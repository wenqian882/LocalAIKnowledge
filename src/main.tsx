import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type {
  Conversation,
  DesktopApi,
  KnowledgeBase,
  KnowledgeFile,
  KnowledgeInput,
  KnowledgeType,
  Message,
  Snapshot,
  ModelSettingsView,
} from '../shared/types';
import { MODEL_PROVIDERS } from '../shared/models';
import { ModelSettingsPanel } from './ModelSettings';
import { ModelControl } from './ModelControl';
import { DocumentPreview } from './DocumentPreview';
import { Icon } from './icons';
import './styles.css';
declare global {
  interface Window {
    desktop: DesktopApi;
  }
}
const api = window.desktop;
const typeLabel = (type: KnowledgeType) => (type === 'personal' ? '个人知识库' : '通用知识库');
const formatDate = (value: string) =>
  new Date(value).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
const sizeLabel = (bytes: number) =>
  bytes < 1024
    ? `${bytes} B`
    : bytes < 1024 * 1024
      ? `${(bytes / 1024).toFixed(1)} KB`
      : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
type Notice = { text: string; error: boolean } | null;
const NoticeContext = React.createContext<{ notice: Notice; close: () => void }>({
  notice: null,
  close: () => {},
});
function Toast({ notice, close }: { notice: Notice; close: () => void }) {
  return (
    notice && (
      <div
        className={`toast ${notice.error ? 'error' : ''}`}
        role={notice.error ? 'alert' : 'status'}
      >
        <Icon name={notice.error ? 'info' : 'check'} size={19} />
        <span>{notice.text}</span>
        <button className="icon-button" aria-label="关闭提示" onClick={close}>
          <Icon name="close" size={16} />
        </button>
      </div>
    )
  );
}

function Modal({
  title,
  children,
  onClose,
  wide = false,
  busy = false,
  settings = false,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  wide?: boolean;
  busy?: boolean;
  settings?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const heading = React.useId();
  const notification = React.useContext(NoticeContext);
  useEffect(() => {
    const node = ref.current!;
    node.showModal();
    return () => node.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className={`modal ${wide ? 'wide' : ''} ${settings ? 'settings-modal' : ''}`}
      aria-labelledby={heading}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <div className="modal-inner">
        <header>
          <h2 id={heading}>{title}</h2>
          <button className="icon-button" aria-label="关闭弹窗" onClick={onClose} disabled={busy}>
            <Icon name="close" />
          </button>
        </header>
        {children}
      </div>
      <Toast {...notification} />
    </dialog>
  );
}
function Empty({
  icon = 'book',
  title,
  text,
  action,
}: {
  icon?: 'book' | 'search' | 'file';
  title: string;
  text: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="empty">
      <span className="empty-icon">
        <Icon name={icon} size={30} />
      </span>
      <h2>{title}</h2>
      <p>{text}</p>
      {action}
    </div>
  );
}
function KnowledgeForm({
  item,
  type,
  busy,
  onClose,
  onSave,
}: {
  item?: KnowledgeBase;
  type: KnowledgeType;
  busy: boolean;
  onClose: () => void;
  onSave: (input: KnowledgeInput, id?: string) => Promise<void>;
}) {
  const [name, setName] = useState(item?.name ?? '');
  const [description, setDescription] = useState(item?.description ?? '');
  const [kind, setKind] = useState(item?.type ?? type);
  const [error, setError] = useState('');
  return (
    <Modal title={item ? '编辑知识库' : '新建知识库'} onClose={onClose} busy={busy}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!name.trim()) {
            setError('请填写知识库名称');
            return;
          }
          void onSave({ name, description, type: kind }, item?.id);
        }}
        noValidate
      >
        <p className="modal-description">给资料一个清晰的归处。你可以稍后添加文件。</p>
        <label>
          名称 <span className="required">*</span>
          <input
            autoFocus
            aria-label="知识库名称"
            maxLength={80}
            value={name}
            aria-invalid={!!error}
            onChange={(event) => {
              setName(event.target.value);
              setError('');
            }}
            placeholder="例如：我的项目笔记"
          />
        </label>
        {error && (
          <p className="field-error" role="alert">
            {error}
          </p>
        )}
        <label>
          简介 <span className="optional">选填</span>
          <textarea
            aria-label="知识库简介"
            rows={3}
            maxLength={500}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="这里会收集哪些资料？"
          />
        </label>
        <fieldset>
          <legend>类型</legend>
          <div className="type-options">
            {(['personal', 'general'] as KnowledgeType[]).map((value) => (
              <label key={value} className={kind === value ? 'chosen' : ''}>
                <input
                  type="radio"
                  name="kind"
                  value={value}
                  checked={kind === value}
                  onChange={() => setKind(value)}
                />
                <span>
                  {typeLabel(value)}
                  <small>
                    {value === 'personal' ? '自己的笔记与项目资料' : '本机整理的公共参考资料'}
                  </small>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <p className="subtle small">两类均保存在本机。「通用」不会自动公开或联网搜集资料。</p>
        <footer className="modal-actions">
          <button type="button" className="button" onClick={onClose} disabled={busy}>
            取消
          </button>
          <button className="button primary" type="submit" disabled={busy}>
            {busy ? '保存中…' : '保存知识库'}
          </button>
        </footer>
      </form>
    </Modal>
  );
}
function App() {
  const [snapshot, setSnapshot] = useState<Snapshot>({
    knowledgeBases: [],
    conversations: [],
    dataPath: '',
  });
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState<'home' | 'knowledge'>('home');
  const [tab, setTab] = useState<KnowledgeType>('personal');
  const [search, setSearch] = useState('');
  const [detailId, setDetailId] = useState<string | null>(null);
  const [fileList, setFileList] = useState<KnowledgeFile[]>([]);
  const [filesLoading, setFilesLoading] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [form, setForm] = useState<{ item?: KnowledgeBase } | null>(null);
  const [confirm, setConfirm] = useState<
    { kind: 'knowledge'; item: KnowledgeBase } | { kind: 'file'; item: KnowledgeFile } | null
  >(null);
  const [preview, setPreview] = useState<{
    name: string;
    content: string;
    warnings?: string[];
    format?: string;
  } | null>(null);
  const [importing, setImporting] = useState(false);
  const [selector, setSelector] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [about, setAbout] = useState(false);
  const [settings, setSettings] = useState(false);
  const [modelPicker, setModelPicker] = useState(false);
  const [modelReady, setModelReady] = useState(false);
  const [sending, setSending] = useState(false);
  const [modelSettings, setModelSettings] = useState<ModelSettingsView>({
    active: 'demo',
    providers: {
      deepseek: { model: MODEL_PROVIDERS.deepseek.defaultModel, hasKey: false },
      openai: { model: MODEL_PROVIDERS.openai.defaultModel, hasKey: false },
    },
  });
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null);
  const [dragging, setDragging] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const detail = snapshot.knowledgeBases.find((item) => item.id === detailId);
  const current = snapshot.conversations.find((item) => item.id === conversationId);
  const draftKey = conversationId ?? 'new';
  const draft = drafts[draftKey] ?? '';
  const linked = snapshot.knowledgeBases.filter((item) => current?.kbIds.includes(item.id));
  const activeProvider = modelSettings.active === 'demo' ? null : modelSettings.active;
  const modelCaption = activeProvider
    ? `${activeProvider === 'openai' ? 'OpenAI' : 'DeepSeek'} · ${modelSettings.providers[activeProvider].model}`
    : '演示模式 · 模型未接入';
  const notifyError = (error: unknown) =>
    setNotice({ text: error instanceof Error ? error.message : '操作失败，请重试', error: true });
  const refresh = async () => {
    const data = await api.snapshot();
    setSnapshot(data);
    return data;
  };
  const run = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try {
      await action();
    } catch (error) {
      notifyError(error);
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    void api
      .modelSettings()
      .then((value) => {
        setModelSettings(value);
        setModelReady(true);
      })
      .catch(notifyError);
    void refresh()
      .then((data) => {
        if (data.conversations.length) setConversationId(data.conversations[0].id);
      })
      .catch(notifyError)
      .finally(() => setLoading(false));
    const prevent = (event: DragEvent) => event.preventDefault();
    window.addEventListener('dragover', prevent);
    window.addEventListener('drop', prevent);
    return () => {
      window.removeEventListener('dragover', prevent);
      window.removeEventListener('drop', prevent);
    };
  }, []);
  useEffect(() => {
    let active = true;
    setMessages([]);
    if (!conversationId) {
      setMessagesLoading(false);
      return;
    }
    setMessagesLoading(true);
    void api
      .messages(conversationId)
      .then((value) => {
        if (active) setMessages(value);
      })
      .catch((error) => {
        if (active) notifyError(error);
      })
      .finally(() => {
        if (active) setMessagesLoading(false);
      });
    return () => {
      active = false;
    };
  }, [conversationId]);
  useEffect(() => {
    let active = true;
    setFileList([]);
    if (!detailId) {
      setFilesLoading(false);
      return;
    }
    setFilesLoading(true);
    void api
      .files(detailId)
      .then((value) => {
        if (active) setFileList(value);
      })
      .catch((error) => {
        if (active) notifyError(error);
      })
      .finally(() => {
        if (active) setFilesLoading(false);
      });
    return () => {
      active = false;
    };
  }, [detailId]);
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);
  useEffect(() => {
    if (!notice || notice.error) return;
    const timer = setTimeout(() => setNotice(null), 6000);
    return () => clearTimeout(timer);
  }, [notice]);
  const newConversation = () =>
    run(async () => {
      const item = await api.createConversation();
      await refresh();
      setConversationId(item.id);
      setPage('home');
    });
  const send = () =>
    run(async () => {
      if (!draft.trim() || !modelReady) return;
      let id = conversationId;
      if (!id) {
        id = (await api.createConversation()).id;
        const createdId = id;
        setDrafts((value) => ({ ...value, [createdId]: draft, new: '' }));
        setConversationId(id);
        await refresh();
      }
      setSending(true);
      try {
        await api.sendMessage(id, draft);
        const updated = await api.messages(id);
        await refresh();
        setMessages(updated);
        const sentId = id;
        setDrafts((value) => ({ ...value, [draftKey]: '', [sentId]: '' }));
      } finally {
        setSending(false);
      }
    });
  const importFiles = (files?: File[]) =>
    run(async () => {
      if (!detailId) return;
      setImporting(true);
      try {
        const result = await api.importFiles(detailId, files);
        setFileList(await api.files(detailId));
        await refresh();
        if (result.imported || result.errors.length)
          setNotice({
            text: `${result.imported ? `已导入 ${result.imported} 个文件，尚未建立检索索引。` : ''}${result.errors.length ? '\n' + result.errors.join('\n') : ''}`,
            error: result.errors.length > 0,
          });
      } finally {
        setImporting(false);
      }
    });
  const openSelector = () =>
    run(async () => {
      let item = current;
      if (!item) {
        item = await api.createConversation();
        await refresh();
        setConversationId(item.id);
      }
      // Carry a draft into the lazily created conversation.
      if (!current && draft) setDrafts((value) => ({ ...value, [item.id]: draft, new: '' }));
      setSelected(item.kbIds);
      setSelector(true);
    });
  const saveKnowledge = async (input: KnowledgeInput, id?: string) =>
    run(async () => {
      await api.saveKnowledge(input, id);
      await refresh();
      setTab(input.type);
      setForm(null);
      setNotice({ text: id ? '知识库已更新' : '知识库已创建，可以添加文件了', error: false });
    });
  const deleteConfirmed = () =>
    run(async () => {
      if (!confirm) return;
      if (confirm.kind === 'knowledge') {
        await api.deleteKnowledge(confirm.item.id);
        if (detailId === confirm.item.id) setDetailId(null);
      } else {
        await api.removeFile(confirm.item.id);
        if (detailId) setFileList(await api.files(detailId));
      }
      await refresh();
      setConfirm(null);
      setNotice({ text: '已删除本地数据，用户原始文件未受影响', error: false });
    });
  const visible = snapshot.knowledgeBases.filter(
    (item) =>
      item.type === tab &&
      `${item.name}\n${item.description}`
        .toLocaleLowerCase()
        .includes(search.trim().toLocaleLowerCase()),
  );

  return (
    <NoticeContext.Provider value={{ notice, close: () => setNotice(null) }}>
      <div className="app-shell">
        <nav className="rail" aria-label="主导航">
          <div className="brand-mark" title="LocalAI Knowledge">
            <svg aria-hidden="true" viewBox="0 0 32 32" fill="none">
              <path d="M6 5v22h20M14 5v14h12" stroke="currentColor" strokeWidth="2.5" />
              <path d="M23 5h4v4h-4z" fill="currentColor" />
            </svg>
          </div>
          <button
            className={`nav-button ${page === 'home' ? 'active' : ''}`}
            title="首页"
            aria-label="首页"
            aria-current={page === 'home' ? 'page' : undefined}
            onClick={() => setPage('home')}
          >
            <Icon name="home" size={23} />
            <span aria-hidden="true">首页</span>
          </button>
          <button
            className={`nav-button ${page === 'knowledge' ? 'active' : ''}`}
            title="知识库"
            aria-label="知识库"
            aria-current={page === 'knowledge' ? 'page' : undefined}
            onClick={() => {
              setPage('knowledge');
              setDetailId(null);
            }}
          >
            <Icon name="book" size={23} />
            <span aria-hidden="true">知识库</span>
          </button>
          <div className="rail-bottom">
            <span className="local-dot" title="数据保存在本机" />
            <button
              className="nav-button"
              title="设置"
              aria-label="设置"
              disabled={busy}
              onClick={() => setSettings(true)}
            >
              <Icon name="settings" />
              <span aria-hidden="true">设置</span>
            </button>
            <button
              className="nav-button"
              title="关于与数据位置"
              aria-label="关于与数据位置"
              onClick={() => setAbout(true)}
            >
              <Icon name="info" />
            </button>
          </div>
        </nav>
        {page === 'home' && (
          <aside className="conversation-sidebar">
            <div className="sidebar-brand">
              LocalAI <span className="brand-subtitle">知识库</span>
            </div>
            <button
              className="button new-chat"
              onClick={() => void newConversation()}
              disabled={busy || loading}
            >
              <Icon name="plus" />
              新建对话
            </button>
            <div className="sidebar-label">
              历史对话 <span>{snapshot.conversations.length}</span>
            </div>
            <div className="history-list">
              {!snapshot.conversations.length && (
                <p className="history-empty">
                  还没有对话
                  <br />
                  从一个问题开始吧
                </p>
              )}
              {snapshot.conversations.map((item) => (
                <button
                  key={item.id}
                  className={`history-item ${item.id === conversationId ? 'selected' : ''}`}
                  disabled={busy}
                  onClick={() => setConversationId(item.id)}
                  title={item.title}
                >
                  <Icon name="chat" size={17} />
                  <span>
                    {item.title}
                    <small>{formatDate(item.updatedAt)}</small>
                  </span>
                </button>
              ))}
            </div>
            <div className="sidebar-foot">
              <Icon name="folder" size={17} />
              <span>
                你的本地工作空间<small>文件与对话保存在这台设备</small>
              </span>
            </div>
          </aside>
        )}
        <main
          className={
            page === 'home'
              ? `chat-main ${messages.length || sending ? 'has-messages' : 'is-empty'}`
              : 'knowledge-main'
          }
        >
          {loading ? (
            <div className="empty">
              <p>正在打开本地工作空间…</p>
            </div>
          ) : page === 'home' ? (
            <>
              <header className="chat-header">
                <div>
                  <span className="header-title">{current?.title ?? '新对话'}</span>
                  <span className="version-label">对话记录</span>
                </div>
                <span className="status-pill">
                  <span />
                  {modelCaption}
                </span>
              </header>
              <div className="chat-scroll">
                {messagesLoading ? (
                  <p className="loading-label">正在读取对话…</p>
                ) : !messages.length && !sending ? (
                  <section className="welcome">
                    <div className="welcome-identity">
                      <Icon name="book" size={33} />
                      <h1>你好，我是 LocalAI</h1>
                    </div>
                    <p>写下问题，开始一段对话</p>
                  </section>
                ) : (
                  <div className="messages" aria-live="polite">
                    {messages.map((message) => (
                      <article key={message.id} className={`message ${message.role}`}>
                        <div className="message-avatar">
                          {message.role === 'user' ? '你' : <Icon name="book" size={20} />}
                        </div>
                        <div className="message-body">
                          <div className="message-meta">
                            {message.role === 'user' ? '你' : 'LocalAI'}
                            {message.isDemo && (
                              <span className="demo-label">演示回复 · 未检索</span>
                            )}
                            {!message.isDemo && message.role === 'assistant' && (
                              <span className="model-message-label">
                                {message.provider === 'openai' ? 'OpenAI' : 'DeepSeek'} ·{' '}
                                {message.model} · 未检索
                              </span>
                            )}
                            <time>{formatDate(message.createdAt)}</time>
                          </div>
                          <div className="message-content">{message.content}</div>
                        </div>
                      </article>
                    ))}
                    <div ref={end} />
                    {sending && (
                      <p className="generation-pending" role="status">
                        正在等待
                        {activeProvider
                          ? ` ${activeProvider === 'openai' ? 'OpenAI' : 'DeepSeek'}`
                          : '演示'}
                        回复…
                      </p>
                    )}
                  </div>
                )}
              </div>
              <div className="composer-area">
                <div className="composer">
                  <textarea
                    aria-label="消息输入"
                    disabled={busy}
                    placeholder="写下你的问题或想法…"
                    value={draft}
                    maxLength={20000}
                    onChange={(event) =>
                      setDrafts((value) => ({ ...value, [draftKey]: event.target.value }))
                    }
                    onKeyDown={(event) => {
                      if (
                        event.key === 'Enter' &&
                        !event.shiftKey &&
                        !event.nativeEvent.isComposing
                      ) {
                        event.preventDefault();
                        if (!busy && modelReady) void send();
                      }
                    }}
                  />
                  <div className="composer-toolbar">
                    <button
                      className={`knowledge-select ${linked.length ? 'has-selection' : ''}`}
                      onClick={() => void openSelector()}
                      disabled={busy}
                      title={
                        linked.map((item) => item.name).join('、') || '选择本次对话关联的知识库'
                      }
                    >
                      <Icon name="book" size={17} />
                      {linked.length ? `已关联 ${linked.length} 个知识库` : '关联知识库'}
                      <span aria-hidden="true">⌄</span>
                    </button>
                    <ModelControl
                      value={modelSettings}
                      busy={busy}
                      perform={run}
                      onChange={setModelSettings}
                      onOpenChange={setModelPicker}
                      onSettings={() => setSettings(true)}
                    >
                      <Toast notice={notice} close={() => setNotice(null)} />
                    </ModelControl>
                    <span className="composer-hint">Shift + Enter 换行</span>
                    {sending ? (
                      <button
                        className="cancel-generation"
                        aria-label="停止生成"
                        onClick={() => void api.cancelGeneration().catch(notifyError)}
                      >
                        <span />
                      </button>
                    ) : (
                      <button
                        className="send-button"
                        aria-label="发送消息"
                        title="发送消息"
                        disabled={
                          busy ||
                          !draft.trim() ||
                          messagesLoading ||
                          !modelReady ||
                          !!modelSettings.error
                        }
                        onClick={() => void send()}
                      >
                        <Icon name="arrow" size={21} />
                      </button>
                    )}
                  </div>
                  {linked.length > 0 && (
                    <div className="linked-chips">
                      {linked.map((item) => (
                        <span key={item.id}>{item.name}</span>
                      ))}
                      <small>仅保存关联，尚未检索</small>
                    </div>
                  )}
                </div>
                <p className="composer-footnote">
                  {activeProvider
                    ? `发送会将对话文字交给 ${activeProvider === 'openai' ? 'OpenAI' : 'DeepSeek'}，可能产生费用 · 关联文档尚未检索`
                    : '演示回复不代表真实 AI 回答 · 演示模式不调用模型'}
                </p>
              </div>
            </>
          ) : detail ? (
            <>
              <header className="detail-top">
                <button className="text-button" onClick={() => setDetailId(null)}>
                  <Icon name="chevron" size={17} />
                  返回知识库
                </button>
                <span className="status-pill">
                  <span />
                  本地保存
                </span>
              </header>
              <div className="knowledge-content">
                <div className="detail-heading">
                  <div className="detail-book">
                    <Icon name="book" size={28} />
                  </div>
                  <div>
                    <span className={`type-badge ${detail.type}`}>{typeLabel(detail.type)}</span>
                    <h1>{detail.name}</h1>
                    <p>{detail.description || '暂无简介'}</p>
                  </div>
                  <button
                    className="button"
                    onClick={() => setForm({ item: detail })}
                    disabled={busy}
                  >
                    <Icon name="edit" size={16} />
                    编辑
                  </button>
                </div>
                <div className="index-notice">
                  <Icon name="info" size={18} />
                  <p>
                    文件导入后可以查看正文。<strong>当前尚未建立检索索引</strong>
                    ，关联对话不会自动读取或检索文件。
                  </p>
                </div>
                <div
                  className={`dropzone ${dragging ? 'dragging' : ''}`}
                  onDragOver={(event) => {
                    event.preventDefault();
                    setDragging(true);
                  }}
                  onDragLeave={(event) => {
                    if (!event.currentTarget.contains(event.relatedTarget as Node))
                      setDragging(false);
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    setDragging(false);
                    if (!busy) void importFiles(Array.from(event.dataTransfer.files));
                  }}
                >
                  <span className="upload-icon">
                    <Icon name="upload" size={24} />
                  </span>
                  <div>
                    <h3>把资料放进知识库</h3>
                    <p>拖入 TXT、Markdown、Word（.docx）或 PDF</p>
                    <small>单个最多 10 MB · PDF 最多 500 页 · 保留原文件</small>
                  </div>
                  <button
                    className="button primary"
                    disabled={busy}
                    onClick={() => void importFiles()}
                  >
                    <Icon name="plus" size={17} />
                    {importing ? '导入并解析中…' : busy ? '处理中…' : '选择文件'}
                  </button>
                </div>
                <p className="import-format-note">
                  Word 和 PDF 会在本机提取文字。扫描件尚未支持 OCR，旧版 .doc 请另存为 .docx；TXT /
                  Markdown 需为 UTF-8。复杂排版请核对原文。
                </p>
                <div className="section-heading">
                  <h2>
                    已导入文件 <span>{fileList.length}</span>
                  </h2>
                  <span>仅应用中的副本</span>
                </div>
                {filesLoading ? (
                  <p className="loading-label">正在读取文件列表…</p>
                ) : !fileList.length ? (
                  <Empty
                    icon="file"
                    title="这里还没有文件"
                    text="添加你的第一份笔记或资料，即可在这里查看正文。"
                  />
                ) : (
                  <div className="file-list">
                    {fileList.map((file) => (
                      <div className="file-row" key={file.id}>
                        <span className="file-icon">
                          <Icon name="file" size={23} />
                        </span>
                        <button
                          className="file-name"
                          onClick={() =>
                            void run(async () =>
                              setPreview({
                                name: file.name,
                                content: await api.readFile(file.id),
                                warnings: file.warnings,
                                format: file.format,
                              }),
                            )
                          }
                        >
                          <strong>{file.name}</strong>
                          <small>
                            {sizeLabel(file.size)} · 导入于 {formatDate(file.importedAt)}
                            {file.pageCount ? ` · ${file.pageCount} 页` : ''}
                            {file.format === 'docx' || file.format === 'pdf' ? ' · 已提取正文' : ''}
                          </small>
                          {!!file.warnings?.length && (
                            <small className="parse-warning">
                              部分内容需核对，查看正文了解详情
                            </small>
                          )}
                        </button>
                        <span className="index-badge">已导入 · 未索引</span>
                        <button
                          className="button compact"
                          disabled={busy}
                          onClick={() =>
                            void run(async () =>
                              setPreview({
                                name: file.name,
                                content: await api.readFile(file.id),
                                warnings: file.warnings,
                                format: file.format,
                              }),
                            )
                          }
                        >
                          查看正文
                        </button>
                        <button
                          className="icon-button danger-hover"
                          aria-label={`移除 ${file.name}`}
                          title="移除应用中的副本"
                          disabled={busy}
                          onClick={() => setConfirm({ kind: 'file', item: file })}
                        >
                          <Icon name="trash" size={17} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          ) : (
            <>
              <header className="knowledge-header">
                <div>
                  <h1>知识库</h1>
                  <p>管理你的笔记、文档与参考资料</p>
                </div>
                <div className="knowledge-tools">
                  <div className="search-field">
                    <Icon name="search" size={18} />
                    <input
                      aria-label="搜索知识库"
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                      placeholder="搜索名称或简介"
                    />
                    {search && (
                      <button
                        className="icon-button"
                        title="清空搜索"
                        aria-label="清空搜索"
                        onClick={() => setSearch('')}
                      >
                        <Icon name="close" size={15} />
                      </button>
                    )}
                  </div>
                  <button className="button primary" onClick={() => setForm({})} disabled={busy}>
                    <Icon name="plus" size={18} />
                    新建知识库
                  </button>
                </div>
              </header>
              <div className="knowledge-content list-content">
                <div className="tabs" role="tablist" aria-label="知识库类型">
                  {(['personal', 'general'] as KnowledgeType[]).map((value) => (
                    <button
                      role="tab"
                      aria-selected={tab === value}
                      aria-controls="knowledge-panel"
                      id={`tab-${value}`}
                      key={value}
                      className={tab === value ? 'active' : ''}
                      onClick={() => setTab(value)}
                    >
                      {typeLabel(value)}
                      <span>
                        {snapshot.knowledgeBases.filter((item) => item.type === value).length}
                      </span>
                    </button>
                  ))}
                </div>
                <p className="tab-description">
                  {tab === 'personal'
                    ? '收集自己的笔记、项目资料与内部参考文件。'
                    : '在本机整理公共参考资料。不会自动公开、联网搜索或预置行业资料。'}
                </p>
                <div role="tabpanel" id="knowledge-panel" aria-labelledby={`tab-${tab}`}>
                  {!visible.length ? (
                    <Empty
                      icon={search.trim() ? 'search' : 'book'}
                      title={search.trim() ? '没有找到匹配的知识库' : '从第一个知识库开始'}
                      text={
                        search.trim()
                          ? '试试其他名称或简介关键词。'
                          : '把零散的资料收集起来，让每次学习都有积累。'
                      }
                      action={
                        search.trim() ? (
                          <button className="button" onClick={() => setSearch('')}>
                            清空搜索
                          </button>
                        ) : (
                          <button className="button primary" onClick={() => setForm({})}>
                            <Icon name="plus" size={17} />
                            新建知识库
                          </button>
                        )
                      }
                    />
                  ) : (
                    <div className="knowledge-grid">
                      {visible.map((item) => (
                        <article className="knowledge-card" key={item.id}>
                          <button
                            className="card-open"
                            onClick={() => setDetailId(item.id)}
                            aria-label={`打开知识库 ${item.name}`}
                          >
                            <div className="card-top">
                              <Icon name="book" size={24} />
                              <span className={`type-badge ${item.type}`}>
                                {item.type === 'personal' ? '个人' : '通用'}
                              </span>
                            </div>
                            <h2>{item.name}</h2>
                            <p>{item.description || '暂无简介，点击编辑添加。'}</p>
                          </button>
                          <footer>
                            <span>
                              <Icon name="file" size={14} />
                              {item.fileCount} 个文件
                            </span>
                            <time title={new Date(item.updatedAt).toLocaleString('zh-CN')}>
                              {formatDate(item.updatedAt)} 更新
                            </time>
                            <div className="card-actions">
                              <button
                                className="icon-button"
                                aria-label={`编辑 ${item.name}`}
                                title="编辑知识库"
                                onClick={() => setForm({ item })}
                              >
                                <Icon name="edit" size={16} />
                              </button>
                              <button
                                className="icon-button danger-hover"
                                aria-label={`删除 ${item.name}`}
                                title="删除知识库"
                                onClick={() => setConfirm({ kind: 'knowledge', item })}
                              >
                                <Icon name="trash" size={16} />
                              </button>
                            </div>
                          </footer>
                        </article>
                      ))}
                    </div>
                  )}
                </div>
                <div className="local-note">
                  <Icon name="folder" size={15} />
                  <span>知识库、文件副本和聊天记录均保存在应用数据目录。</span>
                  <button className="text-button" onClick={() => setAbout(true)}>
                    查看位置
                  </button>
                </div>
              </div>
            </>
          )}
        </main>
        {!form && !confirm && !preview && !selector && !about && !settings && !modelPicker && (
          <Toast notice={notice} close={() => setNotice(null)} />
        )}
        {form && (
          <KnowledgeForm
            item={form.item}
            type={tab}
            busy={busy}
            onClose={() => setForm(null)}
            onSave={saveKnowledge}
          />
        )}
        {settings && (
          <Modal title="模型设置" settings busy={busy} onClose={() => setSettings(false)}>
            <ModelSettingsPanel
              value={modelSettings}
              busy={busy}
              perform={run}
              onChange={setModelSettings}
            />
          </Modal>
        )}
        {confirm && (
          <Modal
            title={confirm.kind === 'knowledge' ? '删除知识库？' : '移除文件副本？'}
            busy={busy}
            onClose={() => setConfirm(null)}
          >
            <p className="confirm-name">{confirm.item.name}</p>
            <p className="modal-description">
              {confirm.kind === 'knowledge'
                ? `将删除这个知识库的名称、简介、${confirm.item.fileCount} 个已导入文件副本和对话中的关联。聊天消息会保留。`
                : '将删除此文件在应用数据目录中的副本和导入记录。'}
            </p>
            <div className="deletion-note">不会删除你导入前的原始文件。此操作无法撤销。</div>
            <footer className="modal-actions">
              <button className="button" onClick={() => setConfirm(null)} disabled={busy}>
                取消
              </button>
              <button
                className="button danger"
                disabled={busy}
                onClick={() => void deleteConfirmed()}
              >
                {busy ? '处理中…' : '确认删除'}
              </button>
            </footer>
          </Modal>
        )}
        {preview && (
          <Modal title={preview.name} wide onClose={() => setPreview(null)}>
            <DocumentPreview {...preview} />
          </Modal>
        )}
        {selector && (
          <Modal title="关联知识库" busy={busy} onClose={() => setSelector(false)}>
            <p className="modal-description">
              选择本次对话要关联的资料。当前只保存选择，尚未读取或检索文件。
            </p>
            <div className="selector-list">
              {snapshot.knowledgeBases.map((item) => (
                <label key={item.id}>
                  <input
                    type="checkbox"
                    checked={selected.includes(item.id)}
                    onChange={(event) =>
                      setSelected((value) =>
                        event.target.checked
                          ? [...value, item.id]
                          : value.filter((id) => id !== item.id),
                      )
                    }
                  />
                  <span>
                    <strong>{item.name}</strong>
                    <small>
                      {typeLabel(item.type)} · {item.fileCount} 个文件
                    </small>
                  </span>
                </label>
              ))}
              {!snapshot.knowledgeBases.length && (
                <p className="subtle">还没有知识库。先去知识库页面创建一个吧。</p>
              )}
            </div>
            <footer className="modal-actions">
              <button className="button" onClick={() => setSelector(false)}>
                取消
              </button>
              <button
                className="button primary"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    if (!conversationId) return;
                    await api.setKnowledge(conversationId, selected);
                    await refresh();
                    setSelector(false);
                  })
                }
              >
                保存选择
              </button>
            </footer>
          </Modal>
        )}
        {about && (
          <Modal title="关于 LocalAI Knowledge" onClose={() => setAbout(false)}>
            <p className="modal-description">一个本地优先的桌面知识工作空间 · v0.7.0</p>
            <label>
              数据目录<code className="data-path">{snapshot.dataPath || '暂时无法读取'}</code>
            </label>
            <p className="small subtle">
              知识库与聊天存入 knowledge.sqlite，文件副本存入 files
              文件夹。关闭应用后，可整体备份此目录。
            </p>
            <div className="index-notice">
              <Icon name="info" size={18} />
              <p>
                本版可在设置中接入 DeepSeek 或
                OpenAI。启用后，发送消息会将对话文字交给所选服务商并可能产生费用。文档切分、向量化与
                RAG 尚未实现，关联文件不会自动发送。「本地桌面」不代表模型在本机运行。
              </p>
            </div>
            <footer className="modal-actions">
              <button className="button primary" onClick={() => setAbout(false)}>
                知道了
              </button>
            </footer>
          </Modal>
        )}
      </div>
    </NoticeContext.Provider>
  );
}
class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <div className="fatal">
        <h1>界面暂时无法打开</h1>
        <p>请关闭并重新启动应用。已有本地数据会保留。</p>
      </div>
    ) : (
      this.props.children
    );
  }
}
createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
);
