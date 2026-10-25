const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const rootDirectory = path.resolve(__dirname, '..');
const outputDirectory = path.join(rootDirectory, 'dist', 'ui-check');
const defaults = {
  petName: '鲸鱼娘', city: '上海', modelId: 'deepseek-flash', reasoningEffort: 'max',
  proactiveEnabled: false, voiceEnabled: false, alwaysOnTop: false, launchAtLogin: false,
  scale: 1, apiKeySet: false,
  petOpacity: 100, chatOpacity: 80, messageOpacity: 88,
  inputOpacity: 92, textOpacity: 100, bubbleOpacity: 50,
  conversationDirectory: 'D:\\鲸鱼娘\\对话积累',
};

function installMockBridge() {
  const { contextBridge, ipcRenderer } = require('electron');
  let settings = { ...defaults };
  let pendingAnswer;
  const callbacks = new Map();
  const calls = [];
  const failures = new Map();
  const record = (name, value) => calls.push({ name, value });
  const failIfRequested = name => {
    const message = failures.get(name);
    failures.delete(name);
    if (message) throw new Error(message);
  };
  const subscribe = (name) => (callback) => {
    callbacks.set(name, callback);
    return () => callbacks.delete(name);
  };
  contextBridge.exposeInMainWorld('petAPI', {
    getSettings: async () => ({ ...settings }),
    getDesktopLayout: async () => null,
    saveSettings: async (values) => {
      record('saveSettings', values);
      failIfRequested('saveSettings');
      settings = { ...settings, ...values };
      return { ...settings };
    },
    clearApiKey: async () => { settings.apiKeySet = false; },
    getWeather: async () => ({ city: '上海', condition: '晴', temperature: 24, feelsLike: 24, low: 18, high: 26, rainChance: 0 }),
    sendChat: (message) => {
      record('sendChat', message);
      return new Promise((resolve) => { pendingAnswer = resolve; });
    },
    clearChat: async () => record('clearChat'),
    setIgnoreMouse: (ignore) => record('setIgnoreMouse', ignore),
    moveBy: (x, y) => record('moveBy', { x, y }),
    previewScale: (scale) => record('previewScale', scale),
    openApiKeys: async () => record('openApiKeys'),
    openConversationFolder: async () => { record('openConversationFolder'); failIfRequested('openConversationFolder'); },
    chooseConversationDirectory: async () => { record('chooseConversationDirectory'); failIfRequested('chooseConversationDirectory'); return 'D:\\鲸鱼娘\\选定目录'; },
    hide: () => record('hide'),
    quit: () => record('quit'),
    onOpenChat: subscribe('chat'),
    onOpenSettings: subscribe('settings'),
    onOpenContextPreview: subscribe('context'),
    onRequestWeather: subscribe('weather'),
    onDesktopLayout: subscribe('desktopLayout'),
  });
  contextBridge.exposeInMainWorld('__qa', {
    emit: (event, payload) => callbacks.get(event)?.(payload),
    failNext: (name, message) => failures.set(name, message),
    snapshot: () => ({ settings: { ...settings }, calls: [...calls], answerPending: Boolean(pendingAnswer) }),
    answer: (text) => {
      const resolve = pendingAnswer;
      pendingAnswer = undefined;
      resolve?.({ kind: 'model', text });
    },
  });
  window.addEventListener('error', (event) => ipcRenderer.send('qa:renderer-error', event.message));
  window.addEventListener('unhandledrejection', (event) => ipcRenderer.send('qa:renderer-error', String(event.reason)));
}

async function verifyNeumorphicSettings({ window, evaluate, check, delay, settle, capture, waitFor }) {
  const rgba = (value) => {
    const parts = value.match(/[\d.]+/g)?.map(Number);
    assertColor(parts && parts.length >= 3, value);
    return [...parts.slice(0, 3), parts[3] ?? 1];
  };
  const assertColor = (valid, value) => { if (!valid) throw new Error(`Unsupported computed color: ${value}`); };
  const over = (foreground, background) => foreground.slice(0, 3).map((value, index) => value * foreground[3] + background[index] * (1 - foreground[3])).concat(1);
  const backgroundOf = (layers) => layers.reduce((background, color) => over(rgba(color), background), [255, 255, 255, 1]);
  const luminance = (color) => color.slice(0, 3).map(value => value / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4)
    .reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
  const contrast = (foreground, background) => {
    const values = [luminance(over(foreground, background)), luminance(background)].sort((a, b) => b - a);
    return (values[0] + .05) / (values[1] + .05);
  };
  const shadows = (value) => value === 'none' ? [] : (value.match(/(?:[^,(]|\([^)]*\))+/g) || []).map(entry => {
    const color = entry.match(/rgba?\([^)]*\)/)?.[0];
    const lengths = entry.replace(/rgba?\([^)]*\)/g, '').match(/-?[\d.]+px/g)?.map(Number.parseFloat) || [];
    return { inset: entry.includes('inset'), x: lengths[0] || 0, y: lengths[1] || 0, blur: lengths[2] || 0, color };
  });
  const dual = (value, inset) => {
    const entries = shadows(value);
    const dark = entries.find(item => item.x > 0 && item.y > 0);
    const light = entries.find(item => item.x < 0 && item.y < 0);
    return entries.length === 2 && entries.every(item => item.inset === inset && item.blur > 0) &&
      Boolean(dark?.color && light?.color && luminance(rgba(light.color)) > luminance(rgba(dark.color)));
  };
  const depth = value => shadows(value).reduce((sum, item) => sum + Math.abs(item.x) + Math.abs(item.y) + item.blur, 0);
  const sameRect = (first, second) => ['x', 'y', 'width', 'height'].every(key => Math.abs(first[key] - second[key]) < .1);
  const foregroundContrast = (surface) => {
    const color = rgba(surface.color);
    color[3] *= surface.opacity;
    return contrast(color, backgroundOf(surface.backgroundLayers));
  };
  const focusContrast = surface => contrast(rgba(surface.outlineColor), backgroundOf(surface.surroundingLayers));
  const borderContrast = surface => contrast(rgba(surface.borderColor), backgroundOf(surface.surroundingLayers));
  await evaluate(`window.__qaReadSettingsSurface = (selector, pseudo = null) => {
    const element = document.querySelector(selector);
    const style = getComputedStyle(element, pseudo);
    const rect = element.getBoundingClientRect();
    const ancestors = [];
    for (let current = element; current; current = current.parentElement) ancestors.unshift(current);
    const backgroundLayers = ancestors.map(current => getComputedStyle(current).backgroundColor);
    if (pseudo) backgroundLayers.push(style.backgroundColor);
    return {
      selector, pseudo, color: style.color, backgroundColor: style.backgroundColor, backgroundImage: style.backgroundImage,
      backgroundLayers, surroundingLayers: backgroundLayers.slice(0, pseudo ? -2 : -1),
      opacity: ancestors.reduce((value, current) => value * Number(getComputedStyle(current).opacity), 1) * (pseudo ? Number(style.opacity) : 1),
      boxShadow: style.boxShadow, transform: style.transform, left: style.left, appearance: style.appearance,
      fontSize: style.fontSize, fontWeight: style.fontWeight, borderRadius: style.borderRadius, borderTopLeftRadius: style.borderTopLeftRadius,
      borderColor: style.borderTopColor, borderWidth: parseFloat(style.borderTopWidth), borderStyle: style.borderTopStyle,
      outlineColor: style.outlineColor, outlineWidth: parseFloat(style.outlineWidth), outlineStyle: style.outlineStyle, outlineOffset: parseFloat(style.outlineOffset),
      paintedOutlineWidth: ['none', 'hidden'].includes(style.outlineStyle) ? 0 : parseFloat(style.outlineWidth),
      transitionDuration: style.transitionDuration, transitionTimingFunction: style.transitionTimingFunction,
      focusVisible: element.matches(':focus-visible'), x: rect.x, y: rect.y, width: rect.width, height: rect.height,
    };
  }; void 0;`);
  const read = (selector, pseudo = null) => evaluate(`window.__qaReadSettingsSurface(${JSON.stringify(selector)}, ${JSON.stringify(pseudo)})`);
  const panelMaterial = await Promise.all(['#settingsPanel', '.settings-header', '.settings-content', '.settings-actions', '.opacity-settings'].map(selector => read(selector)));
  check('settings surfaces share the canonical solid neumorphic material', panelMaterial.every(surface =>
    surface.backgroundImage === 'none' && backgroundOf(surface.backgroundLayers).slice(0, 3).every((value, index) => Math.abs(value - [224, 229, 236][index]) < 1)),
  { surfaces: panelMaterial.map(({ selector, backgroundColor, backgroundImage }) => ({ selector, backgroundColor, backgroundImage })) });
  await capture('settings-neumorphism');
  await evaluate('document.body.classList.remove("preview")');
  try {
    await settle();
    const viewport = await evaluate('({ width: innerWidth, height: innerHeight })');
    const png = (await window.webContents.capturePage()).toPNG();
    fs.writeFileSync(path.join(outputDirectory, 'settings-neumorphism-transparent.png'), png);
    const bitmapImage = require('electron').nativeImage.createFromBuffer(png);
    const bitmapSize = bitmapImage.getSize();
    const bitmap = bitmapImage.toBitmap();
    const exteriorPixels = [80, 300, 650].map(y => {
      const bitmapX = Math.floor(2 * bitmapSize.width / viewport.width);
      const bitmapY = Math.floor(y * bitmapSize.height / viewport.height);
      return { x: 2, y, alpha: bitmap[(bitmapY * bitmapSize.width + bitmapX) * 4 + 3] };
    });
    check('settings rendered exterior remains transparent without window shadows',
      (await read('#settingsPanel')).boxShadow === 'none' && bitmap.length === bitmapSize.width * bitmapSize.height * 4 &&
      exteriorPixels.every(pixel => pixel.alpha === 0), { exteriorPixels, bitmapSize, viewport });
  } finally {
    await evaluate('document.body.classList.add("preview")');
  }

  const textSelectors = await evaluate(`Array.from(document.querySelectorAll('#settingsPanel h2, #settingsPanel label, #settingsPanel .opacity-grid label > span, #settingsPanel legend, #settingsPanel output, #settingsPanel button, #settingsPanel input:not([type="range"]):not([type="checkbox"]), #settingsPanel select')).filter(element => element.getClientRects().length > 0).map((element, index) => {
    element.dataset.qaContrast = String(index);
    return '#settingsPanel [data-qa-contrast="' + index + '"]';
  })`);
  const textContrast = [];
  for (const selector of textSelectors) {
    const surface = await read(selector);
    textContrast.push({ selector, ratio: foregroundContrast(surface) });
  }
  for (const selector of ['#apiKeyInput', '#conversationDirectoryInput']) {
    const surface = await read(selector, '::placeholder');
    textContrast.push({ selector: selector + '::placeholder', ratio: foregroundContrast(surface) });
  }
  check('settings text labels placeholders outputs and buttons meet 4.5 contrast', textContrast.every(item => item.ratio >= 4.5),
    { measuredElements: textContrast.length, minimum: Math.min(...textContrast.map(item => item.ratio)), failing: textContrast.filter(item => item.ratio < 4.5) });

  const inputSelectors = ['#petNameInput', '#cityInput', '#apiKeyInput', '#conversationDirectoryInput'];
  const restingInputs = await Promise.all(inputSelectors.map(selector => read(selector)));
  check('settings text fields use inset dual shadows', restingInputs.every(surface => dual(surface.boxShadow, true)),
    { surfaces: restingInputs.map(({ selector, boxShadow }) => ({ selector, boxShadow })) });
  const normalSettingBorders = await Promise.all([...inputSelectors, '#modelInputTrigger', '#closeSettingsBtn', '#apiKeyHelpBtn', '#chooseConversationDirectoryBtn', '#openConversationFolderBtn', '#clearKeyBtn', '#settingsPanel .primary-button'].map(selector => read(selector)));
  check('normal settings borders are thin and lighter than the previous gray-blue outline', normalSettingBorders.every(surface =>
    surface.borderWidth > 0 && surface.borderWidth <= 1 && luminance(rgba(surface.borderColor)) > luminance([166, 173, 186, 1])),
    { borders: normalSettingBorders.map(({ selector, borderColor, borderWidth }) => ({ selector, borderColor, borderWidth })) });

  const readFixedGeometry = () => evaluate(`(() => {
    const rect = selector => { const value = document.querySelector(selector).getBoundingClientRect(); return { x: value.x, y: value.y, width: value.width, height: value.height }; };
    const scroller = document.querySelector('.settings-content');
    return { header: rect('.settings-header'), footer: rect('.settings-actions'), panel: rect('#settingsPanel'),
      scrollWidth: scroller.scrollWidth, clientWidth: scroller.clientWidth, panelScrollWidth: document.querySelector('#settingsPanel').scrollWidth,
      panelClientWidth: document.querySelector('#settingsPanel').clientWidth, scrollTop: scroller.scrollTop,
      maxScroll: scroller.scrollHeight - scroller.clientHeight };
  })()`);
  const fixedTop = await readFixedGeometry();
  const scrollPositions = [];
  for (const portion of [0, .5, 1]) {
    await evaluate(`document.querySelector('.settings-content').scrollTop = (document.querySelector('.settings-content').scrollHeight - document.querySelector('.settings-content').clientHeight) * ${portion}`);
    await settle();
    scrollPositions.push(await readFixedGeometry());
  }
  check('settings header footer and panel remain fixed without horizontal scrolling', scrollPositions.every(position =>
    sameRect(position.header, fixedTop.header) && sameRect(position.footer, fixedTop.footer) && sameRect(position.panel, fixedTop.panel) &&
    position.scrollWidth <= position.clientWidth && position.panelScrollWidth <= position.panelClientWidth), { scrollPositions });
  const settingsTextFit = await evaluate(`(() => {
    const targets = [...document.querySelectorAll('#settingsPanel button, #settingsPanel label > span, #settingsPanel legend, #settingsPanel output')];
    const clipped = targets.filter(element => element.scrollWidth > element.clientWidth + 1 || element.scrollHeight > element.clientHeight + 1)
      .map(element => ({ id: element.id, className: element.className, scrollWidth: element.scrollWidth, clientWidth: element.clientWidth, scrollHeight: element.scrollHeight, clientHeight: element.clientHeight }));
    const labelRows = [...document.querySelectorAll('.opacity-grid label > span')].filter(element => element.getClientRects().length > 0).map(element => {
      const range = document.createRange();
      range.selectNodeContents(element.firstChild);
      return { textRight: range.getBoundingClientRect().right, valueLeft: element.querySelector('output').getBoundingClientRect().left };
    });
    const rect = selector => document.querySelector(selector).getBoundingClientRect();
    return { clipped, labelRows, directoryFits: rect('#conversationDirectoryInput').right <= rect('#chooseConversationDirectoryBtn').left && rect('#chooseConversationDirectoryBtn').right <= rect('#openConversationFolderBtn').left };
  })()`);
  check('settings labels values directory controls and buttons fit the shared larger typography', settingsTextFit.clipped.length === 0 &&
    settingsTextFit.labelRows.every(row => row.textRight < row.valueLeft) && settingsTextFit.directoryFits, settingsTextFit);
  await capture('settings-neumorphism-bottom');

  const debuggerApi = window.webContents.debugger;
  debuggerApi.attach('1.3');
  try {
    await debuggerApi.sendCommand('DOM.enable');
    await debuggerApi.sendCommand('CSS.enable');
    const { root } = await debuggerApi.sendCommand('DOM.getDocument', { depth: -1, pierce: true });
    const nodeId = async selector => (await debuggerApi.sendCommand('DOM.querySelector', { nodeId: root.nodeId, selector })).nodeId;
    const force = async (id, forcedPseudoClasses) => {
      await debuggerApi.sendCommand('CSS.forcePseudoState', { nodeId: id, forcedPseudoClasses });
      await settle();
    };
    const buttons = ['#closeSettingsBtn', '#apiKeyHelpBtn', '#chooseConversationDirectoryBtn', '#openConversationFolderBtn', '#clearKeyBtn', '#settingsPanel .primary-button'];
    await evaluate('document.activeElement?.blur()');
    window.webContents.sendInputEvent({ type: 'mouseMove', x: 770, y: 710 });
    for (const selector of buttons) {
      await evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({ block: 'nearest' })`);
      await settle();
      const id = await nodeId(selector);
      await force(id, []);
      const resting = await read(selector);
      await force(id, ['hover']);
      const hovered = await read(selector);
      await force(id, ['hover', 'active']);
      const pressed = await read(selector);
      await force(id, []);
      check(`settings button has raised hover-shrinking and pressed-inset states: ${selector}`,
        dual(resting.boxShadow, false) && dual(hovered.boxShadow, false) && dual(pressed.boxShadow, true) &&
        depth(hovered.boxShadow) < depth(resting.boxShadow) && sameRect(resting, hovered) && sameRect(resting, pressed) &&
        [resting, hovered, pressed].every(surface => surface.transform === 'none' && foregroundContrast(surface) >= 4.5) &&
        resting.transitionDuration.split(', ').every(value => value === '0.3s') && resting.transitionTimingFunction.split(', ').every(value => value === 'ease-in-out'),
        { method: 'CDP forced pseudo-state computed styles', resting: resting.boxShadow, hovered: hovered.boxShadow, pressed: pressed.boxShadow,
          minimumContrast: Math.min(...[resting, hovered, pressed].map(foregroundContrast)) });
    }

    const rangeIds = await evaluate(`Array.from(document.querySelectorAll('#settingsPanel input[type="range"]')).filter(element => element.getClientRects().length > 0).map(element => '#' + element.id)`);
    const rangeParts = [];
    const descendants = node => [node, ...(node.children || []).flatMap(descendants), ...(node.shadowRoots || []).flatMap(descendants)];
    const attribute = (node, name) => {
      const attributes = node.attributes || [];
      for (let index = 0; index < attributes.length; index += 2) if (attributes[index] === name) return attributes[index + 1];
      return undefined;
    };
    for (const selector of rangeIds) {
      const id = await nodeId(selector);
      const { node } = await debuggerApi.sendCommand('DOM.describeNode', { nodeId: id, depth: -1, pierce: true });
      const parts = descendants(node);
      const track = parts.find(part => attribute(part, 'pseudo') === '-webkit-slider-runnable-track');
      const thumb = parts.find(part => attribute(part, 'pseudo') === '-webkit-slider-thumb' || attribute(part, 'id') === 'thumb');
      const styleOf = async part => part ? Object.fromEntries((await debuggerApi.sendCommand('CSS.getComputedStyleForNode', { nodeId: part.nodeId })).computedStyle.map(item => [item.name, item.value])) : null;
      const trackStyle = await styleOf(track);
      const thumbStyle = await styleOf(thumb);
      const surface = await read(selector);
      rangeParts.push({ selector, appearance: surface.appearance, track: trackStyle && { shadow: trackStyle['box-shadow'], height: trackStyle.height },
        thumb: thumbStyle && { shadow: thumbStyle['box-shadow'], width: thumbStyle.width, height: thumbStyle.height, appearance: thumbStyle.appearance },
        ...(thumb ? {} : { unresolvedNodes: parts.map(part => ({ name: part.nodeName, id: attribute(part, 'id'), pseudo: attribute(part, 'pseudo') })) }) });
    }
    check('all five visible opacity ranges have custom recessed tracks and raised thumbs', rangeParts.length === 5 && rangeParts.every(part => part.appearance === 'none' &&
      part.track && dual(part.track.shadow, true) && parseFloat(part.track.height) > 0 && part.thumb && dual(part.thumb.shadow, false) &&
      parseFloat(part.thumb.width) >= 12 && parseFloat(part.thumb.height) >= 12), { method: 'actual Chromium user-agent shadow DOM computed styles', ranges: rangeParts });
  } finally {
    debuggerApi.detach();
  }

  debuggerApi.attach('1.3');
  await debuggerApi.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: true });
  try {
    const key = async keyCode => {
      window.webContents.sendInputEvent({ type: 'keyDown', keyCode });
      if (keyCode === 'Return') window.webContents.sendInputEvent({ type: 'char', keyCode: '\r' });
      window.webContents.sendInputEvent({ type: 'keyUp', keyCode });
      await delay(55);
    };
    const tabTo = async selector => {
      for (let attempt = 0; attempt < 35; attempt += 1) {
        if (await evaluate(`document.activeElement === document.querySelector(${JSON.stringify(selector)})`)) return;
        await key('Tab');
      }
      throw new Error(`Keyboard focus could not reach ${selector}`);
    };
    window.webContents.focus();
    await evaluate('document.querySelector("#closeSettingsBtn").focus()');
    await key('Tab');
    await settle();
    const focusedInput = await read('#petNameInput');
    check('real Tab navigation focuses the nickname with a shallow inset and visible contrast ring',
      await evaluate('document.activeElement.id === "petNameInput"') && focusedInput.focusVisible && dual(focusedInput.boxShadow, true) &&
      depth(focusedInput.boxShadow) < depth(restingInputs[0].boxShadow) && focusedInput.outlineWidth >= 1 && focusedInput.outlineStyle !== 'none' && focusContrast(focusedInput) >= 3,
      { method: 'Electron keyboard events with emulated document focus for the hidden offscreen window',
        activeElement: await evaluate('document.activeElement.id'), documentFocused: await evaluate('document.hasFocus()'),
        shadow: focusedInput.boxShadow, outline: focusedInput.outlineColor, outlineWidth: focusedInput.outlineWidth,
        focusVisible: focusedInput.focusVisible, ringContrast: focusContrast(focusedInput) });
    await capture('settings-neumorphism-focus');
    await tabTo('#petOpacityInput');
    const beforeOpacity = await evaluate('Number(document.querySelector("#petOpacityInput").value)');
    await key('Left');
    await settle();
    const afterOpacity = await evaluate('({ value: Number(document.querySelector("#petOpacityInput").value), css: Number(getComputedStyle(document.querySelector("#petVisual")).opacity) })');
    const focusedRange = await read('#petOpacityInput');
    check('real keyboard arrow changes character opacity through its retained range input', afterOpacity.value === beforeOpacity - 1 && afterOpacity.css === afterOpacity.value / 100, { beforeOpacity, ...afterOpacity });
    check('range keyboard focus has a visible contrasting ring', focusedRange.focusVisible && focusedRange.outlineWidth >= 1 && focusContrast(focusedRange) >= 3, { ringContrast: focusContrast(focusedRange) });
    await tabTo('#alwaysOnTopInput');
    await settle();
    const toggleOff = await read('#alwaysOnTopInput + span');
    const thumbOff = await read('#alwaysOnTopInput + span', '::after');
    const beforeChecked = await evaluate('document.querySelector("#alwaysOnTopInput").checked');
    await key('Space');
    await waitFor(`document.querySelector('#alwaysOnTopInput').checked !== ${beforeChecked}`);
    await settle();
    const toggleOn = await read('#alwaysOnTopInput + span');
    const thumbOn = await read('#alwaysOnTopInput + span', '::after');
    const translate = value => value === 'none' ? 0 : Number(value.match(/^matrix\(([^)]+)\)$/)?.[1].split(',')[4]);
    const thumbOffset = surface => (parseFloat(surface.left) || 0) + translate(surface.transform);
    check('real Space toggles the switch and moves its thumb without moving the track', !beforeChecked &&
      await evaluate('document.querySelector("#alwaysOnTopInput").checked') && sameRect(toggleOff, toggleOn) &&
      thumbOffset(thumbOn) > thumbOffset(thumbOff) && toggleOff.backgroundColor !== toggleOn.backgroundColor,
      { offOffset: thumbOffset(thumbOff), onOffset: thumbOffset(thumbOn), offColor: toggleOff.backgroundColor, onColor: toggleOn.backgroundColor });
    check('switch keyboard focus is visible with at least 3 contrast', toggleOn.outlineWidth >= 1 && toggleOn.outlineStyle !== 'none' && focusContrast(toggleOn) >= 3,
      { ringContrast: focusContrast(toggleOn), outline: toggleOn.outlineColor });
    await tabTo('#conversationDirectoryInput');
    const keyboardDirectory = await evaluate(`(() => {
      const input = document.querySelector('#conversationDirectoryInput').getBoundingClientRect();
      const scroller = document.querySelector('.settings-content').getBoundingClientRect();
      return { active: document.activeElement.id, inputTop: input.top, inputBottom: input.bottom, scrollTop: scroller.top, scrollBottom: scroller.bottom };
    })()`);
    check('keyboard reaches the directory field and scrolls it fully into view', keyboardDirectory.active === 'conversationDirectoryInput' &&
      keyboardDirectory.inputTop >= keyboardDirectory.scrollTop && keyboardDirectory.inputBottom <= keyboardDirectory.scrollBottom, keyboardDirectory);
    await key('Tab');
    const focusedButton = await read('#chooseConversationDirectoryBtn');
    check('directory action has a visible keyboard focus ring', focusedButton.focusVisible && focusedButton.outlineWidth >= 1 && focusContrast(focusedButton) >= 3,
      { ringContrast: focusContrast(focusedButton) });
    const settingFocusSurfaces = [focusedInput, focusedRange, toggleOn, focusedButton];
    check('settings input range switch and button focus rings are one pixel and lighter without losing contrast', settingFocusSurfaces.every(surface =>
      surface.outlineWidth === 1 && luminance(rgba(surface.outlineColor)) > luminance([85, 82, 136, 1]) && focusContrast(surface) >= 3),
      { rings: settingFocusSurfaces.map(surface => ({ selector: surface.selector, color: surface.outlineColor, width: surface.outlineWidth, contrast: focusContrast(surface) })) });
    await key('Return');
    await waitFor('document.querySelector("#conversationDirectoryInput").value.endsWith("选定目录")');
    check('real Enter activates the directory picker through the mock bridge', await evaluate('window.__qa.snapshot().settings.conversationDirectory !== document.querySelector("#conversationDirectoryInput").value'));
    await evaluate('closePanels(); window.__qa.emit("settings"); document.activeElement?.blur(); document.querySelector(".settings-content").scrollTop = 0');
    await settle();
  } finally {
    await debuggerApi.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: false });
    debuggerApi.detach();
  }
  return { read, rgba, dual, depth, sameRect, foregroundContrast, focusContrast, borderContrast, luminance };
}

async function verifyCustomDropdowns({ window, evaluate, check, delay, settle, capture, waitFor, styles }) {
  const { read, rgba, dual, depth, sameRect, foregroundContrast, focusContrast, borderContrast } = styles;
  const controls = ['modelInput'];
  const key = async keyCode => {
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode });
    if (keyCode === 'Return') window.webContents.sendInputEvent({ type: 'char', keyCode: '\r' });
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode });
    await delay(65);
  };
  const click = async (selector, scroll = false) => {
    if (scroll) await evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({ block: 'nearest' })`);
    await settle();
    const point = await evaluate(`(() => {
      const element = document.querySelector(${JSON.stringify(selector)}), rect = element.getBoundingClientRect();
      return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2),
        receivesPointer: element.contains(document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)) };
    })()`);
    if (!point.receivesPointer) throw new Error(`Dropdown target is clipped or covered: ${selector} ${JSON.stringify(point)}`);
    window.webContents.sendInputEvent({ type: 'mouseMove', x: point.x, y: point.y });
    window.webContents.sendInputEvent({ type: 'mouseDown', x: point.x, y: point.y, button: 'left', clickCount: 1 });
    window.webContents.sendInputEvent({ type: 'mouseUp', x: point.x, y: point.y, button: 'left', clickCount: 1 });
    await delay(65);
  };
  const state = id => evaluate(`(() => {
    const select = document.querySelector('#${id}'), trigger = document.querySelector('#${id}Trigger'), list = document.querySelector('#${id}Listbox');
    const active = document.getElementById(trigger.getAttribute('aria-activedescendant'));
    return { value: select.value, label: trigger.textContent.trim(), role: trigger.getAttribute('role'), expanded: trigger.getAttribute('aria-expanded'),
      controls: trigger.getAttribute('aria-controls'), activeValue: active?.dataset.value, activeId: active?.id,
      focus: document.activeElement.id, hiddenNative: select.hidden || getComputedStyle(select).display === 'none',
      nativeFocusable: select.tabIndex >= 0 && !select.hidden && getComputedStyle(select).display !== 'none',
      listRole: list.getAttribute('role'), listVisible: !list.hidden && getComputedStyle(list).display !== 'none' && list.getBoundingClientRect().height > 0,
      selected: [...list.querySelectorAll('[role="option"][aria-selected="true"]')].map(option => option.dataset.value),
      options: [...list.querySelectorAll('[role="option"]')].map(option => ({ value: option.dataset.value, text: option.textContent.trim(), id: option.id })) };
  })()`);
  const menuGeometry = id => evaluate(`(() => {
    const list = document.querySelector('#${id}Listbox'), trigger = document.querySelector('#${id}Trigger');
    const rect = element => { const value = element.getBoundingClientRect(); return { left: value.left, right: value.right, top: value.top, bottom: value.bottom, width: value.width, height: value.height }; };
    const menu = rect(list), field = rect(trigger), panel = rect(document.querySelector('#settingsPanel'));
    const header = rect(document.querySelector('.settings-header')), footer = rect(document.querySelector('.settings-actions'));
    const active = document.getElementById(trigger.getAttribute('aria-activedescendant'));
    const activeRect = active && rect(active);
    const reachable = [...list.querySelectorAll('[role="option"]')].filter(option => {
      const value = rect(option); return value.top >= menu.top && value.bottom <= menu.bottom;
    }).every(option => { const value = rect(option); return option.contains(document.elementFromPoint((value.left + value.right) / 2, (value.top + value.bottom) / 2)); });
    return { menu, field, panel, header, footer, viewport: { width: innerWidth, height: innerHeight },
      portalOutsideScroller: !document.querySelector('.settings-content').contains(list),
      horizontalOverflow: list.scrollWidth > list.clientWidth + 1, reachable,
      activeVisible: !activeRect || (activeRect.top >= menu.top && activeRect.bottom <= menu.bottom) };
  })()`);
  const fits = geometry => geometry.portalOutsideScroller && geometry.menu.left >= geometry.panel.left && geometry.menu.right <= geometry.panel.right &&
    geometry.menu.top >= Math.max(geometry.header.bottom, 0) && geometry.menu.bottom <= Math.min(geometry.footer.top, geometry.viewport.height) &&
    geometry.menu.left >= 0 && geometry.menu.right <= geometry.viewport.width && geometry.menu.height > 0 && !geometry.horizontalOverflow && geometry.reachable;
  const savedBefore = await evaluate('window.__qa.snapshot()');
  const saveCount = snapshot => snapshot.calls.filter(call => call.name === 'saveSettings').length;
  const debuggerApi = window.webContents.debugger;
  debuggerApi.attach('1.3');
  await debuggerApi.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: true });
  try {
    await evaluate('closePanels(); window.__qa.emit("settings"); document.querySelector(".settings-content").scrollTop = 0');
    await settle();
    const initial = await Promise.all(controls.map(state));
    check('the model uses a DOM combobox with a hidden native value source and saved default', initial.every((item, index) =>
      item.role === 'combobox' && item.listRole === 'listbox' && item.controls === `${controls[index]}Listbox` && item.expanded === 'false' &&
      !item.listVisible && item.hiddenNative && !item.nativeFocusable) && initial[0].value === 'deepseek-flash', { controls: initial });
    const removedControls = await evaluate(`({ obsoleteIds: ['reasoningInput', 'reasoningInputTrigger', 'reasoningInputListbox', 'scaleInput'].filter(id => document.getElementById(id)),
      labelText: document.querySelector('#settingsPanel').textContent, comboCount: document.querySelectorAll('#settingsPanel [role="combobox"]').length,
      scale: settings.scale, effort: settings.reasoningEffort, mockScale: window.__qa.snapshot().settings.scale, mockEffort: window.__qa.snapshot().settings.reasoningEffort })`);
    check('size and effort controls are absent while internal scale is retained and reasoning stays at max',
      removedControls.obsoleteIds.length === 0 && !/人物大小|思考强度/.test(removedControls.labelText) && removedControls.comboCount === 1 &&
      removedControls.scale === defaults.scale && removedControls.mockScale === defaults.scale &&
      removedControls.effort === 'max' && removedControls.mockEffort === 'max',
      { obsoleteIds: removedControls.obsoleteIds, comboCount: removedControls.comboCount, scale: removedControls.scale, effort: removedControls.effort });
    await click('#modelInputTrigger', true);
    await waitFor('document.querySelector("#modelInputTrigger").getAttribute("aria-expanded") === "true"');
    const modelOpen = await state('modelInput');
    const groups = await evaluate(`Array.from(document.querySelectorAll('#modelInputListbox [role="group"]'), group => ({
      name: document.getElementById(group.getAttribute('aria-labelledby'))?.textContent.trim().replace(/\\s/g, ''),
      values: [...group.querySelectorAll('[role="option"]')].map(option => option.dataset.value) }))`);
    check('model menu groups the current Flash and Pro models with readable names', JSON.stringify(groups) === JSON.stringify([
      { name: 'Flash系列', values: ['deepseek-flash'] }, { name: 'Pro系列', values: ['deepseek-v4-pro'] }]) &&
      modelOpen.options[0]?.text.includes('DeepSeek V4.1 Flash') && modelOpen.options[1]?.text.includes('DeepSeek V4 Pro'), { groups, options: modelOpen.options });
    check('real pointer opens model menu with active and selected accessibility state', modelOpen.listVisible && modelOpen.focus === 'modelInputTrigger' &&
      modelOpen.activeValue === 'deepseek-flash' && JSON.stringify(modelOpen.selected) === JSON.stringify(['deepseek-flash']), modelOpen);
    const modelGeometry = await menuGeometry('modelInput');
    check('model list is portalled outside scrolling content and fully hit-testable within settings', fits(modelGeometry), modelGeometry);
    await capture('dropdown-model-expanded');
    await click('#modelInputListbox [data-value="deepseek-v4-pro"]');
    const modelChosen = await state('modelInput');
    const draftSnapshot = await evaluate('window.__qa.snapshot()');
    check('pointer selection updates the draft model without immediately persisting', modelChosen.value === 'deepseek-v4-pro' &&
      modelChosen.label.includes('DeepSeek V4 Pro') && modelChosen.expanded === 'false' && !modelChosen.listVisible &&
      draftSnapshot.settings.modelId === 'deepseek-flash' && saveCount(draftSnapshot) === saveCount(savedBefore), modelChosen);
    await click('#modelInputTrigger');
    const selectedModel = await state('modelInput');
    check('reopened model menu marks only the draft choice selected', selectedModel.activeValue === 'deepseek-v4-pro' &&
      JSON.stringify(selectedModel.selected) === JSON.stringify(['deepseek-v4-pro']), selectedModel);
    await capture('dropdown-model-selected');
    await key('Escape');
    const escapedModel = await state('modelInput');
    check('Escape closes the menu and restores trigger focus without losing its draft', escapedModel.expanded === 'false' &&
      !escapedModel.listVisible && escapedModel.focus === 'modelInputTrigger' && escapedModel.value === 'deepseek-v4-pro', escapedModel);

    await key('Space');
    await key('Home');
    const home = await state('modelInput');
    await key('Down');
    const down = await state('modelInput');
    await key('Up');
    const up = await state('modelInput');
    await key('End');
    const end = await state('modelInput');
    check('Home End and arrow keys move the active model without committing it', home.activeValue === 'deepseek-flash' && down.activeValue === 'deepseek-v4-pro' &&
      up.activeValue === 'deepseek-flash' && end.activeValue === 'deepseek-v4-pro' && [home, down, up, end].every(item => item.value === 'deepseek-v4-pro' &&
        item.focus === 'modelInputTrigger' && JSON.stringify(item.selected) === JSON.stringify(['deepseek-v4-pro'])), { home, down, up, end });
    await key('Home');
    await key('Return');
    const entered = await state('modelInput');
    check('Enter commits the active model only to the settings draft', entered.value === 'deepseek-flash' && entered.expanded === 'false' &&
      saveCount(await evaluate('window.__qa.snapshot()')) === saveCount(savedBefore), entered);
    await key('Space');
    const spaceOpen = await state('modelInput');
    await key('End');
    await key('Space');
    const spaceChosen = await state('modelInput');
    check('Space opens the custom list and confirms its active option', spaceOpen.expanded === 'true' && spaceOpen.activeValue === 'deepseek-flash' &&
      spaceChosen.expanded === 'false' && spaceChosen.value === 'deepseek-v4-pro', { spaceOpen, spaceChosen });
    await key('Down');
    const arrowOpen = await state('modelInput');
    check('arrow key opens a closed combobox with a valid active descendant', arrowOpen.expanded === 'true' &&
      arrowOpen.options.some(option => option.id === arrowOpen.activeId) && arrowOpen.value === 'deepseek-v4-pro', arrowOpen);
    await key('Tab');
    const tabClosed = await state('modelInput');
    check('Tab closes the list and follows normal keyboard traversal without saving', tabClosed.expanded === 'false' &&
      tabClosed.focus !== 'modelInputTrigger' && saveCount(await evaluate('window.__qa.snapshot()')) === saveCount(savedBefore), tabClosed);

    await click('#modelInputTrigger', true);
    await click('#petNameInput', true);
    const outsideClosed = await state('modelInput');
    check('a real outside click dismisses the custom menu', outsideClosed.expanded === 'false' && !outsideClosed.listVisible, outsideClosed);
    await click('#modelInputTrigger', true);
    await evaluate('document.querySelector(".settings-content").scrollTop += 45');
    await settle();
    check('scrolling settings dismisses the menu so it cannot detach from its field', (await state('modelInput')).expanded === 'false');
    await click('#modelInputTrigger', true);
    await evaluate('window.__qa.emit("chat")');
    check('switching panels dismisses all custom menus', (await Promise.all(controls.map(state))).every(item => item.expanded === 'false' && !item.listVisible));
    await evaluate('window.__qa.emit("settings")');
    const cancelled = await Promise.all(controls.map(state));
    check('closing unsaved settings restores the saved model while reasoning remains fixed at max', cancelled[0].value === 'deepseek-flash' &&
      cancelled[0].label.includes('DeepSeek V4.1 Flash') && await evaluate('settings.reasoningEffort === "max"') &&
      saveCount(await evaluate('window.__qa.snapshot()')) === saveCount(savedBefore), { controls: cancelled });

    await click('#modelInputTrigger', true);
    await click('#modelInputListbox [data-value="deepseek-v4-pro"]');
    await click('#settingsPanel .primary-button');
    await waitFor('!document.querySelector("#settingsPanel").classList.contains("open")');
    const persisted = await evaluate('window.__qa.snapshot()');
    await evaluate('window.__qa.emit("settings")');
    const restored = await Promise.all(controls.map(state));
    const savedPayload = persisted.calls.filter(call => call.name === 'saveSettings').at(-1).value;
    check('explicit Save persists the model once without resubmitting removed preferences',
      persisted.settings.modelId === 'deepseek-v4-pro' && persisted.settings.reasoningEffort === 'max' &&
      persisted.settings.scale === savedBefore.settings.scale && !Object.hasOwn(savedPayload, 'reasoningEffort') && !Object.hasOwn(savedPayload, 'scale') &&
      saveCount(persisted) === saveCount(savedBefore) + 1 && restored[0].value === 'deepseek-v4-pro', { controls: restored, payloadKeys: Object.keys(savedPayload) });

    await evaluate('document.querySelector(".settings-content").scrollTop = 0');
    await settle();
    const directoryTypography = await Promise.all(['#conversationDirectoryInput', '#chooseConversationDirectoryBtn', '#openConversationFolderBtn', '#modelInputTrigger'].map(selector => read(selector)));
    await click('#modelInputTrigger', true);
    const menuTypographySelectors = await evaluate(`Array.from(document.querySelectorAll('[role="listbox"] [role="option"], [role="listbox"] [role="group"] > :first-child'), (element, index) => {
      element.dataset.qaDropdown = String(index); return '[data-qa-dropdown="' + index + '"]'; })`);
    const menuTypography = await Promise.all(menuTypographySelectors.map(selector => read(selector)));
    check('directory controls and custom dropdown triggers options and group headings use 12 pixel support text',
      [...directoryTypography, ...menuTypography].every(item => item.fontSize === '12px'),
      { elements: [...directoryTypography, ...menuTypography].map(({ selector, fontSize }) => ({ selector, fontSize })) });
    check('custom dropdown text keeps readable contrast on the shared material', menuTypography.every(item => foregroundContrast(item) >= 4.5),
      { minimumContrast: Math.min(...menuTypography.map(foregroundContrast)) });
    await key('Escape');

    await debuggerApi.sendCommand('DOM.enable');
    await debuggerApi.sendCommand('CSS.enable');
    const { root } = await debuggerApi.sendCommand('DOM.getDocument', { depth: -1, pierce: true });
    const pseudo = async (selector, forcedPseudoClasses) => {
      const { nodeId } = await debuggerApi.sendCommand('DOM.querySelector', { nodeId: root.nodeId, selector });
      await debuggerApi.sendCommand('CSS.forcePseudoState', { nodeId, forcedPseudoClasses });
      await settle();
      return read(selector);
    };
    for (const id of controls) {
      const selector = '#' + id + 'Trigger';
      await evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({ block: 'nearest' }); document.activeElement?.blur()`);
      window.webContents.sendInputEvent({ type: 'mouseMove', x: 770, y: 710 });
      await settle();
      const normal = await pseudo(selector, []), hover = await pseudo(selector, ['hover']), pressed = await pseudo(selector, ['hover', 'active']);
      await pseudo(selector, []);
      check(`custom trigger keeps raised hover and pressed-inset styling with fixed geometry: ${id}`,
        dual(normal.boxShadow, false) && dual(hover.boxShadow, false) && dual(pressed.boxShadow, true) && depth(hover.boxShadow) < depth(normal.boxShadow) &&
        [normal, hover, pressed].every(item => item.transform === 'none' && foregroundContrast(item) >= 4.5 &&
          rgba(item.backgroundColor).slice(0, 3).every(channel => channel >= 200)) && sameRect(normal, hover) && sameRect(normal, pressed),
        { method: 'CDP forced pseudo-state computed styles', normal: normal.boxShadow, hover: hover.boxShadow, pressed: pressed.boxShadow });
      await evaluate(`document.querySelector(${JSON.stringify(selector)}).focus()`);
      await key('Space');
      await settle();
      const focused = await read(selector);
      check(`custom trigger keyboard focus retains a thin visible contrast ring: ${id}`, focused.focusVisible && focused.outlineWidth === 1 &&
        focused.outlineStyle !== 'none' && focusContrast(focused) >= 3, { contrast: focusContrast(focused), width: focused.outlineWidth });
      const optionSelector = '#' + id + 'Listbox [role="option"]';
      const normalOption = await pseudo(optionSelector, []), hoverOption = await pseudo(optionSelector, ['hover']), pressedOption = await pseudo(optionSelector, ['hover', 'active']);
      await pseudo(optionSelector, []);
      check(`custom menu options use themed DOM states without native system styling: ${id}`,
        normalOption.fontSize === '12px' && [hoverOption, pressedOption].every(item => item.transform === 'none' && sameRect(normalOption, item)) &&
        [normalOption, hoverOption, pressedOption].every(item => foregroundContrast(item) >= 4.5 && item.backgroundImage === 'none') &&
        dual(pressedOption.boxShadow, true) && (normalOption.backgroundColor !== hoverOption.backgroundColor || normalOption.boxShadow !== hoverOption.boxShadow),
        { method: 'DOM listbox and CDP forced option hover/active', normal: normalOption.backgroundColor, hover: hoverOption.backgroundColor,
          normalShadow: normalOption.boxShadow, hoverShadow: hoverOption.boxShadow, pressedShadow: pressedOption.boxShadow });
      const selectedOption = await read('#' + id + 'Listbox [aria-selected="true"]');
      const selectedIndicator = await evaluate(`getComputedStyle(document.querySelector('#${id}Listbox [aria-selected="true"]'), '::after').content`);
      const activeOption = await read('#' + (await state(id)).activeId);
      check(`selected and keyboard-active options are distinguishable and retain readable contrast: ${id}`,
        selectedIndicator.includes('✓') && Number(selectedOption.fontWeight) >= 600 && foregroundContrast(selectedOption) >= 4.5 &&
        activeOption.backgroundColor !== normalOption.backgroundColor && activeOption.borderWidth === 1 && borderContrast(activeOption) >= 3 &&
        foregroundContrast(activeOption) >= 4.5, { indicator: selectedIndicator, selectedContrast: foregroundContrast(selectedOption),
          activeBorderContrast: borderContrast(activeOption), activeBackground: activeOption.backgroundColor });
      await key('Escape');
    }

    await evaluate(`window.__qaOriginalSettingsStyle = document.querySelector('#settingsPanel').getAttribute('style');
      document.querySelector('#settingsPanel').style.height = '340px';
      document.querySelector('#settingsPanel').style.maxHeight = '340px';`);
    try {
      await click('#modelInputTrigger', true);
      await key('End');
      await settle();
      const constrained = await menuGeometry('modelInput');
      check('a menu near the bottom opens upward and keeps its active option reachable in limited space',
        fits(constrained) && constrained.menu.bottom <= constrained.field.top + 1 && constrained.activeVisible, constrained);
      await capture('dropdown-model-limited-space');
      await key('Home');
      const first = await menuGeometry('modelInput');
      check('Home scrolls the first custom option into view in a constrained menu', fits(first) && first.activeVisible, first);
      await key('Escape');
    } finally {
      await evaluate(`const panel = document.querySelector('#settingsPanel');
        if (window.__qaOriginalSettingsStyle === null) panel.removeAttribute('style'); else panel.setAttribute('style', window.__qaOriginalSettingsStyle);
        delete window.__qaOriginalSettingsStyle;`);
      await settle();
    }
    await evaluate('document.querySelector(".settings-content").scrollTop = document.querySelector(".settings-content").scrollHeight');
    await capture('dropdown-directory-12px');
    const directoryActionsBefore = await evaluate('window.__qa.snapshot().calls.filter(call => call.name === "openConversationFolder").length');
    await click('#openConversationFolderBtn');
    check('the compact directory Open control still activates through the mock bridge',
      await evaluate('window.__qa.snapshot().calls.filter(call => call.name === "openConversationFolder").length') === directoryActionsBefore + 1);
  } finally {
    await debuggerApi.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: false });
    debuggerApi.detach();
    await evaluate(`closePanels(); window.__qa.emit('settings');
      for (const [id, value] of [['modelInput', 'deepseek-flash']]) {
        const input = document.querySelector('#' + id); input.value = value; input.dispatchEvent(new Event('change', { bubbles: true }));
      }
      document.querySelector('#settingsForm').requestSubmit();`);
    await waitFor('!document.querySelector("#settingsPanel").classList.contains("open")');
    await evaluate('window.__qa.emit("settings"); document.activeElement?.blur(); document.querySelector(".settings-content").scrollTop = 0');
    await settle();
  }
}

async function verifyNeumorphicApplication({ window, evaluate, check, settle, delay, capture, waitFor, styles }) {
  const { read, rgba, dual, depth, sameRect, focusContrast, borderContrast, luminance } = styles;
  const material = surface => {
    const visibleMaterial = [...surface.backgroundLayers].reverse().map(rgba).find(color => color[3] > 0);
    return surface.backgroundImage === 'none' && visibleMaterial?.slice(0, 3).every(value => value >= 200 && value <= 245);
  };
  const soft = surface => dual(surface.boxShadow, false) || dual(surface.boxShadow, true);
  const key = async keyCode => {
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode });
    if (keyCode === 'Return') window.webContents.sendInputEvent({ type: 'char', keyCode: '\r' });
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode });
    await delay(55);
  };
  await evaluate(`window.__qaOriginalMessages = [...document.querySelector('#messages').children];
    window.__qa.emit('chat');
    addMessage('user', '今天也想和你一起慢慢完成计划。', 'qa-style-user');
    addMessage('system', '暂时无法连接，请稍后重试。', 'qa-style-system');
    addTyping();
    showBubble('今天也一起慢慢来吧。', { duration: 120000 });`);
  await settle();
  try {
    const surfaces = await Promise.all(['#chatPanel', '.panel-header', '.composer', '#chatInput',
      '.message.assistant .bubble', '#qa-style-user .bubble', '#qa-style-system .bubble', '#typingMessage .bubble'].map(selector => read(selector)));
    check('chat header composer and messages share the soft monochrome material',
      surfaces.every(material), { surfaces: surfaces.map(({ selector, backgroundColor, backgroundImage }) => ({ selector, backgroundColor, backgroundImage })) });
    const dimensionalSurfaces = surfaces.filter(surface => surface.selector.includes('.bubble') || surface.selector === '.composer');
    check('assistant user system loading and text input use soft dual shadows', dimensionalSurfaces.every(soft),
      { surfaces: dimensionalSurfaces.map(({ selector, boxShadow }) => ({ selector, boxShadow })) });
    check('explicit greeting calls cannot make the disabled floating bubble visible', await evaluate('window.__qaFloatingBubbleHidden()'));
    await capture('chat-neumorphism-states');

    const typography = await evaluate(`(() => {
      const elements = [document.documentElement, document.body, ...document.querySelectorAll('#app, #app *')];
      const samples = elements.map(element => ({ target: element.id ? '#' + element.id : element.tagName.toLowerCase() + (typeof element.className === 'string' && element.className ? '.' + element.className.trim().split(/\\s+/).join('.') : ''), size: getComputedStyle(element).fontSize }));
      for (const element of document.querySelectorAll('input[placeholder], textarea[placeholder]')) samples.push({ target: '#' + element.id + '::placeholder', size: getComputedStyle(element, '::placeholder').fontSize });
      const root = getComputedStyle(document.documentElement);
      return { tokens: ['support', 'body', 'title'].map(name => root.getPropertyValue('--font-size-' + name).trim()),
        sizes: [...new Set(samples.map(sample => sample.size))].sort((a, b) => parseFloat(a) - parseFloat(b)),
        count: samples.length, unexpected: samples.filter(sample => !['12px', '14px', '18px'].includes(sample.size)) };
    })()`);
    check('all application elements including icons placeholders and dynamic states use exactly three font sizes',
      JSON.stringify(typography.tokens) === JSON.stringify(['12px', '14px', '18px']) &&
      JSON.stringify(typography.sizes) === JSON.stringify(['12px', '14px', '18px']) && typography.unexpected.length === 0, typography);
    const hierarchy = await Promise.all(['#chatTitle', '#chatTitle b', '#settingsPanel h2', '#chatInput', '#qa-style-user .bubble', '.message.assistant .bubble'].map(selector => read(selector)));
    check('titles and primary reading text follow the shared 18 and 14 pixel hierarchy', hierarchy.every((surface, index) => surface.fontSize === (index < 3 ? '18px' : '14px')),
      { elements: hierarchy.map(({ selector, fontSize }) => ({ selector, fontSize })) });
    await evaluate(`syncPetName('W'.repeat(16)); showBubble('今天也一起慢慢来吧。', { duration: 120000 })`);
    await settle();
    const longNameGeometry = await evaluate(`(() => {
      const header = document.querySelector('.panel-header').getBoundingClientRect();
      const title = document.querySelector('.panel-title');
      const titleRect = title.getBoundingClientRect();
      const close = document.querySelector('#closeChatBtn').getBoundingClientRect();
      return { titleFits: title.scrollWidth <= title.clientWidth + 1 && titleRect.left >= header.left && titleRect.right <= close.left,
        closeInside: close.right <= header.right && close.top >= header.top && close.bottom <= header.bottom,
        headerHeight: header.height, titleWidth: titleRect.width };
    })()`);
    check('maximum-length nickname wraps without covering chat actions', longNameGeometry.titleFits && longNameGeometry.closeInside, longNameGeometry);
    check('chat input placeholder follows the current nickname with the requested wording',
      await evaluate(`document.querySelector('#chatInput').placeholder === '想问' + 'W'.repeat(16) + '点什么...'`));
    const hiddenGreetingScales = [];
    for (const scale of [.78, 1, 1.18]) {
      await evaluate(`applyVisualSettings({ ...settings, scale: ${scale} })`);
      await settle();
      hiddenGreetingScales.push({ scale, hidden: await evaluate('window.__qaFloatingBubbleHidden()') });
    }
    check('the floating bubble stays hidden at every stored character size', hiddenGreetingScales.every(result => result.hidden), { hiddenGreetingScales });
    await evaluate(`applyVisualSettings(settings); syncPetName(settings.petName); showBubble('今天也一起慢慢来吧。', { duration: 120000 })`);
    await settle();

    const opacitySnapshot = () => evaluate(`(() => {
      const color = (selector, property, pseudo = null) => getComputedStyle(document.querySelector(selector), pseudo)[property];
      return { petOpacity: [color('#petVisual', 'opacity')], chatOpacity: [color('#chatPanel', 'backgroundColor')],
        messageOpacity: ['.message.assistant .bubble', '#qa-style-user .bubble', '#qa-style-system .bubble'].map(selector => color(selector, 'backgroundColor')),
        inputOpacity: [color('.composer', 'backgroundColor')],
        textOpacity: ['.message.assistant .bubble', '#qa-style-user .bubble', '#qa-style-system .bubble', '#chatInput', '#bubbleText'].map(selector => color(selector, 'color')),
        bubbleOpacity: [color('#speechBubble', 'backgroundColor'), color('#speechBubble', 'borderTopColor', '::before'), color('#speechBubble', 'borderTopColor', '::after')] };
    })()`);
    const baselineOpacity = await opacitySnapshot();
    const opacityCases = { petOpacity: 65, chatOpacity: 35, messageOpacity: 55, inputOpacity: 60, textOpacity: 45, bubbleOpacity: 40 };
    const opacityResults = [];
    for (const [name, value] of Object.entries(opacityCases)) {
      await evaluate(`applyVisualSettings({ ...settings, ${name}: ${value} })`);
      await settle();
      const actual = await opacitySnapshot();
      const targetAlphas = actual[name].map(color => name === 'petOpacity' ? Number(color) : rgba(color)[3]);
      opacityResults.push({ name, expected: value / 100, targetAlphas,
        independent: Object.keys(actual).filter(key => key !== name).every(key => JSON.stringify(actual[key]) === JSON.stringify(baselineOpacity[key])) });
      await evaluate('applyVisualSettings(settings)');
      await settle();
    }
    check('active opacity settings and the retained hidden bubble appearance stay independent',
      opacityResults.every(result => result.independent && result.targetAlphas.every(alpha => Math.abs(alpha - result.expected) < .005)), { opacityResults });

    await evaluate(`document.querySelector('#typingMessage').remove(); closePanels();
      showBubble('今天也一起慢慢来吧。', { duration: 120000 });`);
    await capture('floating-bubble-hidden');
    await evaluate('showContextToolbar({ clientX: 520, clientY: 370 })');
    await capture('toolbar-neumorphism');
    const toolbar = await read('#contextToolbar');
    check('right-click toolbar shares the material with inset-only outer shading', material(toolbar) && dual(toolbar.boxShadow, true),
      { background: toolbar.backgroundColor, shadow: toolbar.boxShadow });
    const compactToolbar = await evaluate(`(() => {
      const menu = document.querySelector('#contextToolbar'), bounds = menu.getBoundingClientRect();
      return { width: bounds.width, height: bounds.height, rows: [...menu.querySelectorAll('button')].map(button => ({
        height: button.getBoundingClientRect().height, fontSize: getComputedStyle(button.querySelector('span')).fontSize,
        label: button.textContent.trim(), fits: button.scrollWidth <= button.clientWidth && button.scrollHeight <= button.clientHeight })) };
    })()`);
    check('the compact toolbar uses three readable 32 pixel rows and 12 pixel text within 112 pixels', compactToolbar.width === 112 &&
      compactToolbar.rows.length === 3 && compactToolbar.rows.every(row => row.height === 32 && row.fontSize === '12px' && row.fits), compactToolbar);

    const debuggerApi = window.webContents.debugger;
    debuggerApi.attach('1.3');
    try {
      await debuggerApi.sendCommand('DOM.enable');
      await debuggerApi.sendCommand('CSS.enable');
      await debuggerApi.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: true });
      const { root } = await debuggerApi.sendCommand('DOM.getDocument', { depth: -1, pierce: true });
      const selectors = ['#contextSettingsBtn', '#contextHideBtn', '#contextQuitBtn'];
      window.webContents.sendInputEvent({ type: 'mouseMove', x: 770, y: 710 });
      await evaluate('document.activeElement?.blur()');
      for (const selector of selectors) {
        const { nodeId } = await debuggerApi.sendCommand('DOM.querySelector', { nodeId: root.nodeId, selector });
        const state = async forcedPseudoClasses => {
          await debuggerApi.sendCommand('CSS.forcePseudoState', { nodeId, forcedPseudoClasses });
          await settle();
          return read(selector);
        };
        const resting = await state([]);
        const hovered = await state(['hover']);
        const pressed = await state(['hover', 'active']);
        await state([]);
        check(`toolbar button keeps geometry while changing raised hover and pressed shadows: ${selector}`,
          dual(resting.boxShadow, false) && dual(hovered.boxShadow, false) && dual(pressed.boxShadow, true) && depth(hovered.boxShadow) < depth(resting.boxShadow) &&
          sameRect(resting, hovered) && sameRect(resting, pressed) && [resting, hovered, pressed].every(surface => surface.transform === 'none'),
          { method: 'CDP forced pseudo-state computed styles', resting: resting.boxShadow, hovered: hovered.boxShadow, pressed: pressed.boxShadow });
      }
      await evaluate('document.querySelector("#contextSettingsBtn").focus()');
      await key('Tab');
      await settle();
      const toolbarFocus = await read('#contextHideBtn');
      check('toolbar supports real Tab navigation with a clear keyboard focus ring',
        await evaluate('document.activeElement.id === "contextHideBtn"') && toolbarFocus.focusVisible && toolbarFocus.outlineWidth >= 1 && focusContrast(toolbarFocus) >= 3,
        { method: 'Electron keyboard event with emulated offscreen document focus', ringContrast: focusContrast(toolbarFocus) });
      await capture('toolbar-neumorphism-focus');

      await evaluate('hideContextToolbar(); window.__qa.emit("chat")');
      await settle();
      await evaluate('document.activeElement?.blur()');
      await settle();
      const restingInput = await read('.composer');
      const normalAppBorders = await Promise.all(['#chatPanel', '.composer', '#clearChatBtn', '#closeChatBtn', '#sendBtn', '.message.assistant .bubble', '#contextToolbar'].map(selector => read(selector)));
      check('chat message and toolbar outlines stay thin and soft in their normal state', normalAppBorders.every(surface =>
        surface.borderWidth > 0 && surface.borderWidth <= 1 && luminance(rgba(surface.borderColor)) > luminance([166, 173, 186, 1])),
        { borders: normalAppBorders.map(({ selector, borderColor, borderWidth }) => ({ selector, borderColor, borderWidth })) });
      await evaluate('document.querySelector("#closeChatBtn").focus()');
      await key('Tab');
      await settle();
      const focusedInput = await read('#chatInput');
      const focusedComposer = await read('.composer');
      check('chat textarea receives real keyboard focus with shallower inset shading and a visible ring',
        await evaluate('document.activeElement.id === "chatInput"') && focusedInput.focusVisible && dual(restingInput.boxShadow, true) && dual(focusedComposer.boxShadow, true) &&
        depth(focusedComposer.boxShadow) < depth(restingInput.boxShadow) && focusedComposer.borderWidth >= 1 && focusedComposer.borderStyle === 'solid' &&
        focusedComposer.borderColor !== restingInput.borderColor && borderContrast(focusedComposer) >= 3,
        { shadowHost: '.composer', focusRingHost: '.composer border', resting: restingInput.boxShadow, focused: focusedComposer.boxShadow, ringContrast: borderContrast(focusedComposer) });
      check('chat focus uses one thin light-purple composer ring without an inner textarea ring',
        focusedInput.outlineStyle === 'none' && focusedInput.paintedOutlineWidth === 0 && focusedInput.borderWidth === 0 &&
        focusedComposer.outlineStyle === 'none' && focusedComposer.paintedOutlineWidth === 0 && focusedComposer.borderWidth === 1 &&
        luminance(rgba(focusedComposer.borderColor)) > luminance([85, 82, 136, 1]) && borderContrast(focusedComposer) >= 3,
        { textareaOutline: focusedInput.outlineStyle, textareaPaintedOutlineWidth: focusedInput.paintedOutlineWidth,
          composerOutline: focusedComposer.outlineStyle, composerPaintedOutlineWidth: focusedComposer.paintedOutlineWidth, composerBorder: focusedComposer.borderColor,
          composerBorderWidth: focusedComposer.borderWidth, ringContrast: borderContrast(focusedComposer) });
      const keyboardMessage = 'Hello whale';
      for (const character of keyboardMessage) window.webContents.sendInputEvent({ type: 'char', keyCode: character });
      await waitFor(`document.querySelector('#chatInput').value === ${JSON.stringify(keyboardMessage)}`);
      await capture('chat-neumorphism-focus');
      await key('Return');
      await waitFor('window.__qa.snapshot().answerPending');
      const loadingStyle = await read('#typingMessage .bubble');
      check('real keyboard text and Enter send exactly one message and preserve the themed loading state',
        await evaluate(`window.__qa.snapshot().calls.filter(call => call.name === 'sendChat' && call.value === ${JSON.stringify(keyboardMessage)}).length === 1 && document.querySelector('#sendBtn').disabled && document.querySelector('#chatInput').value === ''`) &&
        material(loadingStyle) && soft(loadingStyle) && loadingStyle.fontSize === '14px' && await evaluate('window.__qaFloatingBubbleHidden()'));
      await evaluate('window.__qa.answer("我在这里，慢慢来就好。")');
      await waitFor('!document.querySelector("#sendBtn").disabled');
      await settle();
      const answer = await read('.message.answer .bubble');
      check('model answer remains visible with its themed typography while the floating bubble stays hidden',
        material(answer) && soft(answer) && answer.fontSize === '14px' && answer.width > 0 && answer.height > 0 && await evaluate('window.__qaFloatingBubbleHidden()'));
    } finally {
      await debuggerApi.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: false });
      debuggerApi.detach();
    }
  } finally {
    await evaluate(`document.querySelector('#messages').replaceChildren(...window.__qaOriginalMessages);
      delete window.__qaOriginalMessages; applyVisualSettings(settings); syncPetName(settings.petName); hideContextToolbar(); closePanels();
      window.__qa.emit('settings'); document.activeElement?.blur(); document.querySelector('.settings-content').scrollTop = 0;`);
    await settle();
  }
}

async function verifyHiddenFloatingBubble({ window, evaluate, check, delay, settle, capture, waitFor, styles }) {
  const click = async selector => {
    await evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({ block: 'nearest' })`);
    await settle();
    const point = await evaluate(`(() => { const element = document.querySelector(${JSON.stringify(selector)}), rect = element.getBoundingClientRect();
      return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2),
        hit: element.contains(document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)) }; })()`);
    if (!point.hit) throw new Error(`Settings feedback target is clipped: ${selector}`);
    window.webContents.sendInputEvent({ type: 'mouseDown', x: point.x, y: point.y, button: 'left', clickCount: 1 });
    window.webContents.sendInputEvent({ type: 'mouseUp', x: point.x, y: point.y, button: 'left', clickCount: 1 });
    await delay(65);
  };
  const readFeedback = () => evaluate(`(() => {
    const element = document.querySelector('#settingsFeedback'), rect = element.getBoundingClientRect();
    const save = document.querySelector('#settingsPanel .primary-button').getBoundingClientRect();
    const panel = document.querySelector('#settingsPanel').getBoundingClientRect();
    return { text: element.textContent, hidden: element.hidden, rendered: element.getClientRects().length > 0,
      role: element.getAttribute('role'), live: element.getAttribute('aria-live'), height: rect.height,
      scrollHeight: element.scrollHeight, clientHeight: element.clientHeight,
      inPanel: rect.left >= panel.left && rect.right <= panel.right && rect.top >= panel.top && rect.bottom <= save.top,
      saveVisible: save.top >= panel.top && save.bottom <= Math.min(panel.bottom, innerHeight),
      fitsWidth: element.scrollWidth <= element.clientWidth, floatingHidden: window.__qaFloatingBubbleHidden() };
  })()`);
  await evaluate('closePanels(); window.__qa.emit("settings"); document.querySelector(".settings-content").scrollTop = 0');
  await settle();
  const dormant = await evaluate(`({ settings: window.__qa.snapshot().settings,
    hiddenControls: [...document.querySelectorAll('[data-floating-bubble-setting]')].map(element => ({ hidden: element.hidden,
      rendered: element.getClientRects().length > 0, ids: [...element.querySelectorAll('input')].map(input => input.id) })),
    feedbackHidden: document.querySelector('#settingsFeedback').hidden && !document.querySelector('#settingsFeedback').textContent,
    floatingHidden: window.__qaFloatingBubbleHidden() })`);
  check('disabled floating-bubble settings are absent from the visible form without deleting their preferences', dormant.hiddenControls.length === 3 &&
    dormant.hiddenControls.every(item => item.hidden && !item.rendered) && dormant.feedbackHidden && dormant.floatingHidden &&
    ['proactiveEnabled', 'voiceEnabled', 'bubbleOpacity'].every(name => Object.hasOwn(dormant.settings, name)), dormant);
  await capture('settings-hidden-floating');
  await evaluate(`document.querySelector('#proactiveInput').checked = !settings.proactiveEnabled;
    document.querySelector('#voiceInput').checked = !settings.voiceEnabled;
    document.querySelector('#bubbleOpacityInput').value = '7';`);
  await click('#settingsPanel .primary-button');
  await waitFor('!document.querySelector("#settingsPanel").classList.contains("open")');
  const saved = await evaluate('window.__qa.snapshot()');
  const payload = saved.calls.filter(call => call.name === 'saveSettings').at(-1).value;
  check('saving visible settings omits and preserves all three hidden floating-bubble preferences',
    ['proactiveEnabled', 'voiceEnabled', 'bubbleOpacity'].every(name => !Object.hasOwn(payload, name) && saved.settings[name] === dormant.settings[name]),
    { payloadKeys: Object.keys(payload), preserved: Object.fromEntries(['proactiveEnabled', 'voiceEnabled', 'bubbleOpacity'].map(name => [name, saved.settings[name]])) });
  await evaluate('window.__qa.emit("settings")');
  const draftName = '未保存的昵称';
  const saveError = '暂时无法保存，请检查目录权限后重试。';
  await evaluate(`document.querySelector('#petNameInput').value = ${JSON.stringify(draftName)};
    window.__qa.failNext('saveSettings', ${JSON.stringify(saveError)});`);
  await click('#settingsPanel .primary-button');
  await waitFor(`document.querySelector('#settingsFeedback').textContent === ${JSON.stringify(saveError)}`);
  const saveFeedback = await readFeedback();
  check('failed settings save keeps the draft and shows a visible alert beside accessible actions', saveFeedback.rendered && !saveFeedback.hidden &&
    saveFeedback.role === 'alert' && saveFeedback.live === 'assertive' && saveFeedback.inPanel && saveFeedback.saveVisible && saveFeedback.fitsWidth && saveFeedback.floatingHidden &&
    await evaluate(`document.querySelector('#settingsPanel').classList.contains('open') && document.querySelector('#petNameInput').value === ${JSON.stringify(draftName)} && window.__qa.snapshot().settings.petName !== ${JSON.stringify(draftName)}`), saveFeedback);
  check('inline settings error text remains readable', styles.foregroundContrast(await styles.read('#settingsFeedback')) >= 4.5,
    { contrast: styles.foregroundContrast(await styles.read('#settingsFeedback')) });
  await capture('settings-save-error');
  await evaluate('closePanels(); window.__qa.emit("settings")');
  check('reopening settings clears the previous feedback without adding permanent helper text', (await readFeedback()).hidden && (await readFeedback()).text === '');
  const chooseError = '暂时无法选择文件夹，请稍后重试。';
  await evaluate(`window.__qa.failNext('chooseConversationDirectory', ${JSON.stringify(chooseError)})`);
  await click('#chooseConversationDirectoryBtn');
  await waitFor(`document.querySelector('#settingsFeedback').textContent === ${JSON.stringify(chooseError)}`);
  const chooseFeedback = await readFeedback();
  check('directory-picker failure appears in a visible settings alert while the floating bubble stays hidden', chooseFeedback.rendered &&
    chooseFeedback.role === 'alert' && chooseFeedback.inPanel && chooseFeedback.saveVisible && chooseFeedback.floatingHidden, chooseFeedback);
  await capture('settings-directory-error');
  const openError = '无法打开指定目录，请检查文件夹地址。'.repeat(16);
  await evaluate(`window.__qa.failNext('openConversationFolder', ${JSON.stringify(openError)})`);
  await click('#openConversationFolderBtn');
  await waitFor(`document.querySelector('#settingsFeedback').textContent === ${JSON.stringify(openError)}`);
  const openFeedback = await readFeedback();
  check('long directory errors scroll within a bounded alert without hiding Save or overflowing horizontally', openFeedback.rendered &&
    openFeedback.role === 'alert' && openFeedback.height <= 88 && openFeedback.scrollHeight > openFeedback.clientHeight &&
    openFeedback.inPanel && openFeedback.saveVisible && openFeedback.fitsWidth && openFeedback.floatingHidden, openFeedback);
  await capture('settings-directory-error-long');
  await click('#openConversationFolderBtn');
  check('a successful retry clears the previous directory error', (await readFeedback()).hidden && (await readFeedback()).text === '');
  await click('#clearKeyBtn');
  await waitFor('document.querySelector("#settingsFeedback").getAttribute("role") === "status" && !document.querySelector("#settingsFeedback").hidden');
  const status = await readFeedback();
  check('mock key-clear success uses a visible polite status instead of a floating bubble', status.rendered && status.role === 'status' &&
    status.live === 'polite' && status.text.includes('已清除') && status.inPanel && status.saveVisible && status.floatingHidden, status);
  await capture('settings-key-status');
  await evaluate(`closePanels(); window.__qa.emit('settings');
    window.__qaBeforeProactive = { settings: { ...settings }, lastReminderAt, greetingIndex,
      speak: window.speechSynthesis.speak, cancel: window.speechSynthesis.cancel };
    window.__qaSpeechCalls = [];
    window.speechSynthesis.speak = () => window.__qaSpeechCalls.push('speak');
    window.speechSynthesis.cancel = () => window.__qaSpeechCalls.push('cancel');
    settings = { ...settings, proactiveEnabled: true, voiceEnabled: true, quietStart: 0, quietEnd: 0 };
    lastReminderAt = Date.now() - 120000;
    document.querySelector('#petVisual').classList.remove('hello');
    showBubble('这条浮动问候应保持隐藏。', { voice: true, duration: 120000 });
    proactiveTick(); proactiveTick();`);
  try {
    const inactive = await evaluate(`({ hidden: window.__qaFloatingBubbleHidden(), speechCalls: [...window.__qaSpeechCalls],
      hello: document.querySelector('#petVisual').classList.contains('hello'), greetingUnchanged: greetingIndex === window.__qaBeforeProactive.greetingIndex })`);
    check('direct and proactive greetings do not render speak or animate while the floating feature is disabled',
      inactive.hidden && inactive.speechCalls.length === 0 && !inactive.hello && inactive.greetingUnchanged, inactive);
  } finally {
    await evaluate(`settings = window.__qaBeforeProactive.settings; lastReminderAt = window.__qaBeforeProactive.lastReminderAt;
      greetingIndex = window.__qaBeforeProactive.greetingIndex;
      window.speechSynthesis.speak = window.__qaBeforeProactive.speak; window.speechSynthesis.cancel = window.__qaBeforeProactive.cancel;
      delete window.__qaBeforeProactive; delete window.__qaSpeechCalls;
      closePanels(); window.__qa.emit('settings'); document.activeElement?.blur(); document.querySelector('.settings-content').scrollTop = 0;`);
    await settle();
  }
}

async function verifyDesktopLayouts({ window, evaluate, check, settle, capture, waitFor }) {
  const { resolveDesktopLayout } = require('../src/desktop-layout');
  const primary = { x: 0, y: 0, width: 1536, height: 960 };
  const secondary = { x: -1920, y: -120, width: 1920, height: 1080 };
  const fixtures = [];
  for (const scale of [.78, 1, 1.18]) {
    for (const edge of ['left', 'right', 'top', 'bottom']) {
      fixtures.push({ name: `${edge}-${scale}`, edge, scale, workArea: primary,
        petAnchor: { x: edge === 'left' ? -10000 : edge === 'right' ? 10000 : primary.width / 2,
          y: edge === 'top' ? -10000 : edge === 'bottom' ? 10000 : primary.height - 4 } });
    }
    for (const edge of ['left', 'right']) fixtures.push({ name: `negative-monitor-${edge}-${scale}`, edge, scale, workArea: secondary,
      petAnchor: { x: edge === 'left' ? -10000 : 10000, y: secondary.y + secondary.height - 4 } });
  }
  fixtures.push({ name: 'bottom-inside-1', edge: 'inside-bottom', scale: 1, workArea: primary,
    petAnchor: { x: primary.width / 2, y: primary.height - 4 } });
  const geometry = () => evaluate(`(() => {
    const rect = selector => { const element = document.querySelector(selector), value = element.getBoundingClientRect();
      return { left: value.left, right: value.right, top: value.top, bottom: value.bottom, width: value.width, height: value.height,
        scrollWidth: element.scrollWidth, clientWidth: element.clientWidth }; };
    const anchor = window.__qaReadPoseGeometry().base;
    return { viewport: { width: innerWidth, height: innerHeight }, pet: rect('#petVisual'), stage: rect('#petStage'),
      chat: rect('#chatPanel'), settings: rect('#settingsPanel'), floatingBubbleHidden: window.__qaFloatingBubbleHidden(),
      anchorOpaque: isOpaquePixel(anchor.x, anchor.y) };
  })()`);
  const inside = (rect, viewport, tolerance = .7) => rect.left >= -tolerance && rect.top >= -tolerance &&
    rect.right <= viewport.width + tolerance && rect.bottom <= viewport.height + tolerance;
  const samePosition = (rect, expected) => Math.abs(rect.left - expected.left) < .7 && Math.abs(rect.top - expected.top) < .7 &&
    Math.abs(rect.width - expected.width) < .7 && Math.abs(rect.height - expected.height) < .7;
  await evaluate(`closePanels(); holdHappyPose(false); document.querySelector('#petVisual').style.animation = 'none';`);
  try {
    for (const fixture of fixtures) {
      const layout = resolveDesktopLayout(fixture);
      window.setContentSize(layout.windowBounds.width, layout.windowBounds.height);
      await waitFor(`innerWidth === ${layout.windowBounds.width} && innerHeight === ${layout.windowBounds.height}`);
      await evaluate(`applySettings({ scale: ${layout.scale} }); window.__qa.emit('desktopLayout', ${JSON.stringify(layout)}); window.__qa.emit('chat');
        showBubble('今天从哪里开始？', { duration: 120000 });`);
      await settle();
      const chat = await geometry();
      const visiblePetWidth = Math.max(0, Math.min(chat.pet.right, chat.viewport.width) - Math.max(chat.pet.left, 0));
      const visiblePetRatio = visiblePetWidth / chat.pet.width;
      const windowOnMonitor = layout.windowBounds.x >= fixture.workArea.x && layout.windowBounds.y >= fixture.workArea.y &&
        layout.windowBounds.x + layout.windowBounds.width <= fixture.workArea.x + fixture.workArea.width &&
        layout.windowBounds.y + layout.windowBounds.height <= fixture.workArea.y + fixture.workArea.height;
      const sideCorrect = layout.panelSide === 'right' ? chat.chat.left >= chat.pet.right + 11 : chat.chat.right <= chat.pet.left - 11;
      check(`desktop chat and character retain independent bounds while the floating bubble stays hidden: ${fixture.name}`,
        windowOnMonitor && samePosition(chat.chat, layout.panel) && inside(chat.chat, chat.viewport) && chat.floatingBubbleHidden &&
        visiblePetRatio >= .875 - .002 && chat.pet.top >= -.7 && chat.pet.bottom <= chat.viewport.height + 20.7 && sideCorrect && chat.anchorOpaque,
        { fixture: fixture.name, panelSide: layout.panelSide, visiblePetRatio, layout, actual: chat });
      const absoluteLeft = layout.windowBounds.x + chat.pet.left;
      const absoluteTop = layout.windowBounds.y + chat.pet.top;
      const absoluteBottom = layout.windowBounds.y + chat.pet.bottom;
      const edgeReached = fixture.edge === 'left' ? Math.abs(absoluteLeft - fixture.workArea.x - 4) < .7 :
        fixture.edge === 'top' ? Math.abs(absoluteTop - fixture.workArea.y - 8) < .7 :
          fixture.edge === 'bottom' ? Math.abs(absoluteBottom - fixture.workArea.y - fixture.workArea.height - 20) < .7 :
            fixture.edge === 'inside-bottom' ? Math.abs(absoluteBottom - fixture.workArea.y - fixture.workArea.height + 4) < .7 : visiblePetRatio >= .875 - .002;
      check(`character reaches the requested screen edge without being constrained by the panel: ${fixture.name}`, edgeReached,
        { absoluteLeft, absoluteTop, absoluteBottom, edge: fixture.edge, workArea: fixture.workArea });
      if (fixture.scale === 1 && ['left-1', 'right-1'].includes(fixture.name)) await capture(`desktop-${fixture.edge}-character-chat`);
      if (fixture.name === 'bottom-1') await capture('desktop-bottom-overflow-20-chat');
      if (fixture.name === 'bottom-inside-1') await capture('desktop-bottom-inside-chat');
      await evaluate('window.__qa.emit("settings")');
      await settle();
      const settings = await geometry();
      check(`settings follows the independent panel bounds without moving the character: ${fixture.name}`,
        inside(settings.settings, settings.viewport) && samePosition(settings.settings, layout.panel) &&
        Math.abs(settings.pet.left - chat.pet.left) < .1 && Math.abs(settings.pet.top - chat.pet.top) < .1 &&
        settings.settings.scrollWidth <= settings.settings.clientWidth, { panel: settings.settings, pet: settings.pet });
      if (fixture.name === 'left-1') await capture('desktop-left-character-settings');
      if (fixture.name === 'bottom-1') {
        await evaluate('document.querySelector(".settings-content").scrollTop = document.querySelector(".settings-content").scrollHeight');
        await settle();
        const bottomControls = await evaluate(`(() => { const panel = document.querySelector('#settingsPanel').getBoundingClientRect();
          const save = document.querySelector('#settingsPanel .primary-button').getBoundingClientRect();
          const directory = document.querySelector('#conversationDirectoryInput').getBoundingClientRect();
          const scroller = document.querySelector('.settings-content').getBoundingClientRect();
          return { saveVisible: save.top >= panel.top && save.bottom <= Math.min(panel.bottom, innerHeight),
            directoryVisible: directory.top >= scroller.top && directory.bottom <= scroller.bottom }; })()`);
        check('allowing 20 pixels of foot overflow does not clip settings directory or Save', bottomControls.saveVisible && bottomControls.directoryVisible, bottomControls);
        await capture('desktop-bottom-overflow-20-settings');
      }
      if (['left-1', 'negative-monitor-right-1'].includes(fixture.name)) {
        await evaluate('closePanels()');
        for (const [x, y] of [[0, 0], [layout.windowBounds.width - 1, 0], [0, layout.windowBounds.height - 1],
          [layout.windowBounds.width - 1, layout.windowBounds.height - 1]]) {
          await evaluate(`showContextToolbar({ clientX: ${x}, clientY: ${y} })`);
          await settle();
          const menu = await evaluate(`(() => { const element = document.querySelector('#contextToolbar'), value = element.getBoundingClientRect();
            return { left: value.left, right: value.right, top: value.top, bottom: value.bottom, width: value.width, height: value.height,
              labelFits: [...element.querySelectorAll('button')].every(button => button.scrollWidth <= button.clientWidth && button.scrollHeight <= button.clientHeight) }; })()`);
          check(`compact toolbar stays inside the actual window at ${fixture.name} corner ${x},${y}`,
            inside(menu, chat.viewport) && menu.width === 112 && menu.labelFits, { menu, viewport: chat.viewport });
          if (fixture.name === 'left-1' && x > 0 && y > 0) await capture('desktop-toolbar-bottom-right');
        }
        await evaluate('hideContextToolbar()');
      }
    }
  } finally {
    window.setContentSize(780, 720);
    await window.loadFile(path.join(rootDirectory, 'src', 'index.html'), { query: { preview: '1' } });
    await waitFor('document.querySelectorAll("#messages .message").length === 1 && innerWidth === 780 && innerHeight === 720');
    await evaluate('Promise.all([...document.images].map(image => image.decode()))');
    await settle();
  }
  check('layout fixtures leave the isolated preview at the default viewport', await evaluate('innerWidth === 780 && innerHeight === 720'));
}

async function runElectronChecks() {
  const { app, BrowserWindow, ipcMain, nativeImage } = require('electron');
  const assert = require('node:assert/strict');
  const profileDirectory = process.env.WHALE_GIRL_QA_PROFILE;
  assert(profileDirectory, 'Run this check with node scripts/verify-ui.cjs');
  for (const name of ['profile', 'session']) fs.mkdirSync(path.join(profileDirectory, name));
  app.setPath('userData', path.join(profileDirectory, 'profile'));
  app.setPath('sessionData', path.join(profileDirectory, 'session'));
  app.disableHardwareAcceleration();
  const results = [];
  const rendererErrors = [];
  const networkRequests = [];
  const check = (name, condition, details = {}) => {
    assert(condition, `${name}: ${JSON.stringify(details)}`);
    results.push({ ...details, name, passed: true });
  };
  const installerOptions = JSON.parse(fs.readFileSync(path.join(rootDirectory, 'package.json'), 'utf8')).build?.nsis;
  check('installer keeps the Start menu entry without creating a desktop shortcut',
    installerOptions?.createDesktopShortcut === false && installerOptions?.createStartMenuShortcut === true,
    { method: 'static installer configuration', createDesktopShortcut: installerOptions?.createDesktopShortcut, createStartMenuShortcut: installerOptions?.createStartMenuShortcut });
  ipcMain.on('qa:renderer-error', (_event, message) => rendererErrors.push(message));
  await app.whenReady();
  fs.mkdirSync(outputDirectory, { recursive: true });
  const window = new BrowserWindow({
    show: false, width: 780, height: 720, useContentSize: true,
    frame: false, transparent: true,
    webPreferences: {
      preload: __filename, contextIsolation: true, nodeIntegration: false,
      sandbox: false, backgroundThrottling: false, offscreen: true,
      partition: 'whale-girl-ui-check',
    },
  });
  window.webContents.setFrameRate(30);
  window.webContents.session.webRequest.onBeforeRequest(
    { urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] },
    ({ url }, callback) => { networkRequests.push(url); callback({ cancel: true }); },
  );
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  const evaluate = (script) => window.webContents.executeJavaScript(script);
  const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
  const settle = () => delay(380);
  const waitFor = async (expression) => {
    for (let count = 0; count < 50; count += 1) {
      if (await evaluate(expression)) return;
      await delay(40);
    }
    throw new Error(`UI condition timed out: ${expression}`);
  };
  const capture = async (name) => {
    await settle();
    const image = await window.webContents.capturePage();
    fs.writeFileSync(path.join(outputDirectory, `${name}.png`), image.toPNG());
  };
  await window.loadFile(path.join(rootDirectory, 'src', 'index.html'), { query: { preview: '1' } });
  await waitFor('document.querySelectorAll("#messages .message").length === 1');
  await evaluate(`window.__qaFloatingBubbleHidden = () => {
    const bubble = document.querySelector('#speechBubble');
    return FLOATING_BUBBLE_ENABLED === false && bubble.hidden && !bubble.classList.contains('visible') &&
      bubble.getClientRects().length === 0 && getComputedStyle(bubble).display === 'none' && !bubbleTimer;
  }; void 0;`);
  await evaluate('Promise.all([...document.images].map(image => image.decode()))');
  await evaluate(`window.__qaReadPoseGeometry = () => {
    const visual = document.querySelector('#petVisual');
    const visualStyle = getComputedStyle(visual);
    const matrixOf = style => new DOMMatrix(style.transform === 'none' ? undefined : style.transform);
    const originOf = style => style.transformOrigin.split(' ').map(Number.parseFloat);
    const transformPoint = (matrix, origin, point) => {
      const transformed = matrix.transformPoint(new DOMPoint(point.x - origin[0], point.y - origin[1]));
      return { x: transformed.x + origin[0], y: transformed.y + origin[1] };
    };
    const parentMatrix = matrixOf(visualStyle);
    const parentOrigin = originOf(visualStyle);
    const parentRect = visual.getBoundingClientRect();
    const corners = [
      { x: 0, y: 0 }, { x: visual.offsetWidth, y: 0 },
      { x: 0, y: visual.offsetHeight }, { x: visual.offsetWidth, y: visual.offsetHeight },
    ].map(point => transformPoint(parentMatrix, parentOrigin, point));
    const parentLayout = {
      x: parentRect.left - Math.min(...corners.map(point => point.x)),
      y: parentRect.top - Math.min(...corners.map(point => point.y)),
    };
    const pointFor = (selector, sourcePoint) => {
      const image = document.querySelector(selector);
      const style = getComputedStyle(image);
      const matrix = matrixOf(style);
      const width = parseFloat(style.width);
      const height = parseFloat(style.height);
      const fit = Math.min(width / image.naturalWidth, height / image.naturalHeight);
      const position = style.objectPosition.split(' ');
      const offset = (token, freeSpace) => token.endsWith('%') ? parseFloat(token) / 100 * freeSpace : parseFloat(token);
      const pointInImage = {
        x: offset(position[0], width - image.naturalWidth * fit) + sourcePoint.x * fit,
        y: offset(position[1], height - image.naturalHeight * fit) + sourcePoint.y * fit,
      };
      const imagePoint = transformPoint(matrix, originOf(style), pointInImage);
      const point = transformPoint(parentMatrix, parentOrigin, {
        x: image.offsetLeft + imagePoint.x, y: image.offsetTop + imagePoint.y,
      });
      return {
        x: parentLayout.x + point.x, y: parentLayout.y + point.y,
        registration: [matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f],
        naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight,
        objectFit: style.objectFit, opacity: Number(style.opacity),
      };
    };
    return {
      elapsed: performance.now() - (window.__qaPoseStartedAt || performance.now()),
      happy: visual.classList.contains('happy'),
      parentLeft: parentRect.left,
      parentMatrix: [parentMatrix.a, parentMatrix.b, parentMatrix.c, parentMatrix.d],
      base: pointFor('#petImage', { x: 620, y: 834 }),
      smile: pointFor('#petHappyImage', { x: 587, y: 832 }),
    };
  }; void 0;`);
  await delay(750);
  const initialCopy = await evaluate(`({ placeholder: document.querySelector('#chatInput').placeholder,
    hasEyebrow: Boolean(document.querySelector('#bubbleEyebrow')), greeting: document.querySelector('#bubbleText').textContent,
    speechTemplates: [...speechInitialGreetings] })`);
  check('startup hides the floating greeting while retaining the chat greeting and dynamic placeholder',
    initialCopy.placeholder === '想问鲸鱼娘点什么...' && !initialCopy.hasEyebrow && await evaluate('window.__qaFloatingBubbleHidden()') &&
    await evaluate('document.querySelector("#messages .message.assistant .bubble").textContent.length > 0') &&
    initialCopy.speechTemplates.length > 0 && initialCopy.speechTemplates.every(text => !text.includes('{name}') && !text.includes(defaults.petName) && !/deepseek|模型/i.test(text)), initialCopy);
  await capture('startup-hidden-floating');
  await evaluate('window.__qa.emit("chat")');
  await capture('standard');

  const chatAppearance = await evaluate(`(() => {
    const panel = document.querySelector('#chatPanel');
    const bounds = panel.getBoundingClientRect();
    const indicator = document.querySelector('.online-dot');
    return {
      hasScaleButton: Boolean(document.querySelector('#chatScaleBtn')),
      status: document.querySelector('.panel-title > span').textContent.trim(),
      indicatorColor: getComputedStyle(indicator).backgroundColor,
      chatShadow: getComputedStyle(panel).boxShadow,
      settingsShadow: getComputedStyle(document.querySelector('#settingsPanel')).boxShadow,
      x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height,
    };
  })()`);
  check('chat resize control is absent', !chatAppearance.hasScaleButton);
  check('chat status contains only the online label', chatAppearance.status === '在线', { status: chatAppearance.status });
  const indicatorRgb = chatAppearance.indicatorColor.match(/^rgb\((\d+), (\d+), (\d+)\)$/)?.slice(1).map(Number);
  check('online indicator is green', Boolean(indicatorRgb && indicatorRgb[1] > indicatorRgb[0] && indicatorRgb[1] > indicatorRgb[2]), { color: chatAppearance.indicatorColor });
  check('chat and settings panels have no outer shadow', chatAppearance.chatShadow === 'none' && chatAppearance.settingsShadow === 'none', {
    chatShadow: chatAppearance.chatShadow, settingsShadow: chatAppearance.settingsShadow,
  });
  check('chat uses fixed standard geometry', chatAppearance.x === 16 && chatAppearance.y === 29 && chatAppearance.width === 374 && chatAppearance.height === 654, {
    x: chatAppearance.x, y: chatAppearance.y, width: chatAppearance.width, height: chatAppearance.height,
  });
  await evaluate('document.body.classList.remove("preview")');
  try {
    await settle();
    const viewport = await evaluate('({ width: innerWidth, height: innerHeight, devicePixelRatio })');
    const transparentCapture = await window.webContents.capturePage();
    const png = transparentCapture.toPNG();
    fs.writeFileSync(path.join(outputDirectory, 'panel-no-shadow-transparent.png'), png);
    const bitmapImage = nativeImage.createFromBuffer(png);
    const bitmapSize = bitmapImage.getSize();
    const bitmap = bitmapImage.toBitmap();
    const pixelX = Math.floor(2 * bitmapSize.width / viewport.width);
    const pixelY = Math.floor(300 * bitmapSize.height / viewport.height);
    const alpha = bitmap[(pixelY * bitmapSize.width + pixelX) * 4 + 3];
    check('chat exterior is fully transparent in the rendered capture',
      bitmap.length === bitmapSize.width * bitmapSize.height * 4 && alpha === 0,
      { cssPoint: { x: 2, y: 300 }, bitmapPoint: { x: pixelX, y: pixelY }, alpha, bitmapSize, viewport });
  } finally {
    await evaluate('document.body.classList.add("preview")');
  }

  const opacityDefaults = await evaluate(`Object.fromEntries(
    ['pet', 'chat', 'message', 'input', 'text', 'bubble'].map(name =>
      [name, Number(getComputedStyle(document.documentElement).getPropertyValue('--' + name + '-opacity'))]))`);
  check('default opacity values', JSON.stringify(Object.values(opacityDefaults)) === JSON.stringify([1, .8, .88, .92, 1, .5]), opacityDefaults);
  await evaluate('window.__qa.emit("settings")');
  await capture('settings');
  const styles = await verifyNeumorphicSettings({ window, evaluate, check, delay, settle, capture, waitFor });
  await verifyCustomDropdowns({ window, evaluate, check, delay, settle, capture, waitFor, styles });
  await verifyHiddenFloatingBubble({ window, evaluate, check, delay, settle, capture, waitFor, styles });
  await verifyNeumorphicApplication({ window, evaluate, check, delay, settle, capture, waitFor, styles });
  const settingsGeometry = await evaluate(`(() => {
    const panel = document.querySelector('#settingsPanel').getBoundingClientRect();
    const save = document.querySelector('.settings-actions .primary-button').getBoundingClientRect();
    const scroller = document.querySelector('.settings-content');
    return { panelTop: panel.top, panelBottom: panel.bottom, saveTop: save.top, saveBottom: save.bottom,
      viewHeight: innerHeight, scrollHeight: scroller.scrollHeight, clientHeight: scroller.clientHeight };
  })()`);
  check('save button visible within settings and viewport', settingsGeometry.saveTop >= settingsGeometry.panelTop && settingsGeometry.saveBottom <= settingsGeometry.panelBottom && settingsGeometry.saveBottom <= settingsGeometry.viewHeight, settingsGeometry);
  await evaluate('document.querySelector(".settings-content").scrollTop = document.querySelector(".settings-content").scrollHeight');
  await capture('settings-bottom');
  const directoryGeometry = await evaluate(`(() => {
    const input = document.querySelector('#conversationDirectoryInput').getBoundingClientRect();
    const scroll = document.querySelector('.settings-content').getBoundingClientRect();
    return { inputTop: input.top, inputBottom: input.bottom, scrollTop: scroll.top, scrollBottom: scroll.bottom };
  })()`);
  check('directory input reachable by scrolling', directoryGeometry.inputTop >= directoryGeometry.scrollTop && directoryGeometry.inputBottom <= directoryGeometry.scrollBottom, directoryGeometry);

  const opacityPreview = { petOpacity: 65, chatOpacity: 35, messageOpacity: 55, inputOpacity: 60, textOpacity: 45, bubbleOpacity: 40 };
  await evaluate(`(() => {
    for (const [name, value] of Object.entries(${JSON.stringify(opacityPreview)})) {
      const input = document.querySelector('#' + name + 'Input');
      input.value = String(value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
  })()`);
  const previewStyles = await evaluate(`(() => {
    const style = element => getComputedStyle(document.querySelector(element));
    return { pet: style('#petVisual').opacity, chat: style('#chatPanel').backgroundColor,
      message: style('.message .bubble').backgroundColor, composer: style('.composer').backgroundColor,
      text: style('.message .bubble').color, bubble: style('#speechBubble').backgroundColor };
  })()`);
  check('opacity sliders update actual CSS surfaces independently',
    previewStyles.pet === '0.65' && previewStyles.chat.endsWith('0.35)') && previewStyles.message.endsWith('0.55)') &&
    previewStyles.composer.endsWith('0.6)') && previewStyles.text.endsWith('0.45)') && previewStyles.bubble.endsWith('0.4)'), previewStyles);
  await evaluate('document.querySelector("#chooseConversationDirectoryBtn").click()');
  await waitFor('document.querySelector("#conversationDirectoryInput").value.endsWith("选定目录")');
  const pastedDirectory = 'D:\\Whale Girl\\对话存档';
  await evaluate(`document.querySelector('#conversationDirectoryInput').value = ${JSON.stringify(pastedDirectory)};
    document.querySelector('#settingsForm').requestSubmit();`);
  await waitFor('!document.querySelector("#settingsPanel").classList.contains("open")');
  const saved = await evaluate('window.__qa.snapshot().settings');
  check('pasted directory and active opacity settings save without changing hidden bubble preferences', saved.conversationDirectory === pastedDirectory &&
    Object.entries(opacityPreview).filter(([name]) => name !== 'bubbleOpacity').every(([name, value]) => saved[name] === value) && saved.bubbleOpacity === defaults.bubbleOpacity);
  await evaluate('window.__qa.emit("settings")');
  check('saved directory restored in settings', await evaluate(`document.querySelector('#conversationDirectoryInput').value === ${JSON.stringify(pastedDirectory)}`));
  await evaluate(`(() => {
    for (const [name, value] of Object.entries(${JSON.stringify(defaults)})) {
      const input = document.querySelector('#' + name + 'Input');
      if (input && input.type === 'range') input.value = String(value);
    }
    document.querySelector('#settingsForm').requestSubmit();
  })()`);
  await waitFor('!document.querySelector("#settingsPanel").classList.contains("open")');

  await evaluate('window.__qa.emit("chat")');
  await settle();
  await evaluate('document.querySelector("#chatInput").value = "陪我整理一个清晰的小计划吧。"; document.querySelector("#chatForm").requestSubmit()');
  await waitFor('window.__qa.snapshot().answerPending');
  check('model request switches to happy pose and displays chat loading without a floating status',
    await evaluate('document.querySelector("#petVisual").classList.contains("happy") && document.querySelector("#typingMessage").getClientRects().length > 0 && window.__qaFloatingBubbleHidden()'));
  await capture('happy');
  const longAnswer = Array.from({ length: 180 }, (_, index) => `第 ${index + 1} 段：把任务拆成清晰的小步骤，完成一件后再继续下一件。保留每个想法与细节，也给自己留一点休息的空间。`).join('\n\n') + '\n\n完整回答的最后一行。';
  await evaluate(`window.__qa.answer(${JSON.stringify(longAnswer)})`);
  await waitFor('!document.querySelector("#sendBtn").disabled');
  await settle();
  const answerGeometry = await evaluate(`(() => {
    const answer = document.querySelector('.message.answer .bubble');
    const messages = document.querySelector('#messages');
    const style = getComputedStyle(answer);
    const bounds = answer.getBoundingClientRect();
    const viewport = messages.getBoundingClientRect();
    return { text: answer.textContent, height: bounds.height, borderHeight: parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth), scrollHeight: answer.scrollHeight,
      maxHeight: style.maxHeight, overflowY: style.overflowY, lineClamp: style.webkitLineClamp,
      messageScrollHeight: messages.scrollHeight, messageClientHeight: messages.clientHeight,
      answerBottom: bounds.bottom, viewportBottom: viewport.bottom,
      happy: document.querySelector('#petVisual').classList.contains('happy') };
  })()`);
  check('long answer preserved without clipping', answerGeometry.text === longAnswer && answerGeometry.maxHeight === 'none' &&
    answerGeometry.overflowY === 'visible' && answerGeometry.lineClamp === 'none' &&
    Math.abs(answerGeometry.height - answerGeometry.borderHeight - answerGeometry.scrollHeight) <= 1 &&
    answerGeometry.messageScrollHeight > answerGeometry.messageClientHeight &&
    answerGeometry.answerBottom <= answerGeometry.viewportBottom, { characters: longAnswer.length, exactText: answerGeometry.text === longAnswer,
      height: answerGeometry.height, borderHeight: answerGeometry.borderHeight, answerScrollHeight: answerGeometry.scrollHeight, scrollHeight: answerGeometry.messageScrollHeight,
      maxHeight: answerGeometry.maxHeight, overflowY: answerGeometry.overflowY, lineClamp: answerGeometry.lineClamp,
      answerBottom: answerGeometry.answerBottom, viewportBottom: answerGeometry.viewportBottom });
  check('model completion restores resting pose', !answerGeometry.happy);
  check('model completion leaves the floating status hidden and keeps the full chat answer',
    await evaluate('window.__qaFloatingBubbleHidden() && document.querySelector(".message.answer .bubble").getClientRects().length > 0'));
  await capture('long-answer-bottom');

  const samplePoseFrame = () => evaluate('new Promise(resolve => requestAnimationFrame(() => resolve(window.__qaReadPoseGeometry())))');
  const horizontalRange = (frames, read) => Math.max(...frames.map(read)) - Math.min(...frames.map(read));
  const checkPoseGeometry = (name, frames, scale) => {
    const metrics = {
      scale, frames: frames.length,
      parentDrift: horizontalRange(frames, frame => frame.parentLeft),
      baseAnchorDrift: horizontalRange(frames, frame => frame.base.x),
      smileAnchorDrift: horizontalRange(frames, frame => frame.smile.x),
      maximumAnchorDifference: Math.max(...frames.map(frame => Math.abs(frame.base.x - frame.smile.x))),
      baseRegistration: frames[0].base.registration,
      smileRegistration: frames[0].smile.registration,
    };
    const correctAssets = frames.every(frame => [frame.base, frame.smile].every(layer =>
      layer.naturalWidth === 1024 && layer.naturalHeight === 1536 && layer.objectFit === 'contain'));
    const fixedRegistrations = frames.every(frame => ['base', 'smile'].every(layer =>
      frame[layer].registration.every((value, index) => Math.abs(value - frames[0][layer].registration[index]) < .000001)));
    const fixedParentScale = frames.every(frame => Math.abs(frame.parentMatrix[0] - scale) < .000001 &&
      Math.abs(frame.parentMatrix[3] - scale) < .000001 &&
      Math.abs(frame.parentMatrix[1]) < .000001 && Math.abs(frame.parentMatrix[2]) < .000001);
    check(name, correctAssets && fixedRegistrations && fixedParentScale &&
      metrics.parentDrift < .3 && metrics.baseAnchorDrift < .3 && metrics.smileAnchorDrift < .3 &&
      metrics.maximumAnchorDifference < 2, metrics);
  };
  for (const scale of [.78, 1, 1.18]) {
    await evaluate(`applySettings({ scale: ${scale} }); closePanels();`);
    await settle();
    const before = [];
    for (let index = 0; index < 3; index += 1) before.push(await samplePoseFrame());
    if (scale === 1) await capture('pose-aligned-idle');
    await evaluate('window.__qaPoseStartedAt = performance.now(); showHappyPose(800)');
    const switching = [];
    for (let index = 0; index < 180 && (index < 40 || switching.at(-1).elapsed < 1250); index += 1) {
      switching.push(await samplePoseFrame());
    }
    checkPoseGeometry(`registered character anchors stay fixed during pose crossfade at scale ${scale}`, [...before, ...switching], scale);
    const held = switching.filter(frame => frame.elapsed >= 100 && frame.elapsed <= 700);
    const restored = switching.filter(frame => frame.elapsed >= 850);
    const finalFrame = switching.at(-1);
    check(`click pose holds for 0.8 seconds then restores at scale ${scale}`,
      held.length >= 10 && held.every(frame => frame.happy) && restored.length >= 5 && restored.every(frame => !frame.happy) &&
      finalFrame.elapsed >= 1150 && finalFrame.base.opacity > .99 && finalFrame.smile.opacity < .01,
      { scale, heldFrames: held.length, restoredFrames: restored.length, finalElapsed: finalFrame.elapsed });
    if (scale === 1) {
      await evaluate('showHappyPose(800)');
      await capture('pose-aligned-happy');
      await delay(850);
    }
  }
  await evaluate('applySettings({ scale: 1 }); animateHello()');
  const helloFrames = [];
  for (let index = 0; index < 24; index += 1) helloFrames.push(await samplePoseFrame());
  checkPoseGeometry('greeting animation does not move character anchors horizontally', helloFrames, 1);
  await evaluate('window.__qaPoseStartedAt = performance.now(); document.querySelector("#chatInput").value = "再陪我聊一会儿吧。"; document.querySelector("#chatForm").requestSubmit()');
  await waitFor('window.__qa.snapshot().answerPending');
  const thinkingFrames = [];
  for (let index = 0; index < 180 && (index < 32 || thinkingFrames.at(-1).elapsed < 1100); index += 1) thinkingFrames.push(await samplePoseFrame());
  checkPoseGeometry('model thinking animation keeps both registered poses horizontally aligned', thinkingFrames, 1);
  check('model holds smile beyond the short click interval', thinkingFrames.at(-1).elapsed > 850 && thinkingFrames.every(frame => frame.happy));
  await evaluate('window.__qa.answer("我在这里。")');
  await waitFor('!document.querySelector("#sendBtn").disabled');
  await settle();
  await evaluate('applySettings({ scale: .78 }); closePanels(); holdHappyPose(true)');
  await settle();
  const tailPoint = await evaluate(`(() => {
    const visual = document.querySelector('#petVisual');
    const image = document.querySelector('#petHappyImage');
    const rect = visual.getBoundingClientRect();
    const imageRect = image.getBoundingClientRect();
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(image, 0, 0);
    const fit = Math.min(imageRect.width / image.naturalWidth, imageRect.height / image.naturalHeight);
    const offsetX = (imageRect.width - image.naturalWidth * fit) / 2;
    const offsetY = (imageRect.height - image.naturalHeight * fit) / 2;
    for (let x = Math.min(innerWidth - 2, Math.floor(imageRect.right) - 2); x > rect.right + 1; x -= 1) {
      for (let y = Math.ceil(imageRect.top) + 2; y < Math.min(innerHeight - 2, imageRect.bottom - 2); y += 1) {
        const sourceX = Math.floor((x - imageRect.left - offsetX) / fit);
        const sourceY = Math.floor((y - imageRect.top - offsetY) / fit);
        if (sourceX < 1 || sourceY < 1 || sourceX >= canvas.width - 1 || sourceY >= canvas.height - 1) continue;
        const pixels = context.getImageData(sourceX - 1, sourceY - 1, 3, 3).data;
        if (!Array.from({ length: 9 }, (_, index) => pixels[index * 4 + 3]).every(alpha => alpha > 240)) continue;
        return { x, y, outsideBy: x - rect.right, opaque: isOpaquePixel(x, y),
          domTarget: document.elementFromPoint(x, y)?.id,
          reachesPet: Boolean(document.elementFromPoint(x, y)?.closest('#petVisual')) };
      }
    }
    return null;
  })()`);
  check('registered tail outside parent remains opaque and receives DOM events',
    Boolean(tailPoint && tailPoint.outsideBy > 1 && tailPoint.opaque && tailPoint.reachesPet), tailPoint || {});
  window.webContents.sendInputEvent({ type: 'mouseMove', x: 8, y: 8 });
  await delay(60);
  check('transparent background enables mouse pass-through', await evaluate('window.__qa.snapshot().calls.filter(call => call.name === "setIgnoreMouse").at(-1)?.value === true'));
  window.webContents.sendInputEvent({ type: 'mouseMove', x: tailPoint.x, y: tailPoint.y });
  await delay(60);
  check('opaque extended tail disables mouse pass-through', await evaluate('window.__qa.snapshot().calls.filter(call => call.name === "setIgnoreMouse").at(-1)?.value === false'));
  window.webContents.sendInputEvent({ type: 'mouseDown', x: tailPoint.x, y: tailPoint.y, button: 'left', clickCount: 1 });
  window.webContents.sendInputEvent({ type: 'mouseUp', x: tailPoint.x, y: tailPoint.y, button: 'left', clickCount: 1 });
  await waitFor('document.querySelector("#chatPanel").classList.contains("open")');
  await evaluate('holdHappyPose(false)');
  check('real tail click opens chat and keeps the short smile without a hello jump', await evaluate('document.querySelector("#petVisual").classList.contains("happy") && !document.querySelector("#petVisual").classList.contains("hello")'));
  window.webContents.sendInputEvent({ type: 'mouseDown', x: tailPoint.x, y: tailPoint.y, button: 'left', clickCount: 1 });
  window.webContents.sendInputEvent({ type: 'mouseUp', x: tailPoint.x, y: tailPoint.y, button: 'left', clickCount: 1 });
  await waitFor('!document.querySelector("#chatPanel").classList.contains("open")');
  check('second real tail click closes chat without moving the window', await evaluate('window.__qa.snapshot().calls.filter(call => call.name === "moveBy").length === 0'));
  await delay(850);
  await evaluate('applySettings({ scale: 1.18 }); window.__qa.emit("settings")');
  check('opening settings at the largest stored character size does not reveal the floating bubble', await evaluate('window.__qaFloatingBubbleHidden()'));
  await verifyDesktopLayouts({ window, evaluate, check, settle, capture, waitFor });
  check('renderer raised no errors', rendererErrors.length === 0, { rendererErrors });
  check('no external requests attempted', networkRequests.length === 0, { networkRequests });
  fs.writeFileSync(path.join(outputDirectory, 'results.json'), JSON.stringify({ passed: true, checks: results }, null, 2));
  console.log(`Passed ${results.length} UI checks. Screenshots: ${outputDirectory}`);
  window.destroy();
  app.quit();
}

function runIsolatedWorker() {
  const { spawnSync } = require('node:child_process');
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-girl-ui-check-'));
  let exitCode = 1;
  try {
    const environment = { ...process.env, WHALE_GIRL_QA_PROFILE: temporaryRoot };
    delete environment.ELECTRON_RUN_AS_NODE;
    const result = spawnSync(require('electron'), [__filename, '--ui-check-worker'], {
      cwd: rootDirectory, env: environment, stdio: 'inherit', windowsHide: true, timeout: 150000,
    });
    if (result.error) throw result.error;
    exitCode = result.status ?? 1;
  } finally {
    const resolved = path.resolve(temporaryRoot);
    if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith('whale-girl-ui-check-')) {
      throw new Error('Unexpected temporary profile path');
    }
    fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
  process.exitCode = exitCode;
}

if (process.type === 'renderer') {
  installMockBridge();
} else if (process.versions.electron && process.argv.includes('--ui-check-worker')) {
  runElectronChecks().catch((error) => {
    console.error(error);
    require('electron').app.exit(1);
  });
} else {
  runIsolatedWorker();
}
