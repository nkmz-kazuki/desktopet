const TIMEOUT_CODES = new Set([
  'ETIMEDOUT', 'ESOCKETTIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT', 'ERR_TIMED_OUT',
  'ERR_CONNECTION_TIMED_OUT',
]);
const ABORT_CODES = new Set(['ABORT_ERR', 'ERR_ABORTED']);
const DNS_CODES = new Set(['ENOTFOUND', 'EAI_AGAIN', 'ERR_NAME_NOT_RESOLVED']);
const PROXY_CODES = new Set([
  'ECONNREFUSED', 'ERR_PROXY_CONNECTION_FAILED', 'ERR_TUNNEL_CONNECTION_FAILED',
  'ERR_NO_SUPPORTED_PROXIES',
]);
const CERTIFICATE_CODES = new Set([
  'DEPTH_ZERO_SELF_SIGNED_CERT', 'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'UNABLE_TO_GET_ISSUER_CERT',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
]);
const CONNECTION_CODES = new Set([
  'ECONNRESET', 'ECONNABORTED', 'EPIPE', 'ENETUNREACH', 'EHOSTUNREACH',
  'ERR_FAILED', 'ERR_NETWORK_CHANGED', 'ERR_INTERNET_DISCONNECTED',
  'ERR_ADDRESS_UNREACHABLE', 'UND_ERR_SOCKET',
]);

function formatNetworkError(error, { service = '聊天服务' } = {}) {
  const codes = new Set();
  const names = new Set();
  const visited = new Set();
  const pending = [error];
  let fetchFailed = false;

  // Fetch often wraps the useful transport code in cause or AggregateError.errors.
  // Inspect only classification fields; never return any original error text.
  while (pending.length) {
    const current = pending.pop();
    if (!current || typeof current !== 'object' || visited.has(current)) continue;
    visited.add(current);

    if (typeof current.name === 'string') names.add(current.name);
    if (typeof current.code === 'string') codes.add(current.code.replace(/^net::/, ''));
    if (typeof current.message === 'string') {
      const chromiumCode = current.message.match(/^(?:net::)?(ERR_[A-Z0-9_]+)(?=$|[\s:(])/);
      if (chromiumCode) codes.add(chromiumCode[1]);
      if (current.name === 'TypeError' && /^(?:fetch failed|failed to fetch|network request failed)$/i.test(current.message.trim())) {
        fetchFailed = true;
      }
    }

    if (current.cause) pending.push(current.cause);
    if (Array.isArray(current.errors)) pending.push(...current.errors);
  }

  const hasCode = (predicate) => [...codes].some(predicate);
  if (names.has('TimeoutError') || hasCode((code) => TIMEOUT_CODES.has(code))) {
    return `${service}请求超时，请检查网络或系统代理后重试。`;
  }
  if (names.has('AbortError') || hasCode((code) => ABORT_CODES.has(code))) {
    return `${service}请求已中断，请重试。`;
  }
  if (hasCode((code) => CERTIFICATE_CODES.has(code) || /^(?:CERT_|ERR_(?:TLS_)?CERT_)/.test(code))) {
    return `${service}的证书验证失败，请检查系统时间或代理证书设置。`;
  }
  if (hasCode((code) => DNS_CODES.has(code))) {
    return `${service}的域名解析失败，请检查网络或 DNS 设置。`;
  }
  if (hasCode((code) => PROXY_CODES.has(code))) {
    return `无法连接${service}，请检查网络、系统代理及服务地址。`;
  }
  if (fetchFailed || hasCode((code) => CONNECTION_CODES.has(code) || /^ERR_(?:CONNECTION_|SSL_)/.test(code))) {
    return `暂时无法连接${service}，请检查网络或系统代理后重试。`;
  }
  return null;
}

module.exports = { formatNetworkError };
