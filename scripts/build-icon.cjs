const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const assetsDirectory = path.resolve(__dirname, '..', 'assets');
const sizes = [256, 128, 64, 48, 32, 24, 16];

function encodeIco(images) {
  const header = Buffer.alloc(6 + 16 * images.length);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach(({ size, png }, index) => {
    const entry = 6 + 16 * index;
    header.writeUInt8(size === 256 ? 0 : size, entry);
    header.writeUInt8(size === 256 ? 0 : size, entry + 1);
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(png.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += png.length;
  });
  return Buffer.concat([header, ...images.map(({ png }) => png)]);
}

async function renderIcons() {
  const { app, BrowserWindow } = require('electron');
  const profile = process.env.DESKTOPET_ICON_BUILD_PROFILE;
  if (!profile) throw new Error('Run npm run build:icon to use an isolated profile.');
  app.setPath('userData', profile);
  for (const name of ['sessionData', 'logs', 'crashDumps']) {
    const directory = path.join(profile, name);
    fs.mkdirSync(directory, { recursive: true });
    app.setPath(name, directory);
  }
  app.disableHardwareAcceleration();
  await app.whenReady();
  const template = fs.readFileSync(path.join(assetsDirectory, 'icon.svg'), 'utf8');
  const portraitReference = 'href="character.png"';
  if (template.split(portraitReference).length !== 2) throw new Error('The icon must reference character.png exactly once.');
  const portrait = fs.readFileSync(path.join(assetsDirectory, 'character.png')).toString('base64');
  const svg = template.replace(portraitReference, `href="data:image/png;base64,${portrait}"`);
  const source = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
  const window = new BrowserWindow({
    show: false,
    width: 512,
    height: 512,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.session.webRequest.onBeforeRequest(
    { urls: ['http://*/*', 'https://*/*'] }, (_details, callback) => callback({ cancel: true }),
  );
  await window.loadURL('data:text/html;charset=utf-8,<meta charset="utf-8"><title>Icon export</title>');
  const rendered = await window.webContents.executeJavaScript(`(async () => {
    const image = new Image();
    image.src = ${JSON.stringify(source)};
    await image.decode();
    return ${JSON.stringify([512, ...sizes])}.map(size => {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = size;
      const context = canvas.getContext('2d');
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = 'high';
      context.drawImage(image, 0, 0, size, size);
      return { size, data: canvas.toDataURL('image/png').split(',')[1] };
    });
  })()`);
  const images = rendered.map(({ size, data }) => ({ size, png: Buffer.from(data, 'base64') }));
  fs.writeFileSync(path.join(assetsDirectory, 'icon.png'), images[0].png);
  fs.writeFileSync(path.join(assetsDirectory, 'icon.ico'), encodeIco(images.slice(1)));
  console.log(`Exported icon.png (512px), icon.ico (${sizes.join(', ')}px).`);
  window.destroy();
  app.quit();
}

function buildIcons() {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'desktopet-icon-build-'));
  try {
    const environment = { ...process.env, DESKTOPET_ICON_BUILD_PROFILE: profile };
    delete environment.ELECTRON_RUN_AS_NODE;
    const result = spawnSync(require('electron'), [__filename, '--icon-worker'], {
      cwd: path.resolve(__dirname, '..'), env: environment, stdio: 'inherit', windowsHide: true, timeout: 60000,
    });
    if (result.error) throw result.error;
    process.exitCode = result.status ?? 1;
  } finally {
    const resolved = path.resolve(profile);
    if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith('desktopet-icon-build-')) {
      throw new Error('Unexpected icon build profile path.');
    }
    fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
}

if (process.versions.electron && process.argv.includes('--icon-worker')) {
  renderIcons().catch(error => {
    console.error(error);
    require('electron').app.exit(1);
  });
} else if (process.versions.electron) {
  console.error('Run npm run build:icon with the Node.js entry point.');
  require('electron').app.exit(1);
} else {
  buildIcons();
}
