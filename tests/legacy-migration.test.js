const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  LEGACY_COMPATIBILITY, MIGRATION_MARKER, STARTUP_MIGRATION_MARKER,
  readDiagnosticEnvironment, migrateBuiltInName, migrateLegacyProfile, migrateLegacyLoginItem,
} = require('../src/legacy-migration');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'desktopet-migration-test-'));
  t.after(() => {
    assert.equal(path.dirname(root), os.tmpdir());
    assert.ok(path.basename(root).startsWith('desktopet-migration-test-'));
    fs.rmSync(root, { recursive: true, force: true });
  });
  const target = path.join(root, 'Desktopet');
  const legacy = LEGACY_COMPATIBILITY.profileDirectories.map((name) => path.join(root, name));
  function seed(directory, { settings, state, key } = {}) {
    fs.mkdirSync(directory, { recursive: true });
    for (const [name, value] of [['settings.json', settings], ['Local State', state]]) {
      if (value !== undefined) fs.writeFileSync(path.join(directory, name), JSON.stringify(value));
    }
    if (key !== undefined) fs.writeFileSync(path.join(directory, 'deepseek-key.bin'), key);
  }
  return { root, target, legacy, seed };
}

const readJson = (directory, name) => JSON.parse(fs.readFileSync(path.join(directory, name), 'utf8'));
const cryptoState = (suffix = 'source') => ({ encrypted_key: `synthetic-context-${suffix}`, audit_enabled: true });

test('imports preferences and only the matching crypto context, leaving every source byte unchanged', (t) => {
  const { root, target, legacy, seed } = fixture(t);
  const settings = { petName: '自定义', scale: 0.88, modelId: 'deepseek-v4-pro', launchAtLogin: true };
  const key = Buffer.from([0, 255, 3, 144, 18]);
  seed(legacy[0], { settings, state: { os_crypt: cryptoState(), cache: 'not migrated' }, key });
  const sourceBefore = new Map(fs.readdirSync(legacy[0]).map((name) => [name, fs.readFileSync(path.join(legacy[0], name))]));
  assert.deepEqual(migrateLegacyProfile(root, target), { migrated: true, copiedKey: true });
  assert.deepEqual(readJson(target, 'settings.json'), settings);
  assert.deepEqual(readJson(target, 'Local State'), { os_crypt: cryptoState() });
  assert.deepEqual(fs.readFileSync(path.join(target, 'deepseek-key.bin')), key);
  for (const [name, contents] of sourceBefore) assert.deepEqual(fs.readFileSync(path.join(legacy[0], name)), contents);
});

test('fills only missing target settings and preserves unrelated target Local State metadata', (t) => {
  const { root, target, legacy, seed } = fixture(t);
  seed(legacy[0], { settings: { city: '北京', scale: 0.83, voiceEnabled: true }, state: { os_crypt: cryptoState() }, key: 'synthetic-key' });
  seed(target, { settings: { city: '杭州', scale: 1.1, petName: '我的名字', voiceEnabled: false }, state: { browser: { version: 'test' } } });
  migrateLegacyProfile(root, target);
  assert.deepEqual(readJson(target, 'settings.json'), { city: '杭州', scale: 1.1, voiceEnabled: false, petName: '我的名字' });
  assert.deepEqual(readJson(target, 'Local State'), { browser: { version: 'test' }, os_crypt: cryptoState() });
});

test('selects one newest source and never combines crypto data or preferences across old profiles', (t) => {
  const { root, target, legacy, seed } = fixture(t);
  seed(legacy[0], { settings: { city: '北京' }, key: 'newest-key-without-context' });
  seed(legacy[1], { settings: { city: '上海', petName: 'older-custom-name' }, state: { os_crypt: cryptoState('older') }, key: 'older-key' });
  assert.equal(migrateLegacyProfile(root, target).copiedKey, false);
  assert.deepEqual(readJson(target, 'settings.json'), { city: '北京' });
  assert.equal(fs.existsSync(path.join(target, 'deepseek-key.bin')), false);
  assert.equal(fs.existsSync(path.join(target, 'Local State')), false);
});

test('falls back to the earlier profile only when the newer source has no profile files', (t) => {
  const { root, target, legacy, seed } = fixture(t);
  seed(legacy[0]);
  seed(legacy[1], { settings: { city: '深圳' }, state: { os_crypt: cryptoState('earlier') }, key: 'earlier-key' });
  assert.equal(migrateLegacyProfile(root, target).copiedKey, true);
  assert.equal(readJson(target, 'settings.json').city, '深圳');
  assert.equal(readJson(target, 'Local State').os_crypt.encrypted_key, cryptoState('earlier').encrypted_key);
  assert.equal(fs.readFileSync(path.join(target, 'deepseek-key.bin'), 'utf8'), 'earlier-key');
});

test('an existing target key prevents any imported crypto context or key replacement', (t) => {
  const { root, target, legacy, seed } = fixture(t);
  seed(legacy[0], { settings: {}, state: { os_crypt: cryptoState() }, key: 'source-key' });
  seed(target, { key: 'target-key', state: { existingMetadata: true } });
  assert.equal(migrateLegacyProfile(root, target).copiedKey, false);
  assert.equal(fs.readFileSync(path.join(target, 'deepseek-key.bin'), 'utf8'), 'target-key');
  assert.deepEqual(readJson(target, 'Local State'), { existingMetadata: true });
});

test('an existing target crypto context is never replaced or paired with a source key', (t) => {
  for (const encryption of [cryptoState('target'), cryptoState(), null, {}]) {
    const { root, target, legacy, seed } = fixture(t);
    seed(legacy[0], { settings: {}, state: { os_crypt: cryptoState() }, key: 'source-key' });
    const state = { os_crypt: encryption, existingMetadata: true };
    seed(target, { state });
    assert.equal(migrateLegacyProfile(root, target).copiedKey, false);
    assert.deepEqual(readJson(target, 'Local State'), state);
    assert.equal(fs.existsSync(path.join(target, 'deepseek-key.bin')), false);
  }
});

test('malformed target metadata remains untouched and blocks encrypted-key import', (t) => {
  const { root, target, legacy, seed } = fixture(t);
  seed(legacy[0], { settings: { city: '上海' }, state: { os_crypt: cryptoState() }, key: 'source-key' });
  seed(target);
  for (const name of ['settings.json', 'Local State']) fs.writeFileSync(path.join(target, name), '{broken');
  assert.equal(migrateLegacyProfile(root, target).copiedKey, false);
  for (const name of ['settings.json', 'Local State']) assert.equal(fs.readFileSync(path.join(target, name), 'utf8'), '{broken');
  assert.equal(fs.existsSync(path.join(target, 'deepseek-key.bin')), false);
});

test('missing, empty or malformed source encryption data never imports a naked encrypted key', (t) => {
  for (const state of [undefined, null, [], {}, { os_crypt: {} }, { os_crypt: { encrypted_key: '' } }]) {
    const { root, target, legacy, seed } = fixture(t);
    seed(legacy[0], { settings: { city: '上海' }, state, key: 'source-key' });
    assert.equal(migrateLegacyProfile(root, target).copiedKey, false);
    assert.equal(fs.existsSync(path.join(target, 'deepseek-key.bin')), false);
    assert.equal(fs.existsSync(path.join(target, 'Local State')), false);
  }
  for (const key of [undefined, '']) {
    const { root, target, legacy, seed } = fixture(t);
    seed(legacy[0], { settings: {}, state: { os_crypt: cryptoState() }, key });
    assert.equal(migrateLegacyProfile(root, target).copiedKey, false);
    assert.equal(fs.existsSync(path.join(target, 'Local State')), false);
  }
});

test('a later key clear cannot resurrect a legacy key or overwrite later preferences', (t) => {
  const { root, target, legacy, seed } = fixture(t);
  seed(legacy[0], { settings: { city: '上海' }, state: { os_crypt: cryptoState() }, key: 'source-key' });
  migrateLegacyProfile(root, target);
  fs.rmSync(path.join(target, 'deepseek-key.bin'));
  fs.rmSync(path.join(target, 'Local State'));
  seed(target, { settings: { city: '杭州' } });
  assert.deepEqual(migrateLegacyProfile(root, target), { migrated: false, reason: 'already-checked' });
  assert.equal(readJson(target, 'settings.json').city, '杭州');
  assert.equal(fs.existsSync(path.join(target, 'deepseek-key.bin')), false);
});

test('a failed key commit rolls back crypto metadata and leaves migration retryable without a success marker', (t) => {
  for (const existingState of [undefined, { browser: { retained: true } }]) {
    const { root, target, legacy, seed } = fixture(t);
    seed(legacy[0], { settings: { city: '上海' }, state: { os_crypt: cryptoState() }, key: 'source-key' });
    seed(target, { settings: { city: '杭州' }, state: existingState });
    const oldState = existingState && fs.readFileSync(path.join(target, 'Local State'));
    const originalLink = fs.linkSync;
    fs.linkSync = () => { throw new Error('synthetic atomic-key commit failure'); };
    try {
      assert.throws(() => migrateLegacyProfile(root, target), /synthetic atomic-key commit failure/);
    } finally {
      fs.linkSync = originalLink;
    }
    assert.equal(fs.existsSync(path.join(target, MIGRATION_MARKER)), false);
    assert.equal(fs.existsSync(path.join(target, 'deepseek-key.bin')), false);
    assert.equal(readJson(target, 'settings.json').city, '杭州');
    assert.equal(fs.readdirSync(target).some((name) => name.endsWith('.tmp')), false);
    if (oldState) assert.deepEqual(fs.readFileSync(path.join(target, 'Local State')), oldState);
    else assert.equal(fs.existsSync(path.join(target, 'Local State')), false);
    assert.equal(migrateLegacyProfile(root, target).copiedKey, true);
  }
});

test('a fresh canonical profile is marked once and will not import a subsequently created old profile', (t) => {
  const { root, target, legacy, seed } = fixture(t);
  assert.deepEqual(migrateLegacyProfile(root, target), { migrated: false, reason: 'no-source' });
  assert.deepEqual(readJson(target, MIGRATION_MARKER), { version: 1 });
  seed(legacy[0], { settings: { city: '上海' }, state: { os_crypt: cryptoState() }, key: 'source-key' });
  assert.equal(migrateLegacyProfile(root, target).reason, 'already-checked');
  assert.equal(fs.existsSync(path.join(target, 'deepseek-key.bin')), false);
});

test('only exact built-in names migrate; custom names and substrings are preserved', () => {
  for (const name of LEGACY_COMPATIBILITY.builtInNames) {
    assert.equal(migrateBuiltInName(` ${name.toUpperCase()} `), 'Desktopet');
    assert.equal(migrateBuiltInName(`${name} 的朋友`), `${name} 的朋友`);
  }
  for (const name of ['deepseek', '小鲸', 'Desktopet', '自定义昵称']) assert.equal(migrateBuiltInName(name), name);
});

test('diagnostic compatibility is centralized and explicit canonical values take priority, including an empty override', () => {
  for (const [current, previous] of Object.entries(LEGACY_COMPATIBILITY.environment)) {
    assert.equal(readDiagnosticEnvironment({ [previous]: 'old-value' })[current], 'old-value');
    assert.equal(readDiagnosticEnvironment({ [current]: 'new-value', [previous]: 'old-value' })[current], 'new-value');
    assert.equal(readDiagnosticEnvironment({ [current]: '', [previous]: 'old-value' })[current], '');
    assert.equal(readDiagnosticEnvironment({})[current], '');
  }
});

test('packaged Windows startup migration registers the canonical executable before removing only the known old name', (t) => {
  for (const enabled of [true, false]) {
    const { target, seed } = fixture(t);
    seed(target);
    const calls = [];
    const app = { isPackaged: true, getPath: () => target, setLoginItemSettings: (options) => calls.push(options) };
    const options = { platform: 'win32', execPath: 'C:\\Test Apps\\Desktopet.exe' };
    assert.equal(migrateLegacyLoginItem(app, enabled, options), true);
    assert.deepEqual(calls, [
      { name: 'Desktopet', path: options.execPath, openAtLogin: enabled },
      ...LEGACY_COMPATIBILITY.startupEntryNames.map((name) => ({ name, openAtLogin: false })),
    ]);
    assert.deepEqual(readJson(target, STARTUP_MIGRATION_MARKER), { version: 1 });
    assert.equal(migrateLegacyLoginItem(app, enabled, options), false);
    assert.equal(calls.length, 1 + LEGACY_COMPATIBILITY.startupEntryNames.length);
  }
});

test('development, preview and non-Windows startup never touch login settings or migration markers', (t) => {
  for (const variant of [{ isPackaged: false }, { preview: true }, { platform: 'linux' }]) {
    const { target, seed } = fixture(t);
    seed(target);
    const calls = [];
    const app = { isPackaged: variant.isPackaged ?? true, getPath: () => target, setLoginItemSettings: (options) => calls.push(options) };
    assert.equal(migrateLegacyLoginItem(app, true, { platform: 'win32', ...variant }), false);
    assert.deepEqual(calls, []);
    assert.equal(fs.existsSync(path.join(target, STARTUP_MIGRATION_MARKER)), false);
  }
});

test('a failed new startup registration never removes the previous startup entry and remains retryable', (t) => {
  const { target, seed } = fixture(t);
  seed(target);
  const calls = [];
  const app = { isPackaged: true, getPath: () => target, setLoginItemSettings: (options) => {
    calls.push(options);
    throw new Error('synthetic registration error');
  } };
  assert.throws(() => migrateLegacyLoginItem(app, true, { platform: 'win32' }), /synthetic registration error/);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, 'Desktopet');
  assert.equal(fs.existsSync(path.join(target, STARTUP_MIGRATION_MARKER)), false);
});
