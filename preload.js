const { contextBridge, ipcRenderer } = require('electron');

// ─── Whitelist of valid IPC channels ───────────────────────────────────────
const INVOKE_CHANNELS = new Set([
  'window-close', 'window-minimize', 'update-install-now',
  'spotify-login', 'spotify-logout', 'spotify-is-authed',
  'spotify-get-playback', 'spotify-play-pause', 'spotify-next', 'spotify-prev',
  'spotify-set-volume', 'spotify-seek', 'spotify-get-playlists', 'spotify-play-context',
  'spotify-shuffle', 'spotify-repeat',
  'weather-by-coords', 'weather-geocode',
  'shortcuts-get', 'shortcuts-save', 'shortcut-launch',
  'todos-get', 'todos-save',
  'notes-get', 'notes-save',
  'system-info', 'notify',
]);

const SEND_CHANNELS = new Set([
  'reload-app', 'open-discord', 'open-chrome', 'open-youtube', 'open-google', 'open-spotify',
]);

function safeInvoke(channel, ...args) {
  if (!INVOKE_CHANNELS.has(channel)) {
    console.warn(`[preload] Blocked invoke: ${channel}`);
    return Promise.reject(new Error(`Channel not allowed: ${channel}`));
  }
  return ipcRenderer.invoke(channel, ...args);
}

function safeSend(channel, ...args) {
  if (!SEND_CHANNELS.has(channel)) {
    console.warn(`[preload] Blocked send: ${channel}`);
    return;
  }
  ipcRenderer.send(channel, ...args);
}

contextBridge.exposeInMainWorld('api', {
  // Window
  close:    () => safeInvoke('window-close'),
  minimize: () => safeInvoke('window-minimize'),
  reload:   () => safeSend('reload-app'),
  installUpdate: () => safeInvoke('update-install-now'),
  onUpdateStatus: (cb) => ipcRenderer.on('update-status', (_e, data) => cb(data)),
  // Auth
  login:           () => safeInvoke('spotify-login'),
  logout:          () => safeInvoke('spotify-logout'),
  isAuthed:        () => safeInvoke('spotify-is-authed'),
  onSpotifyAuthed: (cb) => ipcRenderer.on('spotify-authed', (_e, ...a) => cb(...a)),
  // Playback
  getPlayback:  ()        => safeInvoke('spotify-get-playback'),
  playPause:    (playing) => safeInvoke('spotify-play-pause', playing),
  next:         ()        => safeInvoke('spotify-next'),
  prev:         ()        => safeInvoke('spotify-prev'),
  setVolume:    (v)       => safeInvoke('spotify-set-volume', Number(v)),
  seek:         (ms)      => safeInvoke('spotify-seek', Number(ms)),
  getPlaylists: ()        => safeInvoke('spotify-get-playlists'),
  playContext:  (uri)     => safeInvoke('spotify-play-context', uri),
  // shuffle(state: boolean), repeat(mode: 'off'|'context'|'track')
  shuffle: (state) => safeInvoke('spotify-shuffle', Boolean(state)),
  repeat:  (mode)  => safeInvoke('spotify-repeat', mode),
  // Weather
  weatherByCoords: (c) => safeInvoke('weather-by-coords', c),
  weatherGeocode:  (q) => safeInvoke('weather-geocode', q),
  // Shortcuts
  shortcutsGet:   ()    => safeInvoke('shortcuts-get'),
  shortcutsSave:  (s)   => safeInvoke('shortcuts-save', s),
  shortcutLaunch: (sc)  => safeInvoke('shortcut-launch', sc),
  // Todos
  todosGet:  ()    => safeInvoke('todos-get'),
  todosSave: (t)   => safeInvoke('todos-save', t),
  // Notes
  notesGet:  ()    => safeInvoke('notes-get'),
  notesSave: (n)   => safeInvoke('notes-save', n),
  // System
  systemInfo: () => safeInvoke('system-info'),
  notify:     (o) => safeInvoke('notify', o),
});

contextBridge.exposeInMainWorld('electronAPI', {
  openDiscord: () => safeSend('open-discord'),
  openChrome:  () => safeSend('open-chrome'),
  openYouTube: () => safeSend('open-youtube'),
  openGoogle:  () => safeSend('open-google'),
  openSpotify: () => safeSend('open-spotify'),
});
