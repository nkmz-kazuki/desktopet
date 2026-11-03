const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const LEGACY_COMPATIBILITY = Object.freeze({
  profileDirectories: Object.freeze(['whale-girl', 'qingyu-desktop-companion']),
  builtInNames: Object.freeze(['鲸鱼娘', 'whale girl', 'whale-girl', 'whalegirl', 'hazuki', '青屿']),
  startupEntryNames: Object.freeze(['electron.app.鲸鱼娘']),
  environment: Object.freeze({
    DESKTOPET_SCREENSHOT_PATH: 'QINGYU_SCREENSHOT_PATH',
    DESKTOPET_SCREENSHOT_MODE: 'QINGYU_SCREENSHOT_MODE',
    DESKTOPET_PET_POSE: 'QINGYU_PET_POSE',
  }),
});
const MIGRATION_MARKER = 'desktopet-migration.json';
const STARTUP_MIGRATION_MARKER = 'desktopet-startup-migration.json';

function readDiagnosticEnvironment(environment = process.env) {
  return Object.fromEntries(Object.entries(LEGACY_COMPATIBILITY.environment).map(([current, previous]) => [
    current, environment[current] ?? environment[previous] ?? '',
  ]));
}

function migrateBuiltInName(value, fallback = 'Desktopet') {
  const name = String(value || '').trim();
  return LEGACY_COMPATIBILITY.builtInNames.some((previous) => previous.toLowerCase() === name.toLowerCase())
    ? fallback : value;
}

function readObject(filename) {
  let contents;
  try {
    contents = fs.readFileSync(filename, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return { exists: false, valid: false };
    throw error;
  }
  try {
    const value = JSON.parse(contents);
    return { exists: true, valid: Boolean(value && typeof value === 'object' && !Array.isArray(value)), value, contents };
  } catch {
    return { exists: true, valid: false };
  }
}

function writeAtomic(filename, contents) {
  const temporary = `${filename}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, contents, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    fs.renameSync(temporary, filename);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}

function writeObject(filename, value) {
  writeAtomic(filename, JSON.stringify(value, null, 2));
}

function migrateLegacyProfile(dataRoot, targetDirectory) {
  fs.mkdirSync(targetDirectory, { recursive: true });
  const marker = path.join(targetDirectory, MIGRATION_MARKER);
  if (fs.existsSync(marker)) return { migrated: false, reason: 'already-checked' };
  const sourceDirectory = LEGACY_COMPATIBILITY.profileDirectories
    .map((name) => path.join(dataRoot, name))
    .find((directory) => ['settings.json', 'deepseek-key.bin', 'Local State']
      .some((name) => fs.existsSync(path.join(directory, name))));
  if (!sourceDirectory) {
    writeObject(marker, { version: 1 });
    return { migrated: false, reason: 'no-source' };
  }

  const sourceSettings = readObject(path.join(sourceDirectory, 'settings.json'));
  const targetSettingsPath = path.join(targetDirectory, 'settings.json');
  const targetSettings = readObject(targetSettingsPath);
  if (sourceSettings.valid && (!targetSettings.exists || targetSettings.valid)) {
    writeObject(targetSettingsPath, { ...sourceSettings.value, ...(targetSettings.value || {}) });
  }

  const targetStatePath = path.join(targetDirectory, 'Local State');
  const targetState = readObject(targetStatePath);
  const targetKeyPath = path.join(targetDirectory, 'deepseek-key.bin');
  const hasTargetEncryption = targetState.valid && Object.hasOwn(targetState.value, 'os_crypt');
  let copiedKey = false;
  if (!fs.existsSync(targetKeyPath) && !hasTargetEncryption && (!targetState.exists || targetState.valid)) {
    const sourceState = readObject(path.join(sourceDirectory, 'Local State'));
    const encryption = sourceState.valid ? sourceState.value.os_crypt : null;
    const sourceKeyPath = path.join(sourceDirectory, 'deepseek-key.bin');
    if (encryption && typeof encryption === 'object' && !Array.isArray(encryption)
      && typeof encryption.encrypted_key === 'string' && encryption.encrypted_key.length > 0
      && fs.existsSync(sourceKeyPath) && fs.statSync(sourceKeyPath).isFile() && fs.statSync(sourceKeyPath).size > 0) {
      const temporaryKey = `${targetKeyPath}.${randomUUID()}.tmp`;
      let installedState = false;
      try {
        fs.copyFileSync(sourceKeyPath, temporaryKey, fs.constants.COPYFILE_EXCL);
        // The key becomes visible only after its complete copy and matching crypto context are ready.
        writeObject(targetStatePath, { ...(targetState.value || {}), os_crypt: encryption });
        installedState = true;
        fs.linkSync(temporaryKey, targetKeyPath);
        copiedKey = true;
      } catch (error) {
        if (installedState && !fs.existsSync(targetKeyPath)) {
          if (targetState.exists) writeAtomic(targetStatePath, targetState.contents);
          else fs.rmSync(targetStatePath, { force: true });
        }
        throw error;
      } finally {
        fs.rmSync(temporaryKey, { force: true });
      }
    }
  }
  writeObject(marker, { version: 1 });
  return { migrated: true, copiedKey };
}

function migrateLegacyLoginItem(app, enabled, { platform = process.platform, execPath = process.execPath, preview = false } = {}) {
  if (platform !== 'win32' || !app.isPackaged || preview) return false;
  const marker = path.join(app.getPath('userData'), STARTUP_MIGRATION_MARKER);
  if (fs.existsSync(marker)) return false;
  app.setLoginItemSettings({ name: 'Desktopet', path: execPath, openAtLogin: Boolean(enabled) });
  for (const name of LEGACY_COMPATIBILITY.startupEntryNames) {
    app.setLoginItemSettings({ name, openAtLogin: false });
  }
  writeObject(marker, { version: 1 });
  return true;
}

module.exports = {
  LEGACY_COMPATIBILITY, MIGRATION_MARKER, STARTUP_MIGRATION_MARKER,
  readDiagnosticEnvironment, migrateBuiltInName, migrateLegacyProfile, migrateLegacyLoginItem,
};
