// Limites de uso por IA (o chip de cada uma na interface). Cada integração alimenta o
// seu; o que passou do horário de reset some sozinho.
import type { ProviderUsage, UsageWindow } from '../shared/live';
import { providerInfo } from './integrations';

export class UsageStore {
  private readonly byProvider = new Map<string, ProviderUsage>();
  private readonly listeners = new Set<() => void>();

  set(provider: string, windows: UsageWindow[], now = Date.now()): void {
    if (!windows.length) {
      if (this.byProvider.delete(provider)) this.emit();
      return;
    }
    const prev = this.byProvider.get(provider);
    const same = prev && JSON.stringify(prev.windows) === JSON.stringify(windows);
    const info = providerInfo(provider);
    this.byProvider.set(provider, { provider, displayName: info.displayName, badge: info.badge, windows, updatedAt: now });
    if (!same) this.emit();
  }

  /** Janelas ainda válidas (as que já resetaram saem) */
  list(now = Date.now()): ProviderUsage[] {
    return [...this.byProvider.values()]
      .map((u) => ({ ...u, windows: u.windows.filter((w) => w.resetsAt === null || w.resetsAt > now) }))
      .filter((u) => u.windows.length > 0);
  }

  onChange(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private emit(): void {
    for (const cb of this.listeners) cb();
  }
}

export const usageStore = new UsageStore();
