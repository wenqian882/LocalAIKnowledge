import { app, BrowserWindow, dialog, ipcMain, Menu, session, safeStorage } from 'electron';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Store } from './store';
import type { KnowledgeInput } from '../shared/types';
import { ModelSettings } from './model-settings';
import { ModelService, type ModelTransport } from './model-service';
import { MODEL_PROVIDERS } from '../shared/models';
import { cancelDocumentParsing } from './document-parser';

app.setName('LocalAI Knowledge');
// Test override is deliberately opt-in; production always uses Electron userData.
if (process.env.LOCALAI_TEST_DATA)
  app.setPath('userData', path.resolve(process.env.LOCALAI_TEST_DATA));
else app.setPath('userData', path.join(app.getPath('appData'), 'LocalAIKnowledge'));
const hasLock = app.requestSingleInstanceLock();
let store: Store;
let models: ModelService;
let mainWindow: BrowserWindow | null = null;
const entry = path.join(__dirname, '../..', 'dist', 'index.html');
const trustedURL = pathToFileURL(entry).href;

function register() {
  const handle = (channel: string, action: (...args: any[]) => unknown) => {
    ipcMain.handle(channel, async (event, ...args: any[]) => {
      if (event.sender !== mainWindow?.webContents || event.senderFrame?.url !== trustedURL)
        return { ok: false, error: '无效的应用来源' };
      try {
        return { ok: true, data: await action(...args) };
      } catch (error) {
        const message = error instanceof Error ? error.message : '操作失败';
        // Filesystem errors should not expose full source paths to the renderer.
        return {
          ok: false,
          error: /^(EACCES|EPERM|ENOENT|ENOSPC|SQLITE)/.test(message)
            ? '本地数据操作失败，请检查文件是否存在、目录权限或剩余磁盘空间。'
            : message,
        };
      }
    });
  };
  handle('data:snapshot', () => ({
    knowledgeBases: store.knowledge(),
    conversations: store.conversations(),
    dataPath: store.dataPath,
  }));
  handle('knowledge:save', (input: KnowledgeInput, id?: string) => store.saveKnowledge(input, id));
  handle('knowledge:delete', (id: string) => store.deleteKnowledge(id));
  handle('files:list', (id: string) => store.files(id));
  handle('files:read', (id: string) => store.readFile(id));
  handle('files:remove', (id: string) => store.removeFile(id));
  handle('files:import', async (id: string, droppedPaths?: string[]) => {
    let paths = droppedPaths;
    if (!paths) {
      const result = await dialog.showOpenDialog(mainWindow!, {
        title: '导入文档',
        properties: ['openFile', 'multiSelections'],
        filters: [
          { name: '支持的文档', extensions: ['txt', 'md', 'markdown', 'docx', 'pdf'] },
          { name: 'Word文档', extensions: ['docx'] },
          { name: 'PDF文档', extensions: ['pdf'] },
        ],
      });
      paths = result.canceled ? [] : result.filePaths;
    }
    return store.importFiles(id, paths);
  });
  handle('conversations:create', () => store.createConversation());
  handle('conversations:knowledge', (id: string, ids: string[]) => store.setKnowledge(id, ids));
  handle('messages:list', (id: string) => store.messages(id));
  handle('models:get', () => models.settings.view());
  handle('models:inference', (input) => models.configure(input));
  handle('models:select', (input) => models.select(input));
  handle('models:list', (id) => models.list(id));
  handle('models:save', (input) => models.save(input));
  handle('models:test', (input) => models.test(input));
  handle('models:remove-key', (id) => models.remove(id));
  handle('models:demo', () => models.demo());
  handle('models:cancel', () => models.cancel());
  handle('messages:send', async (id: string, value: string) => {
    const content = store.validateMessage(id, value);
    const answer = await models.generate(store.messages(id), content);
    store.sendMessage(id, content, answer);
  });
}
function openWindow() {
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 900,
    minWidth: 960,
    minHeight: 680,
    title: 'LocalAI Knowledge',
    // Set the window icon as well as the packaged EXE icon so source/test windows
    // do not fall back to Electron's default Windows branding.
    ...(process.platform === 'win32'
      ? { icon: path.join(app.getAppPath(), 'assets', 'app-icon.ico') }
      : {}),
    backgroundColor: '#ffffff',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      spellcheck: false,
    },
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault());
  mainWindow.webContents.on('will-attach-webview', (event) => event.preventDefault());
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
  void mainWindow.loadFile(entry);
}
if (!hasLock) app.quit();
else {
  app.on('second-instance', () => {
    mainWindow?.restore();
    mainWindow?.focus();
  });
  app
    .whenReady()
    .then(() => {
      Menu.setApplicationMenu(null);
      session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) =>
        callback(false),
      );
      session.defaultSession.setPermissionCheckHandler(() => false);
      // Renderer remains offline. Explicit model calls use a separate main-process session.
      session.defaultSession.webRequest.onBeforeRequest(
        { urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] },
        (_details, callback) => callback({ cancel: true }),
      );
      store = new Store(path.join(app.getPath('userData'), 'data'));
      const modelSession = session.fromPartition('localai-model-api');
      modelSession.setPermissionRequestHandler((_contents, _permission, callback) =>
        callback(false),
      );
      modelSession.setPermissionCheckHandler(() => false);
      const allowed: ReadonlySet<string> = new Set(
        Object.values(MODEL_PROVIDERS).map((provider) => provider.endpoint),
      );
      const modelLists: ReadonlySet<string> = new Set(
        Object.values(MODEL_PROVIDERS).map((provider) => provider.modelsEndpoint),
      );
      modelSession.webRequest.onBeforeRequest(
        { urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] },
        (details, callback) =>
          callback({
            cancel: !(
              (details.method === 'POST' && allowed.has(details.url)) ||
              (details.method === 'GET' && modelLists.has(details.url))
            ),
          }),
      );
      const settings = new ModelSettings(store.dataPath, {
        available: async () =>
          (await safeStorage.isAsyncEncryptionAvailable()) &&
          !(
            process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text'
          ),
        encrypt: (value) => safeStorage.encryptStringAsync(value),
        decrypt: async (value) => (await safeStorage.decryptStringAsync(value)).result,
      });
      models = new ModelService(settings, ((url, init) =>
        modelSession.fetch(url, init)) as ModelTransport);
      register();
      openWindow();
      app.on('activate', () => {
        if (!mainWindow) openWindow();
      });
    })
    .catch((error) => {
      dialog.showErrorBox(
        '无法启动本地知识库',
        `请检查应用数据目录的权限与可用空间。\n${error.message}`,
      );
      app.quit();
    });
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
  app.on('will-quit', () => store?.close());
  app.on('before-quit', () => {
    models?.cancel();
    cancelDocumentParsing();
  });
}
