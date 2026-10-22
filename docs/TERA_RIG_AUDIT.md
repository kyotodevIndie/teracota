# Auditoria técnica: renderização da Tera e viabilidade de um rig 2D

> Data: 2026-10-07 · Somente leitura: nenhum código foi alterado e nenhuma dependência instalada.
> Base analisada: branch `feat/mini-companion` (inclui o protótipo do Mini Companion, ainda sem commit).

## Resumo

- **A Tera hoje é sprite em Canvas 2D**, sem framework de interface (TypeScript puro + esbuild).
  Cada pose tem 4 PNGs de 512×512. A fluidez vem de movimento procedural (`wobble.ts`) e de
  uma mola de pêndulo (`pendulum.ts`).
- **Já existe a abstração certa:** a interface `Character` (`src/renderer/character.ts`). O
  app inteiro (estados, passeio, arrastar, balão, clique) fala só com ela. Um rig entra como
  **uma terceira implementação**, `RigCharacter`, sem mexer no resto.
- **Recomendação: aproveitar o Canvas 2D atual, não usar PixiJS no MVP.** São ~25 peças numa
  janela de 260 px: o Canvas 2D dá conta com folga, e o projeto já está pronto e testado em
  janelas transparentes no Windows. Deixar a cena isolada permite trocar por PixiJS depois, se
  um dia precisar de deformação de malha.
- **O gargalo não é código, é arte.** O rig precisa da Tera desenhada em camadas separadas,
  com as áreas escondidas pintadas por baixo. Os frames atuais são imagens únicas e não servem
  como fonte.
- ⚠️ **Divergência de identidade visual:** o pedido fala em **moletom preto**, mas a arte atual
  (`assets/skins/tera/frames/*`) é um **moletom terracota/laranja** com gola branca. As mãos já
  são humanas. É preciso decidir qual é a referência antes de encomendar as camadas.

## 1. Arquitetura atual

### Electron

| Processo | Arquivos | Papel |
|---|---|---|
| Main | `src/main/main.ts`, `entity.ts`, `manager.ts`, `walker.ts`, `server.ts`, `skins.ts` | Ciclo de vida. Cada Tera é uma janela própria: transparente, sem moldura, sempre no topo, deixando o clique passar. Roteamento por sessão, passeio, servidor HTTP local e carregamento de skins. |
| Preload | `src/preload/preload.ts` | Expõe `window.teracota`, com contextIsolation e sem Node no renderer. |
| Renderer | `src/renderer/app.ts` + `index.html` + `style.css` | O "cérebro" da personagem: estados, mouse, balão. |
| Contrato | `src/shared/ipc.ts`, `protocol.ts`, `skin.ts` | Tipos e canais IPC; `CompanionEvent`; manifesto de skin. |
| Mini Companion | `src/main/companion/*`, `src/renderer/companion.*` | Janela compacta (protótipo). Mostra os frames da skin com `<img>`. |

- **Framework de interface:** nenhum. É DOM + TypeScript, empacotado por `build.mjs` (esbuild,
  renderer em formato IIFE para `chrome130`).
- **CSP do renderer:** `default-src 'self'`; imagens de `file:` e `data:`.

### Como a Tera é desenhada

- **Interface comum:** `src/renderer/character.ts` (`Character`). Métodos: `show(look)`,
  `setMotion`, `setTalking`, `setSwing`, `lookAt`, `hitTest`, `setProp`.
- **Implementação 1, sprites (padrão):** `src/renderer/sprite-character.ts`.
  - Um `<canvas>` 2D. Frames pré-redimensionados com `createImageBitmap`.
  - Laço `requestAnimationFrame` com fps adaptativo: 60 se movendo, 24 parada, 15 dormindo.
  - Cada quadro aplica a transformação procedural e a escala da animação ancorada nos pés.
  - Clique só na personagem: `hitTest` usa máscaras de alfa de 64×64 calculadas no main (`skins.ts`).
- **Implementação 2, SVG (reserva):** `src/renderer/svg-character.ts`. É uma personagem
  desenhada em código, com expressões (olhos/boca por expressão) e animações CSS. Usada se a
  skin falhar.
- **Assets:** `assets/skins/tera/skin.json` + `frames/<pose>/01..04.png` (512×512, RGBA).
  - 13 poses: idle, walk, drag, land, work, think, talk, happy, error, sad, sleep, wave, surprised.
  - `scale` por animação (work/sleep 0.84), `loop:false` (land), `swing` (drag).
  - Validação em `src/shared/skin.ts` (`parseSkinManifest`) e carga em `src/main/skins.ts`.

## 2. Animações e interações existentes

| Recurso | Onde | Reaproveitável no rig? |
|---|---|---|
| Estados → visual (`pose`, `expression`, `anim`, ícone, duração) | `src/renderer/states.ts`, `look.ts` | **Sim, sem mudança.** O rig recebe o mesmo `Look`. |
| Máquina de estados da personagem (estado base, reação passageira, dormir depois de 3 min, expirar ferramenta) | `src/renderer/app.ts` | **Sim**: fala só com `Character`. |
| Respiração, quique ao andar, tremidinha de erro, inclinação | `src/renderer/wobble.ts` (`wobbleFor`) | **Sim**: vira o movimento do corpo inteiro (nó raiz). |
| Física de pêndulo ao arrastar (mola amortecida) | `src/renderer/pendulum.ts` | **Sim**: a mesma mola serve de base pra cauda, o cabelo e os cordões. |
| Carinho (mouse indo e voltando) | `src/renderer/pet.ts` | Sim, sem mudança. |
| Balão com digitação + "boca mexendo" (`setTalking`) | `src/renderer/bubble.ts` | Sim. No rig, `setTalking` alterna as bocas. |
| Olhar o cursor (`lookAt`) | `character.ts` (as sprites ignoram; o SVG implementa) | **Sim**: no rig vira cabeça + olhos seguindo o cursor. |
| Passeio | `src/main/walker.ts` + `setMotion('walk')` | Sim. O rig anima as pernas proceduralmente. |
| Clique/arrastar/hover via posição do cursor (polling de 33 ms) | `entity.ts` + `app.ts` | Sim. O rig só precisa de um `hitTest` próprio. |

**Como os eventos do Claude Code chegam à interface:**
1. O hook do plugin roda `curl` com o JSON pra `POST 127.0.0.1:7777/hook` (`server.ts`).
2. `adapter.ts` traduz o JSON num `AgentSignal`.
3. `manager.ts` escolhe a Tera.
4. `entity.send()` repassa por IPC (`teracota:event`).
5. `app.ts` chama `handleEvent` → `setState` → `character.show(look)`.

**O renderer nunca sabe de onde o evento veio.** O rig não toca em nada disso.

**Interpolação:** não há uma biblioteca de tweens. O movimento é por funções de tempo (seno)
e por uma mola integrada a cada quadro. Isso já cobre o que o MVP precisa.

## 3. Viabilidade do rig 2D

### Canvas 2D atual × PixiJS

| Critério | Aproveitar o Canvas 2D | PixiJS (v8) |
|---|---|---|
| Integração | Zero dependências. Mesmo build, mesmo CSP. | Entra fácil no bundle IIFE. **Risco de CSP:** partes do Pixi usam geração de código. Com `default-src 'self'` pode ser preciso o módulo de compatibilidade do Pixi ou afrouxar o CSP. **Verificar na versão escolhida.** |
| Desempenho pra ~25 peças em 260 px | Sobra: são ~25 `drawImage` com transformação por quadro, a 24 fps quando parada. | Sobra também, via WebGL. |
| Janelas transparentes, várias Teras (até 5) + mini | Já testado em produção. | Um contexto WebGL por janela (memória). Transparência com WebGL é mais sensível a driver no Windows. |
| Hierarquia, pivôs, z-order | ~150 linhas próprias: árvore de nós com matriz 2D. | Pronto (`Container`, `pivot`). |
| Deformação de malha (cabelo e roupa "dobrando") | Difícil. Dá pra simular com segmentos. | `MeshRope`/`MeshPlane` prontos: **é a única vantagem real.** |
| Clique só na personagem | Ler o alfa de 1 pixel num canvas fora da tela. | Precisa de hit área ou leitura de pixels também. |
| Manutenção | Código pequeno, testável e sem atualizações quebrando. | Dependência grande e com mudanças de API entre versões principais. |

**Conclusão: Canvas 2D no MVP.** A cena fica num módulo isolado (`scene.ts`) com a interface
"desenhe esta árvore". Se um dia precisar de malha (cabelo esvoaçante de verdade), troca-se só
esse módulo por um backend PixiJS.

### Como montar a personagem com PNGs articulados

- **Peças:** cada parte é um PNG transparente recortado justo, com o **pivô** (ponto de rotação)
  definido no manifesto. Exemplos: a base do pescoço pra cabeça, o ombro pro braço, a raiz pra
  cauda.
- **Hierarquia (transformações herdadas):**
  ```
  raiz (corpo inteiro: wobble, pêndulo, flip ao andar)
  ├─ cauda_1 → cauda_2 → cauda_3        (atrás do corpo)
  ├─ perna_e, perna_d (+ meia/sapato)
  ├─ tronco (moletom) ── cordões_e, cordões_d
  │   ├─ braço_e → antebraço_e → mão_e   (mão = slot trocável)
  │   ├─ braço_d → antebraço_d → mão_d
  │   └─ pescoço → cabeça
  │        ├─ cabelo_atrás, orelha_e, orelha_d (atrás do rosto)
  │        ├─ rosto (pele) ── olhos (slots), sobrancelhas (slots), boca (slot), blush
  │        └─ franja, mechas laterais, ahoge (na frente)
  ```
- **Ordem de desenho (z):** separada da hierarquia. Ex.: a cauda é filha da raiz mas fica atrás
  do tronco, e a orelha é filha da cabeça mas fica atrás do cabelo da frente. Cada peça tem um `z`.
- **Expressões = troca de slots.** Uma expressão define qual imagem cada slot usa:
  - olhos: aberto, semicerrado, fechado, feliz `^ ^`, surpreso;
  - boca: neutra, sorriso, aberta pequena e grande pra fala, triste;
  - sobrancelhas e blush.
  É o mesmo vocabulário das `Expression` do protocolo (`neutral`, `happy`, `focused`, ...).
- **Poses = predefinições de ângulo** por nó (braços, mãos, cabeça), interpoladas ao trocar de
  pose. Ex.: `wave` levanta o braço direito e troca a mão pra "aberta"; `work` dobra os braços e
  mostra o notebook.
- **Procedural por cima:** controladores pequenos e puros (testáveis) que somam ângulo ou
  escala a nós específicos:
  - respiração: tronco + ombros;
  - piscada: agendador aleatório que troca o slot dos olhos;
  - olhar: cabeça e íris seguem o cursor via `lookAt`;
  - balanço secundário: a mola do `pendulum.ts` aplicada em cadeia na cauda, no ahoge e nos cordões.
- **Clique (`hitTest`):** desenhar a cena também num canvas pequeno fora da tela e ler o alfa
  do pixel sob o cursor. Isso substitui as máscaras pré-calculadas, que não funcionam para peças
  que se movem.

### Bibliotecas necessárias

**Nenhuma nova no MVP.**
- Canvas 2D, `DOMMatrix` e `createImageBitmap` já estão no Chromium do Electron.
- Para produzir a arte: um editor com camadas (Krita, Photoshop, Clip Studio).
- Opcional: um script próprio em `scripts/`, no padrão do `import-skin.ts`, que lê pivôs e
  posições de um arquivo exportado e gera o `rig.json`.

## 4. Arquitetura recomendada

### Componentes

```
src/shared/rig.ts                 tipos + parseRigManifest (validação, como parseSkinManifest)
src/shared/rig.test.ts
src/renderer/rig/
  scene.ts                        árvore de nós, matriz 2D, ordem z, desenho em Canvas 2D
  rig-character.ts                implements Character: Look → pose + expressão + procedural
  controllers.ts                  respiração, piscada, olhar, mola em cadeia (funções puras)
  controllers.test.ts
  poses.ts                        interpolação entre predefinições de pose
```

### Arquivos existentes a modificar (pouco)

| Arquivo | Mudança |
|---|---|
| `src/shared/skin.ts` | `SkinManifest` ganha `type: 'sprites' \| 'rig'` (ausente = sprites, compatível com skins atuais) e `rig?: string`. |
| `src/main/skins.ts` | Pra skins `rig`: carregar `rig.json`, validar e não calcular máscaras de frame. |
| `src/renderer/app.ts` | `createCharacter()`: se `skin.manifest.type === 'rig'` → `RigCharacter.create(...)`. Mesmo fallback de hoje (erro → SVG). |
| `src/renderer/companion.ts` | Depois do MVP: o quadrado do Mini Companion pode usar o mesmo `RigCharacter`, recortado. Até lá ele continua com os frames. |
| `scripts/import-skin.ts` | Opcional: importar um rig. |

### Estrutura dos assets

```
assets/skins/tera-rig/
  skin.json        { "name": "Tera", "type": "rig", "size": 260, "facing": "right", "rig": "rig.json" }
  rig.json         peças, pivôs, hierarquia, z, slots, expressões, poses
  parts/
    body/          torso.png, hood.png, drawstring_l.png, drawstring_r.png
    arms/          upper_l.png, fore_l.png, upper_r.png, fore_r.png
    hands/         l_relaxed.png, l_open.png, l_typing.png, r_relaxed.png, r_open.png, r_wave.png ...
    legs/          leg_l.png, leg_r.png, shoe_l.png, shoe_r.png
    head/          face.png, neck.png, ear_l.png, ear_r.png
    hair/          back.png, bangs.png, side_l.png, side_r.png, ahoge.png
    tail/          tail_1.png, tail_2.png, tail_3.png
    face/          eyes_open.png, eyes_half.png, eyes_closed.png, eyes_happy.png, eyes_surprised.png,
                   brows_neutral.png, brows_worried.png, brows_focused.png,
                   mouth_neutral.png, mouth_smile.png, mouth_open_s.png, mouth_open_l.png, mouth_sad.png,
                   blush.png
    props/         laptop.png ...
    accessories/   (futuro) hat_*.png, glasses_*.png
    outfits/       (futuro) <roupa>/torso.png, upper_l.png ... (substitui o conjunto do moletom)
```

**Exemplo do `rig.json`** (formato proposto, enxuto):

```json
{
  "canvas": 1024,
  "parts": {
    "torso":  { "image": "parts/body/torso.png", "parent": "root", "pivot": [128, 40], "at": [512, 600], "z": 20 },
    "head":   { "image": "parts/head/face.png",  "parent": "neck", "pivot": [200, 330], "at": [0, -10], "z": 40 },
    "tail_1": { "image": "parts/tail/tail_1.png", "parent": "root", "pivot": [10, 60], "at": [600, 640], "z": 5 }
  },
  "slots": { "eyes": "head", "mouth": "head", "hand_r": "fore_r" },
  "expressions": {
    "neutral": { "eyes": "eyes_open", "mouth": "mouth_neutral", "brows": "brows_neutral" },
    "happy":   { "eyes": "eyes_happy", "mouth": "mouth_smile", "blush": true }
  },
  "poses": {
    "idle": {},
    "wave": { "upper_r": -120, "fore_r": -30, "hand_r": "r_wave" }
  }
}
```

**Acessórios e roupas:**
- **Acessório** é uma peça extra presa a um nó existente (`parent: "head"`), num slot opcional.
- **Roupa** é um conjunto que troca as imagens dos nós do moletom (torso, braços, capuz),
  mantendo os mesmos pivôs.
- Nenhum dos dois exige mudar o código.

## 5. Plano de implementação (etapas pequenas)

1. **Decidir a referência visual** (moletom preto × terracota atual) e **produzir as camadas**
   do MVP (lista na seção 6). Bloqueia tudo o que vem depois.
2. **Formato + validação:** `src/shared/rig.ts` com `parseRigManifest` e testes, no padrão de
   `skin.test.ts`. Tudo isolado, sem tocar no app.
3. **Cena:** `scene.ts` (árvore, pivôs, z, desenho) + uma página de teste que abre no navegador
   sem Electron, como o `app.ts` já permite.
4. **`RigCharacter` só com `idle`:**
   - implementa `Character`;
   - poses não suportadas caem em `idle`;
   - registrar como skin nova "Tera (rig, experimental)" no menu **Skin**;
   - a skin de sprites continua sendo a padrão.
5. **MVP procedural:**
   - **respiração:** escala sutil do tronco, ombros acompanhando, ancorada nos pés;
   - **piscadas:** intervalo aleatório de 2 a 6 s, ~120 ms fechada, às vezes dupla; olhos fechados ao dormir;
   - **cabeça:** inclinação de ±6° seguindo o cursor via `lookAt`, com suavização e deriva lenta quando o cursor está longe; íris acompanham;
   - **cauda:** 3 segmentos em mola encadeada (baseada no `pendulum.ts`), com um seno lento de base e reação ao arrastar e ao andar.
6. **Integração com o que já existe:**
   - `setMotion('walk')`: pernas alternando + o quique atual;
   - `setMotion('drag')`: o pêndulo atual na raiz + secundário na cauda e no cabelo;
   - `setTalking`: bocas alternando;
   - `hitTest`: pelo alfa do pixel.
7. **Expressões** (`neutral`, `happy`, `focused`, `confused`, `surprised`, `sleepy`, `sad`) por troca de slots.
8. **Poses** em ordem de uso: `work`, `think`, `wave`, `happy`, `error`, `sleep`. Depois `sad`, `surprised`, `land`. Com isso, o rig pode virar o padrão.
9. **Mini Companion:** o quadrado passa a usar o rig (meio corpo), e dá pra ajustar o
   enquadramento por pose.
10. **Desempenho:** medir CPU com 1 e com 5 Teras e manter o fps adaptativo. Meta: não piorar
    os ~5% de um núcleo que a Tera usa parada hoje.

**Como as funcionalidades atuais ficam preservadas:**
- O rig é **uma skin a mais**, escolhida no menu. Sprites e SVG continuam iguais.
- Nada do `app.ts`, dos estados, do passeio, do servidor ou dos hooks muda: o rig recebe o mesmo `Look`.
- Se o rig falhar ao carregar, cai no SVG, como já acontece com as sprites.

## 6. Recursos gráficos necessários

**Requisitos gerais:**
- Base em **1024×1024** (2× o frame atual), PNG RGBA, linha e paleta idênticas às da arte de referência.
- Cada peça recortada justa, com uma **sobra pintada nas juntas** (ombro, pescoço, quadril, raiz
  da cauda) pra não abrir buraco quando gira.
- **Áreas escondidas pintadas por baixo:** pescoço sob o cabelo, tronco sob os braços, rosto sob a franja.
- Entregar também o **arquivo de camadas** (PSD/KRA) com as peças já posicionadas na pose neutra.
  Ele é a referência pra medir os pivôs.

**Lista mínima pro MVP** (respiração, piscada, cabeça e cauda), cerca de 25 imagens:
- **Corpo:** tronco do moletom, capuz/gola, cordões esquerdo e direito.
- **Braços:** braço e antebraço de cada lado, na manga do moletom.
- **Mãos humanas:** uma relaxada de cada lado.
- **Pernas:** perna esquerda e direita (com a meia) e um sapato de cada lado.
- **Cabeça:** pescoço, rosto (pele, sem olhos e sem boca), orelha esquerda e direita.
- **Cabelo:** de trás, franja, mechas laterais esquerda e direita, ahoge.
- **Cauda:** 3 segmentos.
- **Rosto:** olhos abertos, semicerrados e fechados; boca neutra; sobrancelhas neutras; blush.

**Depois do MVP** (expressões e poses):
- Olhos feliz `^ ^` e surpreso; íris separada se quiser olhar pros lados.
- Bocas: sorriso, aberta pequena e grande (fala), triste e reta.
- Sobrancelhas preocupadas e focadas.
- Mãos: aberta, acenando, digitando e segurando.
- Props: notebook.
- Efeitos: gota de suor e "zzz", se ficarem desenhados em vez de emoji.

## 7. Riscos, dependências e incompatibilidades

| Risco | Impacto | Mitigação |
|---|---|---|
| **Produzir a arte em camadas** fiel ao design (os frames atuais foram gerados como imagens inteiras) | Alto: é o caminho crítico | Encomendar a um artista com o PSD como entrega; validar com 1 peça (cabeça + rosto) antes do lote. |
| Divergência moletom preto × terracota | Alto: retrabalho de arte | Decidir na etapa 1. |
| Juntas aparecendo ao girar (cotovelo, pescoço) | Médio | Sobra pintada nas juntas + limites de ângulo por nó no `rig.json`. |
| "Rigidez de recorte de papel" sem deformação de malha | Médio | Rotação pequena + mola secundária disfarçam bem no tamanho de 260 px. Malha (PixiJS) só se for realmente necessária. |
| `hitTest` mais caro (ler pixel) | Baixo | Canvas fora da tela pequeno (64 px), leitura só quando o cursor está perto. |
| CPU com várias Teras | Médio | Manter o fps adaptativo e redesenhar só quando algo mudou. |
| PixiJS: CSP e WebGL em janela transparente | Médio (só se escolher Pixi) | Não usar Pixi no MVP. |
| Licença da arte nova | Baixo | Mantém a CC BY 4.0 (`LICENSE-ART.md`) e o crédito do autor. |

**Dependências de outras frentes:** nenhuma do backend. O Mini Companion se beneficia do rig,
mas não depende dele.

---

> Observação: este arquivo está em `docs/`, que é a pasta do site VitePress. Sem um
> `srcExclude` no `docs/.vitepress/config.mts`, ele **será publicado** como página do site no
> próximo deploy. Se for só uso interno, vale movê-lo ou excluí-lo do site.
