const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { mainHarness } = require('./main-harness');
const { resolveDesktopLayout, anchorFromLegacyPosition, PET_BOTTOM_OVERFLOW } = require('../src/desktop-layout');

const EPSILON = 1e-8;
const primary = { workArea: { x: 0, y: 0, width: 1536, height: 960 } };
const secondary = { workArea: { x: -1536, y: 100, width: 1536, height: 960 } };
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < EPSILON, `${actual} ≈ ${expected}`);
const persistedSettings = (harness) => fs.readFile(path.join(harness.appPaths.userData, 'settings.json'), 'utf8').then(JSON.parse);

function screenRect(layout, rect, height = rect.height) {
  return { x: layout.windowBounds.x + rect.left, y: layout.windowBounds.y + rect.top, width: rect.width, height };
}

function assertContained(rect, area, margin = 0) {
  assert.ok(rect.x >= area.x + margin - EPSILON, 'left remains visible');
  assert.ok(rect.y >= area.y + margin - EPSILON, 'top remains visible');
  assert.ok(rect.x + rect.width <= area.x + area.width - margin + EPSILON, 'right remains visible');
  assert.ok(rect.y + rect.height <= area.y + area.height - margin + EPSILON, 'bottom remains visible');
}

function assertSafeLayout(layout) {
  assertContained(layout.windowBounds, layout.workArea);
  assertContained(screenRect(layout, layout.panel), layout.workArea, 8);
  assertContained(screenRect(layout, layout.greeting, layout.greeting.maxHeight + 24), layout.workArea, 8);
  for (const value of Object.values(layout.windowBounds)) assert.ok(Number.isInteger(value));
  assert.equal(layout.visibleBounds.width, layout.windowBounds.width);
  assert.equal(layout.visibleBounds.height, layout.windowBounds.height);
  close(layout.petStage.left + layout.windowBounds.x + 257.65, layout.petAnchor.x);
  close(layout.petStage.top + layout.windowBounds.y + 724, layout.petAnchor.y);
  assert.ok(layout.petAnchor.y - 604 * layout.scale >= layout.workArea.y + 8 - EPSILON, 'the top leaves room for the breathing movement');
  assert.ok(layout.petAnchor.y <= layout.workArea.y + layout.workArea.height + PET_BOTTOM_OVERFLOW + EPSILON);
  assert.ok(layout.windowBounds.width >= 114 && layout.windowBounds.height >= 114, 'the toolbar can fit inside visible bounds');
}

test('independent panels, greeting including its tail, and the native frame stay inside all monitor edges', () => {
  for (const workArea of [
    primary.workArea, secondary.workArea,
    { x: 200, y: -900, width: 1280, height: 860 },
    { x: 0, y: 0, width: 640, height: 480 },
    { x: 0, y: 0, width: 320, height: 640 },
  ]) {
    for (const scale of [0.78, 1, 1.18]) {
      for (const x of [-100000, workArea.x + workArea.width / 2, 100000]) {
        for (const y of [-100000, workArea.y + workArea.height / 2, 100000]) {
          assertSafeLayout(resolveDesktopLayout({ workArea, scale, petAnchor: { x, y } }));
        }
      }
    }
  }
});

test('the pet reaches four DIPs from the far left with its panel on the right at every scale', () => {
  for (const workArea of [primary.workArea, secondary.workArea]) {
    for (const scale of [0.78, 1, 1.18]) {
      const layout = resolveDesktopLayout({ workArea, scale, petAnchor: { x: -100000, y: 800 } });
      close(layout.petAnchor.x - 221.65 * scale, workArea.x + 4);
      assert.equal(layout.panelSide, 'right');
      const panel = screenRect(layout, layout.panel);
      close(panel.x, layout.petAnchor.x + 181.35 * scale + 12);
      assertSafeLayout(layout);
    }
  }
});

test('right limits preserve seven eighths plus four DIPs and only the pet feet can extend 20 DIPs below the work area', () => {
  assert.equal(PET_BOTTOM_OVERFLOW, 20);
  for (const workArea of [primary.workArea, secondary.workArea]) {
    for (const scale of [0.78, 1, 1.18]) {
      const layout = resolveDesktopLayout({ workArea, scale, petAnchor: { x: 100000, y: 100000 } });
      const petLeft = layout.petAnchor.x - 221.65 * scale;
      close(workArea.x + workArea.width - petLeft, 403 * scale * 0.875 + 4);
      close(layout.petAnchor.y, workArea.y + workArea.height + 20);
      assert.equal(layout.panelSide, 'left');
      assertSafeLayout(layout);
    }
  }
});

test('when either side fits the panel chooses toward the screen center, and narrow screens can overlap without trapping the pet', () => {
  const workArea = { x: 0, y: 0, width: 2400, height: 1080 };
  assert.equal(resolveDesktopLayout({ workArea, petAnchor: { x: 900, y: 1000 } }).panelSide, 'right');
  assert.equal(resolveDesktopLayout({ workArea, petAnchor: { x: 1500, y: 1000 } }).panelSide, 'left');
  const narrow = { x: 0, y: 0, width: 640, height: 480 };
  const layout = resolveDesktopLayout({ workArea: narrow, scale: 1.18, petAnchor: { x: -100000, y: 100000 } });
  close(layout.scale, (480 - 16) / 604);
  close(layout.petAnchor.x - 221.65 * layout.scale, 4);
  assert.equal(layout.panel.width, 374);
  assert.equal(layout.panel.height, 464);
  assertSafeLayout(layout);
  const portrait = resolveDesktopLayout({ workArea: { x: 0, y: 0, width: 320, height: 640 }, scale: 1.18, petAnchor: { x: 100000, y: 100000 } });
  close(portrait.scale, 312 / (403 * 0.875));
  close(320 - (portrait.petAnchor.x - 221.65 * portrait.scale), 403 * portrait.scale * 0.875 + 4);
  assertSafeLayout(portrait);
});

test('greetings prefer the space above the pet and avoid an adjacent panel when there is room', () => {
  const layout = resolveDesktopLayout({ workArea: { x: 0, y: 0, width: 1920, height: 1080 }, scale: 0.78, petAnchor: { x: 1200, y: 1040 } });
  const greeting = screenRect(layout, layout.greeting, layout.greeting.maxHeight + 24);
  const panel = screenRect(layout, layout.panel);
  assert.ok(greeting.y + greeting.height <= layout.petAnchor.y - 604 * layout.scale - 12 + EPSILON);
  assert.ok(greeting.x >= panel.x + panel.width || greeting.x + greeting.width <= panel.x
    || greeting.y >= panel.y + panel.height || greeting.y + greeting.height <= panel.y);
  assertSafeLayout(layout);
});

test('startup migrates the old fixed window position once and prioritizes the saved pet anchor thereafter', async (t) => {
  close(anchorFromLegacyPosition({ x: 836, y: 280 }).x, 1433.65);
  const harness = await mainHarness(t, { displays: [primary], saved: { scale: 0.78, windowPosition: { x: 836, y: 280 } } });
  const expected = resolveDesktopLayout({ workArea: primary.workArea, scale: 0.78, petAnchor: anchorFromLegacyPosition({ x: 836, y: 280 }) });
  harness.createWindow();
  assert.deepEqual(harness.windowBounds, expected.windowBounds);
  const saved = await persistedSettings(harness);
  assert.deepEqual(saved.petPosition, expected.petAnchor);
  assert.deepEqual(saved.windowPosition, { x: expected.windowBounds.x, y: expected.windowBounds.y });
  const restarted = await mainHarness(t, { displays: [primary], saved: { ...saved, windowPosition: { x: -50000, y: -50000 } } });
  assert.deepEqual(restarted.restoreLayout().petAnchor, expected.petAnchor);
  restarted.createWindow();
  assert.deepEqual(restarted.windowBounds, expected.windowBounds);
  restarted.emitWindow('ready-to-show');
  assert.equal(restarted.rendererMessages[0].channel, 'desktop-layout');
});

test('incremental dragging follows the anchor across panel side changes without frame-induced drift', async (t) => {
  const harness = await mainHarness(t, { displays: [primary], saved: { scale: 0.78, petPosition: { x: 400, y: 800 } } });
  harness.createWindow();
  const before = await harness.invoke('window:get-layout');
  for (let index = 0; index < 500; index += 1) harness.emit('window:move-by', { x: 1.25, y: 0 });
  const moved = await harness.invoke('window:get-layout');
  close(moved.petAnchor.x, before.petAnchor.x + 625);
  close(moved.petAnchor.y, before.petAnchor.y);
  assert.notEqual(moved.panelSide, before.panelSide);
  for (let index = 0; index < 500; index += 1) harness.emit('window:move-by', { x: -1.25, y: 0 });
  const returned = await harness.invoke('window:get-layout');
  close(returned.petAnchor.x, before.petAnchor.x);
  assert.deepEqual(returned.windowBounds, before.windowBounds);
  harness.emit('window:move-by', { x: 100000, y: 100000 });
  const limit = await harness.invoke('window:get-layout');
  harness.emit('window:move-by', { x: 100, y: 100 });
  assert.deepEqual((await harness.invoke('window:get-layout')).petAnchor, limit.petAnchor);
  harness.emit('window:move-by', { x: -1, y: -1 });
  close((await harness.invoke('window:get-layout')).petAnchor.x, limit.petAnchor.x - 1);
  close((await harness.invoke('window:get-layout')).petAnchor.y, limit.petAnchor.y - 1);
  await new Promise((resolve) => setTimeout(resolve, 380));
  assert.deepEqual((await persistedSettings(harness)).petPosition, (await harness.invoke('window:get-layout')).petAnchor);
});

test('startup and dragging respect a negative-coordinate monitor and disconnected positions recover to the primary display', async (t) => {
  const harness = await mainHarness(t, {
    displays: [primary, secondary], saved: { scale: 0.78, petPosition: { x: -900, y: 850 } }, cursorPoint: { x: -1200, y: 850 },
  });
  harness.createWindow();
  assert.deepEqual((await harness.invoke('window:get-layout')).workArea, secondary.workArea);
  harness.emit('window:move-by', { x: -100000, y: 0 });
  const moved = await harness.invoke('window:get-layout');
  close(moved.petAnchor.x - 221.65 * moved.scale, secondary.workArea.x + 4);
  assert.equal(moved.panelSide, 'right');
  assertSafeLayout(moved);
  const disconnected = await mainHarness(t, { displays: [primary], saved: { petPosition: { x: -5000, y: -5000 } } });
  const defaults = await mainHarness(t, { displays: [primary] });
  assert.deepEqual(disconnected.restoreLayout(), defaults.restoreLayout());
  assertSafeLayout(disconnected.restoreLayout());
});

test('a pet whose feet cross a stacked display boundary restores on the screen containing its body', async (t) => {
  const lower = { workArea: { x: 0, y: 960, width: 1536, height: 960 } };
  const harness = await mainHarness(t, {
    displays: [primary, lower], saved: { scale: 1, petPosition: { x: 1200, y: 980 } },
  });
  harness.createWindow();
  const layout = await harness.invoke('window:get-layout');
  assert.deepEqual(layout.workArea, primary.workArea);
  assert.equal(layout.petAnchor.y, 980);
  assertSafeLayout(layout);
  const restarted = await mainHarness(t, { displays: [primary, lower], saved: await persistedSettings(harness) });
  assert.deepEqual(restarted.restoreLayout(), layout);
  const initial = resolveDesktopLayout({ workArea: primary.workArea });
  assert.equal(initial.petAnchor.y, 956, 'new default placement does not automatically push feet below the screen');
});

test('scale preview does not save anchors or preferences, cancellation restores them, and save commits the chosen layout', async (t) => {
  const harness = await mainHarness(t, { displays: [primary], saved: { scale: 0.78, petPosition: { x: 178, y: 956 } } });
  harness.createWindow();
  const before = await harness.invoke('window:get-layout');
  const savedBefore = await persistedSettings(harness);
  harness.emit('window:preview-scale', 1.18);
  const preview = await harness.invoke('window:get-layout');
  assert.equal(preview.scale, 1.18);
  assert.notEqual(preview.petAnchor.x, before.petAnchor.x);
  assert.deepEqual(await persistedSettings(harness), savedBefore);
  assert.deepEqual(JSON.parse(JSON.stringify((await harness.invoke('settings:get')).petPosition)), savedBefore.petPosition);
  harness.emit('window:preview-scale', 0.78);
  assert.deepEqual(await harness.invoke('window:get-layout'), before);
  const saved = await harness.invoke('settings:save', { scale: 1.18 });
  assert.equal(saved.scale, 1.18);
  const layout = await harness.invoke('window:get-layout');
  assert.deepEqual(JSON.parse(JSON.stringify(saved.petPosition)), layout.petAnchor);
  assert.deepEqual((await persistedSettings(harness)).petPosition, layout.petAnchor);
  assert.deepEqual(harness.windowBounds, layout.windowBounds);
});

test('small-screen fitting preserves the preferred scale and dragging back to a larger monitor restores it', async (t) => {
  const harness = await mainHarness(t, { displays: [{ workArea: { x: 0, y: 0, width: 640, height: 480 } }], saved: { scale: 1.18 } });
  harness.createWindow();
  close((await harness.invoke('window:get-layout')).scale, 464 / 604);
  assert.equal((await harness.invoke('settings:get')).scale, 1.18);
  assert.equal((await persistedSettings(harness)).scale, 1.18);
  harness.setDisplays([{ workArea: { x: 0, y: 0, width: 640, height: 480 } }, { workArea: { x: 640, y: 0, width: 1536, height: 960 } }]);
  harness.setCursor({ x: 1000, y: 400 });
  harness.emit('window:move-by', { x: 700, y: 0 });
  const moved = await harness.invoke('window:get-layout');
  assert.equal(moved.scale, 1.18);
  assert.equal(moved.workArea.x, 640);
  assert.equal((await harness.invoke('settings:get')).scale, 1.18);
  assertSafeLayout(moved);
});

test('dragging a scale preview saves the moved anchor while leaving the saved scale unchanged', async (t) => {
  const harness = await mainHarness(t, { displays: [primary], saved: { scale: 0.78, petPosition: { x: 400, y: 800 } } });
  harness.createWindow();
  harness.emit('window:preview-scale', 1.18);
  const preview = await harness.invoke('window:get-layout');
  harness.emit('window:move-by', { x: 20, y: 0 });
  const moved = await harness.invoke('window:get-layout');
  close(moved.petAnchor.x, preview.petAnchor.x + 20);
  assert.equal(moved.scale, 1.18);
  const preferences = await harness.invoke('settings:get');
  assert.equal(preferences.scale, 0.78);
  close(preferences.petPosition.x, moved.petAnchor.x);
  harness.emit('window:preview-scale', 0.78);
  const canceled = await harness.invoke('window:get-layout');
  close(canceled.petAnchor.x, moved.petAnchor.x);
  assert.equal(canceled.scale, 0.78);
});

test('invalid directories and non-finite drag or scale payloads cannot partially move the window or change its preferences', async (t) => {
  const harness = await mainHarness(t);
  harness.createWindow();
  const previous = harness.windowBounds;
  const saved = await persistedSettings(harness);
  await assert.rejects(harness.invoke('settings:save', { scale: 1.18, conversationDirectory: 'not-absolute' }));
  for (const delta of [null, {}, { x: NaN, y: 0 }, { x: 0, y: Infinity }, { x: '1', y: 0 }]) harness.emit('window:move-by', delta);
  for (const scale of [null, NaN, Infinity, 0.77, 1.19, '1']) harness.emit('window:preview-scale', scale);
  assert.deepEqual(harness.windowBounds, previous);
  assert.deepEqual(await persistedSettings(harness), saved);
  assert.equal(harness.boundsChanges.length, 0);
});

test('display removal and metrics changes reclamp a hidden pet without showing or focusing it', async (t) => {
  const harness = await mainHarness(t, { displays: [primary, secondary], saved: { petPosition: { x: -900, y: 850 } } });
  await harness.startApp();
  harness.setWindowState({ visible: false });
  harness.setDisplays([primary]);
  harness.windowCalls.length = 0;
  harness.emitScreen('display-removed');
  const recovered = await harness.invoke('window:get-layout');
  assert.deepEqual(recovered.workArea, primary.workArea);
  assertSafeLayout(recovered);
  harness.setDisplays([{ workArea: { x: 0, y: 0, width: 800, height: 600 } }]);
  harness.emitScreen('display-metrics-changed');
  assertSafeLayout(await harness.invoke('window:get-layout'));
  assert.equal(harness.windowState.visible, false);
  assert.equal(harness.windowCalls.some(([method]) => ['showInactive', 'focus', 'moveTop'].includes(method)), false);
  const lastBounds = harness.windowBounds;
  harness.emitApp('before-quit');
  harness.emitScreen('display-removed');
  harness.emit('window:move-by', { x: 100, y: 100 });
  assert.deepEqual(harness.windowBounds, lastBounds);
});

test('dragging does not reset the native window layer on each pointer move and quitting flushes the latest anchor', async (t) => {
  const harness = await mainHarness(t, { displays: [primary], saved: { petPosition: { x: 700, y: 800 } } });
  harness.createWindow();
  const initial = await persistedSettings(harness);
  harness.windowCalls.length = 0;
  harness.emit('window:move-by', { x: 30, y: 0 });
  const moved = await harness.invoke('window:get-layout');
  assert.equal(harness.windowCalls.some(([method]) => method === 'setAlwaysOnTop'), false);
  assert.deepEqual((await persistedSettings(harness)).petPosition, initial.petPosition);
  harness.emitApp('before-quit');
  const saved = await persistedSettings(harness);
  close(saved.petPosition.x, moved.petAnchor.x);
  close(saved.petPosition.y, moved.petAnchor.y);
});
