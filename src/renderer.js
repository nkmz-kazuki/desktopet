const api = window.petAPI;
const modelConfig = window.modelConfig;
const FLOATING_BUBBLE_ENABLED = false;
const queryParams = new URLSearchParams(window.location.search);
if (queryParams.has('preview')) document.body.classList.add('preview');

const els = {
  chatPanel: document.querySelector('#chatPanel'),
  settingsPanel: document.querySelector('#settingsPanel'),
  contextToolbar: document.querySelector('#contextToolbar'),
  petVisual: document.querySelector('#petVisual'),
  petImage: document.querySelector('#petImage'),
  petHappyImage: document.querySelector('#petHappyImage'),
  speechBubble: document.querySelector('#speechBubble'),
  bubbleText: document.querySelector('#bubbleText'),
  sparkles: document.querySelector('#sparkles'),
  messages: document.querySelector('#messages'),
  chatForm: document.querySelector('#chatForm'),
  chatInput: document.querySelector('#chatInput'),
  sendBtn: document.querySelector('#sendBtn'),
  settingsForm: document.querySelector('#settingsForm'),
  settingsFeedback: document.querySelector('#settingsFeedback'),
  petNameInput: document.querySelector('#petNameInput'),
  cityInput: document.querySelector('#cityInput'),
  apiKeyInput: document.querySelector('#apiKeyInput'),
  modelInput: document.querySelector('#modelInput'),
  proactiveInput: document.querySelector('#proactiveInput'),
  voiceInput: document.querySelector('#voiceInput'),
  alwaysOnTopInput: document.querySelector('#alwaysOnTopInput'),
  launchInput: document.querySelector('#launchInput'),
  conversationDirectoryInput: document.querySelector('#conversationDirectoryInput'),
};

const OPACITY_FIELDS = {
  petOpacity: ['--pet-opacity', 100],
  chatOpacity: ['--chat-opacity', 80],
  messageOpacity: ['--message-opacity', 88],
  inputOpacity: ['--input-opacity', 92],
  textOpacity: ['--text-opacity', 100],
  bubbleOpacity: ['--bubble-opacity', 50],
};

let settings = {
  petName: '鲸鱼娘',
  city: '上海',
  modelId: modelConfig.DEFAULT_MODEL,
  proactiveEnabled: true,
  voiceEnabled: false,
  scale: 1,
  ...Object.fromEntries(Object.entries(OPACITY_FIELDS).map(([name, [, value]]) => [name, value])),
};
let bubbleTimer;
let happyPoseTimer;
let deepSeekPoseActive = false;
let chatBusy = false;
let lastReminderAt = Date.now();
let greetingIndex = 0;
let ignoringMouse = true;
let dragState = null;
let alphaCanvas;
let alphaContext;
let settingsSelects = [];
let desktopLayout = null;
let lastRequestedScale = null;

const COMPANION_GREETING_INTERVAL_MS = 60 * 1000;
const proactiveLines = [
  '老师，我在这里。',
  '老师，今天也一起加油吧。',
  '老师，要不要聊两句？',
  '老师，见到你真好。',
  '老师，记得偶尔眨眨眼。',
  '老师，忙得怎么样啦？',
  '老师，今天有没有遇到开心的小事？',
  '老师，先把手边这一件做完就好。',
  '老师，喝口水吧，我陪你歇一小会儿。',
  '老师，窗外现在是什么颜色呢？',
  '老师，要不要伸个懒腰？',
  '老师，有什么想法都可以慢慢说。',
  '老师，给今天的自己一点耐心。',
  '老师，需要我陪你梳理思路吗？',
  '老师，一点点进展也值得记下来。',
  '老师，我在这里等你叫我。',
  '老师，忙完这一段，记得看看远处。',
  '老师，想听点轻松的话题吗？',
  '老师，今天最想完成哪件小事？',
  '老师，肩膀放松一点，深呼吸。',
  '老师，要不要把灵感先记下来？',
  '老师，这段旅程我陪着你。',
  '老师，愿今天的风也温柔一点。',
];

const initialGreetings = [
  'Hi，我是 {name}，今天从哪里开始？',
  '嗨，我是 {name}。今天想先做哪件事？',
  'Hi，我是 {name}，现在想聊些什么？',
  '见到你啦，今天想从哪里开始？',
];

const speechInitialGreetings = [
  '今天从哪里开始？',
  '今天想先做哪件事？',
  '现在想聊些什么？',
  '今天也一起慢慢来吧。',
];

function randomInitialGreeting() {
  return initialGreetings[Math.floor(Math.random() * initialGreetings.length)].replace('{name}', settings.petName);
}

function setMouseIgnore(ignore) {
  if (ignoringMouse === ignore) return;
  ignoringMouse = ignore;
  api?.setIgnoreMouse(ignore);
}

function isOpaquePixel(clientX, clientY) {
  if (!alphaContext || !els.petImage.complete || !els.petHappyImage.complete) return true;
  const rect = els.petVisual.getBoundingClientRect();
  const x = Math.floor((clientX - rect.left) / rect.width * els.petImage.naturalWidth);
  const y = Math.floor((clientY - rect.top) / rect.height * els.petImage.naturalHeight);
  if (x < 0 || x >= alphaCanvas.width || y < 0 || y >= alphaCanvas.height) return false;
  return alphaContext.getImageData(x, y, 1, 1).data[3] > 18;
}

function prepareAlphaMap() {
  if (!els.petImage.complete || !els.petHappyImage.complete) return;
  const imageWidth = els.petImage.naturalWidth;
  const imageHeight = els.petImage.naturalHeight;
  const happyStyle = window.getComputedStyle(els.petHappyImage);
  const registration = new DOMMatrixReadOnly(happyStyle.transform);
  const offsetX = registration.e * imageWidth / parseFloat(happyStyle.width);
  const offsetY = registration.f * imageHeight / parseFloat(happyStyle.height);
  alphaCanvas = document.createElement('canvas');
  alphaCanvas.width = imageWidth + Math.max(0, Math.ceil(offsetX));
  alphaCanvas.height = imageHeight + Math.max(0, Math.ceil(offsetY));
  alphaContext = alphaCanvas.getContext('2d', { willReadFrequently: true });
  alphaContext.drawImage(els.petImage, 0, 0);
  alphaContext.save();
  alphaContext.setTransform(
    registration.a, registration.b, registration.c, registration.d,
    offsetX, offsetY,
  );
  alphaContext.drawImage(els.petHappyImage, 0, 0, imageWidth, imageHeight);
  alphaContext.restore();
}

function updateMousePassThrough(event) {
  const target = document.elementFromPoint(event.clientX, event.clientY);
  const overPanel = Boolean(target?.closest('.side-panel.open, .settings-panel.open, .context-toolbar.open'));
  const overPet = isOpaquePixel(event.clientX, event.clientY);
  setMouseIgnore(!(overPanel || overPet || dragState));
}

function applySettings(next) {
  settings = { ...settings, ...next };
  settings.modelId = modelConfig.normalizeModelId(settings.modelId);
  applyVisualSettings(settings);
  syncPetName(settings.petName);
}

function applyVisualSettings(values) {
  const requestedScale = Number(values.scale || 1);
  document.documentElement.style.setProperty('--pet-scale', String(requestedScale));
  if (api.previewScale && requestedScale !== lastRequestedScale) {
    lastRequestedScale = requestedScale;
    api.previewScale(requestedScale);
  } else if (desktopLayout && requestedScale === lastRequestedScale) {
    document.documentElement.style.setProperty('--pet-scale', String(desktopLayout.scale));
  }
  for (const [name, [variable, fallback]] of Object.entries(OPACITY_FIELDS)) {
    const value = Number(values[name] ?? fallback);
    document.documentElement.style.setProperty(variable, String(Math.max(0, Math.min(100, value)) / 100));
  }
}

function previewVisualSettings() {
  const values = { scale: settings.scale };
  for (const name of Object.keys(OPACITY_FIELDS)) {
    values[name] = Number(document.querySelector(`#${name}Input`).value);
    document.querySelector(`#${name}Value`).textContent = `${values[name]}%`;
  }
  applyVisualSettings(values);
}

function syncPetName(name) {
  const cleanName = String(name || '鲸鱼娘').trim() || '鲸鱼娘';
  document.querySelectorAll('[data-pet-name]').forEach((element) => {
    element.textContent = cleanName;
  });
  document.querySelectorAll('[data-pet-name-placeholder]').forEach((element) => {
    element.placeholder = element.dataset.petNamePlaceholder.replace('{name}', cleanName);
  });
  document.title = `${cleanName} 桌面陪伴`;
}

function speak(text) {
  if (!settings.voiceEnabled || !('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(String(text).replace(/[*#`]/g, '').slice(0, 180));
  utterance.lang = 'zh-CN';
  utterance.rate = 1.03;
  utterance.pitch = 1.08;
  window.speechSynthesis.speak(utterance);
}

function showBubble(text, { duration = 7500, voice = false } = {}) {
  clearTimeout(bubbleTimer);
  bubbleTimer = null;
  els.bubbleText.textContent = String(text ?? '');
  if (!FLOATING_BUBBLE_ENABLED) {
    els.speechBubble.classList.remove('visible');
    return;
  }
  els.speechBubble.classList.add('visible');
  if (voice) speak(text);
  bubbleTimer = setTimeout(() => els.speechBubble.classList.remove('visible'), duration);
}

function showSettingsFeedback(text = '', { error = false } = {}) {
  const message = String(text ?? '');
  els.settingsFeedback.setAttribute('role', error ? 'alert' : 'status');
  els.settingsFeedback.setAttribute('aria-live', error ? 'assertive' : 'polite');
  els.settingsFeedback.classList.toggle('error', error);
  els.settingsFeedback.textContent = message;
  els.settingsFeedback.hidden = !message;
}

function sparkle(clientX, clientY) {
  const stageRect = document.querySelector('#petStage').getBoundingClientRect();
  for (let index = 0; index < 9; index += 1) {
    const spark = document.createElement('i');
    spark.className = 'spark';
    spark.style.left = `${clientX - stageRect.left}px`;
    spark.style.top = `${clientY - stageRect.top}px`;
    spark.style.setProperty('--dx', `${Math.round((Math.random() - .5) * 125)}px`);
    spark.style.setProperty('--dy', `${Math.round(-25 - Math.random() * 90)}px`);
    els.sparkles.appendChild(spark);
    setTimeout(() => spark.remove(), 1000);
  }
}

function animateHello() {
  els.petVisual.classList.remove('hello');
  void els.petVisual.offsetWidth;
  els.petVisual.classList.add('hello');
  setTimeout(() => els.petVisual.classList.remove('hello'), 680);
}

function updateHappyPose() {
  els.petVisual.classList.toggle('happy', deepSeekPoseActive || Boolean(happyPoseTimer));
}

function showHappyPose(duration = 800) {
  clearTimeout(happyPoseTimer);
  happyPoseTimer = setTimeout(() => {
    happyPoseTimer = null;
    updateHappyPose();
  }, duration);
  updateHappyPose();
}

function holdHappyPose(active) {
  deepSeekPoseActive = Boolean(active);
  updateHappyPose();
}

function addMessage(role, text, id = '') {
  const row = document.createElement('div');
  row.className = `message ${role}`;
  if (id) row.id = id;
  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  bubble.textContent = text;
  row.appendChild(bubble);
  els.messages.appendChild(row);
  els.messages.scrollTop = els.messages.scrollHeight;
  return row;
}

function addTyping() {
  const row = document.createElement('div');
  row.className = 'message assistant';
  row.id = 'typingMessage';
  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  bubble.innerHTML = '<span class="typing-dots"><i></i><i></i><i></i></span>';
  row.appendChild(bubble);
  els.messages.appendChild(row);
  els.messages.scrollTop = els.messages.scrollHeight;
}

function openChat() {
  closeSettingsSelects(true);
  applyVisualSettings(settings);
  els.settingsPanel.classList.remove('open');
  els.chatPanel.classList.add('open');
  setMouseIgnore(false);
  setTimeout(() => els.chatInput.focus(), 220);
}

function toggleChat() {
  hideContextToolbar();
  if (els.chatPanel.classList.contains('open')) {
    els.chatPanel.classList.remove('open');
    els.chatInput.blur();
    return;
  }
  openChat();
}

function closePanels() {
  closeSettingsSelects(true);
  applyVisualSettings(settings);
  els.chatPanel.classList.remove('open');
  els.settingsPanel.classList.remove('open');
}

function hideContextToolbar() {
  els.contextToolbar.classList.remove('open');
}

function showContextToolbar(event) {
  closeSettingsSelects();
  const width = els.contextToolbar.offsetWidth;
  const height = els.contextToolbar.offsetHeight;
  const visible = desktopLayout?.visibleBounds || { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight };
  const minX = visible.x + 4;
  const minY = visible.y + 4;
  const maxX = Math.max(minX, visible.x + visible.width - width - 4);
  const maxY = Math.max(minY, visible.y + visible.height - height - 4);
  const x = Math.max(minX, Math.min(maxX, event.clientX + 8));
  const y = Math.max(minY, Math.min(maxY, event.clientY + 8));
  els.contextToolbar.style.left = `${x}px`;
  els.contextToolbar.style.top = `${y}px`;
  els.contextToolbar.classList.add('open');
  setMouseIgnore(false);
}

function populateSettingsForm() {
  els.petNameInput.value = settings.petName || '';
  els.cityInput.value = settings.city || '';
  els.apiKeyInput.value = '';
  els.apiKeyInput.placeholder = settings.apiKeySet ? '已安全保存；留空即不修改' : 'sk-…';
  syncModelSettings();
  for (const [name, [, fallback]] of Object.entries(OPACITY_FIELDS)) {
    const value = settings[name] ?? fallback;
    document.querySelector(`#${name}Input`).value = String(value);
    document.querySelector(`#${name}Value`).textContent = `${value}%`;
  }
  els.conversationDirectoryInput.value = settings.conversationDirectory || '';
  els.proactiveInput.checked = Boolean(settings.proactiveEnabled);
  els.voiceInput.checked = Boolean(settings.voiceEnabled);
  els.alwaysOnTopInput.checked = Boolean(settings.alwaysOnTop);
  els.launchInput.checked = Boolean(settings.launchAtLogin);
}

function openSettings() {
  closeSettingsSelects();
  hideContextToolbar();
  showSettingsFeedback();
  populateSettingsForm();
  els.chatPanel.classList.remove('open');
  els.settingsPanel.classList.add('open');
  setMouseIgnore(false);
}

function formatWeather(weather) {
  const region = weather.region && weather.region !== weather.city ? ` · ${weather.region}` : '';
  return `${weather.city}${region}现在 ${weather.condition}，${weather.temperature}℃，体感 ${weather.feelsLike}℃。\n今天 ${weather.low}～${weather.high}℃，降水概率 ${weather.rainChance}%。`;
}

async function showWeather(force = false, addToChat = false) {
  showBubble('我正在看看窗外的天气…', { duration: 5000 });
  try {
    const weather = await api.getWeather(force);
    const message = formatWeather(weather);
    showBubble(message, { duration: 10500, voice: addToChat });
    if (addToChat) addMessage('assistant', message);
    return weather;
  } catch (error) {
    const message = error.message || '天气暂时迷路了，稍后再试试。';
    showBubble(message);
    if (addToChat) addMessage('system', message);
    return null;
  }
}

function isWeatherQuestion(message) {
  return window.chatIntent.isWeatherQuestion(message, settings.city);
}

function isTimeQuestion(message) {
  return window.chatIntent.isTimeQuestion(message);
}

async function sendChat(message) {
  const value = String(message || '').trim();
  if (!value || chatBusy) return;
  openChat();
  addMessage('user', value);
  els.chatInput.value = '';
  els.chatInput.style.height = 'auto';

  const usesModel = !isWeatherQuestion(value) && !isTimeQuestion(value);
  chatBusy = true;
  els.sendBtn.disabled = true;
  if (usesModel) {
    holdHappyPose(true);
    els.petVisual.classList.add('thinking');
    showBubble('老师，让我想想...', { duration: 175000 });
  } else if (isWeatherQuestion(value)) {
    showBubble('我正在看看窗外的天气…', { duration: 175000 });
  }
  addTyping();
  try {
    const result = await api.sendChat(value);
    if (result.archiveError) addMessage('system', result.archiveError);
    if (result.error) throw new Error(result.error);
    document.querySelector('#typingMessage')?.remove();
    addMessage(result.kind === 'model' ? 'assistant answer' : 'assistant', result.text);
    showBubble(result.kind === 'model' ? '老师，complete！' : result.text, {
      duration: result.kind === 'model' ? 5200 : 10500, voice: true,
    });
  } catch (error) {
    document.querySelector('#typingMessage')?.remove();
    const message = error.message || '暂时没能连上聊天服务，请稍后再试。';
    addMessage('system', message);
    showBubble(message, { duration: 9500 });
    if (/API Key|401|authentication/i.test(message)) setTimeout(openSettings, 700);
  } finally {
    chatBusy = false;
    els.sendBtn.disabled = false;
    els.petVisual.classList.remove('thinking');
    holdHappyPose(false);
    els.chatInput.focus();
  }
}

function inQuietHours(date = new Date()) {
  const hour = date.getHours();
  const start = Number(settings.quietStart ?? 23);
  const end = Number(settings.quietEnd ?? 8);
  if (start === end) return false;
  return start < end ? hour >= start && hour < end : hour >= start || hour < end;
}

function proactiveTick() {
  if (!FLOATING_BUBBLE_ENABLED || !settings.proactiveEnabled || inQuietHours() || chatBusy) return;
  if (Date.now() - lastReminderAt < COMPANION_GREETING_INTERVAL_MS) return;
  lastReminderAt = Date.now();
  const template = proactiveLines[greetingIndex];
  greetingIndex = (greetingIndex + 1) % proactiveLines.length;
  showBubble(template, { duration: 8500, voice: true });
  animateHello();
}

async function saveSettings(event) {
  event.preventDefault();
  closeSettingsSelects();
  showSettingsFeedback();
  const next = {
    petName: els.petNameInput.value,
    city: els.cityInput.value,
    apiKey: els.apiKeyInput.value,
    modelId: modelConfig.normalizeModelId(els.modelInput.value),
    ...(FLOATING_BUBBLE_ENABLED ? {
      proactiveEnabled: els.proactiveInput.checked,
      voiceEnabled: els.voiceInput.checked,
    } : {}),
    alwaysOnTop: els.alwaysOnTopInput.checked,
    launchAtLogin: els.launchInput.checked,
    quietStart: settings.quietStart ?? 23,
    quietEnd: settings.quietEnd ?? 8,
    conversationDirectory: els.conversationDirectoryInput.value,
    ...Object.fromEntries(Object.keys(OPACITY_FIELDS)
      .filter((name) => FLOATING_BUBBLE_ENABLED || name !== 'bubbleOpacity')
      .map((name) => [name, Number(document.querySelector(`#${name}Input`).value)])),
  };
  try {
    const saved = await api.saveSettings(next);
    applySettings(saved);
    closeSettingsSelects(true);
    els.settingsPanel.classList.remove('open');
    showBubble('设置保存好了。', { duration: 5200 });
  } catch (error) {
    showSettingsFeedback(error.message || '设置保存失败了。', { error: true });
  }
}

function beginDrag(event) {
  if (event.button !== 0) return;
  dragState = { screenX: event.screenX, screenY: event.screenY, moved: 0 };
  els.petVisual.classList.add('dragging');
  els.petVisual.setPointerCapture(event.pointerId);
  setMouseIgnore(false);
}

function moveDrag(event) {
  if (!dragState) return;
  const dx = event.screenX - dragState.screenX;
  const dy = event.screenY - dragState.screenY;
  if (dx || dy) {
    api.moveBy(dx, dy);
    dragState.screenX = event.screenX;
    dragState.screenY = event.screenY;
    dragState.moved += Math.abs(dx) + Math.abs(dy);
  }
}

function endDrag(event) {
  if (!dragState) return;
  const moved = dragState.moved;
  dragState = null;
  els.petVisual.classList.remove('dragging');
  try { els.petVisual.releasePointerCapture(event.pointerId); } catch { /* already released */ }
  if (moved < 8) {
    sparkle(event.clientX, event.clientY);
    showHappyPose(800);
    toggleChat();
  }
}

function wireEvents() {
  els.petImage.addEventListener('load', prepareAlphaMap);
  els.petHappyImage.addEventListener('load', prepareAlphaMap);
  if (els.petImage.complete && els.petHappyImage.complete) prepareAlphaMap();
  window.addEventListener('mousemove', updateMousePassThrough);
  window.addEventListener('blur', () => {
    if (!els.chatPanel.classList.contains('open') && !els.settingsPanel.classList.contains('open') && !els.contextToolbar.classList.contains('open')) {
      setMouseIgnore(true);
    }
  });

  els.petVisual.addEventListener('pointerdown', beginDrag);
  els.petVisual.addEventListener('pointermove', moveDrag);
  els.petVisual.addEventListener('pointerup', endDrag);
  els.petVisual.addEventListener('pointercancel', endDrag);
  els.petVisual.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    showContextToolbar(event);
  });

  document.addEventListener('pointerdown', (event) => {
    if (!event.target.closest('.context-toolbar')) hideContextToolbar();
  });
  document.querySelector('#contextSettingsBtn').addEventListener('click', openSettings);
  document.querySelector('#contextHideBtn').addEventListener('click', () => {
    hideContextToolbar();
    closePanels();
    api.hide();
  });
  document.querySelector('#contextQuitBtn').addEventListener('click', () => api.quit());
  document.querySelector('#closeChatBtn').addEventListener('click', closePanels);
  document.querySelector('#closeSettingsBtn').addEventListener('click', closePanels);
  document.querySelector('#clearChatBtn').addEventListener('click', async () => {
    await api.clearChat();
    els.messages.replaceChildren();
    addMessage('assistant', randomInitialGreeting());
  });

  els.chatForm.addEventListener('submit', (event) => { event.preventDefault(); sendChat(els.chatInput.value); });
  els.chatInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      els.chatForm.requestSubmit();
    }
  });
  els.chatInput.addEventListener('input', () => {
    els.chatInput.style.height = 'auto';
    els.chatInput.style.height = `${Math.min(els.chatInput.scrollHeight, 95)}px`;
  });

  els.settingsForm.addEventListener('submit', saveSettings);
  for (const name of Object.keys(OPACITY_FIELDS)) {
    document.querySelector(`#${name}Input`).addEventListener('input', previewVisualSettings);
  }
  document.querySelector('#chooseConversationDirectoryBtn').addEventListener('click', async () => {
    showSettingsFeedback();
    try {
      const directory = await api.chooseConversationDirectory();
      if (directory) els.conversationDirectoryInput.value = directory;
    } catch (error) {
      showSettingsFeedback(error.message || '暂时无法选择文件夹。', { error: true });
    }
  });
  document.querySelector('#apiKeyHelpBtn').addEventListener('click', async () => {
    showSettingsFeedback();
    try {
      await api.openApiKeys();
    } catch (error) {
      showSettingsFeedback(error.message || '暂时无法打开密钥页面。', { error: true });
    }
  });
  document.querySelector('#openConversationFolderBtn').addEventListener('click', async () => {
    showSettingsFeedback();
    try {
      await api.openConversationFolder();
    } catch (error) {
      showSettingsFeedback(error.message || '暂时无法打开记录文件夹。', { error: true });
    }
  });
  document.querySelector('#clearKeyBtn').addEventListener('click', async () => {
    showSettingsFeedback();
    try {
      await api.clearApiKey();
      settings.apiKeySet = false;
      els.apiKeyInput.value = '';
      els.apiKeyInput.placeholder = 'sk-…';
      showSettingsFeedback('已清除保存的 API Key。');
    } catch (error) {
      showSettingsFeedback(error.message || '暂时无法清除 API Key。', { error: true });
    }
  });

  api.onOpenChat(openChat);
  api.onOpenSettings(openSettings);
  api.onOpenContextPreview(() => showContextToolbar({ clientX: 590, clientY: 420 }));
  api.onRequestWeather(() => {
    const addToChat = !FLOATING_BUBBLE_ENABLED;
    if (addToChat) openChat();
    return showWeather(true, addToChat);
  });
}

async function init() {
  els.speechBubble.hidden = !FLOATING_BUBBLE_ENABLED;
  document.querySelectorAll('[data-floating-bubble-setting]').forEach((element) => {
    element.hidden = !FLOATING_BUBBLE_ENABLED;
  });
  const selectContext = {
    panel: els.settingsPanel,
    scrollBoundary: document.querySelector('#settingsContent'),
    footer: document.querySelector('#settingsActions'),
  };
  settingsSelects = [
    window.customSelect.create({ ...selectContext, select: els.modelInput, options: modelConfig.MODEL_OPTIONS }),
  ];
  wireEvents();
  api.onDesktopLayout?.(applyDesktopLayout);
  try {
    applySettings(await api.getSettings());
  } catch {
    // Keep local defaults so the character can still render.
  }
  try {
    applyDesktopLayout(await api.getDesktopLayout?.());
  } catch {
    // The standalone preview retains its local layout.
  }
  if (queryParams.get('pose') === 'happy') holdHappyPose(true);
  const greeting = randomInitialGreeting();
  addMessage('assistant', greeting);
  if (FLOATING_BUBBLE_ENABLED) {
    const speechGreeting = speechInitialGreetings[Math.floor(Math.random() * speechInitialGreetings.length)];
    setTimeout(() => {
      if (!chatBusy) showBubble(speechGreeting, { duration: 9000 });
    }, 700);
    setInterval(proactiveTick, COMPANION_GREETING_INTERVAL_MS);
  }
}

init();

function syncModelSettings() {
  els.modelInput.value = modelConfig.normalizeModelId(settings.modelId);
  settingsSelects.forEach((control) => control.sync());
}

function closeSettingsSelects(restoreValues = false) {
  settingsSelects.forEach((control) => control.close());
  if (restoreValues) syncModelSettings();
}

function applyDesktopLayout(layout) {
  if (!layout || !Number.isFinite(layout.scale) || layout.scale <= 0 ||
      !layout.petStage || !layout.panel || !layout.greeting || !layout.visibleBounds) return;
  const fields = [layout.petStage.left, layout.petStage.top, layout.panel.left, layout.panel.top,
    layout.panel.width, layout.panel.height, layout.greeting.left, layout.greeting.top,
    layout.greeting.width, layout.visibleBounds.x, layout.visibleBounds.y,
    layout.visibleBounds.width, layout.visibleBounds.height];
  if (!fields.every(Number.isFinite) || layout.panel.width <= 0 || layout.panel.height <= 0 ||
      layout.visibleBounds.width <= 0 || layout.visibleBounds.height <= 0) return;
  closeSettingsSelects();
  hideContextToolbar();
  desktopLayout = layout;
  const style = document.documentElement.style;
  const pixels = {
    '--pet-stage-left': layout.petStage.left, '--pet-stage-top': layout.petStage.top,
    '--panel-left': layout.panel.left, '--panel-top': layout.panel.top,
    '--panel-width': layout.panel.width, '--panel-height': layout.panel.height,
    '--greeting-left': layout.greeting.left - layout.petStage.left,
    '--greeting-top': layout.greeting.top - layout.petStage.top,
    '--greeting-width': layout.greeting.width,
    '--greeting-max-height': Number.isFinite(layout.greeting.maxHeight) && layout.greeting.maxHeight > 0
      ? layout.greeting.maxHeight : 104,
  };
  for (const [property, value] of Object.entries(pixels)) style.setProperty(property, `${value}px`);
  style.setProperty('--pet-stage-right', 'auto');
  style.setProperty('--pet-stage-bottom', 'auto');
  style.setProperty('--greeting-right', 'auto');
  style.setProperty('--pet-scale', String(layout.scale));
  document.body.dataset.panelSide = layout.panelSide;
}
