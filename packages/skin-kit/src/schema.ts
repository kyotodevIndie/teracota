// JSON Schema do rig.json: o editor (ou um agente) completa campos e acusa erro enquanto
// escreve. A validação de verdade é parseRigManifest (@tera/character/rig), que também
// confere o que um schema não alcança (pais existentes, ciclos, variantes citadas).
import { MAX_LAYERS } from '@tera/character/rig';
import { POSES } from '@tera/character/skin';
import { EXPRESSIONS_USED } from '@tera/character/states';

const id = { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$' };
const png = { type: 'string', pattern: '^(?![\\\\/])(?!.*\\.\\.)(?!.*://).*\\.png$', description: 'PNG relativo à pasta da skin' };
const pair = (description: string) => ({ type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2, description });
const layerRef = { ...id, description: 'id de uma camada' };

export const RIG_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'Rig 2D da Tera',
  description: 'Personagem montado com PNGs em camadas articuladas. Guia: docs/dev/skin-studio.md',
  type: 'object',
  required: ['canvas', 'layers'],
  additionalProperties: false,
  properties: {
    $schema: { type: 'string' },
    canvas: { type: 'number', minimum: 16, maximum: 4096, description: 'Lado do canvas do rig, em px (o "at" da raiz usa esse espaço)' },
    feet: pair('Ponto dos pés [x, y] em px do canvas: âncora do movimento do corpo inteiro'),
    layers: {
      type: 'array',
      minItems: 1,
      maxItems: MAX_LAYERS,
      items: {
        type: 'object',
        required: ['id', 'image', 'pivot', 'at'],
        additionalProperties: false,
        properties: {
          id: { ...id, description: 'Nome da camada (letras, números, _ e -)' },
          image: { ...png, description: 'PNG da variante padrão' },
          variants: {
            type: 'object',
            description: 'Imagens alternativas do mesmo tamanho da padrão, por nome (ex.: olhos "closed")',
            propertyNames: { ...id, not: { const: 'default' } },
            additionalProperties: png,
          },
          visible: { type: 'boolean', description: 'false = começa escondida' },
          parent: { anyOf: [layerRef, { type: 'null' }], description: 'Camada pai (null = raiz; só uma raiz)' },
          pivot: pair('Ponto de rotação, em px da própria imagem'),
          at: pair('Onde o pivô fica, em px da imagem do pai (raiz: px do canvas)'),
          z: { type: 'number', description: 'Ordem de desenho (maior = na frente)' },
          rotation: { type: 'number', description: 'Ângulo de repouso, em graus' },
          scale: { anyOf: [{ type: 'number', minimum: 0.1, maximum: 5 }, pair('[sx, sy] entre 0.1 e 5')] },
          limits: {
            type: 'object',
            additionalProperties: false,
            properties: { rotation: pair('Limite [min, max] dos ângulos procedurais, em graus') },
          },
        },
      },
    },
    poses: {
      type: 'object',
      description: `Ajustes por camada em cada pose. O app pede: ${POSES.join(', ')}`,
      propertyNames: id,
      additionalProperties: {
        type: 'object',
        required: ['layers'],
        additionalProperties: false,
        properties: {
          layers: {
            type: 'object',
            propertyNames: layerRef,
            additionalProperties: {
              type: 'object',
              additionalProperties: false,
              properties: {
                rotation: { type: 'number', description: 'graus, somados ao repouso' },
                dx: { type: 'number' },
                dy: { type: 'number' },
                scaleX: { type: 'number' },
                scaleY: { type: 'number' },
                variant: { ...id, description: 'variante da camada nesta pose' },
                visible: { type: 'boolean' },
              },
            },
          },
        },
      },
    },
    expressions: {
      type: 'object',
      description: `Variante por camada em cada expressão. O app usa: ${EXPRESSIONS_USED.join(', ')}`,
      propertyNames: id,
      additionalProperties: { type: 'object', propertyNames: layerRef, additionalProperties: id },
    },
    controllers: {
      type: 'object',
      additionalProperties: false,
      properties: {
        breathe: {
          type: 'object', required: ['layer'], additionalProperties: false,
          properties: { layer: layerRef, period: { type: 'number', exclusiveMinimum: 0 }, amount: { type: 'number', minimum: 0, maximum: 0.2 } },
        },
        sway: {
          type: 'object', required: ['layers'], additionalProperties: false,
          properties: { layers: { type: 'array', items: layerRef, minItems: 1 }, amplitude: { type: 'number', minimum: 0, maximum: 90 }, period: { type: 'number', exclusiveMinimum: 0 } },
        },
        blink: {
          type: 'object', required: ['layer', 'closed'], additionalProperties: false,
          properties: { layer: layerRef, open: id, closed: id, interval: pair('[mín, máx] ms entre piscadas'), duration: { type: 'number', minimum: 40, maximum: 1000 } },
        },
        gaze: {
          type: 'object', required: ['layer', 'max'], additionalProperties: false,
          properties: { layer: layerRef, max: pair('deslocamento máximo [x, y] em px do pai'), head: layerRef, headMax: { type: 'number', minimum: 0, maximum: 30 } },
        },
        talk: {
          type: 'object', required: ['layer', 'variants'], additionalProperties: false,
          properties: { layer: layerRef, variants: { type: 'array', items: id, minItems: 2 }, period: { type: 'number', minimum: 40, maximum: 1000 } },
        },
        walk: {
          type: 'object', required: ['legs'], additionalProperties: false,
          properties: {
            legs: { type: 'array', items: layerRef, minItems: 2, maxItems: 2 },
            arms: { type: 'array', items: layerRef, minItems: 2, maxItems: 2 },
            swing: { type: 'number', minimum: 0, maximum: 80 },
            period: { type: 'number', exclusiveMinimum: 0 },
          },
        },
      },
    },
  },
} as const;
