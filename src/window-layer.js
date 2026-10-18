function applyWindowLayer(window, enabled, { raise = false, platform = process.platform } = {}) {
  if (!window || window.isDestroyed()) return;
  const topmost = Boolean(enabled);
  if (topmost && platform === 'win32') {
    // Reset Chromium's cached level when Windows has dropped the native topmost flag.
    window.setAlwaysOnTop(false);
  }
  // Windows' floating level can demote the window behind a non-topmost taskbar.
  window.setAlwaysOnTop(topmost, topmost && platform === 'win32' ? 'pop-up-menu' : 'floating');
  if (topmost && raise && window.isVisible() && !window.isMinimized()) window.moveTop();
}

module.exports = { applyWindowLayer };
