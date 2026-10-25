const test = require('node:test');
const assert = require('node:assert/strict');
const { rendererHarness } = require('./renderer-harness');
const { resolveDesktopLayout } = require('../src/desktop-layout');

const workArea = { x: 0, y: 0, width: 1536, height: 960 };

test('desktop layout renders each region independently and accepts the effective small-screen scale', async () => {
  const layout = resolveDesktopLayout({ petAnchor: { x: -500, y: 956 }, scale: 1, workArea });
  const harness = await rendererHarness({ desktopLayout: layout });
  assert.equal(layout.panelSide, 'right');
  assert.equal(harness.css('--pet-stage-left'), `${layout.petStage.left}px`);
  assert.equal(harness.css('--panel-left'), `${layout.panel.left}px`);
  assert.equal(harness.css('--greeting-left'), `${layout.greeting.left - layout.petStage.left}px`);
  assert.equal(harness.css('--greeting-right'), 'auto');
  assert.equal(harness.css('--pet-scale'), String(layout.scale));
  const small = resolveDesktopLayout({ petAnchor: layout.petAnchor, scale: 1.18, workArea: { x: 0, y: 0, width: 320, height: 480 } });
  await harness.emitDesktopLayout(small);
  assert.ok(small.scale < 0.78);
  assert.equal(harness.css('--pet-scale'), String(small.scale));
  assert.equal(harness.saved.scale, 1);
});

test('invalid layout payloads cannot replace valid region coordinates', async () => {
  const layout = resolveDesktopLayout({ scale: 1, workArea });
  const harness = await rendererHarness({ desktopLayout: layout });
  const before = harness.css('--panel-left');
  for (const invalid of [null, {}, { ...layout, scale: NaN }, { ...layout, panel: { ...layout.panel, width: -1 } }]) {
    await harness.emitDesktopLayout(invalid);
    assert.equal(harness.css('--panel-left'), before);
  }
});

test('opacity preview, cancel and save preserve the stored size with no size control or payload', async () => {
  const harness = await rendererHarness({ settings: { scale: 1.12 } });
  assert.equal(harness.css('--pet-scale'), '1.12');
  assert.deepEqual(harness.calls.previewScale, [1.12]);
  await harness.openSettings();
  assert.equal(harness.get('scaleInput'), undefined);
  for (const name of ['pet', 'chat', 'message', 'input', 'text', 'bubble']) {
    const control = harness.get(`${name}OpacityInput`);
    control.value = '55';
    await control.dispatch('input');
    assert.equal(harness.css('--pet-scale'), '1.12');
  }
  assert.equal(harness.saved.scale, 1.12);
  await harness.get('closeSettingsBtn').dispatch('click');
  assert.equal(harness.css('--pet-scale'), '1.12');
  assert.equal(harness.calls.saveSettings.length, 0);
  await harness.openSettings();
  await harness.get('settingsForm').dispatch('submit');
  assert.equal('scale' in harness.calls.saveSettings[0], false);
  assert.equal('reasoningEffort' in harness.calls.saveSettings[0], false);
  assert.equal(harness.saved.scale, 1.12);
  assert.equal(harness.css('--pet-scale'), '1.12');
  assert.deepEqual(harness.calls.previewScale, [1.12]);
});

test('context toolbar uses its measured size and clamps each edge to the visible frame', async () => {
  const layout = resolveDesktopLayout({ petAnchor: { x: 1500, y: 956 }, scale: 0.78, workArea });
  const harness = await rendererHarness({ desktopLayout: layout });
  const toolbar = harness.get('contextToolbar');
  toolbar.offsetWidth = 112;
  toolbar.offsetHeight = 118;
  for (const point of [{ clientX: -1000, clientY: -1000 }, { clientX: 10000, clientY: 10000 }]) {
    await harness.get('petVisual').dispatch('contextmenu', point);
    const left = parseFloat(toolbar.style.left);
    const top = parseFloat(toolbar.style.top);
    assert.ok(left >= 4 && top >= 4);
    assert.ok(left + 112 <= layout.visibleBounds.width - 4);
    assert.ok(top + 118 <= layout.visibleBounds.height - 4);
  }
});
