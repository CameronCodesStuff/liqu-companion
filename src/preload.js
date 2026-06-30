const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('companionAPI', {
  // window / pinning
  setClickThrough: (value) => ipcRenderer.invoke('settings:set-click-through', value),
  setAlwaysOnTop: (value) => ipcRenderer.invoke('settings:set-always-on-top', value),
  dragWindow: (dx, dy) => ipcRenderer.invoke('window:drag-move', { dx, dy }),
  dragEnd: () => ipcRenderer.invoke('window:drag-end'),
  setIgnoreMouse: (ignore) => ipcRenderer.invoke('window:set-ignore-mouse', ignore),
  quit: () => ipcRenderer.invoke('app:quit'),
  getStartup: () => ipcRenderer.invoke('startup:get'),
  setStartup: (enabled) => ipcRenderer.invoke('startup:set', enabled),
  onClickThroughChanged: (cb) => ipcRenderer.on('click-through-changed', (_e, v) => cb(v)),
  onAlwaysOnTopChanged: (cb) => ipcRenderer.on('always-on-top-changed', (_e, v) => cb(v)),

  // persisted settings (electron-store)
  getAllSettings: () => ipcRenderer.invoke('settings:get-all'),
  setSetting: (key, value) => ipcRenderer.invoke('settings:set', { key, value }),

  // character library
  listCharacters: () => ipcRenderer.invoke('characters:list'),
  getCharacterPath: (id) => ipcRenderer.invoke('characters:get-path', id),
  importCharacter: (filename, data) => ipcRenderer.invoke('characters:import', { filename, data }),
  deleteCharacter: (id) => ipcRenderer.invoke('characters:delete', id),
  renameCharacter: (id, newLabel) => ipcRenderer.invoke('characters:rename', { id, newLabel }),

  // AI chat (runs server-side in main process — no CORS, keys stay out of renderer devtools network tab)
  aiChat: (provider, model, messages, system, image) =>
    ipcRenderer.invoke('ai:chat', { provider, model, messages, system, image }),
  checkOllama: () => ipcRenderer.invoke('ai:check-ollama'),

  // persistent memory
  memoryGet: () => ipcRenderer.invoke('memory:get'),
  memorySet: (mem) => ipcRenderer.invoke('memory:set', mem),
  memoryClear: () => ipcRenderer.invoke('memory:clear'),

  // real TTS (returns audio bytes for amplitude-based lip-sync)
  ttsSpeak: (text) => ipcRenderer.invoke('tts:speak', { text }),

  // vision: capture the screen for the companion to look at
  visionCapture: () => ipcRenderer.invoke('vision:capture'),

  // system awareness
  setWatchClipboard: (enabled) => ipcRenderer.invoke('system:set-watch-clipboard', enabled),
  onClipboardChanged: (cb) => ipcRenderer.on('clipboard:changed', (_e, text) => cb(text)),
  onCpuWarning: (cb) => ipcRenderer.on('system:cpu-warning', (_e, pct) => cb(pct)),
  onCursorPosition: (cb) => ipcRenderer.on('cursor:position', (_e, pos) => cb(pos)),
});
