export type KnowledgeType = 'personal' | 'general';
export type DocumentFormat = 'text' | 'markdown' | 'docx' | 'pdf';
export interface ParsedDocument {
  version: 1;
  format: DocumentFormat;
  text: string;
  pages?: { number: number; text: string }[];
  pageCount?: number;
  warnings: string[];
}
export interface KnowledgeBase {
  id: string;
  name: string;
  description: string;
  type: KnowledgeType;
  updatedAt: string;
  fileCount: number;
}
export interface KnowledgeFile {
  id: string;
  kbId: string;
  name: string;
  size: number;
  importedAt: string;
  indexStatus: 'not_indexed';
  format?: DocumentFormat;
  pageCount?: number | null;
  textLength?: number | null;
  warnings?: string[];
}
export interface Conversation {
  id: string;
  title: string;
  kbIds: string[];
  createdAt: string;
  updatedAt: string;
}
export interface Message {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant';
  content: string;
  isDemo: boolean;
  createdAt: string;
  provider?: 'deepseek' | 'openai' | null;
  model?: string | null;
}
export type ProviderId = 'deepseek' | 'openai';
export type ReasoningEffort = 'none' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
export interface InferenceOptions {
  effort?: ReasoningEffort;
  speed: 'standard' | 'fast';
}
export interface SetInferenceInput extends InferenceOptions {
  provider: ProviderId;
  model: string;
}
export interface ProviderSettings {
  model: string;
  hasKey: boolean;
  models?: string[];
  catalog?: string[];
  catalogUpdatedAt?: string;
  inference?: Record<string, InferenceOptions>;
}
export interface ModelSettingsView {
  active: ProviderId | 'demo';
  providers: Record<ProviderId, ProviderSettings>;
  error?: string;
}
export interface SaveModelInput {
  provider: ProviderId;
  model: string;
  apiKey: string;
}
export interface Snapshot {
  knowledgeBases: KnowledgeBase[];
  conversations: Conversation[];
  dataPath: string;
}
export interface KnowledgeInput {
  name: string;
  description: string;
  type: KnowledgeType;
}
export interface ImportResult {
  imported: number;
  errors: string[];
}
export type Result<T> = { ok: true; data: T } | { ok: false; error: string };
export interface DesktopApi {
  setInference(input: SetInferenceInput): Promise<ModelSettingsView>;
  selectModel(input: Pick<SaveModelInput, 'provider' | 'model'>): Promise<ModelSettingsView>;
  listModels(provider: ProviderId): Promise<ModelSettingsView>;
  modelSettings(): Promise<ModelSettingsView>;
  saveModel(input: SaveModelInput): Promise<ModelSettingsView>;
  testModel(input: SaveModelInput): Promise<string>;
  removeModelKey(provider: ProviderId): Promise<ModelSettingsView>;
  useDemo(): Promise<ModelSettingsView>;
  cancelGeneration(): Promise<void>;
  snapshot(): Promise<Snapshot>;
  saveKnowledge(input: KnowledgeInput, id?: string): Promise<void>;
  deleteKnowledge(id: string): Promise<void>;
  files(kbId: string): Promise<KnowledgeFile[]>;
  importFiles(kbId: string, files?: File[]): Promise<ImportResult>;
  readFile(id: string): Promise<string>;
  removeFile(id: string): Promise<void>;
  createConversation(): Promise<Conversation>;
  setKnowledge(id: string, kbIds: string[]): Promise<void>;
  messages(id: string): Promise<Message[]>;
  sendMessage(id: string, text: string): Promise<void>;
}
