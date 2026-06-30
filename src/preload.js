const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('companionAPI', {

  setAlwaysOnTop: (value) => ipcRenderer.invoke('settings:set-always-on-top', value),
  setIgnoreMouse: (ignore) => ipcRenderer.invoke('window:set-ignore-mouse', ignore),
  quit: () => ipcRenderer.invoke('app:quit'),
  getStartup: () => ipcRenderer.invoke('startup:get'),
  setStartup: (enabled) => ipcRenderer.invoke('startup:set', enabled),
  onAlwaysOnTopChanged: (cb) => ipcRenderer.on('always-on-top-changed', (_e, v) => cb(v)),

  setMoveMode: (mode) => ipcRenderer.invoke('move:set-mode', mode),
  onMoveState: (cb) => ipcRenderer.on('move:state', (_e, s) => cb(s)),
  onMovePos: (cb) => ipcRenderer.on('move:pos', (_e, p) => cb(p)),
  onResetPosition: (cb) => ipcRenderer.on('char:reset-position', () => cb()),

  getAllSettings: () => ipcRenderer.invoke('settings:get-all'),
  setSetting: (key, value) => ipcRenderer.invoke('settings:set', { key, value }),
  onSettingChanged: (cb) => ipcRenderer.on('settings:changed', (_e, d) => cb(d)),

  listCharacters: () => ipcRenderer.invoke('characters:list'),
  getCharacterPath: (id) => ipcRenderer.invoke('characters:get-path', id),
  importCharacter: (filename, data) => ipcRenderer.invoke('characters:import', { filename, data }),
  deleteCharacter: (id) => ipcRenderer.invoke('characters:delete', id),
  renameCharacter: (id, newLabel) => ipcRenderer.invoke('characters:rename', { id, newLabel }),

  aiChat: (provider, model, messages, system, image) =>
    ipcRenderer.invoke('ai:chat', { provider, model, messages, system, image }),
  checkOllama: () => ipcRenderer.invoke('ai:check-ollama'),

  memoryGet: () => ipcRenderer.invoke('memory:get'),
  memorySet: (mem) => ipcRenderer.invoke('memory:set', mem),
  memoryClear: () => ipcRenderer.invoke('memory:clear'),

  ttsSpeak: (text) => ipcRenderer.invoke('tts:speak', { text }),

  visionCapture: () => ipcRenderer.invoke('vision:capture'),

  setWatchClipboard: (enabled) => ipcRenderer.invoke('system:set-watch-clipboard', enabled),
  onClipboardChanged: (cb) => ipcRenderer.on('clipboard:changed', (_e, text) => cb(text)),
  onCpuWarning: (cb) => ipcRenderer.on('system:cpu-warning', (_e, pct) => cb(pct)),
  onCursorPosition: (cb) => ipcRenderer.on('cursor:position', (_e, pos) => cb(pos)),
});
