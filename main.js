const { app, BrowserWindow, ipcMain, shell, globalShortcut, Notification, powerMonitor } = require('electron');
const { exec } = require('child_process');
const os      = require('os');
const path    = require('path');
const express = require('express');
const fetch   = require('node-fetch');
const Store   = require('electron-store');
const openBrowser = require('open');
const { autoUpdater } = require('electron-updater');

const store = new Store({ encryptionKey: 'mitt-dashboard-secret' });

let mainWindow;
let authServer;
const AUTH_PORT = 8888;

const SPOTIFY_CLIENT_ID     = '26fa4f783c97471b8201d539b5b0748d';
const SPOTIFY_CLIENT_SECRET = 'f6588cd5d74e4f099d091445903c7d22';
const SPOTIFY_REDIRECT      = `http://127.0.0.1:${AUTH_PORT}/callback`;
const SPOTIFY_SCOPES = [
  'user-read-playback-state',
  'user-modify-playback-state',
  'user-read-currently-playing',
  'playlist-read-private',
  'playlist-read-collaborative',
  'streaming',
].join(' ');

/* ═══════════════════════════════════════════════════════════════
   WINDOW
═══════════════════════════════════════════════════════════════ */
function createWindow() {
  const bounds = store.get('windowBounds', { width: 420, height: 680 });

  mainWindow = new BrowserWindow({
    width:       bounds.width  || 420,
    height:      bounds.height || 680,
    x:           bounds.x,
    y:           bounds.y,
    icon:        path.join(__dirname, 'icon.ico'),
    resizable:   false,
    alwaysOnTop: true,
    frame:       false,
    transparent: false,
    webPreferences: {
      preload:          path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration:  false,
      sandbox:          true,
    },
    backgroundColor: '#080c10',
    titleBarStyle:   'hidden',
  });

  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));

  const saveBounds = () => {
    if (mainWindow && !mainWindow.isDestroyed())
      store.set('windowBounds', mainWindow.getBounds());
  };
  mainWindow.on('moved',  saveBounds);
  mainWindow.on('resize', saveBounds);
  mainWindow.on('close',  saveBounds);
}

/* ═══════════════════════════════════════════════════════════════
   STARTUP
═══════════════════════════════════════════════════════════════ */
/* ── Auto-updater setup ─────────────────────────────────────── */
// Log update events to console — remove in production if desired
autoUpdater.logger = require('electron').app;
autoUpdater.autoDownload    = true;   // download silently in background
autoUpdater.autoInstallOnAppQuit = true; // install when user quits

autoUpdater.on('update-available', (info) => {
  mainWindow?.webContents.send('update-status', {
    status: 'available', version: info.version,
  });
});

autoUpdater.on('update-downloaded', (info) => {
  mainWindow?.webContents.send('update-status', {
    status: 'downloaded', version: info.version,
  });
});

autoUpdater.on('error', (err) => {
  // Silently ignore — updater errors shouldn't crash the app
  console.log('[updater] error:', err?.message ?? err);
});

ipcMain.handle('update-install-now', () => {
  autoUpdater.quitAndInstall(false, true);
});

app.whenReady().then(() => {
  startAuthServer();
  createWindow();

  globalShortcut.register('CommandOrControl+Shift+D', () => {
    if (!mainWindow) return;
    mainWindow.isVisible() ? mainWindow.hide() : (mainWindow.show(), mainWindow.focus());
  });

  // Check for updates 3 seconds after startup (give window time to load)
  setTimeout(() => autoUpdater.checkForUpdatesAndNotify(), 3000);
});

app.on('will-quit',         () => globalShortcut.unregisterAll());
app.on('window-all-closed', () => { authServer?.close(); app.quit(); });

/* ═══════════════════════════════════════════════════════════════
   SPOTIFY AUTH SERVER
═══════════════════════════════════════════════════════════════ */
function startAuthServer() {
  const srv = express();

  srv.get('/callback', async (req, res) => {
    const code = req.query.code;
    if (!code) { res.send('Feil: ingen kode.'); return; }

    try {
      const tokenRes = await fetch('https://accounts.spotify.com/api/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type:    'authorization_code',
          code,
          redirect_uri:  SPOTIFY_REDIRECT,
          client_id:     SPOTIFY_CLIENT_ID,
          client_secret: SPOTIFY_CLIENT_SECRET,
        }).toString(),
      });
      const data = await tokenRes.json();

      if (data.access_token) {
        store.set('spotify_access_token',  data.access_token);
        store.set('spotify_refresh_token', data.refresh_token);
        store.set('spotify_expires_at',    Date.now() + data.expires_in * 1000);
        mainWindow?.webContents.send('spotify-authed');
        res.send(`<html><body style="background:#080c10;color:#dde6ee;font-family:sans-serif;
          display:flex;align-items:center;justify-content:center;height:100vh;margin:0;
          flex-direction:column;gap:12px">
          <span style="font-size:48px">✓</span><h2>Spotify tilkoblet!</h2>
          <p style="color:#4a6275">Du kan lukke dette vinduet.</p></body></html>`);
      } else {
        res.send('Innloggingsfeil: ' + JSON.stringify(data));
      }
    } catch (e) { res.send('Serverfeil: ' + e.message); }
  });

  authServer = srv.listen(AUTH_PORT);
}

/* ═══════════════════════════════════════════════════════════════
   SPOTIFY TOKEN HELPERS
═══════════════════════════════════════════════════════════════ */
async function refreshSpotifyToken() {
  const rt = store.get('spotify_refresh_token');
  if (!rt) return null;
  try {
    const res  = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type:    'refresh_token',
        refresh_token: rt,
        client_id:     SPOTIFY_CLIENT_ID,
        client_secret: SPOTIFY_CLIENT_SECRET,
      }).toString(),
    });
    const data = await res.json();
    if (data.access_token) {
      store.set('spotify_access_token', data.access_token);
      store.set('spotify_expires_at',   Date.now() + data.expires_in * 1000);
      if (data.refresh_token) store.set('spotify_refresh_token', data.refresh_token);
      return data.access_token;
    }
  } catch {}
  return null;
}

async function getToken() {
  if (Date.now() > store.get('spotify_expires_at', 0) - 60000)
    return refreshSpotifyToken();
  return store.get('spotify_access_token') ?? null;
}

// Thin wrapper: PUT/POST to Spotify Web API, returns raw Response
async function spotifyPut(path, body = null) {
  const token = await getToken(); if (!token) return null;
  const opts = { method: 'PUT', headers: { Authorization: `Bearer ${token}` } };
  if (body !== null) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
  return fetch(`https://api.spotify.com/v1${path}`, opts);
}
async function spotifyPost(path) {
  const token = await getToken(); if (!token) return null;
  return fetch(`https://api.spotify.com/v1${path}`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}` },
  });
}
async function spotifyGet(path) {
  const token = await getToken(); if (!token) return null;
  return fetch(`https://api.spotify.com/v1${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

/* ═══════════════════════════════════════════════════════════════
   IPC — WINDOW
═══════════════════════════════════════════════════════════════ */
ipcMain.handle('window-close',    () => app.quit());
ipcMain.handle('window-minimize', () => mainWindow?.minimize());
ipcMain.on(    'reload-app',      () => mainWindow?.reload());

/* ═══════════════════════════════════════════════════════════════
   IPC — BUILT-IN APP SHORTCUTS
═══════════════════════════════════════════════════════════════ */
ipcMain.on('open-discord', () =>
  exec('start "" "%LOCALAPPDATA%\\Discord\\Update.exe" --processStart Discord.exe', { shell: true }));
ipcMain.on('open-chrome',  () =>
  exec('start "" "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"', { shell: true }));
ipcMain.on('open-spotify', () => exec('start spotify:', { shell: true }));
ipcMain.on('open-youtube', () => shell.openExternal('https://youtube.com'));
ipcMain.on('open-google',  () => shell.openExternal('https://google.com'));

/* ═══════════════════════════════════════════════════════════════
   IPC — CUSTOM SHORTCUTS
═══════════════════════════════════════════════════════════════ */
ipcMain.handle('shortcuts-get',  ()     => store.get('custom_shortcuts', []));
ipcMain.handle('shortcuts-save', (_, s) => { store.set('custom_shortcuts', s); return true; });
ipcMain.handle('shortcut-launch', (_, sc) => {
  if (!sc) return;
  if (sc.url)       shell.openExternal(sc.url);
  else if (sc.path) exec(`start "" "${sc.path}"`, { shell: true });
});

/* ═══════════════════════════════════════════════════════════════
   IPC — TO-DO & NOTES
═══════════════════════════════════════════════════════════════ */
ipcMain.handle('todos-get',  ()     => store.get('todos', []));
ipcMain.handle('todos-save', (_, t) => { store.set('todos', t); return true; });
ipcMain.handle('notes-get',  ()     => store.get('notes', ''));
ipcMain.handle('notes-save', (_, n) => { store.set('notes', n); return true; });

/* ═══════════════════════════════════════════════════════════════
   IPC — WEATHER  (Open-Meteo, gratis og uten API-nøkkel)
═══════════════════════════════════════════════════════════════ */
ipcMain.handle('weather-by-coords', async (_, { lat, lon }) => {
  try {
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
      `&current=temperature_2m,relative_humidity_2m,apparent_temperature,` +
      `precipitation,weather_code,wind_speed_10m,wind_direction_10m,wind_gusts_10m,uv_index` +
      `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,sunrise,sunset` +
      `&timezone=auto&forecast_days=7`;
    // node-fetch v2 uses { timeout } option, not AbortController signal
    const res = await fetch(url, { timeout: 8000 });
    if (!res.ok) return { error: `HTTP ${res.status}` };
    return await res.json();
  } catch (e) { return { error: e.message }; }
});

ipcMain.handle('weather-geocode', async (_, query) => {
  try {
    const res = await fetch(
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=5&language=no`,
      { timeout: 6000 }
    );
    if (!res.ok) return [];
    const data = await res.json();
    return data.results ?? [];
  } catch { return []; }
});

/* ═══════════════════════════════════════════════════════════════
   IPC — SYSTEM INFO
═══════════════════════════════════════════════════════════════ */
ipcMain.handle('system-info', () => {
  const cpus      = os.cpus();
  const totalMem  = os.totalmem();
  const freeMem   = os.freemem();
  const cpuPct    = Math.min(100, Math.round((os.loadavg()[0] / cpus.length) * 100));
  const memPct    = Math.round(((totalMem - freeMem) / totalMem) * 100);
  return {
    cpuPct,
    cpuModel:   cpus[0]?.model?.split('@')[0]?.trim() ?? 'CPU',
    memPct,
    memUsedGB:  ((totalMem - freeMem) / 1e9).toFixed(1),
    memTotalGB: (totalMem / 1e9).toFixed(1),
    platform:   os.platform(),
    uptime:     Math.floor(os.uptime() / 3600),
  };
});

/* ═══════════════════════════════════════════════════════════════
   IPC — NOTIFICATIONS
═══════════════════════════════════════════════════════════════ */
ipcMain.handle('notify', (_, { title, body }) => {
  if (Notification.isSupported()) new Notification({ title, body, silent: false }).show();
});

/* ═══════════════════════════════════════════════════════════════
   IPC — SPOTIFY AUTH
═══════════════════════════════════════════════════════════════ */
ipcMain.handle('spotify-login', () => {
  const url =
    `https://accounts.spotify.com/authorize?client_id=${SPOTIFY_CLIENT_ID}` +
    `&response_type=code&redirect_uri=${encodeURIComponent(SPOTIFY_REDIRECT)}` +
    `&scope=${encodeURIComponent(SPOTIFY_SCOPES)}`;
  openBrowser(url);
});

ipcMain.handle('spotify-logout', () => {
  store.delete('spotify_access_token');
  store.delete('spotify_refresh_token');
  store.delete('spotify_expires_at');
  return true;
});

ipcMain.handle('spotify-is-authed', () =>
  !!(store.get('spotify_access_token') && store.get('spotify_refresh_token'))
);

/* ═══════════════════════════════════════════════════════════════
   IPC — SPOTIFY PLAYBACK
═══════════════════════════════════════════════════════════════ */
ipcMain.handle('spotify-get-playback', async () => {
  try {
    const res = await spotifyGet('/me/player');
    if (!res)            return null;
    if (res.status===204) return { nothing_playing: true };
    if (!res.ok)          return null;
    return await res.json();
  } catch { return { offline: true }; }
});

ipcMain.handle('spotify-play-pause', async (_, playing) => {
  try { await spotifyPut(`/me/player/${playing ? 'pause' : 'play'}`); } catch {}
});

ipcMain.handle('spotify-next', async () => {
  try { await spotifyPost('/me/player/next'); } catch {}
});

ipcMain.handle('spotify-prev', async () => {
  try { await spotifyPost('/me/player/previous'); } catch {}
});

ipcMain.handle('spotify-set-volume', async (_, vol) => {
  const v = Math.max(0, Math.min(100, Math.round(Number(vol))));
  try { await spotifyPut(`/me/player/volume?volume_percent=${v}`); } catch {}
});

ipcMain.handle('spotify-seek', async (_, ms) => {
  try { await spotifyPut(`/me/player/seek?position_ms=${Math.round(ms)}`); } catch {}
});

/* ── Shuffle ─────────────────────────────────────────────────── */
// state: boolean — true = on, false = off
ipcMain.handle('spotify-shuffle', async (_, state) => {
  try {
    await spotifyPut(`/me/player/shuffle?state=${Boolean(state)}`);
    return { ok: true };
  } catch (e) { return { error: e.message }; }
});

/* ── Repeat ──────────────────────────────────────────────────── */
// mode: 'off' | 'context' | 'track'
ipcMain.handle('spotify-repeat', async (_, mode) => {
  const valid = ['off', 'context', 'track'];
  if (!valid.includes(mode)) return { error: 'invalid_mode' };
  try {
    await spotifyPut(`/me/player/repeat?state=${mode}`);
    return { ok: true };
  } catch (e) { return { error: e.message }; }
});

/* ── Playlists ───────────────────────────────────────────────── */
ipcMain.handle('spotify-get-playlists', async () => {
  try {
    const res = await spotifyGet('/me/playlists?limit=40');
    if (!res?.ok) return null;
    return await res.json();
  } catch { return null; }
});

/* ── Play context (playlist/album URI) ───────────────────────── */
ipcMain.handle('spotify-play-context', async (_, uri) => {
  try {
    const res = await spotifyPut('/me/player/play', uri ? { context_uri: uri } : {});
    if (!res) return { error: 'not_authed' };
    if (res.status === 403) return { error: 'premium_required' };
    if (res.status === 404) return { error: 'no_device' };
    return { ok: true };
  } catch { return { error: 'network' }; }
});
