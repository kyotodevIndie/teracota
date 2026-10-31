// Um relógio de quadros pra janela inteira: cada quadro da tela (requestAnimationFrame)
// move a janela (passeio) e desenha o personagem JUNTOS, então o corpo e a translação
// nunca ficam em ritmos diferentes.
//
/** fps em movimento (passeio, arrasto): em 120/144 Hz, um desenho a cada 2 quadros da tela */
export const MOTION_FPS = 60;
/** fps parada: respiração e piscada continuam fluidas, gastando bem menos */
export const IDLE_FPS = 24;

// Quando nada se move, desenha menos (economia de CPU/GPU), pulando um número inteiro
// de quadros da tela: o intervalo entre desenhos fica sempre igual (sem tremido), seja
// a tela de 60, 120 ou 144 Hz.

/** Quantos quadros da tela por desenho pra ficar o mais perto possível do fps pedido (≥ 1) */
export function frameSkip(targetFps: number, refreshMs: number): number {
  if (!(targetFps > 0) || !Number.isFinite(targetFps) || !(refreshMs > 0)) return 1;
  return Math.max(1, Math.round(1000 / targetFps / refreshMs + 1e-9)); // 2,4999… é 2,5
}

/** Mediana de uma lista (o intervalo da tela, sem se enganar com um quadro atrasado) */
export function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}

const SAMPLES = 30;

export class FrameClock {
  private readonly deltas: number[] = [];
  private last: number | null = null;
  private tick = 0;
  private running = false;

  /**
   * @param onFrame chamado nos quadros em que deve desenhar
   * @param fps fps desejado agora (Infinity = todo quadro da tela)
   */
  constructor(private readonly onFrame: (now: number) => void, private readonly fps: () => number) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    requestAnimationFrame(this.loop);
  }

  stop(): void {
    this.running = false;
  }

  /** Intervalo medido da tela, em ms (≈16,7 a 60 Hz) */
  get refreshMs(): number {
    return median(this.deltas) || 1000 / 60;
  }

  private readonly loop = (now: number): void => {
    if (!this.running) return;
    requestAnimationFrame(this.loop);
    if (this.last !== null) {
      const d = now - this.last;
      if (d > 0 && d < 100) {
        this.deltas.push(d);
        if (this.deltas.length > SAMPLES) this.deltas.shift();
      }
    }
    this.last = now;
    this.tick++;
    if (this.tick % frameSkip(this.fps(), this.refreshMs) === 0) this.onFrame(now);
  };
}
