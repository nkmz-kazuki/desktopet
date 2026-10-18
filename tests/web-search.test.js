const test = require('node:test');
const assert = require('node:assert/strict');
const { searchWeb } = require('../src/web-search');

const testKey = 'test-only-search-key';
const options = (fetchImpl, extra = {}) => ({ apiKey: testKey, fetchImpl, ...extra });
const json = (results, init) => new Response(JSON.stringify({ results }), init);
const result = (url = 'https://example.com/article', overrides = {}) => ({ title: '来源标题', url, snippet: '短摘要', ...overrides });

test('calls only the official Search endpoint with bearer auth and no full-page content', async () => {
  let calls = 0;
  const data = await searchWeb('  DeepSeek site:deepseek.com\n最新消息  ', options(async (url, init) => {
    calls += 1;
    assert.equal(url, 'https://api.deepseek.com/v1/tools/search');
    assert.equal(init.method, 'POST');
    assert.equal(init.redirect, 'error');
    assert.equal(init.headers.Authorization, `Bearer ${testKey}`);
    assert.equal(init.headers['Content-Type'], 'application/json');
    assert.deepEqual(JSON.parse(init.body), { query: 'DeepSeek site:deepseek.com 最新消息', count: 5, need_content: false });
    assert(init.signal instanceof AbortSignal);
    return json([result(undefined, { summary: '供模型阅读的长摘要', content: '不得返回完整正文', date: '2026-10-18T08:00:00+00:00', authority: 4 })]);
  }));
  assert.equal(calls, 1);
  assert.deepEqual(data, { query: 'DeepSeek site:deepseek.com 最新消息', results: [{
    title: '来源标题', url: 'https://example.com/article', snippet: '供模型阅读的长摘要', date: '2026-10-18T08:00:00.000Z', authority: 4,
  }] });
});

test('enforces 1–128 Unicode codepoints, preserves search operators, and rejects missing keys before fetching', async () => {
  let calls = 0;
  const mockFetch = async () => { calls += 1; return json([]); };
  for (const query of ['', ' \t\n', '\u200B\u202E', null, {}, '鲸'.repeat(129), '🐳'.repeat(129)]) {
    await assert.rejects(searchWeb(query, options(mockFetch)), { code: 'SEARCH_QUERY' });
  }
  assert.equal(calls, 0);
  assert.deepEqual(await searchWeb('🐳'.repeat(128), options(mockFetch)), { query: '🐳'.repeat(128), results: [] });
  for (const apiKey of ['', undefined, ' \t ', 'secret\r\nheader: value']) {
    await assert.rejects(searchWeb('新闻', { apiKey, fetchImpl: mockFetch }), { code: 'SEARCH_AUTH' });
  }
  assert.equal(calls, 1);
});

test('returns an empty result without fabricating sources or fetching destination pages', async () => {
  let calls = 0;
  assert.deepEqual(await searchWeb('没有结果的查询', options(async () => { calls += 1; return json([]); })), { query: '没有结果的查询', results: [] });
  assert.equal(calls, 1);
});

test('filters local, private, credentialed and non-web URLs, including encoded IP representations', async () => {
  const unsafe = [
    'javascript:alert(1)', 'data:text/plain,hello', 'file:///C:/secret', 'ftp://example.com/file',
    'https://name:password@example.com', 'https://@example.com', 'http://localhost/', 'http://a.localhost/',
    'http://localhost./', 'http://localhost../', 'http://printer/', 'http://printer.local/', 'http://box.internal/',
    'http://printer.home.arpa/', 'http://a..example.com/',
    'http://127.0.0.1/', 'http://127.1/', 'http://2130706433/', 'http://0x7f000001/', 'http://0177.0.0.1/',
    'http://10.1.2.3/', 'http://172.16.1.2/', 'http://172.31.255.255/', 'http://192.168.0.1/',
    'http://169.254.169.254/latest/meta-data', 'http://100.64.0.1/', 'http://198.18.0.1/',
    'http://0.0.0.0/', 'http://224.0.0.1/', 'http://203.0.113.1/',
    'http://[::1]/', 'http://[::]/', 'http://[fc00::1]/', 'http://[fe80::1]/', 'http://[ff02::1]/',
    'http://[::ffff:127.0.0.1]/', 'http://[::ffff:a00:1]/', 'http://[2001:db8::1]/',
    'https://examp\u200Ble.com/', 'https://example.com\\@localhost/', 'https://example.com/\nheader',
  ];
  const publicUrls = ['https://www.deepseek.com/', 'https://8.8.8.8/', 'https://[2606:4700:4700::1111]/'];
  const data = await searchWeb('公开来源', options(async () => json([...unsafe, ...publicUrls].map((url) => result(url)))));
  assert.deepEqual(data.results.map(({ url }) => url), publicUrls);
});

test('deduplicates normalized URLs, strips markup and invisible controls, and bounds summaries by codepoint', async () => {
  const data = await searchWeb('结果清理', options(async () => json([
    result('https://EXAMPLE.com:443/article#one', { title: '<b>鲸鱼</b>\u200B &amp; 新闻\u202E', summary: '<script>discard</script>&lt;style&gt;hidden&lt;/style&gt;正文 &#x1f433;\n\t继续' }),
    result('https://example.com/article#two'),
    result('https://example.com/long', { title: '', summary: '🐳'.repeat(2100) }),
    result('https://example.com/fallback', { summary: '<b> </b>', snippet: '<i>回退摘要</i>\u0000', date: 'bad', authority: 50 }),
    ...Array.from({ length: 8 }, (_, index) => result(`https://example.com/extra-${index}`)),
    null, {},
  ])));
  assert.equal(data.results.length, 5);
  assert.deepEqual(data.results[0], { title: '鲸鱼 & 新闻', url: 'https://example.com/article', snippet: '正文 🐳 继续' });
  assert.equal(Array.from(data.results[1].snippet).length, 2000);
  assert.equal(data.results[1].title, 'example.com');
  assert.deepEqual(data.results[2], { title: '来源标题', url: 'https://example.com/fallback', snippet: '回退摘要' });
});

test('maps service errors to safe user messages without exposing response bodies or keys', async () => {
  const statuses = { 400: 'SEARCH_QUERY', 401: 'SEARCH_AUTH', 402: 'SEARCH_BALANCE', 403: 'SEARCH_UNAVAILABLE', 408: 'SEARCH_TIMEOUT', 429: 'SEARCH_RATE_LIMIT', 500: 'SEARCH_UNAVAILABLE', 504: 'SEARCH_TIMEOUT' };
  for (const [status, code] of Object.entries(statuses)) {
    await assert.rejects(searchWeb('新闻', options(async () => new Response(`SECRET-SERVER-RESPONSE ${testKey}`, { status: Number(status) }))), (failure) => {
      assert.equal(failure.code, code);
      assert(!failure.message.includes(testKey));
      assert(!failure.message.includes('SECRET-SERVER-RESPONSE'));
      assert.equal(failure.cause, undefined);
      return true;
    });
  }
  await assert.rejects(searchWeb('新闻', options(async () => { throw new Error(`SECRET-SERVER-RESPONSE ${testKey}`); })), { code: 'SEARCH_NETWORK' });
});

test('rejects malformed successful responses and never forwards raw parsing errors', async () => {
  for (const body of ['not json secret', '{}', 'null', '{"results":{}}', '{"error":"secret"}']) {
    await assert.rejects(searchWeb('新闻', options(async () => new Response(body))), { code: 'SEARCH_RESPONSE' });
  }
  const redirected = json([result()]);
  Object.defineProperty(redirected, 'redirected', { value: true });
  await assert.rejects(searchWeb('新闻', options(async () => redirected)), { code: 'SEARCH_UNAVAILABLE' });
});

test('rejects a response over 2 MiB using both declared length and actual streaming bytes', async () => {
  const maximum = 2 * 1024 * 1024;
  let cancelled = false;
  await assert.rejects(searchWeb('新闻', options(async () => new Response(new ReadableStream({
    cancel() { cancelled = true; },
  }), { headers: { 'content-length': String(maximum + 1) } }))), { code: 'SEARCH_TOO_LARGE' });
  assert(cancelled);
  cancelled = false;
  await assert.rejects(searchWeb('新闻', options(async () => new Response(new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(maximum)); controller.enqueue(new Uint8Array(1)); },
    cancel() { cancelled = true; },
  })))), { code: 'SEARCH_TOO_LARGE' });
  assert(cancelled);
  const prefix = '{"results":[],"padding":"';
  const suffix = '"}';
  const boundary = prefix + 'a'.repeat(maximum - Buffer.byteLength(prefix + suffix)) + suffix;
  assert.deepEqual(await searchWeb('新闻', options(async () => new Response(boundary))), { query: '新闻', results: [] });
});

test('times out at 20 seconds even when a fetch mock ignores cancellation', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  let requestSignal;
  const pending = searchWeb('新闻', options((_url, init) => {
    requestSignal = init.signal;
    return new Promise(() => {});
  }));
  context.mock.timers.tick(20_000);
  await assert.rejects(pending, { code: 'SEARCH_TIMEOUT' });
  assert(requestSignal.aborted);
});

test('supports caller cancellation before fetch and while reading the response', async () => {
  const before = new AbortController();
  before.abort(new Error('secret external reason'));
  await assert.rejects(searchWeb('新闻', options(() => assert.fail('must not fetch'), { signal: before.signal })), { code: 'SEARCH_ABORTED' });
  const during = new AbortController();
  let cancelled = false;
  let beganReading;
  const reading = new Promise((resolve) => { beganReading = resolve; });
  const pending = searchWeb('新闻', options(async () => new Response(new ReadableStream({
    pull() { beganReading(); },
    cancel() { cancelled = true; },
  })), { signal: during.signal }));
  await reading;
  during.abort(new Error('secret external reason'));
  await assert.rejects(pending, { code: 'SEARCH_ABORTED' });
  assert(cancelled);
});

test('the 20-second deadline also cancels a stalled successful response body', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  let beganReading;
  let cancelled = false;
  const reading = new Promise((resolve) => { beganReading = resolve; });
  const pending = searchWeb('新闻', options(async () => new Response(new ReadableStream({
    pull() { beganReading(); },
    cancel() { cancelled = true; },
  }))));
  await reading;
  context.mock.timers.tick(20_000);
  await assert.rejects(pending, { code: 'SEARCH_TIMEOUT' });
  assert(cancelled);
});
