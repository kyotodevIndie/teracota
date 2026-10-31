// Balanço de quando ela é carregada pelo mouse: uma mola amortecida que persegue
// um ângulo proporcional à velocidade do arrasto. Puxou pra esquerda → o corpo
// fica pra trás (pés pra direita); parou → passa do meio e vai assentando.
//
// Convenção: ângulo em graus, positivo = pés pra direita.

const DEG_PER_SPEED = 0.03; // graus por px/s de velocidade horizontal
const MAX_ANGLE = 35;
const STIFFNESS = 45; // mola (1/s²) — período ~0,9s
const DAMPING = 3; // amortecimento (1/s) — baixo = balança mais vezes antes de parar
const SPEED_SMOOTHING = 0.35; // média móvel da velocidade (0..1, maior = reage mais rápido)
const MAX_DT = 1 / 30;

export class Pendulum {
  angle = 0;
  private velocity = 0; // graus/s
  private speed = 0; // px/s do arrasto, suavizada
  private pendingDx = 0;
  private lastTime: number | null = null;

  /** Deslocamento horizontal do mouse desde a última chamada de step() */
  push(dx: number): void {
    this.pendingDx += dx;
  }

  step(now: number): number {
    const dt = this.lastTime === null ? 0 : Math.min(MAX_DT, (now - this.lastTime) / 1000);
    this.lastTime = now;
    if (dt === 0) return this.angle;

    const rawSpeed = this.pendingDx / dt;
    this.pendingDx = 0;
    this.speed += (rawSpeed - this.speed) * SPEED_SMOOTHING;

    const target = Math.max(-MAX_ANGLE, Math.min(MAX_ANGLE, -this.speed * DEG_PER_SPEED));
    const accel = STIFFNESS * (target - this.angle) - DAMPING * this.velocity;
    this.velocity += accel * dt;
    this.angle = Math.max(-MAX_ANGLE * 1.3, Math.min(MAX_ANGLE * 1.3, this.angle + this.velocity * dt));
    return this.angle;
  }

  reset(): void {
    this.angle = 0;
    this.velocity = 0;
    this.speed = 0;
    this.pendingDx = 0;
    this.lastTime = null;
  }
}
