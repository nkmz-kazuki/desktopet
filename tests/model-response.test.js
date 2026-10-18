const test = require('node:test');
const assert = require('node:assert/strict');
const { extractResponseText, sanitizeFinalText } = require('../src/model-response');

function response(...text) {
  return {
    status: 'completed',
    output: [{ type: 'message', role: 'assistant', status: 'completed', content: text.map((value) => ({ type: 'output_text', text: value })) }],
  };
}

test('extracts assistant final output text and ignores reasoning, analysis, other roles and non-final channels', () => {
  const data = response('最终回答。');
  data.output.unshift(
    { type: 'reasoning', summary: [{ type: 'summary_text', text: '不要显示推理摘要' }] },
    { type: 'message', role: 'user', content: [{ type: 'output_text', text: '不要显示用户回显' }] },
    { type: 'message', role: 'system', content: [{ type: 'output_text', text: '不要显示系统内容' }] },
    { type: 'message', role: 'assistant', channel: 'analysis', content: [{ type: 'output_text', text: '不要显示分析' }] },
    { type: 'message', role: 'assistant', channel: 'reasoning', content: [{ type: 'output_text', text: '不要显示推理' }] },
    { type: 'message', role: 'assistant', channel: 'commentary', content: [{ type: 'output_text', text: '不要显示中间输出' }] },
  );
  data.output.at(-1).content.unshift(
    { type: 'reasoning_text', text: '不要显示推理字段' },
    { type: 'analysis', text: '不要显示分析字段' },
    { type: 'output_text', channel: 'analysis', text: '不要显示带分析channel的文本' },
  );
  assert.equal(extractResponseText(data), '最终回答。');
  assert.equal(extractResponseText({ output: [{ type: 'message', content: [{ type: 'output_text', text: '兼容缺少角色的旧响应。' }] }] }), '兼容缺少角色的旧响应。');
});

test('removes mixed and nested exact internal blocks while keeping surrounding final paragraphs', () => {
  const raw = '<ds_safety>内部安全评估</ds_safety>\n\n你好，老师。\n<think>隐藏思考<analysis>嵌套分析</analysis>继续思考</think>\n这是正式答案。';
  assert.equal(extractResponseText(response(raw)), '你好，老师。\n\n这是正式答案。');
  assert.equal(sanitizeFinalText('<DS_SAFETY>内部内容</DS_SAFETY><think />正式答案。'), '正式答案。');
  assert.equal(sanitizeFinalText('<analysis-data>正常自定义标记</analysis-data>'), '<analysis-data>正常自定义标记</analysis-data>');
  assert.equal(sanitizeFinalText('<thinking>内部过程</thinking>最终答案。'), '最终答案。');
  assert.equal(sanitizeFinalText('<thinking>未闭合内部过程'), '');
  assert.equal(sanitizeFinalText('示例：`<thinking>字面代码</thinking>`'), '示例：`<thinking>字面代码</thinking>`');
});

test('recognizes internal tags split across content fragments without leaking or inserting characters', () => {
  assert.equal(extractResponseText(response('<ds_sa', 'fety>不能泄露', '</ds_saf', 'ety>正式', '回答')), '正式回答');
  assert.equal(extractResponseText(response('<think>内部', '<analysis>嵌套内容</ana', 'lysis>隐藏尾部</think>', '\n\n最终答案。')), '最终答案。');
});

test('returns an empty answer for internal-only output and conservatively drops unclosed or mismatched internal tails', () => {
  for (const raw of [
    '<ds_safety>完整但仅有内部内容</ds_safety>',
    '<think>尚未结束的内部内容',
    '<analysis>内部内容\n\n```txt\n示例内容\n```',
    '<think><analysis>内部内容</think>不能确定属于最终回答',
    '<ds_safety/><think />',
  ]) assert.equal(extractResponseText(response(raw)), '');
  assert.equal(sanitizeFinalText('可见开头。<think>不完整的内部内容'), '可见开头。');
  assert.equal(sanitizeFinalText('丢失开标签的内部内容</think>最终回答。'), '最终回答。');
});

test('preserves literal tag examples in fenced, inline and indented Markdown code', () => {
  const markdown = [
    '# 标签示例', '',
    '行内代码：`<think>示例</think>`，以及 ``包含 ` 和 <ds_safety> 的示例``。', '',
    '```xml', '<ds_safety>这是代码示例，不是内部输出。</ds_safety>', '<analysis>保留原样。</analysis>', '```', '',
    '~~~~markdown', '```xml', '<think>嵌套围栏示例</think>', '```', '~~~~', '',
    '缩进代码：', '', '    <analysis>缩进示例</analysis>', '',
    '正文保持完整。',
  ].join('\n');
  assert.equal(extractResponseText(response(markdown)), markdown);
  assert.equal(sanitizeFinalText('转义示例：\\<think>字面内容\\</think>。'), '转义示例：\\<think>字面内容\\</think>。');
});

test('code examples within an internal block remain hidden and cannot terminate it with literal closing tags', () => {
  const raw = '<think>\n```xml\n</think>\n内部示例\n```\n继续内部内容\n</think>正式回答。';
  assert.equal(sanitizeFinalText(raw), '正式回答。');
  assert.equal(sanitizeFinalText('<ds_safety>内部引用 `</ds_safety>` 后续内部内容</ds_safety>最终答案。'), '最终答案。');
});

test('keeps long Unicode Markdown answers without truncating paragraphs, code, links or non-internal HTML', () => {
  const markdown = '# 完整回答\n\n' + '中文🐳 **重点** [链接](https://example.com) <details>说明</details>\n\n'.repeat(12000)
    + '```js\nconst text = "<think>literal</think>";\n```';
  assert.equal(extractResponseText(response('<think>内部内容</think>', markdown)), markdown);
});

test('rejects incomplete, failed or in-progress output instead of exposing partial text', () => {
  for (const status of ['incomplete', 'failed', 'in_progress', 'queued', 'cancelled']) {
    assert.equal(extractResponseText({ ...response('可能不完整的内容'), status }), '');
    const message = response('可能不完整的内容');
    message.output[0].status = status;
    assert.equal(extractResponseText(message), '');
    const content = response('看似已完成的开头。', '可能不完整的后文');
    content.output[0].content[1].status = status;
    assert.equal(extractResponseText(content), '');
  }
  assert.equal(extractResponseText({ ...response('分析内容'), channel: 'analysis' }), '');
});

test('malformed envelopes and non-text fields cannot become visible content', () => {
  for (const value of [null, undefined, 'raw text', {}, { output: null }, { output: {} }, { output: [null, {}, { type: 'message', content: null }] }]) {
    assert.equal(extractResponseText(value), '');
  }
  assert.equal(extractResponseText(response({ dangerous: 'do not stringify' })), '');
  assert.equal(sanitizeFinalText({ text: 'do not stringify' }), '');
});
