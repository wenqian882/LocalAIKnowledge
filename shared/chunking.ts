export interface TextChunk {
  number: number;
  /** Start/end offsets count Unicode code points; end is exclusive. */
  start: number;
  end: number;
  text: string;
  charCount: number;
}

/** A deterministic, local baseline. No overlap, model calls or persisted index. */
export function splitText(text: string, maxChars = 300): TextChunk[] {
  if (!Number.isInteger(maxChars) || maxChars < 1 || maxChars > 10_000)
    throw new Error('分块大小必须为 1 到 10000 之间的整数');
  if (!text.trim()) return [];
  const characters = Array.from(text);
  const chunks: TextChunk[] = [];
  const boundaries = [
    (i: number) => characters[i] === '\n' && characters[i - 1] === '\n',
    (i: number) => characters[i] === '\n',
    (i: number) => /[。！？.!?；;]/u.test(characters[i]),
    (i: number) => /[ \t]/u.test(characters[i]),
  ];
  let start = 0;
  while (start < characters.length) {
    let end = Math.min(start + maxChars, characters.length);
    if (end < characters.length) {
      const minimum = start + Math.ceil(maxChars / 2);
      findBoundary: for (const isBoundary of boundaries) {
        for (let i = end - 1; i >= minimum - 1; i--) {
          if (isBoundary(i)) {
            end = i + 1;
            break findBoundary;
          }
        }
      }
    }
    chunks.push({
      number: chunks.length + 1,
      start,
      end,
      text: characters.slice(start, end).join(''),
      charCount: end - start,
    });
    start = end;
  }
  return chunks;
}
