import type { Anim, Expression, StateName } from '../shared/protocol';
import type { Pose } from '@tera/character/skin';

export interface StateDef {
  pose: Pose;
  expression: Expression;
  anim: Anim;
  /** Ícone ao lado da cabeça */
  prop: string;
  /** Volta ao estado base depois de N ms */
  duration?: number;
  /** Atividade de ferramenta — expira se nenhum evento novo chegar */
  tool?: boolean;
}

export const STATE_DEFS: Record<StateName, StateDef> = {
  idle:       { pose: 'idle',      expression: 'neutral',   anim: 'bob',     prop: '' },
  listening:  { pose: 'surprised', expression: 'surprised', anim: 'perk',    prop: '❗', tool: true },
  thinking:   { pose: 'think',     expression: 'focused',   anim: 'sway',    prop: '💭' },
  reading:    { pose: 'work',      expression: 'focused',   anim: 'bob',     prop: '📖', tool: true },
  searching:  { pose: 'work',      expression: 'focused',   anim: 'sway',    prop: '🔍', tool: true },
  typing:     { pose: 'work',      expression: 'focused',   anim: 'type',    prop: '⌨️', tool: true },
  terminal:   { pose: 'work',      expression: 'focused',   anim: 'type',    prop: '💻', tool: true },
  web:        { pose: 'work',      expression: 'neutral',   anim: 'sway',    prop: '🌐', tool: true },
  delegating: { pose: 'talk',      expression: 'happy',     anim: 'bob',     prop: '👥' },
  error:      { pose: 'error',     expression: 'confused',  anim: 'shake',   prop: '💢', duration: 2500 },
  attention:  { pose: 'wave',      expression: 'surprised', anim: 'wave',    prop: '🙋' },
  happy:      { pose: 'happy',     expression: 'happy',     anim: 'jump',    prop: '✨', duration: 3500 },
  sad:        { pose: 'sad',       expression: 'sad',       anim: 'breathe', prop: '💧', duration: 4000 },
  sleeping:   { pose: 'sleep',     expression: 'sleepy',    anim: 'breathe', prop: '💤' },
};

/** Estados de ferramenta voltam a "pensando" se nada novo chegar */
export const TOOL_STATE_TIMEOUT = 8000;
/** Ocioso por esse tempo → dorme */
export const SLEEP_AFTER = 3 * 60 * 1000;
