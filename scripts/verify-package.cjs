const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const asar = require('@electron/asar');

const root = path.resolve(__dirname, '..');
const metadata = require('../package.json');
const archive = path.join(root, 'dist', 'win-unpacked', 'resources', 'app.asar');
const installer = path.join(root, 'dist', `Desktopet-${metadata.version}-Setup.exe`);
const packaged = JSON.parse(asar.extractFile(archive, 'package.json'));
assert.equal(metadata.name, 'desktopet');
assert.equal(metadata.build.productName, 'Desktopet');
assert.equal(packaged.name, metadata.name);
assert.equal(packaged.version, metadata.version);
assert.equal(metadata.build.nsis.createDesktopShortcut, false);
assert.equal(metadata.build.nsis.shortcutName, 'Desktopet');

const files = ['src', 'assets'].flatMap(directory => fs.readdirSync(path.join(root, directory), { recursive: true })
  .filter(entry => fs.statSync(path.join(root, directory, entry)).isFile())
  .map(entry => `${directory}/${entry.replaceAll('\\', '/')}`));
for (const file of files) {
  assert.ok(asar.extractFile(archive, file).equals(fs.readFileSync(path.join(root, file))), `Packaged file differs: ${file}`);
}
const packagedFiles = asar.listPackage(archive).map(file => file.replaceAll('\\', '/').replace(/^\//, ''))
  .filter(file => !asar.statFile(archive, file).files).sort();
assert.deepEqual(packagedFiles, [...files, 'package.json'].sort(), 'Unexpected files in application archive');
const installerStat = fs.statSync(installer);
assert.ok(installerStat.size > 80 * 1024 * 1024, 'Installer is incomplete');
const descriptor = fs.openSync(installer, 'r');
try {
  const header = Buffer.alloc(2);
  fs.readSync(descriptor, header, 0, 2, 0);
  assert.equal(header.toString(), 'MZ');
} finally {
  fs.closeSync(descriptor);
}
console.log(JSON.stringify({ version: packaged.version, filesMatched: files.length, installer: path.basename(installer), bytes: installerStat.size }));
