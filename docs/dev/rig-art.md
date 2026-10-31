---
description: O que a arte final do rig 2D da Tera precisa ter (camadas, variantes, pivôs, poses).
---

# Arte do rig 2D: especificação

O rig 2D é o renderer padrão da Tera (`assets/skins/tera-rig/`). O motor está pronto e
homologado no Electron; **a arte atual é provisória** (formas geométricas com hachura,
geradas por `apps/desktop/scripts/make-rig-placeholders.ts`). A personagem **não está
visualmente concluída** até as camadas abaixo serem desenhadas.

## Identidade (referência provisória)

Mantida a da arte atual (sprites em `assets/skins/tera/`): menina chibi com orelhas e cauda de
gato, cabelo ruivo/terracota, **moletom terracota** com gola branca, cordões e bolso canguru,
meias brancas e mocassins marrons; cor da marca `#D97757`. O "moletom preto" citado num pedido
antigo **não foi adotado**: trocar depende de decisão do proprietário, antes de encomendar a arte.

## Formato

- PNG com transparência, uma imagem por camada (e por variante).
- `canvas` 512 e `feet` [256, 488]: os pés da personagem no ponto (256, 488) de um quadro de
  512 px; a personagem inteira cabe nesse quadro, com folga pra braços erguidos e cauda.
- Pra telas com escala 2×, desenhe com `canvas` 1024 (todas as coordenadas abaixo dobram):
  o motor reduz as imagens pro tamanho de tela no carregamento.
- **Variantes da mesma camada têm o mesmo tamanho** da imagem padrão (o pivô e os filhos
  usam esse espaço).
- `pivot` é o ponto de rotação, em px da própria imagem; `at` é onde esse pivô fica, em px
  da imagem do pai. Ângulos em graus, positivo = horário.
- Desenhe cada camada **na pose de repouso** (braços ao lado do corpo, cabeça reta), com
  sobra escondida nas juntas (ombro, quadril, pescoço, base da cauda) pra não abrir buraco
  quando girar.

## Camadas (as dimensões atuais servem de gabarito)

| id | pai | tamanho | pivot | at | z | rotação | variantes |
|---|---|---|---|---|---|---|---|
| `body` (tronco, moletom) | — | 150×170 | [75, 170] | [256, 404] | 20 | 0 | default |
| `leg_l` | body | 44×84 | [22, 6] | [50, 160] | 10 | 0 | default |
| `leg_r` | body | 44×84 | [22, 6] | [100, 160] | 10 | 0 | default |
| `shoe_l` | leg_l | 56×30 | [28, 6] | [20, 80] | 12 | 0 | default |
| `shoe_r` | leg_r | 56×30 | [28, 6] | [24, 80] | 12 | 0 | default |
| `arm_l` (manga) | body | 40×116 | [20, 12] | [12, 26] | 25 | 12 | default |
| `arm_r` (manga) | body | 40×116 | [20, 12] | [138, 26] | 25 | -12 | default |
| `hand_l` | arm_l | 34×34 | [17, 6] | [20, 108] | 26 | 0 | default |
| `hand_r` | arm_r | 34×34 | [17, 6] | [20, 108] | 26 | 0 | default |
| `head` (cabelo + capuz) | body | 210×190 | [105, 178] | [75, 18] | 40 | 0 | default |
| `face` (pele, sem olhos/boca) | head | 150×112 | [75, 56] | [105, 112] | 41 | 0 | default |
| `eyes` | face | 110×30 | [55, 15] | [75, 50] | 42 | 0 | default, closed, happy, wide |
| `mouth` | face | 40×24 | [20, 12] | [75, 84] | 42 | 0 | default, open, smile, frown |
| `ear_l` | head | 64×76 | [32, 70] | [46, 48] | 35 | -18 | default |
| `ear_r` | head | 64×76 | [32, 70] | [164, 48] | 35 | 18 | default |
| `tail_1` (base) | body | 30×78 | [15, 8] | [128, 150] | 5 | -110 | default |
| `tail_2` | tail_1 | 28×74 | [14, 6] | [15, 72] | 4 | 25 | default |
| `tail_3` (ponta) | tail_2 | 26×70 | [13, 6] | [14, 68] | 3 | 30 | default |

Variantes obrigatórias:

- **olhos**: `default` (abertos, olhando pra frente; a íris anda até ±5×±3 px com o olhar),
  `closed` (piscada e sono), `happy` (^ ^), `wide` (surpresa, arrasto).
- **boca**: `default` (fechada, neutra), `open` (fala e surpresa), `smile`, `frown`.

Desejáveis (o formato já aceita; basta acrescentar no `rig.json`): `blush` (camada escondida
que a expressão `happy` mostra), `sweat` (erro), `zzz` (sono), olhos `focused` e `confused`,
boca `o` pra fala com duas posições, franja como camada própria (balança com o vento da cauda).

## Poses e expressões já mapeadas

As poses do `rig.json` só giram/deslocam camadas (com transição suave); nenhuma exige
desenho novo além das variantes acima:

- **poses**: idle, talk, walk, drag (braços pra cima, pernas penduradas, olhos `wide`, boca
  `open`), land (amassa ao cair), work, think, happy (braços pra cima), error, sad, sleep
  (cabeça caída, olhos `closed`), wave (braço direito erguido), surprised.
- **expressões**: neutral, happy (`happy` + `smile`), focused, confused (`frown`), surprised
  (`wide` + `open`), sleepy (`closed`), sad (`frown`).
- **procedural** (o motor faz): respiração, piscada (2,5–6 s), olhar pro cursor (íris + até
  4° de cabeça), boca alternando ao falar, passos (pernas ±18°, braços em oposição), cauda em
  cadeia, quique ao andar, pêndulo ao ser arrastada. Movimento reduzido desliga os contínuos.

## Como testar uma arte nova

```bash
pnpm build
node apps/desktop/dist/scripts/rig-inspect-server.js   # http://127.0.0.1:4180/
```

A página de inspeção mostra pivôs e caixas, troca pose, expressão, fala, arrasto e movimento
reduzido, e mede o custo de desenho. No app, `apps/desktop/src/main/skin-assets.test.ts`
falha se faltar alguma imagem ou variante.
