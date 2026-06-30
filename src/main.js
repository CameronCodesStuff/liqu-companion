const { app, BrowserWindow, Tray, Menu, ipcMain, screen, nativeImage, globalShortcut, clipboard, desktopCapturer } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const Store = require('electron-store');

const store = new Store({
  defaults: {
    windowX: null,
    windowY: null,
    alwaysOnTop: true,
    clickThrough: false,
    size: 100,
    swaySpeed: 100,
    behavior: 'idle',
    expression: 'neutral',
    characterId: null,
    volume: 80,
    muted: false,
    chatterEnabled: true,
    watchClipboard: false,
    minimalMode: false,
    openAtLogin: false,
    aiProvider: 'anthropic',
    aiModel: '',
    apiKeys: {}, // { anthropic, openai, google, elevenlabs }
    ollamaUrl: 'http://localhost:11434',
    ollamaModel: 'llama3.2',
    memoryEnabled: false,
    chatMemory: [],         // rolling list of {role, content} summaries
    ttsEnabled: false,      // real API TTS (ElevenLabs/OpenAI) vs browser speech
    ttsProvider: 'openai',  // 'openai' | 'elevenlabs'
    ttsVoice: '',
    visionEnabled: false,
    walkEnabled: false,
    physicsReactions: true,
    idleVariation: true,
    eyeTracking: true,
  },
});

let mainWindow = null;
let tray = null;

const WINDOW_WIDTH = 420;
const WINDOW_HEIGHT = 600;
const SNAP_MARGIN = 40; // px from a screen edge that triggers snapping

// Bundled models ship read-only inside the app; imported ones go in userData so they
// survive updates/reinstalls and the app folder never needs write access.
const BUNDLED_MODEL_DIR = path.join(__dirname, '..', 'assets', 'model');
let IMPORTED_MODEL_DIR;

function createWindow() {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;

  const savedX = store.get('windowX');
  const savedY = store.get('windowY');
  const x = Number.isFinite(savedX) ? savedX : screenWidth - WINDOW_WIDTH - 40;
  const y = Number.isFinite(savedY) ? savedY : screenHeight - WINDOW_HEIGHT - 40;

  mainWindow = new BrowserWindow({
    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT,
    x,
    y,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: false,
    resizable: true,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.setAlwaysOnTop(store.get('alwaysOnTop'), 'screen-saver');
  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  mainWindow.setIgnoreMouseEvents(store.get('clickThrough'), { forward: true });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  mainWindow.on('moved', () => {
    const [px, py] = mainWindow.getPosition();
    store.set('windowX', px);
    store.set('windowY', py);
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function createTray() {
  const iconPath = path.join(__dirname, '..', 'assets', 'icons', 'tray.png');
  let trayIcon;
  try {
    trayIcon = nativeImage.createFromPath(iconPath);
  } catch (e) {
    trayIcon = nativeImage.createEmpty();
  }

  tray = new Tray(trayIcon.isEmpty() ? nativeImage.createEmpty() : trayIcon);
  tray.setToolTip('Liqu Companion');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show / Hide  (Alt+Shift+L)',
      click: () => toggleVisibility(),
    },
    {
      label: 'Toggle click-through',
      click: () => {
        const next = !store.get('clickThrough');
        store.set('clickThrough', next);
        if (mainWindow) {
          mainWindow.setIgnoreMouseEvents(next, { forward: true });
          mainWindow.webContents.send('click-through-changed', next);
        }
      },
    },
    {
      label: 'Reset position',
      click: () => {
        if (!mainWindow) return;
        const { width, height } = screen.getPrimaryDisplay().workAreaSize;
        mainWindow.setPosition(width - WINDOW_WIDTH - 40, height - WINDOW_HEIGHT - 40);
      },
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => app.quit(),
    },
  ]);

  tray.setContextMenu(contextMenu);
}

function toggleVisibility() {
  if (!mainWindow) return;
  mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show();
}

// ---- IPC: window / settings basics ----
ipcMain.handle('settings:set-click-through', (_evt, value) => {
  store.set('clickThrough', value);
  if (mainWindow) mainWindow.setIgnoreMouseEvents(value, { forward: true });
  if (mainWindow) mainWindow.webContents.send('click-through-changed', value);
  return value;
});

// While click-through is ON, the whole window ignores the mouse — which would
// otherwise make it impossible to click the gear/settings to turn it back off.
// The renderer calls this to momentarily re-capture the mouse whenever the
// cursor is over an interactive element (gear or open panel), then releases it
// again on mouse-out. forward:true keeps move events flowing so hover detection
// in the renderer still works even while ignoring clicks.
ipcMain.handle('window:set-ignore-mouse', (_evt, ignore) => {
  if (mainWindow) mainWindow.setIgnoreMouseEvents(ignore, { forward: true });
});

ipcMain.handle('settings:set-always-on-top', (_evt, value) => {
  store.set('alwaysOnTop', value);
  if (mainWindow) mainWindow.setAlwaysOnTop(value, value ? 'screen-saver' : 'normal');
  if (mainWindow) mainWindow.webContents.send('always-on-top-changed', value);
  return value;
});

ipcMain.handle('window:drag-move', (_evt, { dx, dy }) => {
  if (!mainWindow) return;
  const [x, y] = mainWindow.getPosition();
  mainWindow.setPosition(x + dx, y + dy);
});

// Called when the user releases a drag — snaps the window to the nearest
// screen edge/corner if it's within SNAP_MARGIN px, like a real desktop pet.
ipcMain.handle('window:drag-end', () => {
  if (!mainWindow) return;
  const [x, y] = mainWindow.getPosition();
  const [w, h] = mainWindow.getSize();
  const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize;

  let nx = x;
  let ny = y;

  if (x < SNAP_MARGIN) nx = 0;
  else if (x + w > sw - SNAP_MARGIN) nx = sw - w;

  if (y < SNAP_MARGIN) ny = 0;
  else if (y + h > sh - SNAP_MARGIN) ny = sh - h;

  if (nx !== x || ny !== y) mainWindow.setPosition(nx, ny);
  return { x: nx, y: ny };
});

ipcMain.handle('app:quit', () => app.quit());

// ---- Open on system startup (native, cross-platform via Electron) ----
ipcMain.handle('startup:get', () => {
  try {
    return app.getLoginItemSettings().openAtLogin;
  } catch (e) {
    return false;
  }
});
ipcMain.handle('startup:set', (_evt, enabled) => {
  try {
    app.setLoginItemSettings({ openAtLogin: !!enabled, openAsHidden: false });
    store.set('openAtLogin', !!enabled);
    return app.getLoginItemSettings().openAtLogin;
  } catch (e) {
    return false;
  }
});

// ---- IPC: generic settings persistence (electron-store) ----
ipcMain.handle('settings:get-all', () => store.store);
ipcMain.handle('settings:set', (_evt, { key, value }) => {
  store.set(key, value);
  return true;
});

// ---- IPC: character library ----
ipcMain.handle('characters:list', () => {
  const list = [];

  try {
    for (const f of fs.readdirSync(BUNDLED_MODEL_DIR)) {
      if (f.toLowerCase().endsWith('.vrm')) {
        list.push({ id: `bundled:${f}`, label: f.replace(/\.vrm$/i, ''), source: 'bundled', file: f });
      }
    }
  } catch (e) { /* dir always exists in packaged builds */ }

  try {
    for (const f of fs.readdirSync(IMPORTED_MODEL_DIR)) {
      if (f.toLowerCase().endsWith('.vrm')) {
        list.push({ id: `imported:${f}`, label: f.replace(/\.vrm$/i, ''), source: 'imported', file: f });
      }
    }
  } catch (e) { /* ignore */ }

  return list;
});

ipcMain.handle('characters:get-path', (_evt, id) => {
  const [source, file] = String(id).split(':');
  const dir = source === 'imported' ? IMPORTED_MODEL_DIR : BUNDLED_MODEL_DIR;
  const fullPath = path.join(dir, path.basename(file)); // basename guards against path traversal
  return 'file://' + fullPath.replace(/\\/g, '/');
});

ipcMain.handle('characters:import', (_evt, { filename, data }) => {
  try {
    let safeName = path.basename(filename).replace(/[^a-zA-Z0-9_\-. ]/g, '_');
    if (!safeName.toLowerCase().endsWith('.vrm')) safeName += '.vrm';

    let finalName = safeName;
    let counter = 1;
    while (fs.existsSync(path.join(IMPORTED_MODEL_DIR, finalName))) {
      finalName = safeName.replace(/\.vrm$/i, `_${counter}.vrm`);
      counter++;
    }

    fs.writeFileSync(path.join(IMPORTED_MODEL_DIR, finalName), Buffer.from(data));
    return { ok: true, id: `imported:${finalName}`, label: finalName.replace(/\.vrm$/i, '') };
  } catch (e) {
    return { ok: false, error: String(e && e.message ? e.message : e) };
  }
});

ipcMain.handle('characters:delete', (_evt, id) => {
  try {
    const [source, file] = String(id).split(':');
    if (source !== 'imported') return { ok: false, error: 'Only imported characters can be deleted.' };
    fs.unlinkSync(path.join(IMPORTED_MODEL_DIR, path.basename(file)));
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e && e.message ? e.message : e) };
  }
});

ipcMain.handle('characters:rename', (_evt, { id, newLabel }) => {
  try {
    const [source, file] = String(id).split(':');
    if (source !== 'imported') return { ok: false, error: 'Only imported characters can be renamed.' };
    const safeLabel = String(newLabel).replace(/[^a-zA-Z0-9_\- ]/g, '_').trim();
    if (!safeLabel) return { ok: false, error: 'Invalid name.' };
    let newFile = safeLabel + '.vrm';
    let counter = 1;
    while (fs.existsSync(path.join(IMPORTED_MODEL_DIR, newFile)) && newFile !== file) {
      newFile = `${safeLabel}_${counter}.vrm`;
      counter++;
    }
    fs.renameSync(path.join(IMPORTED_MODEL_DIR, path.basename(file)), path.join(IMPORTED_MODEL_DIR, newFile));
    return { ok: true, id: `imported:${newFile}`, label: newFile.replace(/\.vrm$/i, '') };
  } catch (e) {
    return { ok: false, error: String(e && e.message ? e.message : e) };
  }
});

// ---------------------------------------------------------------------------
// AI chat proxy. Runs from the MAIN process (not the renderer) on purpose:
// it sidesteps browser CORS restrictions entirely, and keeps API keys out of
// the renderer's devtools/network tab. Keys are stored locally via
// electron-store — note this is plaintext-on-disk storage suitable for a
// personal local app, not a hardened secrets vault.
// ---------------------------------------------------------------------------
async function callAnthropic(apiKey, model, messages, system, image) {
  // messages may include an image (base64 PNG, no data: prefix) attached to
  // the latest user turn for vision.
  const apiMessages = messages.map((m) => ({ role: m.role, content: m.content }));
  if (image && apiMessages.length) {
    const last = apiMessages[apiMessages.length - 1];
    last.content = [
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: image } },
      { type: 'text', text: typeof last.content === 'string' ? last.content : 'What do you see?' },
    ];
  }
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: model || 'claude-sonnet-4-6',
      max_tokens: 400,
      system,
      messages: apiMessages,
    }),
  });
  if (!res.ok) throw new Error(`Anthropic API error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
}

async function callOpenAI(apiKey, model, messages, system, image) {
  const apiMessages = messages.map((m) => ({ role: m.role, content: m.content }));
  if (image && apiMessages.length) {
    const last = apiMessages[apiMessages.length - 1];
    last.content = [
      { type: 'text', text: typeof last.content === 'string' ? last.content : 'What do you see?' },
      { type: 'image_url', image_url: { url: `data:image/png;base64,${image}` } },
    ];
  }
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: model || (image ? 'gpt-4o' : 'gpt-4o-mini'),
      max_tokens: 400,
      messages: [{ role: 'system', content: system }, ...apiMessages],
    }),
  });
  if (!res.ok) throw new Error(`OpenAI API error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content?.trim() || '';
}

async function callGoogle(apiKey, model, messages, system, image) {
  const mdl = model || 'gemini-1.5-flash';
  const contents = messages.map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }));
  if (image && contents.length) {
    contents[contents.length - 1].parts.push({ inlineData: { mimeType: 'image/png', data: image } });
  }
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${mdl}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents,
      }),
    }
  );
  if (!res.ok) throw new Error(`Google API error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.map((p) => p.text).join('\n').trim() || '';
}

// Local, offline, free LLM via Ollama (https://ollama.com). No API key — talks
// to a locally-running Ollama server. Vision works if the chosen model is a
// vision model (e.g. llava, llama3.2-vision).
async function callOllama(baseUrl, model, messages, system, image) {
  const apiMessages = [{ role: 'system', content: system }, ...messages.map((m) => ({ role: m.role, content: m.content }))];
  if (image && apiMessages.length) {
    apiMessages[apiMessages.length - 1].images = [image];
  }
  const res = await fetch(`${baseUrl.replace(/\/$/, '')}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: model || 'llama3.2', messages: apiMessages, stream: false }),
  });
  if (!res.ok) throw new Error(`Ollama error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.message?.content?.trim() || '';
}

ipcMain.handle('ai:chat', async (_evt, { provider, model, messages, system, image }) => {
  try {
    const apiKeys = store.get('apiKeys') || {};

    let text;
    if (provider === 'ollama') {
      text = await callOllama(store.get('ollamaUrl'), store.get('ollamaModel'), messages, system, image);
    } else {
      const key = apiKeys[provider];
      if (!key) return { ok: false, error: `No API key set for ${provider}. Add one in Settings.` };
      if (provider === 'anthropic') text = await callAnthropic(key, model, messages, system, image);
      else if (provider === 'openai') text = await callOpenAI(key, model, messages, system, image);
      else if (provider === 'google') text = await callGoogle(key, model, messages, system, image);
      else return { ok: false, error: `Unknown provider: ${provider}` };
    }

    return { ok: true, text };
  } catch (e) {
    return { ok: false, error: String(e && e.message ? e.message : e) };
  }
});

// Check whether a local Ollama server is reachable, for the settings UI.
ipcMain.handle('ai:check-ollama', async () => {
  try {
    const res = await fetch(`${store.get('ollamaUrl').replace(/\/$/, '')}/api/tags`);
    if (!res.ok) return { ok: false };
    const data = await res.json();
    return { ok: true, models: (data.models || []).map((m) => m.name) };
  } catch (e) {
    return { ok: false };
  }
});

// ---------------------------------------------------------------------------
// Persistent memory. Stores a rolling list of conversation turns/summaries in
// electron-store so the companion "remembers" across restarts. We cap it and,
// when it grows large, ask the model to compress older turns into a summary.
// ---------------------------------------------------------------------------
ipcMain.handle('memory:get', () => store.get('chatMemory') || []);
ipcMain.handle('memory:set', (_evt, mem) => { store.set('chatMemory', mem || []); return true; });
ipcMain.handle('memory:clear', () => { store.set('chatMemory', []); return true; });

// ---------------------------------------------------------------------------
// Real TTS via API → returns actual audio bytes (base64) so the renderer can
// play it AND run amplitude analysis on it for true lip-sync. Falls back to
// browser speech in the renderer if this isn't enabled / has no key.
// ---------------------------------------------------------------------------
ipcMain.handle('tts:speak', async (_evt, { text }) => {
  try {
    const apiKeys = store.get('apiKeys') || {};
    const provider = store.get('ttsProvider');

    if (provider === 'elevenlabs') {
      const key = apiKeys.elevenlabs;
      if (!key) return { ok: false, error: 'No ElevenLabs API key set.' };
      const voice = store.get('ttsVoice') || '21m00Tcm4TlvDq8ikWAM'; // default "Rachel"
      const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'xi-api-key': key },
        body: JSON.stringify({ text, model_id: 'eleven_turbo_v2' }),
      });
      if (!res.ok) return { ok: false, error: `ElevenLabs ${res.status}: ${await res.text()}` };
      const buf = Buffer.from(await res.arrayBuffer());
      return { ok: true, audio: buf.toString('base64'), mime: 'audio/mpeg' };
    }

    // default: OpenAI TTS
    const key = apiKeys.openai;
    if (!key) return { ok: false, error: 'No OpenAI API key set.' };
    const res = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: 'tts-1', voice: store.get('ttsVoice') || 'nova', input: text }),
    });
    if (!res.ok) return { ok: false, error: `OpenAI TTS ${res.status}: ${await res.text()}` };
    const buf = Buffer.from(await res.arrayBuffer());
    return { ok: true, audio: buf.toString('base64'), mime: 'audio/mpeg' };
  } catch (e) {
    return { ok: false, error: String(e && e.message ? e.message : e) };
  }
});

// ---------------------------------------------------------------------------
// Vision: capture the primary screen so the companion can "look" at what's on
// it. Returns a base64 PNG. (Region cropping is done in the renderer from the
// selection rectangle; here we grab the full screen at reduced size.)
// ---------------------------------------------------------------------------
ipcMain.handle('vision:capture', async () => {
  try {
    const primary = screen.getPrimaryDisplay();
    const { width, height } = primary.size;
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: Math.round(width / 1.5), height: Math.round(height / 1.5) },
    });
    if (!sources.length) return { ok: false, error: 'No screen source available.' };
    const png = sources[0].thumbnail.toPNG();
    return { ok: true, image: png.toString('base64'), width: Math.round(width / 1.5), height: Math.round(height / 1.5) };
  } catch (e) {
    return { ok: false, error: String(e && e.message ? e.message : e) };
  }
});

// ---------------------------------------------------------------------------
// System awareness — honest scope note: detecting "a long-running terminal
// command finished" or reading true battery state generically (without an
// extra native dependency we can't verify in this environment) isn't
// reliably doable cross-platform. What's implemented for real below:
//   - CPU load monitoring via Node's built-in `os` module (no native deps)
//   - Clipboard watching via Electron's built-in clipboard module
// Both are off by default and only run when the renderer enables them.
// ---------------------------------------------------------------------------
let clipboardWatchInterval = null;
let lastClipboardText = '';

ipcMain.handle('system:set-watch-clipboard', (_evt, enabled) => {
  store.set('watchClipboard', enabled);
  clearInterval(clipboardWatchInterval);
  if (enabled) {
    lastClipboardText = clipboard.readText();
    clipboardWatchInterval = setInterval(() => {
      const text = clipboard.readText();
      if (text && text !== lastClipboardText) {
        lastClipboardText = text;
        if (mainWindow) mainWindow.webContents.send('clipboard:changed', text.slice(0, 500));
      }
    }, 1500);
  }
  return enabled;
});

let cpuWarnInterval = null;
function startCpuMonitor() {
  cpuWarnInterval = setInterval(() => {
    const load = os.loadavg()[0] / os.cpus().length; // normalized 1-minute load
    if (load > 0.9 && mainWindow) {
      mainWindow.webContents.send('system:cpu-warning', Math.round(load * 100));
    }
  }, 15000);
}

// Broadcasts the OS cursor position relative to the window center, normalized
// to screen size, so the renderer can make the character's eyes/head track
// the mouse anywhere on the desktop — not just inside the small companion window.
let cursorInterval = null;
function startCursorTracking() {
  cursorInterval = setInterval(() => {
    if (!mainWindow || !mainWindow.isVisible()) return;
    const { x: cx, y: cy } = screen.getCursorScreenPoint();
    const [wx, wy] = mainWindow.getPosition();
    const [ww, wh] = mainWindow.getSize();
    const centerX = wx + ww / 2;
    const centerY = wy + wh / 2;
    const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize;
    const nx = Math.max(-1, Math.min(1, (cx - centerX) / (sw / 2)));
    const ny = Math.max(-1, Math.min(1, (cy - centerY) / (sh / 2)));
    mainWindow.webContents.send('cursor:position', { x: nx, y: ny });
  }, 50);
}

// ---- lifecycle ----
app.whenReady().then(() => {
  IMPORTED_MODEL_DIR = path.join(app.getPath('userData'), 'characters');
  fs.mkdirSync(IMPORTED_MODEL_DIR, { recursive: true });

  createWindow();
  createTray();
  startCpuMonitor();
  startCursorTracking();

  globalShortcut.register('Alt+Shift+L', () => toggleVisibility());

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  clearInterval(clipboardWatchInterval);
  clearInterval(cpuWarnInterval);
  clearInterval(cursorInterval);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
