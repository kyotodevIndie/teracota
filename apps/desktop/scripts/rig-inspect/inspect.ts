// Página de inspeção do rig (só desenvolvimento): desenha o rig com pivôs/caixas,
// troca pose/movimento, mostra a camada sob o cursor e mede o desempenho.
// Servida por scripts/rig-inspect/server.ts — roda no navegador, sem Electron.
import { parseRigManifest } from '@tera/character/rig';
import { POSES, parseSkinManifest, type Pose, type SkinInfo } from '@tera/character/skin';
import { EXPRESSIONS, type Expression } from '../../src/shared/protocol';
import { FrameClock } from '../../src/renderer/frame-clock';
import { RigCharacter } from '../../src/renderer/rig/rig-character';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const log = (text: string, error = false) => {
  const el = $('log');
  el.textContent = text;
  el.className = error ? 'err' : '';
};

async function loadSkin(id: string): Promise<SkinInfo> {
  const base = `/skins/${id}/`;
  const manifest = parseSkinManifest(await (await fetch(`${base}skin.json`)).json());
  if (!manifest?.rig) throw new Error('skin.json inválido ou não é um rig');
  const parsed = parseRigManifest(await (await fetch(base + manifest.rig)).json());
  if (!parsed.rig) throw new Error(`rig.json inválido:\n${parsed.errors.join('\n')}`);
  return { id, baseUrl: new URL(base, location.href).href, manifest, hitMasks: {}, rig: parsed.rig };
}

async function main(): Promise<void> {
  const skinId = new URLSearchParams(location.search).get('skin') ?? 'tera-rig';
  let character: RigCharacter;
  try {
    character = await RigCharacter.create($('character'), await loadSkin(skinId));
  } catch (err) {
    log(String(err instanceof Error ? err.message : err), true);
    return;
  }
  log(`skin "${skinId}" carregada`);
  Object.assign(window, { character }); // pra inspecionar pelo console
  // o mesmo relógio do app: desenha no ritmo que o personagem pede
  new FrameClock((now) => character.tick(now), () => character.targetFps()).start();
  document.addEventListener('mousemove', (e) => character.lookAt({ x: e.clientX, y: e.clientY }));

  const debug = $<HTMLInputElement>('debug');
  character.debug = debug.checked;
  debug.onchange = () => { character.debug = debug.checked; };

  const pose = $<HTMLSelectElement>('pose');
  pose.append(...POSES.map((p) => new Option(p, p)));
  pose.value = 'idle';
  const expression = $<HTMLSelectElement>('expression');
  expression.append(...EXPRESSIONS.map((x) => new Option(x, x)));
  expression.value = 'neutral';
  const showLook = () => character.show({ pose: pose.value as Pose, expression: expression.value as Expression, anim: null });
  pose.onchange = showLook;
  expression.onchange = showLook;
  const talking = $<HTMLInputElement>('talking');
  talking.onchange = () => character.setTalking(talking.checked);
  const reduced = $<HTMLInputElement>('reduced');
  reduced.onchange = () => character.setReducedMotion(reduced.checked);

  // arrasto simulado: um seno no ângulo do pêndulo, como se o mouse fosse e voltasse
  let swingTimer: number | undefined;
  const motion = $<HTMLSelectElement>('motion');
  const left = $<HTMLInputElement>('left');
  const applyMotion = () => {
    window.clearInterval(swingTimer);
    character.setSwing(0);
    const m = motion.value as '' | 'walk' | 'drag';
    character.setMotion(m || null, left.checked ? -1 : 1);
    if (m === 'drag') {
      const t0 = performance.now();
      swingTimer = window.setInterval(() => character.setSwing(22 * Math.sin((performance.now() - t0) / 450)), 16);
    }
  };
  motion.onchange = applyMotion;
  left.onchange = applyMotion;

  document.addEventListener('mousemove', (e) => {
    $('hit').textContent = character.layerAt(e.clientX, e.clientY) ?? '—';
  });

  $('bench').onclick = async () => {
    const perf = $('perf');
    perf.textContent = 'medindo...';
    // no ritmo real (requestAnimationFrame) — pode dar 0 se a aba estiver escondida
    character.resetStats();
    await new Promise((r) => setTimeout(r, 5000));
    const live = character.stats();
    // custo puro de desenho: 600 quadros seguidos, sem esperar o vsync
    character.resetStats();
    for (let i = 0; i < 600; i++) character.tick(performance.now() + i * 16);
    const draw = character.stats();
    const r = $('character').getBoundingClientRect();
    const N = 10_000;
    let hits = 0;
    const t0 = performance.now();
    for (let i = 0; i < N; i++) {
      if (character.hitTest(r.left + Math.random() * r.width, r.top + Math.random() * r.height)) hits++;
    }
    const hitUs = ((performance.now() - t0) / N) * 1000;
    perf.textContent = [
      `no ritmo real: ${live.frames} quadros em 5 s (${(live.frames / 5).toFixed(1)} fps)`,
      `desenho (600 quadros): média ${draw.drawMs.toFixed(3)} ms, pior ${draw.maxDrawMs.toFixed(3)} ms`,
      `hitTest: ${hitUs.toFixed(2)} µs por chamada (${hits}/${N} acertaram a personagem)`,
    ].join('\n');
  };
}

void main();
