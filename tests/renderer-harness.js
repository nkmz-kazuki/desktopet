const fs = require('node:fs/promises');
const path = require('node:path');
const vm = require('node:vm');

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

async function rendererHarness(options = {}) {
  let now = options.startAt ?? new Date(2026, 9, 4, 12).getTime();
  let nextTimer = 1;
  const timers = new Map();
  const bubbleChanges = [];
  const queriedSelectors = [];
  const missingSelectors = [];
  const elements = [];
  const ids = new Map();
  let hitTargetId = 'petVisual';
  const bridgeEvents = new Map();
  const calls = { saveSettings: [], sendChat: [], moveBy: [], setIgnoreMouse: [], previewScale: [], spoken: [], chooseDirectory: 0 };
  const opacityDefaults = { petOpacity: 100, chatOpacity: 80, messageOpacity: 88, inputOpacity: 92, textOpacity: 100, bubbleOpacity: 50 };
  let saved = {
    petName: '鲸鱼娘', city: '上海', modelId: 'deepseek-flash', reasoningEffort: 'max', scale: 1,
    proactiveEnabled: true, voiceEnabled: false,
    quietStart: 23, quietEnd: 8, alwaysOnTop: true, launchAtLogin: false,
    conversationDirectory: path.resolve('example-conversations'), ...opacityDefaults, ...options.settings,
  };
  function schedule(callback, delay, interval = 0) {
    const id = nextTimer++;
    timers.set(id, { callback, at: now + Number(delay), interval });
    return id;
  }
  const flush = () => new Promise((resolve) => setImmediate(resolve));

  class Element {
    constructor(tagName = 'div', attrs = {}) {
      this.tagName = tagName.toUpperCase();
      this.attrs = attrs;
      this.listeners = new Map();
      this.children = [];
      this.dataset = {};
      this.value = attrs.value || '';
      this.checked = false;
      this.disabled = false;
      this.complete = false;
      this.hidden = 'hidden' in attrs;
      this.scrollTop = 0;
      this.scrollHeight = 100;
      this.offsetWidth = 400;
      this.offsetHeight = 32;
      this.offsetTop = 0;
      this.clientHeight = 180;
      this.clientLeft = 1;
      this.clientTop = 1;
      this._text = '';
      this._className = attrs.class || '';
      this.id = attrs.id || '';
      if (this.id === 'settingsPanel') { this.offsetWidth = 374; this.offsetHeight = 654; }
      if (this.id) ids.set(this.id, this);
      for (const [key, value] of Object.entries(attrs)) {
        if (key.startsWith('data-')) this.dataset[key.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = value;
      }
      this.classList = {
        contains: (value) => this._className.split(/\s+/).includes(value),
        add: (...values) => { this._className = [...new Set([...this._className.split(/\s+/).filter(Boolean), ...values])].join(' '); },
        remove: (...values) => { this._className = this._className.split(/\s+/).filter((value) => !values.includes(value)).join(' '); },
        toggle: (value, enabled) => {
          const active = enabled ?? !this.classList.contains(value);
          this.classList[active ? 'add' : 'remove'](value);
          return active;
        },
      };
      const properties = new Map();
      this.style = { setProperty: (name, value) => properties.set(name, String(value)), getPropertyValue: (name) => properties.get(name) || '' };
      elements.push(this);
    }
    get className() { return this._className; }
    set className(value) { this._className = value; }
    get id() { return this._id; }
    set id(value) { this._id = value; if (value) ids.set(value, this); }
    get textContent() { return this._text; }
    set textContent(value) {
      this._text = String(value);
      if (this.id === 'bubbleText') bubbleChanges.push({ text: this._text, at: now });
    }
    addEventListener(name, listener) {
      if (!this.listeners.has(name)) this.listeners.set(name, []);
      this.listeners.get(name).push(listener);
    }
    async dispatch(name, details = {}) {
      const event = { type: name, target: this, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...details };
      await Promise.all((this.listeners.get(name) || []).map((listener) => listener(event)));
      await flush();
      return event;
    }
    dispatchEvent(event) {
      event.target ??= this;
      for (const listener of this.listeners.get(event.type) || []) listener(event);
      return !event.defaultPrevented;
    }
    appendChild(child) { child.parentElement = this; this.children.push(child); return child; }
    remove() {
      this.removed = true;
      if (this.parentElement) this.parentElement.children = this.parentElement.children.filter((child) => child !== this);
    }
    replaceChildren(...children) { for (const child of [...this.children]) child.remove(); this.children = []; children.forEach((child) => this.appendChild(child)); }
    setAttribute(name, value) { this.attrs[name] = String(value); }
    getAttribute(name) { return this.attrs[name]; }
    removeAttribute(name) { delete this.attrs[name]; }
    focus() { if (document.activeElement) document.activeElement.focused = false; this.focused = true; document.activeElement = this; }
    blur() { this.focused = false; if (document.activeElement === this) document.activeElement = null; }
    contains(node) { return this === node || this.children.some((child) => child.contains(node)); }
    setPointerCapture() {}
    releasePointerCapture() {}
    getBoundingClientRect() {
      const presets = {
        settingsPanel: { left: 16, top: 29, width: 374, height: 654 },
        settingsContent: { left: 17, top: 104, width: 372, height: 503 },
        settingsActions: { left: 17, top: 607, width: 372, height: 75 },
        modelInputTrigger: { left: 37, top: 300, width: 320, height: 35 },
      };
      const rect = this.rect || presets[this.id] || { left: 0, top: 0, width: 400, height: 660 };
      return { ...rect, right: rect.left + rect.width, bottom: rect.top + rect.height };
    }
    closest(selector) {
      for (const alternative of selector.split(',')) {
        const classes = alternative.trim().split('.').filter(Boolean);
        if (classes.length && classes.every((name) => this.classList.contains(name))) return this;
      }
      return this.parentElement?.closest(selector) || null;
    }
    requestSubmit() { return this.dispatch('submit'); }
  }

  const html = await fs.readFile(path.join(__dirname, '..', 'src', 'index.html'), 'utf8');
  const stack = [];
  const voidTags = new Set(['meta', 'link', 'input', 'img', 'br', 'hr']);
  for (const match of html.matchAll(/<\/?([a-z][\w-]*)\b([^>]*)>/gi)) {
    if (match[0].startsWith('</')) {
      while (stack.length) if (stack.pop().tagName === match[1].toUpperCase()) break;
      continue;
    }
    const attrs = {};
    for (const attr of match[2].matchAll(/([\w-]+)(?:="([^"]*)")?/g)) attrs[attr[1]] = attr[2] ?? '';
    const element = new Element(match[1], attrs);
    stack.at(-1)?.appendChild(element);
    if (!voidTags.has(match[1].toLowerCase()) && !match[0].endsWith('/>')) stack.push(element);
  }
  const document = new Element('document');
  document.body = elements.find((element) => element.tagName === 'BODY');
  document.documentElement = elements.find((element) => element.tagName === 'HTML');
  document.querySelector = (selector) => {
    queriedSelectors.push(selector);
    const element = selector.startsWith('#')
      ? elements.findLast((candidate) => candidate.id === selector.slice(1) && !candidate.removed)
      : null;
    if (!element && selector !== '#typingMessage') missingSelectors.push(selector);
    return element || null;
  };
  document.querySelectorAll = (selector) => {
    queriedSelectors.push(selector);
    const match = selector.match(/^\[([^\]]+)\]$/);
    return match ? elements.filter((element) => match[1] in element.attrs && !element.removed) : [];
  };
  document.createElement = (name) => {
    const element = new Element(name);
    if (name === 'canvas') element.getContext = () => options.canvasContext ?? null;
    return element;
  };
  document.elementFromPoint = () => ids.get(hitTargetId) || document.body;
  const api = {
    getSettings: async () => ({ ...saved }),
    getDesktopLayout: async () => options.desktopLayout ?? null,
    previewScale: (value) => calls.previewScale.push(value),
    saveSettings: async (next) => {
      calls.saveSettings.push({ ...next });
      if (options.saveError) throw new Error(options.saveError);
      saved = { ...saved, ...next };
      return { ...saved };
    },
    sendChat: async (text) => {
      calls.sendChat.push(text);
      return options.sendChat ? options.sendChat(text) : { text: '已回答。', kind: 'model' };
    },
    getWeather: async () => {
      if (options.weatherError) throw new Error(options.weatherError);
      return { city: '上海', region: '上海', condition: '晴', temperature: 21, feelsLike: 20, low: 16, high: 24, rainChance: 10 };
    },
    chooseConversationDirectory: async () => {
      calls.chooseDirectory += 1;
      if (options.chooseDirectoryError) throw new Error(options.chooseDirectoryError);
      return options.selectedDirectory ?? null;
    },
    setIgnoreMouse: (value) => calls.setIgnoreMouse.push(value),
    moveBy: (...values) => calls.moveBy.push(values),
    clearChat: async () => true,
    clearApiKey: async () => {
      if (options.clearKeyError) throw new Error(options.clearKeyError);
      saved.apiKeySet = false;
      return true;
    },
    openApiKeys: async () => {
      if (options.openApiKeysError) throw new Error(options.openApiKeysError);
      return true;
    },
    openConversationFolder: async () => {
      if (options.openFolderError) throw new Error(options.openFolderError);
      return true;
    },
    hide() {}, quit() {},
  };
  for (const name of ['onOpenChat', 'onOpenSettings', 'onOpenContextPreview', 'onRequestWeather', 'onDesktopLayout']) {
    api[name] = (handler) => bridgeEvents.set(name, handler);
  }
  const window = new Element('window');
  Object.assign(window, {
    petAPI: api, location: { search: '' }, innerWidth: 780, innerHeight: 720,
    speechSynthesis: { cancel() {}, speak: (utterance) => calls.spoken.push(utterance.text) },
    getComputedStyle: () => options.imageStyle || { transform: 'matrix(1,0,0,1,12.59375,0)', width: '403px', height: '604px' },
  });
  class ClockDate extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  }
  class RendererEvent {
    constructor(type, details = {}) { this.type = type; Object.assign(this, details); this.defaultPrevented = false; }
    preventDefault() { this.defaultPrevented = true; }
  }
  class SpeechUtterance {
    constructor(text) { this.text = text; }
  }
  class Matrix {
    constructor(transform) {
      const values = transform === 'none' ? [1, 0, 0, 1, 0, 0]
        : transform.match(/^matrix\(([^)]+)\)$/)?.[1].split(',').map(Number);
      if (!values || values.length !== 6) throw new Error('Invalid test transform');
      ['a', 'b', 'c', 'd', 'e', 'f'].forEach((name, index) => { this[name] = values[index]; });
    }
  }
  const context = vm.createContext({
    window, document, Date: ClockDate, console, URLSearchParams, Event: RendererEvent, SpeechSynthesisUtterance: SpeechUtterance, DOMMatrixReadOnly: Matrix,
    Math: options.random == null ? Math : Object.assign(Object.create(Math), { random: () => options.random }),
    setTimeout: (callback, delay) => schedule(callback, delay),
    clearTimeout: (id) => timers.delete(id),
    setInterval: (callback, delay) => schedule(callback, delay, delay),
    clearInterval: (id) => timers.delete(id),
  });
  const intentSource = await fs.readFile(path.join(__dirname, '..', 'src', 'chat-intent.js'), 'utf8');
  vm.runInContext(intentSource, context, { filename: 'chat-intent.js' });
  window.chatIntent = context.chatIntent;
  for (const filename of ['model-config.js', 'custom-select.js']) {
    vm.runInContext(await fs.readFile(path.join(__dirname, '..', 'src', filename), 'utf8'), context, { filename });
  }
  window.customSelect = context.customSelect;
  let source = await fs.readFile(path.join(__dirname, '..', 'src', 'renderer.js'), 'utf8');
  if (options.floatingBubbleEnabled) {
    source = source.replace('const FLOATING_BUBBLE_ENABLED = false;', 'const FLOATING_BUBBLE_ENABLED = true;');
  }
  vm.runInContext(source, context, { filename: 'renderer.js' });
  await flush();
  return {
    get: (id) => ids.get(id),
    css: (name) => document.documentElement.style.getPropertyValue(name),
    get saved() { return saved; },
    get now() { return now; },
    get pendingTimers() { return [...timers.values()].map(({ at, interval }) => ({ at, interval })); },
    calls, bubbleChanges, queriedSelectors, missingSelectors, html,
    get activeElement() { return document.activeElement; },
    pointerDown: async (target) => document.dispatch('pointerdown', { target }),
    windowEvent: async (name, details) => window.dispatch(name, details),
    setHitTarget: (id) => { hitTargetId = id; },
    openSettings: async () => { await bridgeEvents.get('onOpenSettings')(); await flush(); },
    openChat: async () => { await bridgeEvents.get('onOpenChat')(); await flush(); },
    requestWeather: async () => { await bridgeEvents.get('onRequestWeather')(); await flush(); },
    emitDesktopLayout: async (value) => { await bridgeEvents.get('onDesktopLayout')(value); await flush(); },
    flush,
    async advance(milliseconds) {
      const end = now + milliseconds;
      for (;;) {
        const next = [...timers.entries()].filter(([, job]) => job.at <= end).sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
        if (!next) break;
        const [id, job] = next;
        now = job.at;
        if (job.interval) job.at += job.interval;
        else timers.delete(id);
        job.callback();
        await flush();
      }
      now = end;
      await flush();
    },
    async clickPet() {
      const event = { button: 0, pointerId: 1, screenX: 500, screenY: 300, clientX: 500, clientY: 300 };
      await ids.get('petVisual').dispatch('pointerdown', event);
      await ids.get('petVisual').dispatch('pointerup', event);
    },
    async send(text) {
      ids.get('chatInput').value = text;
      await ids.get('chatForm').dispatch('submit');
    },
  };
}

module.exports = { rendererHarness, deferred };
