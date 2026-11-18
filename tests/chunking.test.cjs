const { test } = require('node:test');
const assert = require('node:assert/strict');
const { splitText } = require('../dist-electron/shared/chunking');

test('分块重组与原文完全一致，无丢失/重叠，位置和Unicode字符计数对应', () => {
  const text = '项目一\r\n\n文字解析 JSON 😀 中文。\n第二段：Hello world!\n'.repeat(55);
  const characters = Array.from(text);
  for (const size of [1, 17, 300, 600]) {
    const chunks = splitText(text, size);
    assert.equal(chunks.map((chunk) => chunk.text).join(''), text);
    let end = 0;
    for (const [index, chunk] of chunks.entries()) {
      assert.equal(chunk.number, index + 1);
      assert.equal(chunk.start, end);
      assert.ok(chunk.charCount > 0 && chunk.charCount <= size);
      assert.equal(Array.from(chunk.text).length, chunk.charCount);
      assert.equal(characters.slice(chunk.start, chunk.end).join(''), chunk.text);
      assert.equal(/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/u.test(chunk.text), false);
      end = chunk.end;
    }
    assert.equal(end, characters.length);
  }
});

test('优先选择窗口后半段的段落/换行/句末，保留真实空格', () => {
  for (const separator of ['\n\n', '\n', '。', '.', ' ']) {
    const first = 'A'.repeat(40) + separator;
    const text = first + 'B'.repeat(100);
    assert.equal(splitText(text, 60)[0].text, first);
  }
  const text = 'JSON Hello world 😀\n'.repeat(50);
  assert.equal(
    splitText(text, 300)
      .map((chunk) => chunk.text)
      .join(''),
    text,
  );
});

test('没有分隔符的超长内容按上限切开，增加上限得到更少的块', () => {
  const text = '中'.repeat(1201);
  assert.deepEqual(
    splitText(text, 300).map((chunk) => chunk.charCount),
    [300, 300, 300, 300, 1],
  );
  assert.deepEqual(
    splitText(text, 600).map((chunk) => chunk.charCount),
    [600, 600, 1],
  );
});

test('空白不生成无意义分块，无效上限不会形成死循环', () => {
  for (const text of ['', ' \n\r\t ']) assert.deepEqual(splitText(text), []);
  for (const size of [0, -1, 0.5, NaN, Infinity, 10001, null])
    assert.throws(() => splitText('正文', size), /分块大小/);
});

test('应用最大正文规模仍完整切分，纯文本中的脚本保持原样', () => {
  const seed = '<script>globalThis.__chunkExecuted = true</script>\n资料用于分块学习。\n';
  const text = seed.repeat(Math.ceil(2_000_000 / seed.length)).slice(0, 2_000_000);
  const chunks = splitText(text, 300);
  assert.equal(chunks.map((chunk) => chunk.text).join(''), text);
  assert.ok(chunks.every((chunk) => chunk.charCount <= 300));
  assert.equal(globalThis.__chunkExecuted, undefined);
});
