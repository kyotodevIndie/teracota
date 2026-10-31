// Balão de fala com efeito de digitação.
const TYPE_MS = 28;
const MIN_VISIBLE_MS = 3000;
const MS_PER_CHAR = 70;

export class Bubble {
  private typeTimer: number | undefined;
  private hideTimer: number | undefined;

  constructor(
    private readonly el: HTMLElement,
    private readonly textEl: HTMLElement,
    private readonly fromEl: HTMLElement,
  ) {}

  /**
   * @param from projeto de origem, mostrado como etiqueta antes do texto
   * @returns quanto tempo (ms) o texto leva pra ser "digitado"
   */
  say(text: string, from?: string): number {
    window.clearInterval(this.typeTimer);
    window.clearTimeout(this.hideTimer);
    const chars = Array.from(text); // não quebra emojis no meio
    this.fromEl.textContent = from ?? '';
    this.fromEl.hidden = !from;
    this.textEl.textContent = '';
    this.el.classList.remove('hidden');
    let i = 0;
    this.typeTimer = window.setInterval(() => {
      this.textEl.textContent = chars.slice(0, ++i).join('');
      if (i < chars.length) return;
      window.clearInterval(this.typeTimer);
      this.hideTimer = window.setTimeout(
        () => this.el.classList.add('hidden'),
        Math.max(MIN_VISIBLE_MS, chars.length * MS_PER_CHAR),
      );
    }, TYPE_MS);
    return chars.length * TYPE_MS;
  }
}
