// "Visual" pedido ao personagem. O SVG usa expressão + animação CSS;
// as skins de sprite usam a pose. Os estados definem os três.
import type { Anim, Expression } from '../shared/protocol';
import type { Pose } from '@tera/character/skin';

export interface Look {
  pose: Pose;
  expression: Expression;
  anim: Anim | null;
}

const ANIM_POSE: Partial<Record<Anim, Pose>> = {
  jump: 'happy', wave: 'wave', shake: 'error', perk: 'surprised', type: 'work',
};

const EXPRESSION_POSE: Record<Expression, Pose> = {
  neutral: 'idle', happy: 'happy', focused: 'think', confused: 'error',
  surprised: 'surprised', sleepy: 'sleep', sad: 'sad',
};

/** Pose equivalente a uma expressão/animação (eventos do MCP só mandam essas duas) */
export function poseFor(expression?: Expression, anim?: Anim | null): Pose | undefined {
  return (anim && ANIM_POSE[anim]) || (expression && EXPRESSION_POSE[expression]) || undefined;
}
