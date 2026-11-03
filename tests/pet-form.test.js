const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { mainHarness } = require('./main-harness');
const { rendererHarness, deferred } = require('./renderer-harness');

async function loadImages(harness) {
  for (const id of ['petImage', 'petHappyImage', 'petChibiImage', 'petChibiHappyImage']) {
    Object.assign(harness.get(id), { complete: true, naturalWidth: 1024, naturalHeight: 1536 });
  }
  await harness.get('petImage').dispatch('load');
}

async function doubleClick(harness) {
  await harness.clickPet();
  await harness.advance(100);
  await harness.clickPet();
  await harness.get('petVisual').dispatch('dblclick');
  await harness.flush();
}

test('old and invalid preferences default to original while the selected chibi form survives reload', async (t) => {
  for (const petForm of [undefined, 'unknown', null]) {
    const harness = await mainHarness(t, { saved: { petForm } });
    assert.equal((await harness.invoke('settings:get')).petForm, 'original');
  }
  const harness = await mainHarness(t, { saved: { petName: '小鲸', modelId: 'deepseek-v4-pro', chatOpacity: 67 } });
  const before = await harness.invoke('settings:get');
  const after = await harness.invoke('pet:set-form', 'chibi');
  assert.equal(after.petForm, 'chibi');
  for (const key of Object.keys(before).filter((key) => key !== 'petForm')) assert.deepEqual(after[key], before[key], key);
  assert.equal(harness.loginUpdates, 0);
  assert.deepEqual(harness.boundsChanges, []);
  const saved = JSON.parse(await fs.readFile(path.join(harness.appPaths.userData, 'settings.json'), 'utf8'));
  const reloaded = await mainHarness(t, { saved });
  assert.equal((await reloaded.invoke('settings:get')).petForm, 'chibi');
  assert.throws(() => harness.invoke('pet:set-form', '../other'), /无法切换/);
  assert.equal((await harness.invoke('settings:get')).petForm, 'chibi');
  await harness.invoke('settings:save', { city: '南京' });
  assert.equal((await harness.invoke('settings:get')).petForm, 'chibi');
});

test('switching form leaves the ongoing model conversation intact', async (t) => {
  const requests = [];
  const harness = await mainHarness(t, { fetchImpl: async (_url, options) => {
    requests.push(JSON.parse(options.body));
    return new Response(JSON.stringify({
      status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '记住啦。' }] }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } });
  await harness.invoke('chat:send', '我的小狗叫小白，请记住这个名字。');
  await harness.invoke('pet:set-form', 'chibi');
  await harness.invoke('chat:send', '我的小狗叫什么名字？');
  assert.equal(requests.length, 2);
  assert.ok(JSON.stringify(requests[1].input).includes('我的小狗叫小白，请记住这个名字。'));
  assert.ok(JSON.stringify(requests[1].input).includes('记住啦。'));
});

test('a single click shows the smile immediately for 800ms and toggles chat only after double-click discrimination', async () => {
  const harness = await rendererHarness();
  await harness.clickPet();
  assert.equal(harness.get('petVisual').classList.contains('happy'), true);
  assert.equal(harness.get('chatPanel').classList.contains('open'), false);
  await harness.advance(499);
  assert.equal(harness.get('chatPanel').classList.contains('open'), false);
  await harness.advance(1);
  assert.equal(harness.get('chatPanel').classList.contains('open'), true);
  await harness.advance(299);
  assert.equal(harness.get('petVisual').classList.contains('happy'), true);
  await harness.advance(1);
  assert.equal(harness.get('petVisual').classList.contains('happy'), false);
  await harness.clickPet();
  await harness.advance(500);
  assert.equal(harness.get('chatPanel').classList.contains('open'), false);
  assert.deepEqual(harness.calls.setPetForm, []);
});

test('double click changes the pair in both directions without opening or hiding chat or re-saving other preferences', async () => {
  const harness = await rendererHarness({ settings: { petName: '小鲸', modelId: 'deepseek-v4-pro', petOpacity: 73 } });
  await loadImages(harness);
  await doubleClick(harness);
  assert.equal(harness.get('petVisual').dataset.petForm, 'chibi');
  assert.equal(harness.saved.petForm, 'chibi');
  await harness.advance(1000);
  assert.equal(harness.get('chatPanel').classList.contains('open'), false);
  await harness.openChat();
  await doubleClick(harness);
  await harness.advance(1000);
  assert.equal(harness.get('petVisual').dataset.petForm, 'original');
  assert.equal(harness.get('chatPanel').classList.contains('open'), true);
  assert.deepEqual(harness.calls.setPetForm, ['chibi', 'original']);
  assert.deepEqual(harness.calls.saveSettings, []);
  assert.equal(harness.saved.petName, '小鲸');
  assert.equal(harness.saved.modelId, 'deepseek-v4-pro');
  assert.equal(harness.css('--pet-opacity'), '0.73');
});

test('chibi uses only its own unshifted alpha images, keeping the rest of the transparent desktop clickable', async () => {
  const drawn = [];
  const transforms = [];
  const harness = await rendererHarness({ canvasContext: {
    drawImage: (image) => drawn.push(image.id), save() {}, restore() {},
    setTransform: (...values) => transforms.push(values),
    getImageData: (x, y) => ({ data: [0, 0, 0, x > 450 && x < 550 && y > 700 && y < 800 ? 255 : 0] }),
  } });
  await loadImages(harness);
  await doubleClick(harness);
  assert.deepEqual(drawn.slice(-2), ['petChibiImage', 'petChibiHappyImage']);
  assert.deepEqual(transforms.at(-1), [1, 0, 0, 1, 0, 0]);
  harness.get('petVisual').rect = { left: 0, top: 0, width: 403, height: 604 };
  await harness.windowEvent('mousemove', { clientX: 201.5, clientY: 302 });
  assert.equal(harness.calls.setIgnoreMouse.at(-1), false);
  await harness.windowEvent('mousemove', { clientX: 25, clientY: 25 });
  assert.equal(harness.calls.setIgnoreMouse.at(-1), true);
});

test('switching during an answer keeps the happy pose beyond the click timer and releases it after the answer', async () => {
  const response = deferred();
  const harness = await rendererHarness({ sendChat: () => response.promise });
  await loadImages(harness);
  await harness.send('请讲一个故事。');
  await doubleClick(harness);
  await harness.advance(2000);
  assert.equal(harness.get('petVisual').dataset.petForm, 'chibi');
  assert.equal(harness.get('petVisual').classList.contains('happy'), true);
  assert.equal(harness.get('petVisual').classList.contains('thinking'), true);
  response.resolve({ kind: 'model', text: '很久很久以前。' });
  await harness.flush();
  assert.equal(harness.get('petVisual').classList.contains('happy'), false);
  assert.equal(harness.get('petVisual').classList.contains('thinking'), false);
  assert.equal(harness.get('petVisual').dataset.petForm, 'chibi');
});

test('failed form loading or saving retains the current form and reports a retryable error', async () => {
  for (const formError of [undefined, '暂时无法保存人物形象。']) {
    const harness = await rendererHarness({ formError });
    if (formError) await loadImages(harness);
    await doubleClick(harness);
    assert.equal(harness.get('petVisual').dataset.petForm, 'original');
    const messages = harness.get('messages').children.map((message) => message.children[0]?.textContent);
    assert.ok(messages.some((message) => /人物形象/.test(message)));
  }
});

test('dragging, pointer cancellation and the context menu cancel a pending chat click', async () => {
  for (const action of ['drag', 'cancel', 'contextmenu']) {
    const harness = await rendererHarness();
    await harness.clickPet();
    const pet = harness.get('petVisual');
    const event = { button: 0, pointerId: 1, screenX: 100, screenY: 100, clientX: 100, clientY: 100 };
    if (action === 'contextmenu') await pet.dispatch('contextmenu', event);
    else {
      await pet.dispatch('pointerdown', event);
      if (action === 'drag') await pet.dispatch('pointermove', { ...event, screenX: 125 });
      await pet.dispatch(action === 'cancel' ? 'pointercancel' : 'pointerup', { ...event, screenX: 125 });
      await pet.dispatch('dblclick');
    }
    await harness.advance(1000);
    assert.equal(harness.get('chatPanel').classList.contains('open'), false);
    assert.deepEqual(harness.calls.setPetForm, []);
  }
});
