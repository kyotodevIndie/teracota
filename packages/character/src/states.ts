// Os estados que a Tera mostra no app (o que cada evento das IAs vira), com a pose e a
// expressão de cada um. O Skin Studio e o `tera-skin render` usam esta lista pra mostrar
// a skin em cada situação; o app tem a definição completa (ícone, duração...) e um teste
// garante que as duas listas batem.
import type { Pose } from './skin';

export interface CharacterState {
  id: string;
  /** Nome pra mostrar (pt-BR) */
  label: string;
  pose: Pose;
  expression: string;
}

export const CHARACTER_STATES: readonly CharacterState[] = [
  { id: 'idle', label: 'Ociosa', pose: 'idle', expression: 'neutral' },
  { id: 'listening', label: 'Ouvindo', pose: 'surprised', expression: 'surprised' },
  { id: 'thinking', label: 'Pensando', pose: 'think', expression: 'focused' },
  { id: 'reading', label: 'Lendo', pose: 'work', expression: 'focused' },
  { id: 'searching', label: 'Procurando', pose: 'work', expression: 'focused' },
  { id: 'typing', label: 'Editando', pose: 'work', expression: 'focused' },
  { id: 'terminal', label: 'Terminal', pose: 'work', expression: 'focused' },
  { id: 'web', label: 'Na web', pose: 'work', expression: 'neutral' },
  { id: 'delegating', label: 'Delegando', pose: 'talk', expression: 'happy' },
  { id: 'error', label: 'Erro', pose: 'error', expression: 'confused' },
  { id: 'attention', label: 'Esperando você', pose: 'wave', expression: 'surprised' },
  { id: 'happy', label: 'Terminou', pose: 'happy', expression: 'happy' },
  { id: 'sad', label: 'Triste', pose: 'sad', expression: 'sad' },
  { id: 'sleeping', label: 'Dormindo', pose: 'sleep', expression: 'sleepy' },
];

/** Expressões que o app pede (uma skin pode definir só algumas; as outras ficam neutras) */
export const EXPRESSIONS_USED = [...new Set(CHARACTER_STATES.map((s) => s.expression))];
