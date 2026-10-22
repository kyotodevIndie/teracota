// Host Electron do harness de paridade. Args: --windows=N --hidden --port=47600
const { app, BrowserWindow, ipcMain, screen, nativeImage, Tray, Menu } = require('electron');
const net = require('net');
const path = require('path');

const argv = process.argv.slice(2);
const argOf = (k, d) => { const a = argv.find((x) => x.startsWith('--' + k + '=')); return a ? a.split('=')[1] : d; };
const NWIN = parseInt(argOf('windows', '1'), 10);
const HIDDEN = argv.includes('--hidden');
const PORT = parseInt(argOf('port', '47600'), 10);
const SHARED = path.join(__dirname, '..', 'shared');

const SPRITE = { x: 30, y: 170, size: 260 }, RECT = { x: 4, y: 4, w: 40, h: 40 };
let dragTimer = null;
const masks = []; // masks[frame] = Uint8Array(4096) de alfa 0..255
const state = { firstPaintEpoch: null, firstPaintPerf: null, wins: [], tray: null };

function buildMasks() {
  for (let i = 1; i <= 4; i++) {
    const img = nativeImage.createFromPath(path.join(SHARED, 'frames', 'idle', '0' + i + '.png'))
      .resize({ width: 64, height: 64, quality: 'good' });
    const bmp = img.toBitmap(); // BGRA
    const a = new Uint8Array(4096);
    for (let k = 0; k < 4096; k++) a[k] = bmp[k * 4 + 3];
    masks.push(a);
  }
}
function hit(frame, x, y) {
  if (x >= RECT.x && x < RECT.x + RECT.w && y >= RECT.y && y < RECT.y + RECT.h) return true;
  const sx = Math.floor(((x - SPRITE.x) / SPRITE.size) * 64), sy = Math.floor(((y - SPRITE.y) / SPRITE.size) * 64);
  if (sx < 0 || sy < 0 || sx >= 64 || sy >= 64) return false;
  return masks[frame][sy * 64 + sx] > 40;
}

function createWin(i) {
  const w = new BrowserWindow({
    width: 320, height: 440, x: 100 + i * 360, y: 100,
    transparent: true, frame: false, alwaysOnTop: true, skipTaskbar: true,
    focusable: false, show: false, resizable: false, hasShadow: false, backgroundColor: '#00000000',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true },
  });
  w.setAlwaysOnTop(true, 'screen-saver');
  w._p = { ign: false, frame: 0, drag: null, label: i === 0 ? 'main' : 'w' + i };
  w.loadFile(path.join(SHARED, 'index.html'));
  if (!HIDDEN) w.showInactive();
  state.wins.push(w);
  return w;
}

ipcMain.handle('p', (ev, cmd, args) => {
  const w = BrowserWindow.fromWebContents(ev.sender);
  if (!w) return;
  switch (cmd) {
    case 'frame': w._p.frame = args.i; break;
    case 'first_paint':
      if (w._p.label === 'main' && state.firstPaintEpoch === null) { state.firstPaintEpoch = args.epoch; state.firstPaintPerf = args.perf; }
      break;
    case 'drag_start': {
      const c = screen.getCursorScreenPoint(), b = w.getBounds();
      w._p.drag = { cx: c.x, cy: c.y, bx: b.x, by: b.y };
      if (!dragTimer) dragTimer = setInterval(dragTick, 8);
      break;
    }
    case 'drag_end': w._p.drag = null; if (!state.wins.some((x) => x._p.drag) && dragTimer) { clearInterval(dragTimer); dragTimer = null; } break;
  }
});

function poll() {
  const c = screen.getCursorScreenPoint();
  for (const w of state.wins) {
    if (w.isDestroyed() || !w.isVisible()) continue;
    const b = w.getBounds();
    const want = !hit(w._p.frame, c.x - b.x, c.y - b.y);
    if (w._p.ign !== want) { w.setIgnoreMouseEvents(want); w._p.ign = want; }
  }
}
function dragTick() {
  const c = screen.getCursorScreenPoint();
  for (const w of state.wins) {
    const d = w._p.drag; if (!d) continue;
    w.setBounds({ x: d.bx + c.x - d.cx, y: d.by + c.y - d.cy, width: 320, height: 440 });
  }
}

function info() {
  return {
    host: 'electron', pid: process.pid, version: process.versions.electron,
    firstPaintEpochMs: state.firstPaintEpoch, firstPaintPerfMs: state.firstPaintPerf,
    masksReady: masks.length === 4,
    windows: state.wins.map((w) => {
      const b = w.getBounds(), p = screen.dipToScreenRect(w, b), d = screen.getDisplayMatching(b);
      return { label: w._p.label, x: p.x, y: p.y, w: p.width, h: p.height, dipX: b.x, dipY: b.y, scale: d.scaleFactor, ignore: w._p.ign, frame: w._p.frame, visible: w.isVisible() };
    }),
    displays: screen.getAllDisplays().map((d) => ({ x: d.bounds.x, y: d.bounds.y, w: d.bounds.width, h: d.bounds.height, scale: d.scaleFactor, primary: d.id === screen.getPrimaryDisplay().id })),
  };
}

function makeTray() {
  if (state.tray) return { already: true };
  const icon = nativeImage.createFromPath(path.join(SHARED, 'frames', 'idle', '01.png')).resize({ width: 16, height: 16 });
  const t = new Tray(icon);
  t.setToolTip('Tera parity');
  t.setContextMenu(Menu.buildFromTemplate([{ label: 'Item A' }, { label: 'Sair', click: () => app.quit() }]));
  t.on('click', () => {}); t.on('right-click', () => {});
  state.tray = t;
  return {
    created: !t.isDestroyed(), boundsDip: t.getBounds(),
    listenersClick: t.listenerCount('click'), listenersRightClick: t.listenerCount('right-click'),
    contextMenuSet: true, note: 'verificacao por API; clique real na bandeja nao executado',
  };
}

function handle(line) {
  const p = line.trim().split(/\s+/);
  switch (p[0]) {
    case 'info': return info();
    case 'show': state.wins.forEach((w) => w.showInactive()); return { ok: true };
    case 'freeze': return Promise.all(state.wins.map((w) => w.webContents.executeJavaScript('window.__freeze(' + parseInt(p[1], 10) + ')'))).then(() => ({ ok: true }));
    case 'move': {
      const w = state.wins.find((x) => x._p.label === (p[3] || 'main'));
      const d = screen.screenToDipPoint({ x: parseInt(p[1], 10), y: parseInt(p[2], 10) });
      w.setBounds({ x: d.x, y: d.y, width: 320, height: 440 });
      return new Promise((r) => setTimeout(() => r(info()), 300));
    }
    case 'tray': return makeTray();
    case 'quit': setTimeout(() => app.quit(), 20); return { ok: true };
  }
  return { error: 'unknown' };
}

app.on('window-all-closed', () => {});
app.whenReady().then(() => {
  buildMasks();
  for (let i = 0; i < NWIN; i++) createWin(i);
  setInterval(poll, 33);
  net.createServer((s) => {
    let buf = '';
    s.on('data', async (d) => {
      buf += d; if (!buf.includes('\n')) return;
      let out; try { out = await handle(buf); } catch (e) { out = { error: String(e) }; }
      s.end(JSON.stringify(out));
    });
  }).listen(PORT, '127.0.0.1');
});
