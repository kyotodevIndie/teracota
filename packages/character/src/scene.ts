// Cena do rig em Canvas 2D: carrega as camadas, desenha na ordem de z e responde
// "qual camada está sob este ponto" só com matemática (matriz inversa + máscara de
// alfa gerada uma vez no carregamento). Nada de ler pixels da tela a cada quadro.
import {
  type AlphaMask, type LayerOffset, type Mat, type RigLayer, type RigManifest,
  apply, drawOrder, hitLayer, multiply, topoOrder, worldMatrices,
} from './rig';

/** Lado máximo da máscara de alfa de cada camada (px) */
const MASK_MAX = 64;

interface LoadedVariant {
  bitmap: ImageBitmap;
  mask: AlphaMask;
}

interface LoadedLayer {
  layer: RigLayer;
  variants: Map<string, LoadedVariant>;
  /** tamanho da imagem padrão (o espaço de `pivot` e `at` dos filhos) */
  width: number;
  height: number;
}

/** O que muda de um quadro pro outro além das matrizes */
export interface SceneState {
  /** Variante por camada (ausente ou desconhecida = "default") */
  variants?: Record<string, string>;
  hidden?: Set<string>;
}

export class RigScene {
  private readonly order: RigLayer[];
  private readonly drawn: RigLayer[];
  private world = new Map<string, Mat>();
  /** Camadas e máscaras do último quadro desenhado (o clique usa o que está na tela) */
  private visible: RigLayer[] = [];
  private masks = new Map<string, AlphaMask>();

  private constructor(
    readonly rig: RigManifest,
    private readonly loaded: Map<string, LoadedLayer>,
  ) {
    this.order = topoOrder(rig);
    this.drawn = drawOrder(rig);
  }

  /**
   * Carrega todas as camadas antes de desenhar qualquer coisa. Qualquer falha rejeita
   * (o chamador cai na skin original).
   * @param scale px de tela por px do rig (as imagens já são reduzidas pra esse tamanho)
   */
  static async load(rig: RigManifest, baseUrl: string, scale: number): Promise<RigScene> {
    const loaded = new Map<string, LoadedLayer>();
    await Promise.all(rig.layers.map(async (layer) => {
      const maxScale = Math.max(...layer.scale) * 1.5; // folga pra respiração/escala procedural
      const k = Math.min(1, scale * maxScale);
      const variants = new Map<string, LoadedVariant>();
      let size: { width: number; height: number } | null = null;
      // todas as variantes são decodificadas agora: trocar de expressão nunca espera disco
      for (const [name, file] of Object.entries(layer.variants)) {
        const img = new Image();
        img.src = new URL(file, baseUrl).href;
        try {
          await img.decode();
        } catch {
          throw new Error(`camada "${layer.id}": não consegui carregar ${file}`);
        }
        const { naturalWidth: width, naturalHeight: height } = img;
        if (name === 'default') size = { width, height };
        const bitmap = await createImageBitmap(img, {
          resizeWidth: Math.max(1, Math.round(width * k)),
          resizeHeight: Math.max(1, Math.round(height * k)),
          resizeQuality: 'high',
        });
        variants.set(name, { bitmap, mask: alphaMask(img, width, height) });
      }
      loaded.set(layer.id, { layer, variants, ...size! });
    }));
    return new RigScene(rig, loaded);
  }

  /**
   * Desenha a cena.
   * @param root transformação px do rig → px do canvas (movimento do corpo inteiro)
   */
  draw(ctx: CanvasRenderingContext2D, root: Mat, offsets: Record<string, LayerOffset>, state: SceneState = {}, debug = false): void {
    this.world = worldMatrices(this.order, offsets);
    this.visible = [];
    this.masks = new Map();
    for (const l of this.drawn) {
      if (state.hidden?.has(l.id)) continue;
      const item = this.loaded.get(l.id)!;
      // variante pedida e inexistente (ex.: expressão de outro rig) cai na padrão
      const v = item.variants.get(state.variants?.[l.id] ?? 'default') ?? item.variants.get('default')!;
      const m = multiply(root, this.world.get(l.id)!);
      ctx.setTransform(m[0], m[1], m[2], m[3], m[4], m[5]);
      // a variante é desenhada no espaço da padrão (pivô e filhos dependem dele)
      ctx.drawImage(v.bitmap, 0, 0, item.width, item.height);
      this.visible.push(l);
      this.masks.set(l.id, v.mask);
    }
    if (debug) this.drawDebug(ctx, root);
  }

  /** Camada sob o ponto (px do rig), considerando o último quadro desenhado; null = nenhuma */
  hit(x: number, y: number): string | null {
    return hitLayer(this.visible, this.world, this.masks, x, y);
  }

  /** Pivôs (pontos) e caixas das camadas, pra conferir o rig */
  private drawDebug(ctx: CanvasRenderingContext2D, root: Mat): void {
    for (const l of this.visible) {
      const item = this.loaded.get(l.id)!;
      const m = multiply(root, this.world.get(l.id)!);
      const corners = [[0, 0], [item.width, 0], [item.width, item.height], [0, item.height]].map(([x, y]) => apply(m, x!, y!));
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.strokeStyle = 'rgba(30, 90, 200, .55)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (const [i, [x, y]] of corners.entries()) {
        if (i) ctx.lineTo(x, y);
        else ctx.moveTo(x, y);
      }
      ctx.closePath();
      ctx.stroke();
      const [px, py] = apply(m, l.pivot[0], l.pivot[1]);
      ctx.fillStyle = '#e11d48';
      ctx.beginPath();
      ctx.arc(px, py, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

/** Alfa da imagem reduzido pra no máximo MASK_MAX de lado (uma leitura de pixels por camada, só no carregamento) */
function alphaMask(img: HTMLImageElement, width: number, height: number): AlphaMask {
  const k = Math.min(1, MASK_MAX / Math.max(width, height));
  const mw = Math.max(1, Math.round(width * k));
  const mh = Math.max(1, Math.round(height * k));
  const canvas = new OffscreenCanvas(mw, mh);
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0, mw, mh);
  const px = ctx.getImageData(0, 0, mw, mh).data;
  const data = new Uint8Array(mw * mh);
  for (let i = 0; i < data.length; i++) data[i] = px[i * 4 + 3]!;
  return { width, height, mw, mh, data };
}
