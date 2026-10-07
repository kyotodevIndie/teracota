// Decide qual Tera recebe cada evento, conforme o modo:
// - single: uma Tera só; agrega o estado de todas as sessões
// - multi:  uma Tera por sessão; a primeira ("de casa") nunca vai embora
import type { WebContents } from 'electron';
import { app, screen } from 'electron';
import { CHARACTER_NAME, ENTITY_COLORS } from '../shared/brand';
import type { EntityMode, Identity, MoveMode, Point } from '../shared/ipc';
import type { CompanionEvent, IncomingEvent } from '../shared/protocol';
import { saveConfig, type Config } from './config';
import { Entity, SIZE, cornerPosition, isOnScreen } from './entity';
import { providerInfo } from './integrations';
import type { AgentSignal } from './integrations/types';
import { platform } from './platform';
import { SessionTracker, sessionKey, type Session } from './sessions';

export const MAX_ENTITIES = 5;
const PRUNE_EVERY_MS = 30_000;
/** Janela pra casar a chamada MCP com o sinal `mcpCall` que a precedeu */
const MCP_MATCH_MS = 5000;

const HOME_IDENTITY: Identity = { label: null, color: ENTITY_COLORS[0] };

export class EntityManager {
  private entities: Entity[] = [];
  /** A Tera "de casa": nunca vai embora e é a única que lembra a posição entre execuções */
  private home: Entity | null = null;
  private readonly sessions = new SessionTracker();
  private pendingMcp: { key: string; at: number } | null = null;

  constructor(private config: Config) {
    setInterval(() => this.prune(), PRUNE_EVERY_MS);
  }

  get mode(): EntityMode {
    return this.config.entityMode;
  }

  get moveMode(): MoveMode {
    return this.config.moveMode;
  }

  private visible = true;

  get isVisible(): boolean {
    return this.visible;
  }

  start(): void {
    this.spawnHome();
    if (!this.config.onboarded) {
      this.updateConfig({ onboarded: true });
      // primeira vez: já abre junto com o sistema (dá pra desligar no menu).
      // Só no app instalado — em dev registraria o Electron cru.
      if (app.isPackaged && platform.autostart.supported) app.setLoginItemSettings({ openAtLogin: true });
      setTimeout(() => this.entities[0]?.send({
        state: 'attention',
        duration: 5000,
        say: `Oi! Eu sou a ${CHARACTER_NAME} 👋 Vou te fazer companhia enquanto você programa!`,
      }), 1500);
    }
  }

  /** A oferta de conectar a um agente já foi feita (ou não é mais necessária) */
  get connectOffered(): boolean {
    return this.config.connectOffered === true;
  }

  markConnectOffered(): void {
    if (!this.connectOffered) this.updateConfig({ connectOffered: true });
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    for (const e of this.entities) e.setVisible(visible);
  }

  /** Traz todas pro canto (ex.: se alguma se perdeu num monitor desligado) */
  resetPositions(): void {
    for (const e of this.entities) e.resetPosition();
  }

  byWebContents(wc: WebContents): Entity | undefined {
    return this.entities.find((e) => e.alive && e.win.webContents === wc);
  }

  // ---------- entrada de eventos ----------

  /** Sinal normalizado de um adapter de agente (ou da API local com source) */
  handleSignal(signal: AgentSignal): void {
    const { provider, sessionId, project } = signal.source;
    const key = sessionKey(provider, sessionId);
    const { capabilities } = providerInfo(provider);
    const providersBefore = this.sessions.providerCount();
    const session = this.sessions.touch(key, { provider, project, reportsCompletion: capabilities.completion });
    if (this.sessions.providerCount() !== providersBefore) this.refreshLabels();

    if (signal.working !== undefined) session.working = signal.working;
    if (signal.mcpCall) this.pendingMcp = { key, at: Date.now() };
    const label = this.labelFor(session);
    if (signal.lifecycle === 'end') {
      this.sessions.remove(key);
      if (this.sessions.providerCount() !== providersBefore) this.refreshLabels();
    }

    if (this.mode === 'single') this.routeSingle(signal, label);
    else this.routeMulti(signal, key, label);
  }

  /** Evento da API local: com source entra no fluxo de sessões; sem, vai pra todas */
  handleEvent({ event, source, lifecycle }: IncomingEvent): void {
    if (source) {
      this.handleSignal({
        source: { provider: source.provider, sessionId: source.sessionId ?? 'default', project: source.project ?? source.provider },
        lifecycle,
        working: event?.working,
        event,
      });
      return;
    }
    if (event) this.broadcast(event);
  }

  /** Evento vindo do MCP: vai pra Tera da sessão que chamou a ferramenta */
  handleMcp(event: CompanionEvent): void {
    const pending = this.pendingMcp && Date.now() - this.pendingMcp.at < MCP_MATCH_MS ? this.pendingMcp : null;
    this.pendingMcp = null;
    const key = pending?.key ?? this.sessions.list()[0]?.key;
    const target = (key && this.entityFor(key)) || this.entities[0];
    target?.send(event);
  }

  broadcast(event: CompanionEvent): void {
    for (const e of this.entities) e.send(event);
  }

  // ---------- modos ----------

  setEntityMode(mode: EntityMode): void {
    if (mode === this.mode) return;
    this.updateConfig({ entityMode: mode });
    // cria a nova antes de fechar as antigas — senão 'window-all-closed' encerra o app
    const old = this.entities;
    this.entities = [];
    this.spawnHome();
    for (const e of old) e.destroy();
    if (mode === 'multi') {
      for (const s of this.sessions.list().slice(0, MAX_ENTITIES)) this.assign(s.key, this.labelFor(s));
      this.broadcast({ state: 'happy', say: 'Uma pra cada sessão! 👯' });
    } else {
      this.entities[0]?.send({ state: 'happy', working: this.sessions.anyWorking(), say: 'Deixa comigo, cuido de tudo!' });
    }
  }

  get skinId(): string | undefined {
    return this.config.skin;
  }

  /** Troca a skin de todas as Teras (recarrega as janelas) */
  setSkin(id: string): void {
    this.updateConfig({ skin: id });
    for (const e of this.entities) e.win.reload();
  }

  setMoveMode(mode: MoveMode): void {
    this.updateConfig({ moveMode: mode });
    for (const e of this.entities) e.setMoveMode(mode, true);
  }

  // ---------- roteamento ----------

  /** Etiqueta da sessão: o projeto, ou "Agente · projeto" quando há agentes diferentes abertos */
  private labelFor(session: Session): string {
    return this.sessions.providerCount() > 1
      ? `${providerInfo(session.provider).displayName} · ${session.project}`
      : session.project;
  }

  /** Entrou ou saiu um agente diferente: as plaquinhas ganham/perdem o nome do agente */
  private refreshLabels(): void {
    for (const e of this.entities) {
      const session = e.sessionId ? this.sessions.get(e.sessionId) : undefined;
      if (session) e.setIdentity(e.sessionId, { ...e.identity, label: this.labelFor(session) });
    }
  }

  private routeSingle(signal: AgentSignal, label: string): void {
    const home = this.entities[0];
    const event = signal.event && { ...signal.event };
    if (!home || !event) return;
    event.working = this.sessions.anyWorking();
    if (signal.lifecycle === 'end' && this.sessions.size > 0) {
      // ainda há outras sessões: só se despede daquela, sem dormir
      home.send({ say: 'Tchau! 👋', from: label, working: event.working });
      return;
    }
    if (this.sessions.size > 1 && event.say) event.from = label;
    home.send(event);
  }

  private routeMulti(signal: AgentSignal, key: string, label: string): void {
    let entity = this.entityFor(key);
    if (signal.lifecycle === 'end') {
      if (entity) this.release(entity);
      return;
    }
    entity ??= this.assign(key, label) ?? undefined;
    if (!entity) return;
    if (entity.identity.label !== label) entity.setIdentity(key, { ...entity.identity, label });
    if (signal.event) entity.send(signal.event);
  }

  private entityFor(sessionId: string): Entity | undefined {
    return this.entities.find((e) => e.sessionId === sessionId);
  }

  /** Dá uma Tera pra sessão: reaproveita a de casa se estiver livre, senão cria outra */
  private assign(sessionId: string, project: string): Entity | null {
    const free = this.entities.find((e) => e.sessionId === null);
    if (free) {
      free.setIdentity(sessionId, { ...free.identity, label: project });
      return free;
    }
    if (this.entities.length >= MAX_ENTITIES) return null;
    const used = new Set(this.entities.map((e) => e.identity.color));
    const color = ENTITY_COLORS.find((c) => !used.has(c)) ?? ENTITY_COLORS[0];
    const entity = this.spawn(this.freeSpot(), { label: project, color });
    entity.sessionId = sessionId;
    return entity;
  }

  /** Sessão acabou: a Tera de casa (ou a última) fica livre; as outras vão embora */
  private release(entity: Entity): void {
    if (entity === this.home || this.entities.length === 1) {
      entity.setIdentity(null, HOME_IDENTITY);
      entity.send({ state: 'idle', working: false, say: 'Tchau! 👋' });
      return;
    }
    this.entities = this.entities.filter((e) => e !== entity);
    entity.leave();
  }

  private prune(): void {
    const { removed, workingChanged } = this.sessions.prune();
    if (this.mode === 'multi') {
      for (const id of removed) {
        const e = this.entityFor(id);
        if (e) this.release(e);
      }
      if (removed.length) this.refreshLabels();
    } else if (workingChanged) {
      this.entities[0]?.send({ working: this.sessions.anyWorking() });
    }
  }

  // ---------- criação ----------

  private spawnHome(): void {
    const { x, y } = this.config;
    const saved = x !== undefined && y !== undefined ? { x, y } : null;
    this.home = this.spawn(saved && isOnScreen(saved) ? saved : cornerPosition(), HOME_IDENTITY, true);
  }

  private spawn(position: Point, identity: Identity, persist = false): Entity {
    const entity = new Entity({
      position,
      identity,
      visible: this.visible,
      moveMode: this.moveMode,
      // só a primeira Tera lembra a posição entre execuções
      onSettle: persist ? ({ x, y }) => this.updateConfig({ x, y }) : undefined,
    });
    entity.win.on('closed', () => { this.entities = this.entities.filter((e) => e !== entity); });
    this.entities.push(entity);
    return entity;
  }

  /** Um lugar no rodapé da tela longe das outras Teras */
  private freeSpot(): Point {
    const area = screen.getPrimaryDisplay().workArea;
    const y = area.y + area.height - SIZE.height;
    const others = this.entities.map((e) => e.position.x);
    let best = { x: area.x, score: -1 };
    for (let i = 0; i < 12; i++) {
      const x = area.x + Math.random() * (area.width - SIZE.width);
      const score = Math.min(Infinity, ...others.map((o) => Math.abs(o - x)));
      if (score > best.score) best = { x, score };
    }
    return { x: best.x, y };
  }

  private updateConfig(patch: Partial<Config>): void {
    this.config = { ...this.config, ...patch };
    saveConfig(this.config);
  }
}
