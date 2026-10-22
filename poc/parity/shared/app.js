// Pagina compartilhada pelos dois hosts. Durations copiadas de assets/skins/tera/skin.json (idle).
const DUR = [320, 320, 150, 320];
const SPRITE = { x: 30, y: 170, size: 260 };
const RECT = { x: 4, y: 4, w: 40, h: 40 };
const onTauri = !!window.__TAURI__;
const host = {
  call(cmd, args) {
    if (onTauri) return window.__TAURI__.core.invoke(cmd, args || {});
    return window.parityBridge.call(cmd, args || {});
  },
};
const ctx = document.getElementById('c').getContext('2d');
const imgs = [];
let cur = 0, frozen = -1, timer = null, firstPainted = false;

function draw() {
  ctx.clearRect(0, 0, 320, 440);
  ctx.drawImage(imgs[cur], SPRITE.x, SPRITE.y, SPRITE.size, SPRITE.size);
  ctx.fillStyle = '#ff00ff'; // retangulo opaco de teste
  ctx.fillRect(RECT.x, RECT.y, RECT.w, RECT.h);
}
function setFrame(i) {
  cur = i; draw();
  host.call('frame', { i });
}
function schedule() {
  clearTimeout(timer);
  if (frozen >= 0) return;
  timer = setTimeout(() => { setFrame((cur + 1) % imgs.length); schedule(); }, DUR[cur]);
}
window.__freeze = (i) => { frozen = i; if (i >= 0) { setFrame(i); clearTimeout(timer); } else schedule(); };

// Mascara 64x64 por alfa: somente no Tauri (decodifica no canvas e envia ao Rust).
// No Electron a mascara e calculada no main com nativeImage.
function buildMasks() {
  const m = document.createElement('canvas'); m.width = 64; m.height = 64;
  const mc = m.getContext('2d', { willReadFrequently: true });
  const out = [];
  for (const im of imgs) {
    mc.clearRect(0, 0, 64, 64); mc.drawImage(im, 0, 0, 64, 64);
    const d = mc.getImageData(0, 0, 64, 64).data;
    const a = new Array(4096);
    for (let k = 0; k < 4096; k++) a[k] = d[k * 4 + 3];
    out.push(a);
  }
  return out;
}

// Arrasto no Electron: IPC (o main faz setBounds). No Tauri: data-tauri-drag-region.
if (!onTauri) {
  for (const id of ['dragSprite', 'dragRect']) {
    document.getElementById(id).addEventListener('pointerdown', (e) => { if (e.button === 0) { e.target.setPointerCapture(e.pointerId); host.call('drag_start'); } });
  }
  window.addEventListener('pointerup', () => host.call('drag_end'));
}

let loaded = 0;
for (let i = 1; i <= 4; i++) {
  const im = new Image();
  im.onload = async () => {
    if (++loaded < 4) return;
    if (onTauri) await host.call('set_masks', { masks: buildMasks() });
    draw();
    schedule();
    host.call('frame', { i: 0 });
    requestAnimationFrame(() => {
      if (firstPainted) return; firstPainted = true;
      host.call('first_paint', { epoch: Date.now(), perf: performance.now() });
    });
  };
  im.src = 'frames/idle/0' + i + '.png';
  imgs.push(im);
}
