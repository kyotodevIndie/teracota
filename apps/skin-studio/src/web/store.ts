// Estado do editor: o rig.json cru, o que foi salvo, desfazer/refazer e a seleção.
// Quem desenha assina `onChange`; quem edita chama `commit` (entra no desfazer) ou
// `live` (durante um arrasto; o `commit` no fim fecha a edição num passo só).
import type { SkinFile } from '../studio-api';
import { type RawRig, clone } from './edit';

const UNDO_MAX = 200;

export type Tab = 'layer' | 'pose' | 'expr' | 'ctrl' | 'json' | 'report';

export class Store {
  raw: RawRig;
  files: SkinFile[] = [];
  selected: string | null = null;
  tab: Tab = 'layer';
  /** Pose sendo editada na aba Poses */
  pose = 'idle';
  /** Expressão sendo vista na aba Expressões */
  expression = 'happy';
  playing = false;
  playState = 'idle';
  private saved: string;
  private undoStack: string[] = [];
  private redoStack: string[] = [];
  /** Antes do arrasto em andamento (pro desfazer pegar o arrasto inteiro) */
  private liveBase: string | null = null;
  private readonly listeners = new Set<(why: 'rig' | 'ui') => void>();

  constructor(raw: RawRig) {
    this.raw = raw;
    this.saved = JSON.stringify(raw);
  }

  get dirty(): boolean {
    return JSON.stringify(this.raw) !== this.saved;
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  onChange(cb: (why: 'rig' | 'ui') => void): void {
    this.listeners.add(cb);
  }

  emit(why: 'rig' | 'ui'): void {
    for (const cb of this.listeners) cb(why);
  }

  /** Edição terminada: entra no desfazer */
  commit(next: RawRig): void {
    const before = this.liveBase ?? JSON.stringify(this.raw);
    this.liveBase = null;
    if (before === JSON.stringify(next)) return;
    this.undoStack.push(before);
    if (this.undoStack.length > UNDO_MAX) this.undoStack.shift();
    this.redoStack = [];
    this.raw = next;
    this.emit('rig');
  }

  /** Edição em andamento (arrasto): mostra, mas o desfazer só vê o resultado final */
  live(next: RawRig): void {
    this.liveBase ??= JSON.stringify(this.raw);
    this.raw = next;
    this.emit('rig');
  }

  undo(): void {
    const prev = this.undoStack.pop();
    if (!prev) return;
    this.redoStack.push(JSON.stringify(this.raw));
    this.raw = JSON.parse(prev) as RawRig;
    this.emit('rig');
  }

  redo(): void {
    const next = this.redoStack.pop();
    if (!next) return;
    this.undoStack.push(JSON.stringify(this.raw));
    this.raw = JSON.parse(next) as RawRig;
    this.emit('rig');
  }

  /** Salvou (ou recarregou do disco): este passa a ser o "sem mudanças" */
  markSaved(raw: RawRig = this.raw): void {
    this.saved = JSON.stringify(raw);
    this.emit('ui');
  }

  /** Troca tudo pelo que está no disco (mantém o desfazer, dá pra voltar) */
  replace(raw: RawRig): void {
    this.commit(clone(raw));
    this.markSaved(raw);
  }

  select(id: string | null): void {
    this.selected = id;
    this.emit('ui');
  }

  set<K extends 'tab' | 'pose' | 'expression' | 'playing' | 'playState'>(key: K, value: Store[K]): void {
    (this as Store)[key] = value;
    this.emit('ui');
  }
}
