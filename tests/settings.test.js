const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { normalizeConversationDirectory } = require('../src/conversation-store');
const { mainHarness } = require('./main-harness');

test('migrates only settings and encrypted key, preserving customized preferences and removing obsolete fields', async (t) => {
  const { invoke, appPaths, directory } = await mainHarness(t, { legacy: {
    petName: '自定义昵称', city: '北京', reasoningEffort: 'high', chatLayout: 'compact',
    model: 'obsolete-model', reminderMinutes: 40, obsolete: true, apiKey: 'never-persist-this',
  } });
  const settings = await invoke('settings:get');
  assert.equal(settings.petName, '自定义昵称');
  assert.equal(settings.city, '北京');
  assert.equal(settings.reasoningEffort, 'max');
  assert.equal(settings.modelId, 'deepseek-flash');
  assert.equal('chatLayout' in settings, false);
  assert.equal(settings.chatOpacity, 80);
  assert.equal(settings.petOpacity, 100);
  assert.equal(settings.conversationDirectory, path.join(appPaths.documents, '对话积累'));
  const saved = JSON.parse(await fs.readFile(path.join(appPaths.userData, 'settings.json'), 'utf8'));
  for (const key of ['model', 'reminderMinutes', 'chatLayout', 'obsolete', 'apiKey']) assert.equal(key in saved, false);
  assert.equal(await fs.readFile(path.join(appPaths.userData, 'deepseek-key.bin'), 'utf8'), 'encrypted-test-fixture');
  assert.equal((await fs.readdir(appPaths.userData)).length, 2);
  assert.ok(await fs.stat(path.join(directory, 'qingyu-desktop-companion', 'settings.json')));
});

test('renames the previous built-in nickname and never replaces existing new-version preferences', async (t) => {
  const { invoke } = await mainHarness(t, { saved: { petName: 'hazuki', city: '杭州' }, legacy: { petName: '旧昵称', city: '广州' } });
  const settings = await invoke('settings:get');
  assert.equal(settings.petName, '鲸鱼娘');
  assert.equal(settings.city, '杭州');
});

test('default model preferences use Flash and max reasoning, migrating old levels without reviving obsolete model settings', async (t) => {
  const initial = await mainHarness(t);
  const defaults = await initial.invoke('settings:get');
  assert.equal(defaults.modelId, 'deepseek-flash');
  assert.equal(defaults.reasoningEffort, 'max');
  const legacy = await mainHarness(t, { saved: { model: 'deepseek-v4-pro', reasoningEffort: 'medium' } });
  const migrated = await legacy.invoke('settings:get');
  assert.equal(migrated.modelId, 'deepseek-flash');
  assert.equal(migrated.reasoningEffort, 'max');
  const persisted = JSON.parse(await fs.readFile(path.join(legacy.appPaths.userData, 'settings.json'), 'utf8'));
  assert.equal(persisted.modelId, 'deepseek-flash');
  assert.equal(persisted.reasoningEffort, 'max');
  assert.equal('model' in persisted, false);
});

test('model selection and forced max reasoning save and reload while preserving appearance and identity', async (t) => {
  const { invoke, appPaths } = await mainHarness(t, { saved: {
    petName: '自定义昵称', city: '杭州', scale: 0.88, chatOpacity: 61,
  } });
  const saved = await invoke('settings:save', { modelId: 'deepseek-v4-pro', reasoningEffort: 'max' });
  assert.equal(saved.modelId, 'deepseek-v4-pro');
  assert.equal(saved.reasoningEffort, 'max');
  const persisted = JSON.parse(await fs.readFile(path.join(appPaths.userData, 'settings.json'), 'utf8'));
  const reloaded = await mainHarness(t, { saved: persisted });
  const next = await reloaded.invoke('settings:get');
  assert.equal(next.modelId, 'deepseek-v4-pro');
  assert.equal(next.reasoningEffort, 'max');
  assert.equal(next.petName, '自定义昵称');
  assert.equal(next.city, '杭州');
  assert.equal(next.scale, 0.88);
  assert.equal(next.chatOpacity, 61);
  for (const reasoningEffort of ['none', 'low', 'medium', 'high', 'max']) {
    const result = await invoke('settings:save', { reasoningEffort });
    assert.equal(result.modelId, 'deepseek-v4-pro');
    assert.equal(result.reasoningEffort, 'max');
  }
});

test('invalid model preferences fall back safely on both load and save', async (t) => {
  const { invoke, appPaths } = await mainHarness(t, { saved: {
    modelId: 'deepseek-v4-flash', reasoningEffort: 'unsupported',
  } });
  const loaded = await invoke('settings:get');
  assert.equal(loaded.modelId, 'deepseek-flash');
  assert.equal(loaded.reasoningEffort, 'max');
  await invoke('settings:save', { modelId: 'deepseek-v4-pro', reasoningEffort: 'none' });
  const invalid = await invoke('settings:save', { modelId: '__proto__', reasoningEffort: null, model: 'deepseek-v4-pro' });
  assert.equal(invalid.modelId, 'deepseek-flash');
  assert.equal(invalid.reasoningEffort, 'max');
  const persisted = JSON.parse(await fs.readFile(path.join(appPaths.userData, 'settings.json'), 'utf8'));
  assert.equal(persisted.modelId, 'deepseek-flash');
  assert.equal(persisted.reasoningEffort, 'max');
  assert.equal('model' in persisted, false);
});

test('removes an obsolete chat layout while preserving character scale and migrating its screen anchor', async (t) => {
  const { invoke, appPaths } = await mainHarness(t, { saved: {
    chatLayout: 'wide', scale: 0.88, windowPosition: { x: 820, y: 230 },
  } });
  const loaded = await invoke('settings:get');
  assert.equal('chatLayout' in loaded, false);
  assert.equal(loaded.scale, 0.88);
  assert.equal(loaded.windowPosition.x, 820);
  assert.equal(loaded.windowPosition.y, 230);
  const initial = JSON.parse(await fs.readFile(path.join(appPaths.userData, 'settings.json'), 'utf8'));
  assert.equal('chatLayout' in initial, false);
  const next = await invoke('settings:save', { chatLayout: 'compact' });
  assert.equal('chatLayout' in next, false);
  const persisted = JSON.parse(await fs.readFile(path.join(appPaths.userData, 'settings.json'), 'utf8'));
  assert.equal('chatLayout' in persisted, false);
  assert.equal(persisted.scale, 0.88);
  assert.deepEqual(persisted.petPosition, { x: 820 + 597.65, y: 230 + 724 });
  assert.deepEqual(persisted.windowPosition, { x: next.windowPosition.x, y: next.windowPosition.y });
});

test('saves quoted absolute directories and bounded opacities without moving or overwriting previous conversation history', async (t) => {
  const { invoke, directory, appPaths } = await mainHarness(t);
  const before = await invoke('settings:get');
  const answer = await invoke('chat:send', '现在几点？');
  const oldContent = await fs.readFile(before.conversationFile, 'utf8');
  assert.ok(oldContent.includes(answer.text));
  const destination = path.join(directory, 'selected folder');
  const next = await invoke('settings:save', {
    conversationDirectory: `  "${destination}"  `,
    petOpacity: 0, chatOpacity: 101, messageOpacity: -10, inputOpacity: 33.6, textOpacity: 72, bubbleOpacity: 50,
    model: 'do-not-save', reminderMinutes: 200,
  });
  assert.equal(next.conversationDirectory, destination);
  assert.equal(next.petOpacity, 0);
  assert.equal(next.chatOpacity, 100);
  assert.equal(next.messageOpacity, 0);
  assert.equal(next.inputOpacity, 34);
  assert.equal(next.textOpacity, 72);
  await invoke('chat:send', '日期是什么？');
  assert.equal(await fs.readFile(before.conversationFile, 'utf8'), oldContent);
  assert.ok((await fs.readFile(next.conversationFile, 'utf8')).includes('日期是什么？'));
  const saved = JSON.parse(await fs.readFile(path.join(appPaths.userData, 'settings.json'), 'utf8'));
  assert.equal(saved.conversationDirectory, destination);
  assert.equal('model' in saved, false);
  assert.equal('reminderMinutes' in saved, false);
});

test('rejects invalid or unwritable folders before applying any setting and permits recovery', async (t) => {
  const harness = await mainHarness(t);
  const { invoke, directory, appPaths } = harness;
  const initial = await fs.readFile(path.join(appPaths.userData, 'settings.json'), 'utf8');
  const blockingFile = path.join(directory, 'not-a-directory');
  await fs.writeFile(blockingFile, 'keep this file');
  for (const conversationDirectory of ['relative/path', blockingFile]) {
    await assert.rejects(invoke('settings:save', {
      conversationDirectory, petName: 'should-not-apply', chatOpacity: 22,
      modelId: 'deepseek-v4-pro', reasoningEffort: 'max',
    }));
    assert.equal(await fs.readFile(path.join(appPaths.userData, 'settings.json'), 'utf8'), initial);
    assert.equal((await invoke('settings:get')).petName, '鲸鱼娘');
    assert.equal((await invoke('settings:get')).modelId, 'deepseek-flash');
    assert.equal((await invoke('settings:get')).reasoningEffort, 'max');
    assert.equal(harness.loginUpdates, 0);
  }
  assert.equal(await fs.readFile(blockingFile, 'utf8'), 'keep this file');
  const next = await invoke('settings:save', { conversationDirectory: path.join(directory, 'writable'), petName: '已恢复' });
  assert.equal(next.petName, '已恢复');
});

test('a reply in flight is archived in the directory chosen when its question was sent', async (t) => {
  let completeReply;
  let requestStarted;
  const started = new Promise((resolve) => { requestStarted = resolve; });
  const { invoke, directory } = await mainHarness(t, { fetchImpl: async () => {
    requestStarted();
    return new Promise((resolve) => { completeReply = () => resolve({
      ok: true, json: async () => ({ output: [{ type: 'message', content: [{ type: 'output_text', text: '完整回答' }] }] }),
    }); });
  } });
  const before = await invoke('settings:get');
  const pending = invoke('chat:send', '请讲个故事');
  await started;
  const after = await invoke('settings:save', { conversationDirectory: path.join(directory, 'next-log') });
  completeReply();
  assert.equal((await pending).text, '完整回答');
  assert.ok((await fs.readFile(before.conversationFile, 'utf8')).includes('请讲个故事'));
  assert.equal((await fs.readFile(after.conversationFile, 'utf8')).includes('请讲个故事'), false);
});

test('directory picker returns a path without silently saving it', async (t) => {
  const selectedDirectory = path.resolve('chosen-directory');
  const { invoke } = await mainHarness(t, { selectedDirectory });
  const before = (await invoke('settings:get')).conversationDirectory;
  assert.equal(await invoke('conversation:choose-directory'), selectedDirectory);
  assert.equal((await invoke('settings:get')).conversationDirectory, before);
  const canceled = await mainHarness(t);
  assert.equal(await canceled.invoke('conversation:choose-directory'), null);
});

test('directory input rejects URLs, drive-relative paths and unsupported device paths', () => {
  for (const invalid of ['', '   ', 'https://example.com', 'C:relative', '\0']) {
    assert.throws(() => normalizeConversationDirectory(invalid));
  }
  if (process.platform === 'win32') {
    for (const invalid of ['\\\\.\\device', '\\\\?\\C:\\folder', 'C:\\invalid*name', '\\relative']) {
      assert.throws(() => normalizeConversationDirectory(invalid));
    }
  }
});
