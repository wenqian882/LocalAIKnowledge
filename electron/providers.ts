import type { Message, ParsedDocument } from '../shared/types';

// A future adapter must require explicit configuration and user consent before network use.
export interface ModelConfiguration {
  provider: string;
  baseUrl: string;
  model: string;
  credentialRef: string;
}
export interface ModelProvider {
  generate(messages: Message[], context: RetrievedPassage[]): Promise<string>;
}
export interface RetrievedPassage {
  fileId: string;
  text: string;
  score: number;
}
export interface RetrievalProvider {
  retrieve(query: string, kbIds: string[]): Promise<RetrievedPassage[]>;
}
export interface DocumentParser {
  extensions: string[];
  parse(name: string, bytes: Uint8Array): Promise<ParsedDocument>;
}
export const demoReply =
  '这是一条演示回复，用于验证消息发送与本地历史保存。当前尚未接入模型 API，也没有读取或检索关联知识库。你可以先整理资料，后续再接入模型与 RAG。';
