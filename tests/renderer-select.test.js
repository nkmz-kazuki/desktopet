const test = require('node:test');
const assert = require('node:assert/strict');
const { rendererHarness } = require('./renderer-harness');

async function chooseLast(harness, id) {
  const trigger = harness.get(`${id}Trigger`);
  await trigger.dispatch('click');
  await trigger.dispatch('keydown', { key: 'End' });
  await trigger.dispatch('keydown', { key: 'Enter' });
}

test('the model control uses an accessible custom list backed by a hidden native value and shared current options', async () => {
  const harness = await rendererHarness();
  await harness.openSettings();
  const native = harness.get('modelInput');
  const trigger = harness.get('modelInputTrigger');
  const listbox = harness.get('modelInputListbox');
  assert.equal(native.hidden, true);
  assert.equal(native.getAttribute('tabindex'), '-1');
  assert.equal(native.getAttribute('aria-hidden'), 'true');
  assert.equal(trigger.getAttribute('role'), 'combobox');
  assert.equal(trigger.getAttribute('aria-controls'), listbox.id);
  assert.equal(trigger.getAttribute('aria-expanded'), 'false');
  assert.equal(listbox.getAttribute('role'), 'listbox');
  assert.equal(listbox.parentElement, harness.get('settingsPanel'));
  assert.equal(listbox.hidden, true);
  assert.equal(harness.get('modelInput').value, 'deepseek-flash');
  assert.equal(harness.get('modelInputValue').textContent, 'DeepSeek V4.1 Flash');
  assert.deepEqual(harness.get('modelInputListbox').children.map((group) => group.children[0].textContent), ['Flash 系列', 'Pro 系列']);
  assert.deepEqual([0, 1].map((index) => harness.get(`modelInputOption${index}`).dataset.value), ['deepseek-flash', 'deepseek-v4-pro']);
});

test('navigation changes only the active option; Escape cancels while Enter and Space confirm a draft', async () => {
  const harness = await rendererHarness();
  await harness.openSettings();
  const trigger = harness.get('modelInputTrigger');
  await trigger.dispatch('keydown', { key: 'ArrowDown' });
  assert.equal(trigger.getAttribute('aria-expanded'), 'true');
  assert.equal(trigger.getAttribute('aria-activedescendant'), 'modelInputOption0');
  await trigger.dispatch('keydown', { key: 'End' });
  assert.equal(trigger.getAttribute('aria-activedescendant'), 'modelInputOption1');
  assert.equal(harness.get('modelInput').value, 'deepseek-flash');
  assert.equal(harness.get('modelInputOption0').getAttribute('aria-selected'), 'true');
  assert.equal(harness.get('modelInputOption1').getAttribute('aria-selected'), 'false');
  await trigger.dispatch('keydown', { key: 'Escape' });
  assert.equal(trigger.getAttribute('aria-expanded'), 'false');
  assert.equal(trigger.getAttribute('aria-activedescendant'), undefined);
  assert.equal(harness.activeElement, trigger);
  assert.equal(harness.get('modelInput').value, 'deepseek-flash');
  await chooseLast(harness, 'modelInput');
  assert.equal(harness.get('modelInput').value, 'deepseek-v4-pro');
  assert.equal(harness.get('modelInputValue').textContent, 'DeepSeek V4 Pro');
  assert.equal(harness.get('modelInputOption1').getAttribute('aria-selected'), 'true');
  assert.equal(harness.calls.saveSettings.length, 0);
  await trigger.dispatch('keydown', { key: 'Home' });
  assert.equal(trigger.getAttribute('aria-activedescendant'), 'modelInputOption0');
  await trigger.dispatch('keydown', { key: 'ArrowDown' });
  assert.equal(trigger.getAttribute('aria-activedescendant'), 'modelInputOption1');
  await trigger.dispatch('keydown', { key: 'ArrowUp' });
  const enter = await trigger.dispatch('keydown', { key: ' ' });
  assert.equal(enter.defaultPrevented, true);
  assert.equal(harness.get('modelInput').value, 'deepseek-flash');
  assert.equal(harness.get('modelInputValue').textContent, 'DeepSeek V4.1 Flash');
  assert.equal(harness.get('modelInputListbox').hidden, true);
});

test('the custom lists close on outside input, scrolling, blur and Tab without stealing normal Tab behavior', async () => {
  const harness = await rendererHarness();
  await harness.openSettings();
  const trigger = harness.get('modelInputTrigger');
  await trigger.dispatch('click');
  await harness.pointerDown(harness.get('modelInputOption1'));
  assert.equal(harness.get('modelInputListbox').hidden, false);
  await harness.get('modelInputOption1').dispatch('click');
  assert.equal(harness.get('modelInput').value, 'deepseek-v4-pro');
  await trigger.dispatch('click');
  await harness.pointerDown(harness.get('cityInput'));
  assert.equal(harness.get('modelInputListbox').hidden, true);
  await trigger.dispatch('click');
  await harness.get('settingsContent').dispatch('scroll');
  assert.equal(harness.get('modelInputListbox').hidden, true);
  await trigger.dispatch('click');
  await harness.windowEvent('blur');
  assert.equal(harness.get('modelInputListbox').hidden, true);
  await trigger.dispatch('click');
  const tab = await trigger.dispatch('keydown', { key: 'Tab' });
  assert.equal(tab.defaultPrevented, false);
  assert.equal(harness.get('modelInputListbox').hidden, true);
  await trigger.dispatch('click');
  await harness.windowEvent('resize');
  assert.equal(harness.get('modelInputListbox').hidden, true);
});

test('changing native values synchronizes labels and selected accessibility state', async () => {
  const harness = await rendererHarness();
  await harness.openSettings();
  harness.get('modelInput').value = 'deepseek-v4-pro';
  await harness.get('modelInput').dispatch('change');
  assert.equal(harness.get('modelInputValue').textContent, 'DeepSeek V4 Pro');
  assert.equal(harness.get('modelInputOption1').getAttribute('aria-selected'), 'true');
  await harness.get('modelInputTrigger').dispatch('click');
  harness.get('modelInput').value = 'deepseek-flash';
  await harness.get('modelInput').dispatch('input');
  assert.equal(harness.get('modelInputValue').textContent, 'DeepSeek V4.1 Flash');
  assert.equal(harness.get('modelInputTrigger').getAttribute('aria-activedescendant'), 'modelInputOption0');
});

test('closing settings or switching to chat rolls back model drafts, saving persists modelId without size or reasoning fields', async () => {
  const harness = await rendererHarness();
  await harness.openSettings();
  await chooseLast(harness, 'modelInput');
  await harness.get('modelInputTrigger').dispatch('click');
  await harness.get('closeSettingsBtn').dispatch('click');
  assert.equal(harness.get('modelInputListbox').hidden, true);
  assert.equal(harness.get('modelInput').value, 'deepseek-flash');
  assert.equal(harness.calls.saveSettings.length, 0);
  await harness.openSettings();
  await chooseLast(harness, 'modelInput');
  await harness.openChat();
  assert.equal(harness.get('modelInputValue').textContent, 'DeepSeek V4.1 Flash');
  await harness.openSettings();
  await chooseLast(harness, 'modelInput');
  await harness.get('settingsForm').dispatch('submit');
  assert.equal(harness.calls.saveSettings.length, 1);
  assert.equal(harness.calls.saveSettings[0].modelId, 'deepseek-v4-pro');
  for (const field of ['model', 'reasoningEffort', 'scale']) assert.equal(field in harness.calls.saveSettings[0], false);
  await harness.openSettings();
  assert.equal(harness.get('modelInputValue').textContent, 'DeepSeek V4 Pro');
});

test('failed saving preserves the model draft for correction', async () => {
  const harness = await rendererHarness({ saveError: '设置尚未保存。' });
  await harness.openSettings();
  await chooseLast(harness, 'modelInput');
  await harness.get('settingsForm').dispatch('submit');
  assert.equal(harness.get('settingsPanel').classList.contains('open'), true);
  assert.equal(harness.get('modelInputValue').textContent, 'DeepSeek V4 Pro');
  assert.equal(harness.saved.modelId, 'deepseek-flash');
  await harness.get('closeSettingsBtn').dispatch('click');
  assert.equal(harness.get('modelInput').value, 'deepseek-flash');
});

test('a list near the footer flips upward and clamps within panel and scrolling viewport boundaries', async () => {
  const harness = await rendererHarness();
  await harness.openSettings();
  const trigger = harness.get('modelInputTrigger');
  trigger.rect = { left: 300, top: 558, width: 160, height: 35 };
  await trigger.dispatch('click');
  const listbox = harness.get('modelInputListbox');
  const panel = harness.get('settingsPanel');
  const panelRect = panel.getBoundingClientRect();
  const top = Number.parseFloat(listbox.style.top) + panelRect.top + panel.clientTop;
  const left = Number.parseFloat(listbox.style.left) + panelRect.left + panel.clientLeft;
  assert.equal(listbox.dataset.placement, 'top');
  assert.ok(top >= harness.get('settingsContent').getBoundingClientRect().top);
  assert.ok(top + Number.parseFloat(listbox.style.maxHeight) <= harness.get('settingsActions').getBoundingClientRect().top - 4);
  assert.ok(left >= panelRect.left + 8);
  assert.ok(left + Number.parseFloat(listbox.style.width) <= panelRect.right - 8);
});

test('opening during the settings scale transition preserves the same local popup geometry', async () => {
  const harness = await rendererHarness();
  await harness.openSettings();
  const trigger = harness.get('modelInputTrigger');
  const listbox = harness.get('modelInputListbox');
  await trigger.dispatch('click');
  const properties = ['left', 'top', 'width', 'maxHeight'];
  const normal = Object.fromEntries(properties.map((name) => [name, Number.parseFloat(listbox.style[name])]));
  await trigger.dispatch('click');
  const panelRect = harness.get('settingsPanel').getBoundingClientRect();
  const scale = 0.96;
  for (const id of ['settingsPanel', 'settingsContent', 'settingsActions', 'modelInputTrigger']) {
    const element = harness.get(id);
    const rect = element.getBoundingClientRect();
    element.rect = {
      left: panelRect.left + (rect.left - panelRect.left) * scale,
      top: panelRect.top + (rect.top - panelRect.top) * scale,
      width: rect.width * scale,
      height: rect.height * scale,
    };
  }
  await trigger.dispatch('click');
  for (const name of properties) assert.ok(Math.abs(Number.parseFloat(listbox.style[name]) - normal[name]) < 1e-6, name);
});
