const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const config = require('../src/model-config');

test('the shared catalog lists the two active model families and fixes reasoning to its highest level', () => {
  assert.deepEqual(config.MODEL_OPTIONS, [
    { id: 'deepseek-flash', label: 'DeepSeek V4.1 Flash', group: 'Flash 系列' },
    { id: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro', group: 'Pro 系列' },
  ]);
  assert.equal(config.DEFAULT_MODEL, 'deepseek-flash');
  assert.equal('REASONING_OPTIONS' in config, false);
  assert.equal(config.DEFAULT_REASONING_EFFORT, 'max');
  assert.ok(Object.isFrozen(config));
  assert.ok(Object.isFrozen(config.MODEL_OPTIONS));
  assert.ok(config.MODEL_OPTIONS.every(Object.isFrozen));
});

test('model normalization accepts active IDs and rejects retired, malformed and inherited-looking values', () => {
  for (const { id } of config.MODEL_OPTIONS) assert.equal(config.normalizeModelId(id), id);
  for (const invalid of [undefined, null, '', 'deepseek-v4-flash', 'deepseek-vision-exp',
    'deepseek-chat', 'deepseek-reasoner', 'DEEPSEEK-FLASH', 'deepseek-v4-pro ',
    '__proto__', 'toString', {}, [], 0]) {
    assert.equal(config.normalizeModelId(invalid), 'deepseek-flash');
  }
});

test('all previous reasoning levels and malformed values normalize to max', () => {
  for (const value of ['none', 'low', 'medium', 'high', 'max', undefined, null, '',
    'unsupported', '__proto__', 'toString', {}, [], false]) {
    assert.equal(config.normalizeReasoningEffort(value), 'max');
  }
});

test('the browser and Node entry points expose identical catalogs and normalization', () => {
  const context = vm.createContext({ window: {} });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/model-config.js'), 'utf8'), context);
  const browser = context.window.modelConfig;
  assert.deepEqual(JSON.parse(JSON.stringify(browser)), JSON.parse(JSON.stringify(config)));
  assert.equal(browser.normalizeModelId('deepseek-v4-pro'), 'deepseek-v4-pro');
  assert.equal(browser.normalizeModelId('deepseek-v4-flash'), config.DEFAULT_MODEL);
  assert.equal(browser.normalizeReasoningEffort('medium'), 'max');
  assert.equal(browser.normalizeReasoningEffort('none'), 'max');
});
