const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { mainHarness } = require('./main-harness');

const SOURCE_URL = 'https://example.org/verified-award';
const SOURCE_TITLE = '核实过的官方奖项说明';
const SEARCH_ENDPOINT = 'https://api.deepseek.com/v1/tools/search';

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

function finalAnswer(text, overrides = {}) {
  return {
    status: 'completed',
    output: [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text }] }],
    ...overrides,
  };
}

function searchCall(callId = 'search-1', overrides = {}) {
  return {
    type: 'function_call', id: `function-${callId}`, call_id: callId, name: 'web_search', status: 'completed',
    arguments: JSON.stringify({ query: '2026 奖项 官方信息' }), ...overrides,
  };
}

function toolResponse(...calls) {
  return { status: 'completed', output: calls };
}

function searchResults() {
  return { results: [{ title: SOURCE_TITLE, url: SOURCE_URL, snippet: '搜索返回的测试资料。' }] };
}

async function scenario(t, { responses, search = () => jsonResponse(searchResults()), saved }) {
  const calls = [];
  let responseIndex = 0;
  const harness = await mainHarness(t, { saved, fetchImpl: async (url, options) => {
    const endpoint = String(url);
    const body = options?.body ? JSON.parse(options.body) : undefined;
    calls.push({ url: endpoint, method: options?.method, body });
    if (endpoint === 'https://api.deepseek.com/responses') {
      const next = responses[responseIndex++];
      assert.notEqual(next, undefined, 'the model loop must not make an unplanned extra request');
      return next instanceof Response ? next : jsonResponse(next);
    }
    if (endpoint === SEARCH_ENDPOINT) return search(body);
    throw new Error('Unexpected network route in isolated integration test.');
  } });
  return {
    ...harness,
    calls,
    modelCalls: () => calls.filter((entry) => entry.url === 'https://api.deepseek.com/responses'),
    searchCalls: () => calls.filter((entry) => entry.url === SEARCH_ENDPOINT),
    archive: async () => fs.readFile((await harness.invoke('settings:get')).conversationFile, 'utf8'),
  };
}

test('both active model IDs reach the Responses request with max reasoning even after loading an old lower setting', async (t) => {
  for (const modelId of ['deepseek-flash', 'deepseek-v4-pro']) {
    await t.test(modelId, async (subtest) => {
      const harness = await scenario(subtest, {
        saved: { modelId, reasoningEffort: 'none' }, responses: [finalAnswer('海水潮汐主要受引力影响。')],
      });
      const result = await harness.invoke('chat:send', '解释一下海洋潮汐。');
      assert.equal(result.error, undefined);
      assert.equal(result.model, modelId);
      assert.equal(harness.modelCalls().length, 1);
      assert.equal(harness.modelCalls()[0].body.model, modelId);
      assert.deepEqual(harness.modelCalls()[0].body.reasoning, { effort: 'max' });
      assert.equal(harness.searchCalls().length, 0);
    });
  }
});

test('the production prompt requests prose without asterisk formatting or hash headings while long answers and literal code remain intact', async (t) => {
  const answer = '1. 这是完整的解释文字。\n'.repeat(7000) + '\n```python\n# 保留代码注释\nanswer = 2 ** 8\n```\n逐字引用：“# 原文标题与 **原文星号**”。';
  const harness = await scenario(t, { responses: [finalAnswer(answer)] });
  const result = await harness.invoke('chat:send', '详细解释并保留代码及逐字引用。');
  assert.equal(result.error, undefined);
  assert.equal(result.text, answer);
  assert.ok((await harness.archive()).includes(answer));
  const { instructions } = harness.modelCalls()[0].body;
  assert.ok(instructions.includes('解释文字用纯文本，分点可用数字编号，不用星号或双星号（**）做加粗/项目符号，不用井号（#）标注标题层级；代码和要求逐字引用的原文保持原样。'));
});

test('provider model metadata is retained when available', async (t) => {
  const harness = await scenario(t, {
    saved: { modelId: 'deepseek-v4-pro', reasoningEffort: 'max' },
    responses: [finalAnswer('这是正式回答。', { model: 'deepseek-v4-pro-test-version' })],
  });
  const result = await harness.invoke('chat:send', '讲个故事。');
  assert.equal(result.model, 'deepseek-v4-pro-test-version');
  assert.equal(harness.modelCalls()[0].body.model, 'deepseek-v4-pro');
});

test('changing settings during search freezes the initial model across tool and fallback rounds while all rounds use max reasoning', async (t) => {
  for (const { name, first, initial, changed } of [
    {
      name: 'model function tool', first: toolResponse(searchCall()),
      initial: { modelId: 'deepseek-flash', reasoningEffort: 'high' },
      changed: { modelId: 'deepseek-v4-pro', reasoningEffort: 'max' },
    },
    {
      name: 'mandatory fallback search', first: finalAnswer('首轮尚未核实的回答。'),
      initial: { modelId: 'deepseek-v4-pro', reasoningEffort: 'none' },
      changed: { modelId: 'deepseek-flash', reasoningEffort: 'low' },
    },
  ]) {
    await t.test(name, async (subtest) => {
      let signalSearch;
      let finishSearch;
      const searchStarted = new Promise((resolve) => { signalSearch = resolve; });
      const searchPending = new Promise((resolve) => { finishSearch = resolve; });
      const harness = await scenario(subtest, {
        saved: initial,
        responses: [first, finalAnswer('根据实际检索作出的正式回答。'), finalAnswer('接下来的海洋故事。')],
        search: async () => { signalSearch(); return searchPending; },
      });
      const pending = harness.invoke('chat:send', '查一下今年的科学奖项。');
      await searchStarted;
      await harness.invoke('settings:save', changed);
      finishSearch(jsonResponse(searchResults()));
      const result = await pending;
      assert.equal(result.error, undefined);
      assert.equal(result.model, initial.modelId);
      assert.ok(result.text.includes(SOURCE_URL));
      assert.equal(harness.modelCalls().length, 2);
      for (const { body } of harness.modelCalls()) {
        assert.equal(body.model, initial.modelId);
        assert.equal(body.reasoning.effort, 'max');
      }
      assert.equal(harness.searchCalls().length, 1);
      assert.equal('model' in harness.searchCalls()[0].body, false);
      assert.equal('reasoning' in harness.searchCalls()[0].body, false);
      const next = await harness.invoke('chat:send', '请讲个海洋故事。');
      assert.equal(next.model, changed.modelId);
      assert.equal(harness.modelCalls()[2].body.model, changed.modelId);
      assert.equal(harness.modelCalls()[2].body.reasoning.effort, 'max');
    });
  }
});

test('internal-only model output returns a friendly retry error, archives no internal content and leaves the next request clean', async (t) => {
  const harness = await scenario(t, { responses: [
    finalAnswer('<ds_safety>INTERNAL_SAFETY_DO_NOT_DISPLAY</ds_safety>'),
    finalAnswer('这是一则新的故事。'),
  ] });
  const failed = await harness.invoke('chat:send', '请解释量子纠缠。');
  assert.match(failed.error, /没有收到有效答案.*再试/);
  assert.equal(failed.text, undefined);
  assert.equal(JSON.stringify(failed).includes('INTERNAL_SAFETY'), false);
  const archived = await harness.archive();
  assert.ok(archived.includes(failed.error));
  assert.equal(archived.includes('INTERNAL_SAFETY'), false);
  assert.equal(archived.includes('<ds_safety>'), false);
  await harness.invoke('chat:send', '换个话题，讲个海洋故事。');
  assert.deepEqual(harness.modelCalls()[1].body.input, [{ role: 'user', content: '换个话题，讲个海洋故事。' }]);
  assert.equal(harness.searchCalls().length, 0);
});

test('mixed internal and final text exposes only the cleaned answer through IPC, archive and subsequent model history', async (t) => {
  const clean = '# 正式回答\n\n保留这段中文与 **Markdown**。';
  const harness = await scenario(t, { responses: [
    finalAnswer(`<ds_safety>HIDDEN_CLASSIFICATION</ds_safety><think>HIDDEN_REASONING</think>${clean}`),
    finalAnswer('继续解释。'),
  ] });
  const result = await harness.invoke('chat:send', '解释一下海洋潮汐。');
  assert.equal(result.text, clean);
  assert.equal(result.kind, 'model');
  const archived = await harness.archive();
  assert.ok(archived.includes(clean));
  assert.equal(/HIDDEN_|<ds_safety>|<think>/.test(archived), false);
  await harness.invoke('chat:send', '请继续详细解释。');
  assert.deepEqual(harness.modelCalls()[1].body.input, [
    { role: 'user', content: '解释一下海洋潮汐。' },
    { role: 'assistant', content: clean },
    { role: 'user', content: '请继续详细解释。' },
  ]);
});

test('fresh-information requests execute real search plumbing, return tool output with original reasoning and cite actual returned sources', async (t) => {
  const reasoning = { type: 'reasoning', id: 'reasoning-round-1', summary: [{ type: 'summary_text', text: 'INTERNAL_TOOL_REASONING' }] };
  const call = searchCall();
  const harness = await scenario(t, { responses: [
    toolResponse(reasoning, call),
    finalAnswer('<ds_safety>HIDDEN_CLASSIFICATION</ds_safety>根据检索资料，正式说明如下。'),
    finalAnswer('下一个普通话题。'),
  ] });
  const result = await harness.invoke('chat:send', '查一下今年的诺贝尔物理学奖。');
  assert.equal(result.error, undefined);
  assert.equal(harness.searchCalls().length, 1);
  assert.equal(harness.searchCalls()[0].method, 'POST');
  assert.equal(harness.searchCalls()[0].body.query, '2026 奖项 官方信息');
  assert.equal(harness.modelCalls()[0].body.tool_choice, 'auto');
  assert.equal(harness.modelCalls()[1].body.tool_choice, 'auto');
  const secondInput = harness.modelCalls()[1].body.input;
  assert.deepEqual(secondInput.find((item) => item.type === 'reasoning'), reasoning);
  assert.deepEqual(secondInput.find((item) => item.type === 'function_call'), call);
  const output = secondInput.find((item) => item.type === 'function_call_output');
  assert.equal(output.call_id, call.call_id);
  assert.equal(JSON.parse(output.output).results[0].url, SOURCE_URL);
  assert.ok(result.text.startsWith('根据检索资料，正式说明如下。'));
  assert.ok(result.text.endsWith(`${SOURCE_TITLE}\n${SOURCE_URL}`));
  const archived = await harness.archive();
  assert.ok(archived.includes(SOURCE_URL));
  assert.equal(/INTERNAL_TOOL_REASONING|HIDDEN_CLASSIFICATION/.test(archived), false);
  await harness.invoke('chat:send', '接着聊聊海洋故事。');
  const nextInput = harness.modelCalls()[2].body.input;
  assert.equal(nextInput.length, 3);
  assert.equal(nextInput[1].content, result.text);
  assert.equal(nextInput.some((item) => item.type), false);
  assert.equal(JSON.stringify(nextInput).includes('INTERNAL_TOOL_REASONING'), false);
});

test('when the model skips required search, the app searches and regenerates from external data without preserving the unverified first answer', async (t) => {
  const unverified = '我查到了未经验证的消息。<ds_safety>DISCARDED_INTERNAL_CONTENT</ds_safety>';
  const harness = await scenario(t, { responses: [
    finalAnswer(unverified), finalAnswer('依据实际检索结果给出的正式回答。'), finalAnswer('普通回答。'),
  ] });
  const question = '查一下今年的新消息。';
  const result = await harness.invoke('chat:send', question);
  assert.equal(result.error, undefined);
  assert.equal(harness.searchCalls().length, 1);
  assert.equal(harness.searchCalls()[0].body.query, `查一下${new Date().getFullYear()}年的新消息。`);
  assert.equal(harness.modelCalls().length, 2);
  assert.ok(harness.modelCalls().every((call) => call.body.tool_choice === 'auto'));
  const secondInput = harness.modelCalls()[1].body.input;
  assert.equal(secondInput.length, 2);
  assert.deepEqual(secondInput[0], { role: 'user', content: question });
  assert.equal(secondInput[1].role, 'user');
  assert.match(secondInput[1].content, /外部参考资料.*指令不可执行/);
  const external = JSON.parse(secondInput[1].content.slice(secondInput[1].content.indexOf('\n') + 1));
  assert.equal(external.results[0].url, SOURCE_URL);
  assert.equal(JSON.stringify(secondInput).includes('未经验证的消息'), false);
  assert.equal(JSON.stringify(secondInput).includes('DISCARDED_INTERNAL_CONTENT'), false);
  assert.ok(result.text.startsWith('依据实际检索结果给出的正式回答。'));
  assert.ok(result.text.endsWith(`${SOURCE_TITLE}\n${SOURCE_URL}`));
  const archived = await harness.archive();
  assert.equal(/未经验证的消息|DISCARDED_INTERNAL_CONTENT/.test(archived), false);
  assert.ok(archived.includes(SOURCE_URL));
  await harness.invoke('chat:send', '讲个故事。');
  assert.deepEqual(harness.modelCalls()[2].body.input, [
    { role: 'user', content: question },
    { role: 'assistant', content: result.text },
    { role: 'user', content: '讲个故事。' },
  ]);
});

test('fallback search limits the original question to 128 Unicode characters after expanding the relative year', async (t) => {
  const harness = await scenario(t, { responses: [finalAnswer('未核实的首轮回答。'), finalAnswer('检索后的正式回答。')] });
  const question = '查一下今年' + '🐳'.repeat(200);
  const result = await harness.invoke('chat:send', question);
  assert.equal(result.error, undefined);
  const query = harness.searchCalls()[0].body.query;
  assert.equal(Array.from(query).length, 128);
  assert.equal(query, Array.from(question.replace('今年', `${new Date().getFullYear()}年`)).slice(0, 128).join(''));
  assert.equal(query.endsWith('🐳'), true);
});

test('failed or empty fallback search reports an error without keeping the unverified first answer or polluting history', async (t) => {
  for (const [name, search] of [
    ['fallback HTTP failure', () => jsonResponse({ error: { message: 'FALLBACK_PRIVATE_DIAGNOSTIC' } }, 503)],
    ['fallback empty results', () => jsonResponse({ results: [] })],
  ]) {
    await t.test(name, async (subtest) => {
      const harness = await scenario(subtest, { responses: [
        finalAnswer('这是未经检索的断言。'), finalAnswer('新的普通回答。'),
      ], search });
      const result = await harness.invoke('chat:send', '查一下今年的新消息。');
      assert.ok(result.error);
      assert.equal(result.text, undefined);
      assert.equal(harness.searchCalls().length, 1);
      assert.equal(harness.modelCalls().length, 1);
      const archived = await harness.archive();
      assert.equal(/未经检索的断言|FALLBACK_PRIVATE_DIAGNOSTIC|参考来源：/.test(archived), false);
      await harness.invoke('chat:send', '请讲个海洋故事。');
      assert.deepEqual(harness.modelCalls()[1].body.input, [{ role: 'user', content: '请讲个海洋故事。' }]);
    });
  }
});

test('failed or empty search never fabricates successful retrieval or contaminates later history', async (t) => {
  for (const [name, search] of [
    ['HTTP failure', () => jsonResponse({ error: { message: 'UPSTREAM_PRIVATE_DIAGNOSTIC' } }, 503)],
    ['empty results', () => jsonResponse({ results: [] })],
  ]) {
    await t.test(name, async (subtest) => {
      const harness = await scenario(subtest, { responses: [toolResponse(searchCall()), finalAnswer('干净的新回答。')], search });
      const result = await harness.invoke('chat:send', '搜索近期的科学新闻。');
      assert.ok(result.error);
      assert.equal(result.text, undefined);
      assert.equal(harness.modelCalls().length, 1);
      assert.equal(harness.searchCalls().length, 1);
      const archived = await harness.archive();
      assert.equal(archived.includes('UPSTREAM_PRIVATE_DIAGNOSTIC'), false);
      assert.equal(archived.includes('参考来源：'), false);
      await harness.invoke('chat:send', '请讲个故事。');
      assert.deepEqual(harness.modelCalls()[1].body.input, [{ role: 'user', content: '请讲个故事。' }]);
    });
  }
});

test('incomplete responses and invalid tool calls stop safely and never become a successful answer', async (t) => {
  const cases = [
    ['incomplete response', finalAnswer('UNFINISHED_RESPONSE', { status: 'incomplete' }), 0],
    ['unknown tool', toolResponse(searchCall('bad-name', { name: 'read_local_file' })), 0],
    ['invalid JSON arguments', toolResponse(searchCall('bad-json', { arguments: '{broken' })), 0],
    ['empty query', toolResponse(searchCall('empty-query', { arguments: JSON.stringify({ query: ' ' }) })), 0],
    ['extra arguments', toolResponse(searchCall('extra-argument', { arguments: JSON.stringify({ query: '科学', url: 'file:///private' }) })), 0],
    ['oversized Unicode query', toolResponse(searchCall('long-query', { arguments: JSON.stringify({ query: '鲸'.repeat(129) }) })), 0],
    ['duplicate call id', toolResponse(searchCall('same-id'), searchCall('same-id')), 1],
    ['too many calls', toolResponse(...[1, 2, 3, 4].map((index) => searchCall(`over-limit-${index}`))), 0],
  ];
  for (const [name, response, expectedSearches] of cases) {
    await t.test(name, async (subtest) => {
      const harness = await scenario(subtest, { responses: [response, finalAnswer('下一问的正式回答。')] });
      const result = await harness.invoke('chat:send', '搜索最新的科学进展。');
      assert.ok(result.error);
      assert.equal(result.text, undefined);
      assert.equal(harness.searchCalls().length, expectedSearches);
      assert.equal(harness.modelCalls().length, 1);
      assert.equal((await harness.archive()).includes('UNFINISHED_RESPONSE'), false);
      await harness.invoke('chat:send', '讲个海洋故事。');
      assert.deepEqual(harness.modelCalls()[1].body.input, [{ role: 'user', content: '讲个海洋故事。' }]);
    });
  }
});

test('repeated call IDs across tool rounds terminate without executing the duplicate search', async (t) => {
  const harness = await scenario(t, { responses: [toolResponse(searchCall()), toolResponse(searchCall()), finalAnswer('恢复回答。')] });
  const result = await harness.invoke('chat:send', '搜索今年的科学奖项。');
  assert.match(result.error, /联网请求格式异常/);
  assert.equal(harness.searchCalls().length, 1);
  assert.equal(harness.modelCalls().length, 2);
  await harness.invoke('chat:send', '请讲个故事。');
  assert.deepEqual(harness.modelCalls()[2].body.input, [{ role: 'user', content: '请讲个故事。' }]);
});

test('an unfinished function-call item is not executed even when the envelope says completed', async (t) => {
  const harness = await scenario(t, { responses: [
    toolResponse(searchCall('unfinished-call', { status: 'in_progress' })),
    finalAnswer('后续正式回答。'),
  ] });
  const result = await harness.invoke('chat:send', '搜索最新的科学奖项。');
  assert.ok(result.error, 'an unfinished tool request must return a retry error');
  assert.equal(result.text, undefined);
  assert.equal(harness.searchCalls().length, 0);
  assert.equal(harness.modelCalls().length, 1);
});

test('a model that keeps requesting searches stops after three searches and four model rounds', async (t) => {
  const harness = await scenario(t, { responses: [
    ...[1, 2, 3, 4].map((index) => toolResponse(searchCall(`round-${index}`))),
    finalAnswer('下一问的正常回答。'),
  ] });
  const result = await harness.invoke('chat:send', '搜索最新的海洋科学发现。');
  assert.match(result.error, /检索步骤过多/);
  assert.equal(result.text, undefined);
  assert.equal(harness.searchCalls().length, 3);
  assert.equal(harness.modelCalls().length, 4);
  assert.ok(harness.modelCalls().every((call) => call.body.tool_choice === 'auto'));
  await harness.invoke('chat:send', '讲个故事。');
  assert.deepEqual(harness.modelCalls()[4].body.input, [{ role: 'user', content: '讲个故事。' }]);
});
