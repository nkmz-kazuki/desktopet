const test = require('node:test');
const assert = require('node:assert/strict');
const { formatNetworkError } = require('../src/network-errors');

function codedError(code, message = 'private transport details') {
  return Object.assign(new Error(message), { code });
}

test('uses the nested connection refusal instead of the outer fetch failed message', () => {
  const error = new TypeError('fetch failed', { cause: codedError('ECONNREFUSED') });
  assert.equal(formatNetworkError(error), '无法连接聊天服务，请检查网络、系统代理及服务地址。');
});

test('handles Node and Chromium proxy connection errors', () => {
  for (const code of ['ECONNREFUSED', 'ERR_PROXY_CONNECTION_FAILED', 'ERR_TUNNEL_CONNECTION_FAILED']) {
    assert.equal(formatNetworkError(codedError(code), { service: '联网搜索' }), '无法连接联网搜索，请检查网络、系统代理及服务地址。');
  }
  assert.equal(formatNetworkError(new Error('net::ERR_PROXY_CONNECTION_FAILED at https://private.example/')), '无法连接聊天服务，请检查网络、系统代理及服务地址。');
});

test('finds DNS errors through nested causes and AggregateError collections', () => {
  for (const code of ['ENOTFOUND', 'EAI_AGAIN', 'ERR_NAME_NOT_RESOLVED']) {
    const aggregate = new AggregateError([codedError(code)]);
    const error = new TypeError('fetch failed', { cause: new Error('wrapper', { cause: aggregate }) });
    assert.equal(formatNetworkError(error), '聊天服务的域名解析失败，请检查网络或 DNS 设置。');
  }
});

test('reports timeout and interruption without exposing abort reasons', () => {
  for (const name of ['TimeoutError', 'AbortError']) {
    const error = Object.assign(new Error('private cancellation reason'), { name });
    assert.equal(formatNetworkError(error), name === 'TimeoutError'
      ? '聊天服务请求超时，请检查网络或系统代理后重试。'
      : '聊天服务请求已中断，请重试。');
  }
  assert.match(formatNetworkError(codedError('UND_ERR_CONNECT_TIMEOUT')), /请求超时/);
  assert.match(formatNetworkError(new Error('net::ERR_ABORTED')), /请求已中断/);
});

test('identifies certificate failures without recommending disabled validation', () => {
  for (const code of ['CERT_HAS_EXPIRED', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'ERR_TLS_CERT_ALTNAME_INVALID', 'ERR_CERT_AUTHORITY_INVALID']) {
    assert.equal(formatNetworkError(new TypeError('fetch failed', { cause: codedError(code) })), '聊天服务的证书验证失败，请检查系统时间或代理证书设置。');
  }
});

test('returns a safe generic connection message for fetch and Chromium failures', () => {
  for (const error of [
    new TypeError('fetch failed'),
    new TypeError('Failed to fetch'),
    codedError('ERR_FAILED'),
    codedError('ECONNRESET'),
    new Error('net::ERR_CONNECTION_CLOSED at https://private.example/path'),
  ]) {
    assert.equal(formatNetworkError(error), '暂时无法连接聊天服务，请检查网络或系统代理后重试。');
  }
});

test('never copies source URLs, headers, API keys, or response bodies into UI messages', () => {
  const privateText = 'https://private.example/?key=sk-test-secret Authorization: Bearer sk-test-secret {"body":"private response"}';
  for (const code of ['ENOTFOUND', 'ECONNREFUSED', 'CERT_HAS_EXPIRED', 'ERR_FAILED']) {
    const error = new TypeError('fetch failed', { cause: codedError(code, privateText) });
    error.headers = { Authorization: 'Bearer sk-test-secret' };
    const message = formatNetworkError(error);
    assert.equal(typeof message, 'string');
    assert.doesNotMatch(message, /private|https?:|Authorization|Bearer|sk-test-secret|fetch failed/);
  }
});

test('handles cyclic causes and error collections without mutating them', () => {
  const error = new TypeError('fetch failed');
  error.cause = error;
  error.errors = Object.freeze([error, codedError('ENOTFOUND')]);
  Object.freeze(error);
  assert.equal(formatNetworkError(error), '聊天服务的域名解析失败，请检查网络或 DNS 设置。');
  assert.equal(error.cause, error);
});

test('leaves unrelated business, HTTP, and malformed errors to the caller', () => {
  for (const error of [
    null, undefined, 'fetch failed', 42,
    new Error('API Key 无效'),
    codedError('SEARCH_AUTH', '请先填写有效的 API Key'),
    new Error('网络请求失败（401）'),
    new Error('Unexpected response: ERR_CONNECTION_REFUSED inside a service body'),
    new SyntaxError('Unexpected token in JSON'),
    new TypeError('Cannot read properties of undefined'),
    { message: 'fetch failed' },
  ]) {
    assert.equal(formatNetworkError(error), null);
  }
});
