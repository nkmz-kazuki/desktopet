const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const projectRoot = path.resolve(__dirname, '..');

async function runChecks() {
  const { app, BrowserWindow } = require('electron');
  const { applyWindowLayer } = require('../src/window-layer');
  const profile = process.env.WHALE_WINDOW_LAYER_PROFILE;
  assert(profile, 'Use node scripts/verify-window-layer.cjs');
  app.setPath('userData', profile);
  app.disableHardwareAcceleration();
  await app.whenReady();
  const windows = [];
  const results = [];
  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const makeWindow = async (label, x) => {
    const window = new BrowserWindow({
      width: 260, height: 170, x, y: 40, show: false, frame: false,
      transparent: true, hasShadow: false, alwaysOnTop: false, skipTaskbar: true,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
    });
    windows.push(window);
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.session.webRequest.onBeforeRequest(
      { urls: ['http://*/*', 'https://*/*'] }, (_details, callback) => callback({ cancel: true }),
    );
    await window.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(
      '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'">' +
      '<body style="margin:0;background:#eeefff;color:#303455;font:16px sans-serif;padding:20px">' +
      label + '<p>置顶验证，完成后自动关闭。</p></body>',
    ));
    return window;
  };
  const handleOf = (window) => {
    const bytes = window.getNativeWindowHandle();
    return String(bytes.length === 8 ? bytes.readBigUInt64LE() : bytes.readUInt32LE());
  };
  const probe = (...targets) => {
    const response = spawnSync('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-File', path.join(__dirname, 'read-window-layer.ps1'),
      '-HandleList', targets.map(handleOf).join(','),
    ], { encoding: 'utf8', windowsHide: true, timeout: 10000 });
    if (response.error) throw response.error;
    assert.equal(response.status, 0, response.stderr);
    return JSON.parse(response.stdout.trim());
  };
  const check = (name, passed, details = {}) => {
    assert(passed, name + ': ' + JSON.stringify(details));
    results.push({ name, passed: true, ...details });
  };
  try {
    const companion = await makeWindow('鲸鱼娘测试窗口', 40);
    const ordinary = await makeWindow('普通应用测试窗口', 70);
    ordinary.show();
    companion.setAlwaysOnTop(true, 'floating');
    companion.showInactive();
    await delay(120);
    const baseline = probe(companion, ordinary);
    results.push({ name: 'legacy floating-level diagnostic', electronTopmost: companion.isAlwaysOnTop(), ...baseline });
    check('ordinary test window is the nonzero foreground baseline',
      baseline.foreground !== 0 && baseline.foreground === Number(handleOf(ordinary)),
      { foreground: baseline.foreground, ordinaryHandle: handleOf(ordinary) });

    const before = baseline.foreground;
    applyWindowLayer(companion, true, { raise: true });
    ordinary.moveTop();
    await delay(100);
    let state = probe(companion, ordinary);
    check('enabled setting produces a native topmost window above an ordinary window',
      state.windows[0].topmost && !state.windows[1].topmost && state.windows[0].zIndex < state.windows[1].zIndex, state);
    check('applying topmost does not activate the companion', state.foreground === before, { before, after: state.foreground });

    for (const ignore of [true, false, true, false]) companion.setIgnoreMouseEvents(ignore, { forward: true });
    state = probe(companion, ordinary);
    check('mouse pass-through transitions preserve native topmost', state.windows[0].topmost, state);

    companion.hide();
    applyWindowLayer(companion, true, { raise: true });
    state = probe(companion, ordinary);
    check('applying topmost to a hidden companion never reveals it', !state.windows[0].visible, state);
    companion.showInactive();
    applyWindowLayer(companion, true, { raise: true });
    ordinary.moveTop();
    state = probe(companion, ordinary);
    check('showing the companion restores topmost without changing foreground',
      state.windows[0].topmost && state.windows[0].visible && state.windows[0].zIndex < state.windows[1].zIndex && state.foreground === before, state);

    companion.minimize();
    applyWindowLayer(companion, true, { raise: true });
    state = probe(companion, ordinary);
    check('layer refresh leaves a minimized companion minimized', state.windows[0].minimized, state);
    companion.showInactive();
    applyWindowLayer(companion, true, { raise: true });
    state = probe(companion, ordinary);
    check('explicit inactive show recovers a minimized companion', state.windows[0].topmost && state.windows[0].visible && !state.windows[0].minimized, state);

    applyWindowLayer(companion, false, { raise: true });
    ordinary.moveTop();
    state = probe(companion, ordinary);
    check('disabled setting clears native topmost and permits ordinary windows above it',
      !state.windows[0].topmost && state.windows[1].zIndex < state.windows[0].zIndex, state);
    companion.hide();
    companion.showInactive();
    applyWindowLayer(companion, false, { raise: true });
    state = probe(companion, ordinary);
    check('showing after disabling topmost does not enable it again', !state.windows[0].topmost, state);

    companion.destroy();
    applyWindowLayer(companion, true, { raise: true });
    check('destroyed windows are ignored safely', true);
    const restarted = await makeWindow('重启恢复测试窗口', 40);
    applyWindowLayer(restarted, true);
    restarted.showInactive();
    applyWindowLayer(restarted, true, { raise: true });
    ordinary.moveTop();
    state = probe(restarted, ordinary);
    check('fresh window restores the persisted enabled policy above ordinary windows',
      state.windows[0].topmost && state.windows[0].zIndex < state.windows[1].zIndex, state);

    fs.mkdirSync(path.join(projectRoot, 'dist', 'window-layer-check'), { recursive: true });
    fs.writeFileSync(path.join(projectRoot, 'dist', 'window-layer-check', 'results.json'), JSON.stringify({ passed: true, checks: results }, null, 2));
    console.log(`Passed ${results.filter((result) => result.passed).length} native window checks.`);
  } finally {
    for (const window of windows) if (!window.isDestroyed()) window.destroy();
    app.quit();
  }
}

function runWorker() {
  if (process.platform !== 'win32') throw new Error('Native window validation requires Windows.');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-girl-window-check-'));
  try {
    const env = { ...process.env, WHALE_WINDOW_LAYER_PROFILE: profile };
    delete env.ELECTRON_RUN_AS_NODE;
    const result = spawnSync(require('electron'), [__filename, '--window-layer-worker'], {
      cwd: projectRoot, env, stdio: 'inherit', windowsHide: true, timeout: 60000,
    });
    if (result.error) throw result.error;
    process.exitCode = result.status ?? 1;
  } finally {
    const resolved = path.resolve(profile);
    if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith('whale-girl-window-check-')) throw new Error('Unexpected test profile path.');
    fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
}

if (process.versions.electron && process.argv.includes('--window-layer-worker')) {
  runChecks().catch((error) => { console.error(error); require('electron').app.exit(1); });
} else {
  runWorker();
}
