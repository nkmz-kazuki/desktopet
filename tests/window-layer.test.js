const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { applyWindowLayer } = require('../src/window-layer');
const { mainHarness } = require('./main-harness');

function windowFixture(initial = {}) {
  const state = { visible: true, minimized: false, destroyed: false, cachedTopmost: true, nativeTopmost: false, ...initial };
  const calls = [];
  const window = {
    isDestroyed: () => state.destroyed,
    isVisible: () => state.visible,
    isMinimized: () => state.minimized,
    setAlwaysOnTop(enabled, level) {
      calls.push(['setAlwaysOnTop', enabled, level]);
      if (state.cachedTopmost !== enabled) state.nativeTopmost = enabled;
      state.cachedTopmost = enabled;
    },
    moveTop() { calls.push(['moveTop']); state.visible = true; },
    focus() { calls.push(['focus']); },
  };
  return { window, state, calls };
}

function layerCalls(harness) {
  return harness.windowCalls.filter(([method]) => method === 'setAlwaysOnTop');
}

function assertEnabled(harness) {
  assert.equal(harness.windowState.alwaysOnTop, true);
  assert.equal(harness.windowState.nativeAlwaysOnTop, true);
  assert.equal(layerCalls(harness).at(-1)?.[2], process.platform === 'win32' ? 'pop-up-menu' : 'floating');
  assert.equal(harness.windowCalls.some(([method]) => method === 'focus'), false);
}

test('Windows topmost repair resets a stale cached flag and avoids the floating taskbar placement', () => {
  const { window, state, calls } = windowFixture();
  applyWindowLayer(window, true, { platform: 'win32', raise: true });
  assert.deepEqual(calls, [
    ['setAlwaysOnTop', false, undefined],
    ['setAlwaysOnTop', true, 'pop-up-menu'],
    ['moveTop'],
  ]);
  assert.equal(state.nativeTopmost, true);
  assert.equal(state.cachedTopmost, true);
});

test('disabled topmost is never promoted even when raise is requested', () => {
  for (const platform of ['win32', 'darwin', 'linux']) {
    const { window, state, calls } = windowFixture({ nativeTopmost: true });
    applyWindowLayer(window, false, { platform, raise: true });
    assert.deepEqual(calls, [['setAlwaysOnTop', false, 'floating']]);
    assert.equal(state.nativeTopmost, false);
    assert.equal(state.cachedTopmost, false);
  }
});

test('non-Windows platforms retain their floating level without the Windows cache reset', () => {
  for (const platform of ['darwin', 'linux']) {
    const { window, state, calls } = windowFixture({ cachedTopmost: false });
    applyWindowLayer(window, true, { platform, raise: true });
    assert.deepEqual(calls, [['setAlwaysOnTop', true, 'floating'], ['moveTop']]);
    assert.equal(state.nativeTopmost, true);
  }
});

test('layer application never reveals hidden or minimized windows and does not raise unless requested', () => {
  for (const initial of [{ visible: false }, { minimized: true }]) {
    const { window, state, calls } = windowFixture(initial);
    applyWindowLayer(window, true, { platform: 'win32', raise: true });
    assert.deepEqual(calls.map(([method]) => method), ['setAlwaysOnTop', 'setAlwaysOnTop']);
    assert.equal(state.visible, initial.visible ?? true);
    assert.equal(state.minimized, initial.minimized ?? false);
  }
  const { window, calls } = windowFixture();
  applyWindowLayer(window, true, { platform: 'win32' });
  assert.equal(calls.some(([method]) => method === 'moveTop' || method === 'focus'), false);
});

test('missing and destroyed windows are ignored without invoking native methods', () => {
  assert.doesNotThrow(() => applyWindowLayer(null, true, { raise: true }));
  assert.doesNotThrow(() => applyWindowLayer(undefined, true));
  const { window, calls } = windowFixture({ destroyed: true });
  applyWindowLayer(window, true, { platform: 'win32', raise: true });
  assert.deepEqual(calls, []);
});

test('startup creates a non-topmost hidden window then applies the configured layer before inactive display', async (t) => {
  const harness = await mainHarness(t);
  harness.createWindow();
  assert.equal(harness.windowOptions.alwaysOnTop, false);
  assert.equal(harness.windowState.visible, false);
  assert.equal(harness.windowCalls.some(([method]) => method === 'moveTop' || method === 'showInactive'), false);
  assertEnabled(harness);
  harness.windowCalls.length = 0;
  harness.emitWindow('ready-to-show');
  assert.equal(harness.windowState.visible, true);
  assert.equal(harness.windowCalls.filter(([method]) => method === 'showInactive').length, 1);
  assert.ok(harness.windowCalls.some(([method]) => method === 'moveTop'));
  assertEnabled(harness);
});

test('show and restore events repair visible windows without activating them', async (t) => {
  const harness = await mainHarness(t);
  harness.createWindow();
  harness.emitWindow('ready-to-show');
  for (const event of ['show', 'restore']) {
    harness.loseNativeTopmost();
    harness.windowCalls.length = 0;
    harness.emitWindow(event);
    if (process.platform === 'win32') assertEnabled(harness);
    assert.ok(harness.windowCalls.some(([method]) => method === 'moveTop'));
    assert.equal(harness.windowCalls.some(([method]) => method === 'showInactive' || method === 'focus'), false);
  }
});

test('saving topmost off persists the choice through every recovery event and saving on repairs the native flag', async (t) => {
  const harness = await mainHarness(t);
  await harness.startApp();
  harness.emitWindow('ready-to-show');
  const disabled = await harness.invoke('settings:save', { alwaysOnTop: false });
  assert.equal(disabled.alwaysOnTop, false);
  const persisted = JSON.parse(await fs.readFile(path.join(harness.appPaths.userData, 'settings.json'), 'utf8'));
  assert.equal(persisted.alwaysOnTop, false);
  harness.windowCalls.length = 0;
  harness.emitWindow('show');
  harness.emitWindow('restore');
  harness.emitPower('resume');
  harness.emitPower('unlock-screen');
  harness.emitApp('activate');
  assert.equal(harness.windowState.nativeAlwaysOnTop, false);
  assert.ok(layerCalls(harness).length >= 5);
  assert.equal(layerCalls(harness).some(([, enabled]) => enabled), false);
  assert.equal(harness.windowCalls.some(([method]) => method === 'moveTop' || method === 'focus'), false);
  harness.windowCalls.length = 0;
  const enabled = await harness.invoke('settings:save', { alwaysOnTop: true });
  assert.equal(enabled.alwaysOnTop, true);
  assertEnabled(harness);
  assert.ok(harness.windowCalls.some(([method]) => method === 'moveTop'));
});

test('a previously disabled preference remains disabled on startup and tray reveal', async (t) => {
  const harness = await mainHarness(t, { saved: { alwaysOnTop: false } });
  await harness.startApp();
  harness.emitWindow('ready-to-show');
  harness.emit('app:hide');
  harness.clickTray('打开聊天');
  assert.equal(harness.windowState.visible, true);
  assert.equal(harness.windowState.alwaysOnTop, false);
  assert.equal(layerCalls(harness).some(([, enabled]) => enabled), false);
  assert.equal(harness.windowCalls.some(([method]) => method === 'moveTop' || method === 'focus'), false);
});

test('resume and unlock repair only visible non-minimized windows without reviving a hidden pet', async (t) => {
  const harness = await mainHarness(t);
  await harness.startApp();
  harness.emitWindow('ready-to-show');
  for (const event of ['resume', 'unlock-screen']) {
    harness.loseNativeTopmost();
    harness.windowCalls.length = 0;
    harness.emitPower(event);
    if (process.platform === 'win32') assertEnabled(harness);
    assert.equal(harness.windowCalls.some(([method]) => method === 'showInactive'), false);
    assert.ok(harness.windowCalls.some(([method]) => method === 'moveTop'));
  }
  for (const state of [{ visible: false, minimized: false }, { visible: true, minimized: true }]) {
    harness.setWindowState(state);
    harness.windowCalls.length = 0;
    for (const event of ['resume', 'unlock-screen']) harness.emitPower(event);
    for (const event of ['show', 'restore']) harness.emitWindow(event);
    assert.deepEqual(harness.windowCalls, []);
    assert.equal(harness.windowState.visible, state.visible);
    assert.equal(harness.windowState.minimized, state.minimized);
  }
});

test('saving an enabled preference while hidden updates the layer without showing or raising the pet', async (t) => {
  const harness = await mainHarness(t, { saved: { alwaysOnTop: false } });
  harness.createWindow();
  harness.windowCalls.length = 0;
  await harness.invoke('settings:save', { alwaysOnTop: true });
  assertEnabled(harness);
  assert.equal(harness.windowState.visible, false);
  assert.equal(harness.windowCalls.some(([method]) => method === 'moveTop' || method === 'showInactive'), false);
});

test('all explicit tray actions reveal the requested panel and repair its layer without stealing focus', async (t) => {
  const harness = await mainHarness(t);
  await harness.startApp();
  harness.emitWindow('ready-to-show');
  for (const [label, channel] of [['打开聊天', 'open-chat'], ['查看天气', 'request-weather'], ['设置', 'open-settings']]) {
    harness.emit('app:hide');
    harness.loseNativeTopmost();
    harness.windowCalls.length = 0;
    harness.clickTray(label);
    assert.equal(harness.windowState.visible, true);
    assert.equal(harness.rendererMessages.at(-1)?.channel, channel);
    if (process.platform === 'win32') assertEnabled(harness);
  }
  harness.clickTray('显示 / 隐藏');
  assert.equal(harness.windowState.visible, false);
  harness.windowCalls.length = 0;
  harness.clickTray('显示 / 隐藏');
  assert.equal(harness.windowState.visible, true);
  assert.ok(harness.windowCalls.some(([method]) => method === 'moveTop'));
  harness.emit('app:hide');
  harness.emitTray('click');
  assert.equal(harness.windowState.visible, true);
  assert.equal(harness.rendererMessages.at(-1)?.channel, 'open-chat');
  assert.equal(harness.windowCalls.some(([method]) => method === 'focus'), false);
});

test('destroyed and quitting windows receive no lifecycle layer or display calls', async (t) => {
  for (const scenario of ['destroyed', 'quitting']) {
    const harness = await mainHarness(t);
    await harness.startApp();
    harness.emitWindow('ready-to-show');
    if (scenario === 'destroyed') harness.setWindowState({ destroyed: true });
    else harness.emit('app:quit');
    harness.windowCalls.length = 0;
    for (const event of ['show', 'restore']) harness.emitWindow(event);
    for (const event of ['resume', 'unlock-screen']) harness.emitPower(event);
    harness.emitApp('activate');
    harness.clickTray('打开聊天');
    assert.deepEqual(harness.windowCalls, []);
    if (scenario === 'quitting') assert.equal(harness.quitCalls, 1);
  }
});
