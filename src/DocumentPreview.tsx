import { useId, useMemo, useState } from 'react';
import { splitText } from '../shared/chunking';
import { Icon } from './icons';

const PAGE_SIZE = 20;

export function DocumentPreview({
  content,
  format,
  warnings,
}: {
  content: string;
  format?: string;
  warnings?: string[];
}) {
  const [view, setView] = useState<'text' | 'chunks'>('text');
  const [maxChars, setMaxChars] = useState(300);
  const [page, setPage] = useState(0);
  const [query, setQuery] = useState('');
  const sizeId = useId();
  const chunks = useMemo(
    () => (view === 'chunks' ? splitText(content, maxChars) : []),
    [content, maxChars, view],
  );
  const keyword = query.trim().toLowerCase();
  const matches = useMemo(
    () => (keyword ? chunks.filter((chunk) => chunk.text.toLowerCase().includes(keyword)) : chunks),
    [chunks, keyword],
  );
  const pageCount = Math.ceil(matches.length / PAGE_SIZE);
  return (
    <>
      <p className="preview-note">纯文本预览 · 未建立检索索引 · 文档内容不会作为指令执行</p>
      {(format === 'pdf' || format === 'docx') && (
        <p className="preview-note">
          以下为提取文字，图片、表格结构和复杂排版可能未保留；请对照原文件核查。
        </p>
      )}
      {warnings?.map((warning, index) => (
        <p className="parse-warning" role="note" key={index}>
          {warning}
        </p>
      ))}
      <div className="document-view-switch" role="group" aria-label="文档预览方式">
        <button type="button" aria-pressed={view === 'text'} onClick={() => setView('text')}>
          正文
        </button>
        <button
          type="button"
          aria-pressed={view === 'chunks'}
          onClick={() => {
            setView('chunks');
            setPage(0);
          }}
        >
          查看分块
        </button>
      </div>
      {view === 'text' ? (
        <pre className="document-text">{content || '（空文件）'}</pre>
      ) : (
        <section className="chunk-preview" aria-label="分块预览">
          <div className="chunk-toolbar">
            <label htmlFor={sizeId}>每块最多</label>
            <select
              id={sizeId}
              aria-label="分块大小"
              title="按字符计数，包含空格和换行"
              value={maxChars}
              onChange={(event) => {
                setMaxChars(Number(event.target.value));
                setPage(0);
              }}
            >
              <option value={300}>300 个字符</option>
              <option value={600}>600 个字符</option>
            </select>
            <span role="status">
              {keyword
                ? `命中 ${matches.length} / 共 ${chunks.length} 块`
                : `共 ${chunks.length} 块`}
            </span>
          </div>
          <div className="chunk-search" role="search" aria-label="当前文档关键词检索">
            <Icon name="search" size={16} />
            <input
              type="text"
              aria-label="分块关键词"
              maxLength={120}
              placeholder="查找当前文档分块，例如 Excel"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setPage(0);
              }}
            />
            {query && (
              <button
                type="button"
                className="text-button"
                aria-label="清空分块关键词"
                onClick={() => {
                  setQuery('');
                  setPage(0);
                }}
              >
                清空
              </button>
            )}
          </div>
          <p className="chunk-help">
            仅查当前文档，按字面匹配，忽略英文大小写。分块只在本机预览，未建立索引或接入问答。
          </p>
          <ol className="chunk-list" aria-label="分块结果" key={`${maxChars}-${page}-${keyword}`}>
            {matches.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map((chunk) => (
              <li className="chunk-item" key={chunk.number}>
                <div className="chunk-heading">
                  <strong>第 {chunk.number} 块</strong>
                  <span>{chunk.charCount} 个字符</span>
                </div>
                <pre className="chunk-text">{chunk.text}</pre>
              </li>
            ))}
          </ol>
          {!!chunks.length && !matches.length && (
            <div className="chunk-no-results" role="note">
              <p>没有找到包含“{query.trim()}”的分块。</p>
              <p>关键词未命中不代表资料一定没有答案，可以换个词或核对正文。</p>
            </div>
          )}
          {!chunks.length && <p className="chunk-help">没有可分块的正文。</p>}
          {pageCount > 1 && (
            <div className="chunk-pagination" aria-label="分块翻页">
              <button
                className="button compact"
                aria-label="上一页分块"
                disabled={page === 0}
                onClick={() => setPage(page - 1)}
              >
                上一页
              </button>
              <span>
                第 {page + 1} / {pageCount} 页
              </span>
              <button
                className="button compact"
                aria-label="下一页分块"
                disabled={page + 1 === pageCount}
                onClick={() => setPage(page + 1)}
              >
                下一页
              </button>
            </div>
          )}
        </section>
      )}
    </>
  );
}
