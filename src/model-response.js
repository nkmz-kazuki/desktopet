const INTERNAL_TAG = /^<(\/?)(ds_safety|think|thinking|analysis)\s*(\/?)>/i;

function isEscaped(text, index) {
  let slashes = 0;
  for (let cursor = index - 1; cursor >= 0 && text[cursor] === '\\'; cursor -= 1) slashes += 1;
  return slashes % 2 === 1;
}

function inlineCodeEnd(text, index) {
  let length = 1;
  while (text[index + length] === '`') length += 1;
  const runs = /`+/g;
  runs.lastIndex = index + length;
  let match;
  while ((match = runs.exec(text))) {
    if (match[0].length === length) return match.index + length;
  }
  return -1;
}

function sanitizeFinalText(value) {
  if (typeof value !== 'string') return '';
  const text = value;
  const visible = [];
  const hidden = [];
  let fence = null;
  let previousLineBlank = true;
  let indentedCode = false;
  let cursor = 0;

  while (cursor < text.length) {
    if (cursor === 0 || text[cursor - 1] === '\n') {
      const newline = text.indexOf('\n', cursor);
      const lineEnd = newline < 0 ? text.length : newline + 1;
      const line = text.slice(cursor, lineEnd);
      const content = line.replace(/[\r\n]+$/, '');
      const blank = content.trim() === '';
      const openingFence = content.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
      if (fence) {
        if (!hidden.length) visible.push(line);
        const closingFence = content.match(/^ {0,3}(`{3,}|~{3,})\s*$/);
        if (closingFence && closingFence[1][0] === fence.character && closingFence[1].length >= fence.length) fence = null;
        previousLineBlank = blank;
        cursor = lineEnd;
        continue;
      }
      if (openingFence && !(openingFence[1][0] === '`' && openingFence[2].includes('`'))) {
        fence = { character: openingFence[1][0], length: openingFence[1].length };
        if (!hidden.length) visible.push(line);
        indentedCode = false;
        previousLineBlank = false;
        cursor = lineEnd;
        continue;
      }
      if (/^( {4}|\t)/.test(content) && (previousLineBlank || indentedCode)) {
        if (!hidden.length) visible.push(line);
        indentedCode = true;
        previousLineBlank = blank;
        cursor = lineEnd;
        continue;
      }
      if (!blank) indentedCode = false;
      previousLineBlank = blank;
    }

    if (text[cursor] === '`' && !isEscaped(text, cursor)) {
      const end = inlineCodeEnd(text, cursor);
      if (end >= 0) {
        if (!hidden.length) visible.push(text.slice(cursor, end));
        cursor = end;
        continue;
      }
    }

    const tag = text[cursor] === '<' && !isEscaped(text, cursor) ? text.slice(cursor).match(INTERNAL_TAG) : null;
    if (tag) {
      const name = tag[2].toLowerCase();
      if (tag[1]) {
        if (hidden.at(-1) === name) hidden.pop();
        else if (!hidden.length) visible.length = 0;
      } else if (!tag[3]) {
        hidden.push(name);
      }
      cursor += tag[0].length;
      continue;
    }

    if (!hidden.length) visible.push(text[cursor]);
    cursor += 1;
  }
  return visible.join('').trim();
}

function isFinalChannel(value) {
  return value.channel === undefined || value.channel === 'final';
}

function isCompleted(value) {
  return value.status === undefined || value.status === 'completed';
}

function extractResponseText(data) {
  if (!data || typeof data !== 'object' || !isCompleted(data) || !isFinalChannel(data) || !Array.isArray(data.output)) return '';
  const chunks = [];
  for (const item of data.output) {
    if (!item || item.type !== 'message' || (item.role !== undefined && item.role !== 'assistant') || !isFinalChannel(item)) continue;
    if (!isCompleted(item)) return '';
    if (!Array.isArray(item.content)) continue;
    for (const part of item.content) {
      if (!part || part.type !== 'output_text' || !isFinalChannel(part)) continue;
      if (!isCompleted(part)) return '';
      if (typeof part.text === 'string') chunks.push(part.text);
    }
  }
  return sanitizeFinalText(chunks.join(''));
}

module.exports = { extractResponseText, sanitizeFinalText };
