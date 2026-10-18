const { isIP } = require('node:net');

const SEARCH_ENDPOINT = 'https://api.deepseek.com/v1/tools/search';
const TIMEOUT_MS = 20_000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_RESULTS = 5;

class SearchError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'SearchError';
    this.code = code;
  }
}

function error(code, message) {
  return new SearchError(code, message);
}

function cleanText(value, limit) {
  if (typeof value !== 'string') return '';
  const entities = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  const text = value
    .replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (entity, name) => {
      if (!name.startsWith('#')) return entities[name.toLowerCase()] || entity;
      const hexadecimal = name[1].toLowerCase() === 'x';
      const codePoint = Number.parseInt(name.slice(hexadecimal ? 2 : 1), hexadecimal ? 16 : 10);
      return codePoint > 0 && codePoint <= 0x10ffff && !(codePoint >= 0xd800 && codePoint <= 0xdfff)
        ? String.fromCodePoint(codePoint) : '';
    })
    .replace(/<!--[^]*?-->/g, ' ')
    .replace(/<(script|style)\b[^>]*>[^]*?<\/\1\s*>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\p{Cf}/gu, '')
    .replace(/[\p{Cc}\p{Zl}\p{Zp}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return Array.from(text).slice(0, limit).join('');
}

function publicIPv4(address) {
  const [a, b, c] = address.split('.').map(Number);
  return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 168 || (b === 0 && (c === 0 || c === 2)) || (b === 88 && c === 99))) ||
    (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
    (a === 203 && b === 0 && c === 113));
}

function sourceUrl(value) {
  if (typeof value !== 'string' || value.length > 8192) return null;
  const text = value.trim();
  if (/[\p{Cc}\p{Cf}\s\\]/u.test(text)) return null;
  let url;
  try { url = new URL(text); } catch { return null; }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || /^https?:\/\/[^/?#]*@/i.test(text)) return null;
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.+$/, '');
  const ipVersion = isIP(host);
  if (ipVersion === 4) {
    if (!publicIPv4(host)) return null;
  } else if (ipVersion === 6) {
    // Only global unicast literals are eligible. This also excludes mapped private IPv4.
    if (!/^[23][\da-f]{3}:/.test(host) || /^2001:(?:db8|0|2|1[0-9a-f]|2[0-9a-f]):/i.test(host)) return null;
  } else if (host.length > 253 || !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(host) ||
    /(^|\.)(localhost|local|localdomain|internal|intranet|lan|home|test|invalid|onion)$/.test(host) || host === 'home.arpa' || host.endsWith('.home.arpa')) {
    return null;
  }
  url.hash = '';
  return url;
}

function normalizeResults(items) {
  const seen = new Set();
  const results = [];
  for (const item of items) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const url = sourceUrl(item.url);
    if (!url || seen.has(url.href)) continue;
    seen.add(url.href);
    const result = {
      title: cleanText(item.title, 300) || url.hostname,
      url: url.href,
      snippet: cleanText(item.summary, 2000) || cleanText(item.snippet, 2000),
    };
    if (typeof item.date === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(item.date) && !Number.isNaN(Date.parse(item.date))) {
      result.date = new Date(item.date).toISOString();
    }
    if (Number.isInteger(item.authority) && item.authority >= -1 && item.authority <= 4) result.authority = item.authority;
    results.push(result);
    if (results.length === MAX_RESULTS) break;
  }
  return results;
}

function statusError(status) {
  if (status === 401) return error('SEARCH_AUTH', '联网搜索的 API Key 无效，请在设置中重新填写。');
  if (status === 402) return error('SEARCH_BALANCE', 'DeepSeek 账户余额不足，请充值后再试。');
  if (status === 429) return error('SEARCH_RATE_LIMIT', '搜索请求较多，请稍后再试。');
  if (status === 408 || status === 504) return error('SEARCH_TIMEOUT', '联网搜索超时了，请稍后再试。');
  if (status === 400 || status === 413) return error('SEARCH_QUERY', '搜索词暂时无法处理，请缩短或换一种说法重试。');
  return error('SEARCH_UNAVAILABLE', '联网搜索服务暂时不可用，请稍后再试。');
}

async function readJson(response, signal) {
  const advertisedLength = Number(response.headers?.get('content-length'));
  if (Number.isFinite(advertisedLength) && advertisedLength > MAX_RESPONSE_BYTES) {
    void response.body?.cancel().catch(() => {});
    throw error('SEARCH_TOO_LARGE', '搜索结果过大，请换一组更具体的关键词。');
  }
  if (!response.body || typeof response.body.getReader !== 'function') {
    throw error('SEARCH_RESPONSE', '暂时无法读取搜索结果，请稍后再试。');
  }
  const reader = response.body.getReader();
  const stopReading = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', stopReading, { once: true });
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      if (signal.aborted) throw error('SEARCH_ABORTED', '联网搜索已取消。');
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) {
        stopReading();
        throw error('SEARCH_TOO_LARGE', '搜索结果过大，请换一组更具体的关键词。');
      }
      chunks.push(Buffer.from(value));
    }
    try {
      return JSON.parse(Buffer.concat(chunks, size).toString('utf8'));
    } catch {
      throw error('SEARCH_RESPONSE', '暂时无法读取搜索结果，请稍后再试。');
    }
  } finally {
    signal.removeEventListener('abort', stopReading);
    reader.releaseLock();
  }
}

async function searchWeb(query, { apiKey, fetchImpl = globalThis.fetch, signal } = {}) {
  const actualQuery = typeof query === 'string'
    ? query.replace(/\p{Cf}/gu, '').replace(/[\p{Cc}\s]+/gu, ' ').trim() : '';
  if (!actualQuery || Array.from(actualQuery).length > 128) {
    throw error('SEARCH_QUERY', '请输入 1～128 个字符的搜索词。');
  }
  if (typeof apiKey !== 'string' || !apiKey.trim() || /[\r\n]/.test(apiKey)) {
    throw error('SEARCH_AUTH', '请先在设置中填写有效的 DeepSeek API Key。');
  }
  if (signal?.aborted) throw error('SEARCH_ABORTED', '联网搜索已取消。');

  const controller = new AbortController();
  let timedOut = false;
  const abortFromCaller = () => controller.abort();
  signal?.addEventListener('abort', abortFromCaller, { once: true });
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, TIMEOUT_MS);
  let rejectOnAbort;
  const interrupted = new Promise((_, reject) => {
    rejectOnAbort = () => reject(error('SEARCH_ABORTED', '联网搜索已取消。'));
    controller.signal.addEventListener('abort', rejectOnAbort, { once: true });
  });
  try {
    const request = (async () => {
      const response = await fetchImpl(SEARCH_ENDPOINT, {
        method: 'POST', redirect: 'error',
        headers: { Authorization: `Bearer ${apiKey.trim()}`, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ query: actualQuery, count: MAX_RESULTS, need_content: false }),
        signal: controller.signal,
      });
      if (controller.signal.aborted) throw error('SEARCH_ABORTED', '联网搜索已取消。');
      if (response.status !== 200 || response.redirected) {
        void response.body?.cancel().catch(() => {});
        throw statusError(response.status);
      }
      const data = await readJson(response, controller.signal);
      if (!data || typeof data !== 'object' || !Array.isArray(data.results)) {
        throw error('SEARCH_RESPONSE', '暂时无法读取搜索结果，请稍后再试。');
      }
      return { query: actualQuery, results: normalizeResults(data.results) };
    })();
    return await Promise.race([request, interrupted]);
  } catch (cause) {
    if (timedOut) throw error('SEARCH_TIMEOUT', '联网搜索超时了，请稍后再试。');
    if (controller.signal.aborted) throw error('SEARCH_ABORTED', '联网搜索已取消。');
    if (cause instanceof SearchError) throw cause;
    throw error('SEARCH_NETWORK', '暂时无法连接联网搜索服务，请检查网络后重试。');
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abortFromCaller);
    controller.signal.removeEventListener('abort', rejectOnAbort);
  }
}

module.exports = { searchWeb };
