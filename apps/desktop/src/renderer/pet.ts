// Detecta "carinho": mouse indo e voltando em cima do personagem várias vezes.
const MIN_STEP_PX = 4;
const WINDOW_MS = 1200;
const FLIPS_NEEDED = 4;
const COOLDOWN_MS = 4000;

export class PetDetector {
  private lastX: number | null = null;
  private dir = 0;
  private flips: number[] = [];
  private cooldownUntil = 0;

  constructor(private readonly onPet: () => void) {}

  track(x: number): void {
    if (this.lastX === null) {
      this.lastX = x;
      return;
    }
    if (Math.abs(x - this.lastX) < MIN_STEP_PX) return;
    const d = Math.sign(x - this.lastX);
    this.lastX = x;
    if (this.dir && d !== this.dir) {
      const now = Date.now();
      this.flips = this.flips.filter((t) => now - t < WINDOW_MS);
      this.flips.push(now);
      if (this.flips.length >= FLIPS_NEEDED && now >= this.cooldownUntil) {
        this.flips = [];
        this.cooldownUntil = now + COOLDOWN_MS;
        this.onPet();
      }
    }
    this.dir = d;
  }

  reset(): void {
    this.lastX = null;
    this.dir = 0;
    this.flips = [];
  }
}
