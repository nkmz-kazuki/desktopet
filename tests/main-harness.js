const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const storeModule = require('../src/conversation-store');

async function mainHarness(t, { store, fetchImpl, saved, legacy, selectedDirectory,
  apiKey = 'local-test-only',
  displays = [{ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }],
  windowBounds = { x: 900, y: 200, width: 780, height: 720 },
  cursorPoint = { x: 1000, y: 600 },
} = {}) {
  const root = os.tmpdir();
  const directory = await fs.mkdtemp(path.join(root, 'whale-girl-test-'));
  let context;
  t.after(async () => {
    if (context) vm.runInContext('clearTimeout(moveSaveTimer);', context);
    assert.equal(path.dirname(directory), root);
    assert.ok(path.basename(directory).startsWith('whale-girl-test-'));
    await fs.rm(directory, { recursive: true, force: true });
  });
  const appPaths = {
    appData: directory,
    userData: path.join(directory, 'whale-girl'),
    documents: path.join(directory, 'Documents'),
    temp: directory,
  };
  for (const [name, data] of [['whale-girl', saved], ['qingyu-desktop-companion', legacy]]) {
    if (!data) continue;
    const target = path.join(directory, name);
    await fs.mkdir(target, { recursive: true });
    await fs.writeFile(path.join(target, 'settings.json'), JSON.stringify(data));
    if (name === 'qingyu-desktop-companion') await fs.writeFile(path.join(target, 'deepseek-key.bin'), 'encrypted-test-fixture');
  }
  const handlers = new Map();
  const eventHandlers = new Map();
  const positionChanges = [];
  const boundsChanges = [];
  const windowCalls = [];
  const rendererMessages = [];
  const windowEvents = new EventEmitter();
  const appEvents = new EventEmitter();
  const powerEvents = new EventEmitter();
  const screenEvents = new EventEmitter();
  const trayEvents = new EventEmitter();
  const readyCallbacks = [];
  const windowState = { visible: true, minimized: false, destroyed: false, alwaysOnTop: false, nativeAlwaysOnTop: false, focused: false };
  let windowOptions;
  let trayMenu = [];
  let quitCalls = 0;
  let bounds = { ...windowBounds };
  let cursor = { ...cursorPoint };
  let availableDisplays = displays;
  let loginUpdates = 0;
  const testWindow = {
    setAlwaysOnTop(enabled, level) {
      windowCalls.push(['setAlwaysOnTop', enabled, level]);
      if (enabled !== windowState.alwaysOnTop) windowState.nativeAlwaysOnTop = enabled;
      windowState.alwaysOnTop = enabled;
    },
    isAlwaysOnTop: () => windowState.alwaysOnTop,
    setVisibleOnAllWorkspaces(...args) { windowCalls.push(['setVisibleOnAllWorkspaces', ...args]); },
    loadFile() {},
    once: (...args) => windowEvents.once(...args),
    on: (...args) => windowEvents.on(...args),
    isDestroyed: () => windowState.destroyed,
    isVisible: () => windowState.visible && !windowState.minimized,
    isMinimized: () => windowState.minimized,
    showInactive() {
      windowCalls.push(['showInactive']);
      windowState.visible = true;
      windowState.minimized = false;
      windowEvents.emit('show');
    },
    hide() { windowCalls.push(['hide']); windowState.visible = false; windowEvents.emit('hide'); },
    moveTop() { windowCalls.push(['moveTop']); windowState.visible = true; },
    focus() { windowCalls.push(['focus']); windowState.focused = true; },
    restore() {
      windowCalls.push(['restore']);
      windowState.visible = true;
      windowState.minimized = false;
      windowEvents.emit('restore');
    },
    setIgnoreMouseEvents(...args) { windowCalls.push(['setIgnoreMouseEvents', ...args]); },
    webContents: { send: (channel, payload) => rendererMessages.push({ channel, payload }) },
    getBounds: () => ({ ...bounds }),
    getPosition: () => [bounds.x, bounds.y],
    setPosition: (x, y) => { bounds = { ...bounds, x, y }; positionChanges.push({ x, y }); },
    setBounds: (next) => {
      bounds = { ...bounds, ...next };
      boundsChanges.push({ ...bounds });
      positionChanges.push({ x: bounds.x, y: bounds.y });
    },
  };
  const electron = {
    app: {
      whenReady: () => ({ then: (callback) => readyCallbacks.push(callback) }),
      on: (...args) => appEvents.on(...args),
      quit: () => { quitCalls += 1; appEvents.emit('before-quit'); },
      getPath: (name) => appPaths[name],
      setPath: (name, value) => { appPaths[name] = value; },
      setLoginItemSettings() { loginUpdates += 1; },
    },
    dialog: { showOpenDialog: async () => ({ canceled: !selectedDirectory, filePaths: selectedDirectory ? [selectedDirectory] : [] }) },
    BrowserWindow: function BrowserWindow(options) {
      windowOptions = options;
      bounds = { x: options.x, y: options.y, width: options.width, height: options.height };
      Object.assign(windowState, { visible: options.show !== false, minimized: false, destroyed: false,
        alwaysOnTop: Boolean(options.alwaysOnTop), nativeAlwaysOnTop: Boolean(options.alwaysOnTop) });
      return testWindow;
    },
    powerMonitor: { on: (...args) => powerEvents.on(...args) },
    Menu: { buildFromTemplate: (template) => template },
    nativeImage: { createFromPath: () => ({ crop: () => ({ resize: () => ({}) }) }) },
    Tray: function Tray() {
      return {
        setToolTip() {}, setContextMenu: (menu) => { trayMenu = menu; },
        on: (...args) => trayEvents.on(...args),
      };
    },
    ipcMain: {
      handle: (channel, handler) => handlers.set(channel, handler),
      on: (channel, handler) => eventHandlers.set(channel, handler),
    },
    safeStorage: { isEncryptionAvailable: () => false },
    screen: {
      on: (...args) => screenEvents.on(...args),
      getPrimaryDisplay: () => availableDisplays[0],
      getAllDisplays: () => availableDisplays,
      getCursorScreenPoint: () => ({ ...cursor }),
      getDisplayNearestPoint: (point) => availableDisplays.reduce((best, display) => {
        const distance = ({ workArea: area }) => Math.max(area.x - point.x, 0, point.x - area.x - area.width) ** 2
          + Math.max(area.y - point.y, 0, point.y - area.y - area.height) ** 2;
        return distance(display) < distance(best) ? display : best;
      }),
    },
  };
  context = vm.createContext({
    require: (name) => name === 'electron' ? electron : name === './conversation-store'
      ? { ...storeModule, createConversationStore: store ? () => store : storeModule.createConversationStore }
      : require(name.startsWith('./') ? path.join(__dirname, '..', 'src', name) : name),
    __dirname: path.join(__dirname, '..', 'src'),
    process: { ...process, env: { ...process.env, QINGYU_SCREENSHOT_PATH: '' } },
    console, fetch: fetchImpl, AbortSignal, setTimeout, clearTimeout,
    testWindow, testApiKey: apiKey,
  });
  const source = await fs.readFile(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
  vm.runInContext(source + '\nloadSettings(); sessionApiKey = testApiKey; mainWindow = testWindow; registerIpc();', context);
  return {
    invoke: (channel, value) => handlers.get(channel)({}, value),
    emit: (channel, value) => eventHandlers.get(channel)({}, value),
    directory,
    appPaths,
    positionChanges,
    boundsChanges,
    windowCalls,
    rendererMessages,
    get windowState() { return { ...windowState }; },
    get windowOptions() { return windowOptions; },
    get quitCalls() { return quitCalls; },
    setWindowState: (next) => { Object.assign(windowState, next); },
    loseNativeTopmost: () => { windowState.nativeAlwaysOnTop = false; },
    emitWindow: (event, ...args) => windowEvents.emit(event, ...args),
    emitApp: (event, ...args) => appEvents.emit(event, ...args),
    emitPower: (event, ...args) => powerEvents.emit(event, ...args),
    emitScreen: (event, ...args) => screenEvents.emit(event, ...args),
    emitTray: (event, ...args) => trayEvents.emit(event, ...args),
    clickTray: (label) => {
      const item = trayMenu.find((entry) => entry.label === label);
      assert.ok(item && typeof item.click === 'function', `missing tray action: ${label}`);
      return item.click();
    },
    startApp: async () => {
      for (const callback of readyCallbacks.splice(0)) await callback();
      await vm.runInContext('conversationStore.initialize()', context);
    },
    get windowBounds() { return { ...bounds }; },
    restoreLayout: () => context.restoreDesktopLayout(),
    createWindow: () => context.createWindow(),
    createTray: () => context.createTray(),
    setCursor: (point) => { cursor = { ...point }; },
    setDisplays: (next) => { availableDisplays = next; },
    get loginUpdates() { return loginUpdates; },
  };
}

module.exports = { mainHarness };
