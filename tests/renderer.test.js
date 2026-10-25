const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { rendererHarness, deferred } = require('./renderer-harness');

const opacityVariables = {
  petOpacity: '--pet-opacity', chatOpacity: '--chat-opacity', messageOpacity: '--message-opacity',
  inputOpacity: '--input-opacity', textOpacity: '--text-opacity', bubbleOpacity: '--bubble-opacity',
};

test('all six opacity controls preview immediately, close rolls them back, and save persists exactly the selected fields', async () => {
  const harness = await rendererHarness({ floatingBubbleEnabled: true });
  const original = Object.fromEntries(Object.entries(opacityVariables).map(([name, variable]) => [name, harness.css(variable)]));
  assert.equal(harness.css('--chat-opacity'), '0.8');
  await harness.openSettings();
  let value = 11;
  for (const [name, variable] of Object.entries(opacityVariables)) {
    harness.get(`${name}Input`).value = String(value);
    await harness.get(`${name}Input`).dispatch('input');
    assert.equal(harness.css(variable), String(value / 100));
    assert.equal(harness.get(`${name}Value`).textContent, `${value}%`);
    value += 13;
  }
  assert.equal(harness.calls.saveSettings.length, 0);
  await harness.get('closeSettingsBtn').dispatch('click');
  for (const [name, variable] of Object.entries(opacityVariables)) assert.equal(harness.css(variable), original[name]);
  await harness.openSettings();
  const selected = { petOpacity: 0, chatOpacity: 80, messageOpacity: 42, inputOpacity: 67, textOpacity: 100, bubbleOpacity: 31 };
  for (const [name, amount] of Object.entries(selected)) harness.get(`${name}Input`).value = String(amount);
  await harness.get('settingsForm').dispatch('submit');
  assert.equal(harness.calls.saveSettings.length, 1);
  const payload = harness.calls.saveSettings[0];
  for (const [name, amount] of Object.entries(selected)) {
    assert.equal(payload[name], amount);
    assert.equal(harness.css(opacityVariables[name]), String(amount / 100));
  }
  for (const oldField of ['model', 'reminderMinutes', 'encryptionAvailable', 'chatLayout', 'reasoningEffort', 'scale']) assert.equal(oldField in payload, false);
  assert.equal(harness.get('settingsPanel').classList.contains('open'), false);
  await harness.openSettings();
  assert.equal(harness.get('petOpacityInput').value, '0');
  assert.equal(harness.get('inputOpacityInput').value, '67');
});

test('switching from settings to chat cancels unsaved previews; failed save stays editable', async () => {
  const harness = await rendererHarness({ saveError: '这个目录不可写。' });
  await harness.openSettings();
  harness.get('chatOpacityInput').value = '15';
  await harness.get('chatOpacityInput').dispatch('input');
  assert.equal(harness.css('--chat-opacity'), '0.15');
  await harness.openChat();
  assert.equal(harness.css('--chat-opacity'), '0.8');
  await harness.openSettings();
  harness.get('chatOpacityInput').value = '19';
  await harness.get('settingsForm').dispatch('submit');
  assert.equal(harness.get('settingsPanel').classList.contains('open'), true);
  assert.equal(harness.get('chatOpacityInput').value, '19');
  assert.equal(harness.get('settingsFeedback').textContent, '这个目录不可写。');
  assert.equal(harness.get('settingsFeedback').hidden, false);
  assert.equal(harness.get('settingsFeedback').getAttribute('role'), 'alert');
  await harness.get('closeSettingsBtn').dispatch('click');
  assert.equal(harness.css('--chat-opacity'), '0.8');
});

test('directory choice fills the editable address and saves only when requested; canceled chooser preserves pasted address', async () => {
  const selectedDirectory = path.resolve('selected conversation folder');
  const harness = await rendererHarness({ selectedDirectory });
  await harness.openSettings();
  await harness.get('chooseConversationDirectoryBtn').dispatch('click');
  assert.equal(harness.get('conversationDirectoryInput').value, selectedDirectory);
  assert.equal(harness.calls.saveSettings.length, 0);
  await harness.get('settingsForm').dispatch('submit');
  assert.equal(harness.calls.saveSettings[0].conversationDirectory, selectedDirectory);
  const canceled = await rendererHarness();
  await canceled.openSettings();
  const pasted = `"${path.resolve('pasted folder')}"`;
  canceled.get('conversationDirectoryInput').value = pasted;
  await canceled.get('chooseConversationDirectoryBtn').dispatch('click');
  assert.equal(canceled.get('conversationDirectoryInput').value, pasted);
  await canceled.get('settingsForm').dispatch('submit');
  assert.equal(canceled.calls.saveSettings[0].conversationDirectory, pasted);
});

test('current HTML provides every referenced element without removed greeting, size or reasoning controls', async () => {
  const harness = await rendererHarness();
  await harness.openSettings();
  await harness.get('settingsForm').dispatch('submit');
  await harness.openChat();
  await harness.get('clearChatBtn').dispatch('click');
  assert.deepEqual(harness.missingSelectors, []);
  for (const selector of ['#reminderInput', '#reminderMinutesInput', '#settingsNote', '#privacyNote', '#chatScaleBtn', '#scaleInput', '#reasoningInput', '#reasoningInputTrigger', '#reasoningInputListbox']) {
    assert.equal(harness.queriedSelectors.includes(selector), false);
    assert.equal(harness.html.includes(`id="${selector.slice(1)}"`), false);
  }
  assert.equal(harness.html.includes('随时听你说'), false);
});

test('floating speech stays hidden and silent without greeting timers, preserving its saved preferences', async () => {
  const harness = await rendererHarness({ settings: { proactiveEnabled: true, voiceEnabled: true, bubbleOpacity: 37 } });
  assert.match(harness.html, /id="speechBubble"[^>]*\bhidden\b/);
  assert.equal(harness.get('speechBubble').hidden, true);
  assert.equal(harness.get('speechBubble').classList.contains('visible'), false);
  assert.deepEqual(harness.pendingTimers, []);
  await harness.advance(46 * 60000);
  assert.deepEqual(harness.bubbleChanges, []);
  assert.equal(harness.get('petVisual').classList.contains('hello'), false);
  assert.deepEqual(harness.calls.spoken, []);

  await harness.openSettings();
  for (const id of ['proactiveInput', 'voiceInput', 'bubbleOpacityInput']) {
    assert.equal(harness.get(id).parentElement.hidden, true);
  }
  assert.equal(harness.get('messageOpacityInput').parentElement.hidden, false);
  assert.equal(harness.get('proactiveInput').checked, true);
  assert.equal(harness.get('voiceInput').checked, true);
  assert.equal(harness.get('bubbleOpacityInput').value, '37');
  harness.get('proactiveInput').checked = false;
  harness.get('voiceInput').checked = false;
  harness.get('bubbleOpacityInput').value = '0';
  await harness.get('settingsForm').dispatch('submit');
  const saved = harness.calls.saveSettings[0];
  for (const name of ['proactiveEnabled', 'voiceEnabled', 'bubbleOpacity']) assert.equal(name in saved, false);
  assert.equal(harness.saved.proactiveEnabled, true);
  assert.equal(harness.saved.voiceEnabled, true);
  assert.equal(harness.saved.bubbleOpacity, 37);
  assert.equal(harness.css('--bubble-opacity'), '0.37');

  await harness.send('请介绍一下海洋。');
  await harness.advance(1000);
  assert.equal(harness.get('speechBubble').hidden, true);
  assert.equal(harness.get('speechBubble').classList.contains('visible'), false);
  assert.equal(harness.get('bubbleText').textContent, '老师，complete！');
  assert.deepEqual(harness.calls.spoken, []);
  assert.deepEqual(harness.pendingTimers, []);
  assert.ok(harness.get('messages').children.some((row) => row.children[0]?.textContent === '已回答。'));
  assert.equal(harness.get('settingsFeedback').hidden, true);
});

test('explicit weather requests use the chat panel for both results and errors while floating speech is paused', async () => {
  for (const weatherError of [undefined, '暂时无法获取天气。']) {
    const harness = await rendererHarness({ weatherError });
    await harness.requestWeather();
    assert.equal(harness.get('chatPanel').classList.contains('open'), true);
    assert.equal(harness.get('speechBubble').hidden, true);
    const message = harness.get('messages').children.at(-1);
    assert.equal(message.className, weatherError ? 'message system' : 'message assistant');
    assert.match(message.children[0].textContent, weatherError ? /暂时无法获取天气/ : /上海现在 晴，21℃/);
    assert.deepEqual(harness.calls.sendChat, []);
    assert.deepEqual(harness.calls.spoken, []);
  }
});

test('settings failures remain visible inline, preserve drafts and clear on a new operation or reopening', async () => {
  const options = { saveError: '这个目录不可写。' };
  const harness = await rendererHarness(options);
  const feedback = harness.get('settingsFeedback');
  assert.equal(feedback.hidden, true);
  assert.equal(feedback.textContent, '');
  await harness.openSettings();
  harness.get('cityInput').value = '苏州';
  await harness.get('settingsForm').dispatch('submit');
  assert.equal(feedback.hidden, false);
  assert.equal(feedback.getAttribute('role'), 'alert');
  assert.equal(feedback.getAttribute('aria-live'), 'assertive');
  assert.equal(feedback.textContent, options.saveError);
  assert.equal(harness.get('settingsPanel').classList.contains('open'), true);
  assert.equal(harness.get('cityInput').value, '苏州');
  await harness.get('openConversationFolderBtn').dispatch('click');
  assert.equal(feedback.hidden, true);
  assert.equal(feedback.textContent, '');
  await harness.get('settingsForm').dispatch('submit');
  await harness.get('closeSettingsBtn').dispatch('click');
  await harness.openSettings();
  assert.equal(feedback.hidden, true);
  options.saveError = null;
  harness.get('cityInput').value = '苏州';
  await harness.get('settingsForm').dispatch('submit');
  assert.equal(harness.saved.city, '苏州');
  assert.equal(feedback.hidden, true);
});

test('directory and key actions report errors inline while clearing a key keeps a visible success status', async () => {
  for (const [option, id, message] of [
    ['chooseDirectoryError', 'chooseConversationDirectoryBtn', '暂时无法选择文件夹。'],
    ['openFolderError', 'openConversationFolderBtn', '暂时无法打开记录文件夹。'],
    ['openApiKeysError', 'apiKeyHelpBtn', '暂时无法打开密钥页面。'],
    ['clearKeyError', 'clearKeyBtn', '暂时无法清除 API Key。'],
  ]) {
    const options = { [option]: message, settings: { apiKeySet: true } };
    const harness = await rendererHarness(options);
    await harness.openSettings();
    await harness.get(id).dispatch('click');
    assert.equal(harness.get('settingsFeedback').hidden, false);
    assert.equal(harness.get('settingsFeedback').getAttribute('role'), 'alert');
    assert.equal(harness.get('settingsFeedback').textContent, message);
    assert.equal(harness.get('speechBubble').hidden, true);
    assert.equal(harness.get('settingsPanel').classList.contains('open'), true);
    assert.equal(harness.saved.apiKeySet, true);
    assert.match(harness.get('apiKeyInput').placeholder, /已安全保存/);
    options[option] = null;
    await harness.get('clearKeyBtn').dispatch('click');
    assert.equal(harness.saved.apiKeySet, false);
    assert.equal(harness.get('apiKeyInput').placeholder, 'sk-…');
    assert.equal(harness.get('settingsFeedback').hidden, false);
    assert.equal(harness.get('settingsFeedback').getAttribute('role'), 'status');
    assert.equal(harness.get('settingsFeedback').getAttribute('aria-live'), 'polite');
    assert.equal(harness.get('settingsFeedback').textContent, '已清除保存的 API Key。');
  }
});

test('restoring the single feature switch preserves one-minute greetings and the 23-message cycle', async () => {
  const harness = await rendererHarness({ floatingBubbleEnabled: true, settings: { voiceEnabled: true } });
  assert.equal(harness.get('speechBubble').hidden, false);
  for (const id of ['proactiveInput', 'voiceInput', 'bubbleOpacityInput']) {
    assert.equal(harness.get(id).parentElement.hidden, false);
  }
  const startedAt = harness.now;
  await harness.advance(59999);
  assert.equal(harness.bubbleChanges.filter((entry) => entry.at >= startedAt + 60000).length, 0);
  await harness.advance(1);
  assert.equal(harness.get('bubbleText').textContent, '老师，我在这里。');
  assert.deepEqual(harness.calls.spoken, ['老师，我在这里。']);
  await harness.advance(60000 * 45);
  const greetings = harness.bubbleChanges.filter((entry) => entry.at >= startedAt + 60000);
  assert.equal(greetings.length, 46);
  const firstCycle = greetings.slice(0, 23).map((entry) => entry.text);
  assert.equal(new Set(firstCycle).size, 23);
  assert.equal(firstCycle[22], '老师，愿今天的风也温柔一点。');
  assert.deepEqual(greetings.slice(23).map((entry) => entry.text), firstCycle);
  for (let index = 0; index < greetings.length; index += 1) assert.equal(greetings[index].at, startedAt + (index + 1) * 60000);
});

test('quiet hours and disabled companionship suppress recurring greetings', async () => {
  const quiet = await rendererHarness({ floatingBubbleEnabled: true, startAt: new Date(2026, 9, 4, 23).getTime() });
  await quiet.advance(3 * 60000);
  assert.equal(quiet.bubbleChanges.length, 1);
  const morning = await rendererHarness({ floatingBubbleEnabled: true, startAt: new Date(2026, 9, 5, 7, 59).getTime() });
  await morning.advance(60000);
  assert.equal(morning.get('bubbleText').textContent, '老师，我在这里。');
  const disabled = await rendererHarness({ floatingBubbleEnabled: true, settings: { proactiveEnabled: false } });
  await disabled.advance(3 * 60000);
  assert.equal(disabled.bubbleChanges.length, 1);
});

test('a busy model request retains the happy pose beyond click timeout and suppresses greeting interruptions', async () => {
  const response = deferred();
  const harness = await rendererHarness({ sendChat: () => response.promise });
  await harness.advance(1000);
  await harness.clickPet();
  await harness.send('请讲一个有关海洋的故事。');
  assert.equal(harness.get('petVisual').classList.contains('happy'), true);
  assert.equal(harness.get('petVisual').classList.contains('thinking'), true);
  assert.equal(harness.get('sendBtn').disabled, true);
  assert.equal(harness.get('bubbleText').textContent, '老师，让我想想...');
  assert.equal(harness.get('speechBubble').hidden, true);
  assert.equal(harness.get('speechBubble').classList.contains('visible'), false);
  await harness.advance(121000);
  assert.equal(harness.get('petVisual').classList.contains('happy'), true);
  assert.equal(harness.get('bubbleText').textContent, '老师，让我想想...');
  assert.equal(harness.bubbleChanges.filter((entry) => entry.text === '老师，我在这里。').length, 0);
  response.resolve({ kind: 'model', text: '这是海洋故事。' });
  await harness.flush();
  assert.equal(harness.get('petVisual').classList.contains('happy'), false);
  assert.equal(harness.get('petVisual').classList.contains('thinking'), false);
  assert.equal(harness.get('sendBtn').disabled, false);
  assert.equal(harness.get('bubbleText').textContent, '老师，complete！');
  assert.equal(harness.get('speechBubble').hidden, true);
  assert.equal(harness.get('speechBubble').classList.contains('visible'), false);
  assert.ok(harness.get('messages').children.some((row) => row.children[0]?.textContent === '这是海洋故事。'));
  await harness.advance(58000);
  assert.equal(harness.get('bubbleText').textContent, '老师，complete！');
});

test('the delayed startup greeting does not replace the status of a model request already in progress', async () => {
  const response = deferred();
  const harness = await rendererHarness({ floatingBubbleEnabled: true, sendChat: () => response.promise });
  await harness.send('请帮我整理一下思路。');
  try {
    assert.equal(harness.get('bubbleText').textContent, '老师，让我想想...');
    await harness.advance(700);
    assert.equal(harness.get('bubbleText').textContent, '老师，让我想想...');
  } finally {
    response.resolve({ kind: 'model', text: '可以从目标开始。' });
    await harness.flush();
  }
});

test('click happiness lasts 800 ms, restarts on another click, and dragging does not trigger it', async () => {
  const harness = await rendererHarness();
  await harness.clickPet();
  assert.equal(harness.get('petVisual').classList.contains('happy'), true);
  assert.equal(harness.get('petVisual').classList.contains('hello'), false);
  await harness.advance(799);
  assert.equal(harness.get('petVisual').classList.contains('happy'), true);
  await harness.advance(1);
  assert.equal(harness.get('petVisual').classList.contains('happy'), false);
  await harness.clickPet();
  await harness.advance(500);
  await harness.clickPet();
  await harness.advance(799);
  assert.equal(harness.get('petVisual').classList.contains('happy'), true);
  await harness.advance(1);
  assert.equal(harness.get('petVisual').classList.contains('happy'), false);
  const pet = harness.get('petVisual');
  const event = { button: 0, pointerId: 1, screenX: 100, screenY: 100, clientX: 100, clientY: 100 };
  await pet.dispatch('pointerdown', event);
  await pet.dispatch('pointermove', { ...event, screenX: 120 });
  await pet.dispatch('pointerup', { ...event, screenX: 120 });
  assert.equal(pet.classList.contains('happy'), false);
  assert.deepEqual(harness.calls.moveBy, [[20, 0]]);
});

test('model errors release the held pose and display the error without losing archive warnings', async () => {
  const response = deferred();
  const harness = await rendererHarness({ sendChat: () => response.promise });
  await harness.advance(1000);
  await harness.send('请讲故事。');
  assert.equal(harness.get('petVisual').classList.contains('happy'), true);
  response.resolve({ error: '网络暂时不可用。', archiveError: '这次对话尚未保存。' });
  await harness.flush();
  assert.equal(harness.get('petVisual').classList.contains('happy'), false);
  assert.equal(harness.get('sendBtn').disabled, false);
  const messages = harness.get('messages').children.map((row) => row.children[0]?.textContent);
  assert.ok(messages.includes('网络暂时不可用。'));
  assert.ok(messages.includes('这次对话尚未保存。'));
});

test('the composer placeholder uses the current nickname without quotation marks and updates after saving a rename', async () => {
  const harness = await rendererHarness({ settings: { petName: '星澜' } });
  assert.equal(harness.get('chatInput').placeholder, '想问星澜点什么...');
  await harness.openSettings();
  harness.get('petNameInput').value = '小鲸';
  await harness.get('settingsForm').dispatch('submit');
  assert.equal(harness.get('chatInput').placeholder, '想问小鲸点什么...');
});

test('all floating startup greetings omit the configured name while chat can introduce the character', async () => {
  const expected = ['今天从哪里开始？', '今天想先做哪件事？', '现在想聊些什么？', '今天也一起慢慢来吧。'];
  for (let index = 0; index < expected.length; index += 1) {
    const harness = await rendererHarness({ floatingBubbleEnabled: true, settings: { petName: '星澜' }, random: index / expected.length });
    await harness.advance(700);
    assert.equal(harness.get('bubbleText').textContent, expected[index]);
    assert.equal(harness.get('bubbleText').textContent.includes('星澜'), false);
    assert.equal(harness.html.includes('bubbleEyebrow'), false);
    assert.equal(harness.queriedSelectors.includes('#bubbleEyebrow'), false);
    if (index === 0) assert.ok(harness.get('messages').children[0].children[0].textContent.includes('星澜'));
  }
});
