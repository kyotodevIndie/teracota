---
description: Skin Studio e tera-skin — criar, montar, animar e conferir skins de rig da Tera (por gente e por agentes).
---

# Skin Studio

Duas ferramentas sobre o mesmo formato (`rig.json`), com o **mesmo motor de desenho da
Tera** (`@tera/character`): o que aparece nelas é o que aparece no app.

- **`tera-skin`** (linha de comando): cria, valida e renderiza. Feito pra ser usado também
  por agentes (Codex, Claude): mensagens em português, código de saída 0/1 e uma folha de
  conferência em PNG pra ver o resultado sem abrir o app.
- **Skin Studio** (navegador): monta e anima o rig com o mouse. Salva no mesmo `rig.json`;
  o que outro programa muda no arquivo aparece na hora.

Pacotes: `packages/skin-kit` (validação, JSON Schema, modelo de skin nova; sem interface) e
`apps/skin-studio` (o comando, o render e o editor).

## Comandos

Na raiz do repositório (o `pnpm skin` compila antes de rodar):

```bash
pnpm skin new assets/skins/tera-v2 --nome "Tera"
```

```bash
pnpm skin validate assets/skins/tera-v2
```

```bash
pnpm skin render assets/skins/tera-v2
```

```bash
pnpm skin studio assets/skins/tera-v2
```

| Comando | O que faz |
|---|---|
| `new <pasta> [--nome] [--modelo <pasta>]` | Cria a skin copiando um modelo que já funciona (padrão: `assets/skins/tera-rig`, o rig provisório). Liga o JSON Schema no `rig.json`. |
| `validate <pasta> [--json]` | **Erro** = a Tera não carrega a skin. **Aviso** = carrega, mas falta algo (pose que o app usa, piscada, PNG sem uso). |
| `render <pasta> [--saida] [--pivos] [--quadro 220]` | Desenha cada estado do app, cada pose e expressão, 8 quadros andando e a boca falando. Grava em `<pasta>/previews/` e monta `previews/folha.png`. `--pivos` mostra pivôs e caixas. |
| `studio <pasta> [--porta 4190] [--sem-abrir]` | Abre o editor no navegador (só `127.0.0.1`, com token na URL). |
| `schema <pasta>` | Escreve `rig.schema.json` e liga no `rig.json`. |

O render usa um Electron escondido. Num Linux sem tela (servidor, CI) ele desenha sem
janela nenhuma (`--ozone-platform=headless`).

## O formato, em uma página

- **Camadas** (`layers`): cada uma é um PNG com `pivot` (ponto de giro, px da própria
  imagem), presa num ponto do pai (`at`, px da imagem do pai; na raiz, px do canvas).
  `z` é a ordem de desenho (independe da hierarquia). Uma raiz só.
- **Variantes**: imagens alternativas da mesma camada (olhos fechados, boca aberta), **do
  mesmo tamanho** da imagem padrão.
- **Poses** (`poses`): ajustes por camada somados ao repouso (rotação, deslocamento,
  escala, variante, visível). O app troca de pose com transição suave. Ele pede:
  `idle, walk, drag, land, work, think, talk, happy, error, sad, sleep, wave, surprised`.
- **Expressões** (`expressions`): variante por camada por cima da pose. O app usa
  `neutral, surprised, focused, happy, confused, sad, sleepy`.
- **Movimentos** (`controllers`): `breathe` (respirar), `sway` (cauda/cabelo em cadeia),
  `blink` (piscar), `gaze` (olhar pro cursor), `talk` (boca), `walk` (passos).

Detalhes de cada campo: `rig.schema.json` (o editor completa e valida) e a especificação
da arte em [rig-art.md](./rig-art.md).

## Usando o Studio

- **Montar**: clique escolhe a camada; arrastar muda a posição; **Alt+arrastar** muda o
  pivô sem a imagem sair do lugar; a roda gira; setas empurram 1 px (Shift: 10).
  Ctrl+roda dá zoom; Espaço+arrastar (ou botão do meio) move a vista.
- **Poses**: escolha a pose (a lista mostra quais estados do app usam cada uma); o mesmo
  arrastar e girar passa a valer só pra ela.
- **Expressões**: troque a variante de cada camada que tem variantes.
- **Testar**: a figura anima como no app, em cada estado, andando, falando ou com menos
  movimento.
- **Partes**: solte PNGs na janela; vão pra `parts/` e viram camadas.
- **Salvar** (Ctrl+S) só grava se a Tera conseguir carregar o rig; o primeiro salvamento
  guarda o anterior em `rig.json.bak`. Ctrl+Z / Ctrl+Shift+Z desfazem e refazem.

## Fluxo com um agente (Codex, Claude)

O agente edita arquivos; o Studio mostra; o render confere. Um ciclo que funciona:

1. Crie a skin: `pnpm skin new assets/skins/tera-v2 --nome "Tera"`.
2. Deixe o Studio aberto: `pnpm skin studio assets/skins/tera-v2`.
3. Peça ao agente, por exemplo:

   > Na skin `assets/skins/tera-v2`, troque as partes provisórias pelas desenhadas em
   > `arte/tera/*.png` seguindo `docs/dev/rig-art.md`. Ajuste `pivot` e `at` de cada camada
   > no `rig.json` (o schema está em `rig.schema.json`). Depois de cada rodada, rode
   > `pnpm skin validate` e `pnpm skin render`, abra `previews/folha.png` e corrija o que
   > estiver errado (peças soltas, pivô no lugar errado, pose estranha) até a folha ficar boa.

4. O que o agente muda aparece no Studio na hora; ajuste fino com o mouse e salve. Se os
   dois mexerem ao mesmo tempo, o Studio pergunta qual versão manter.

Regras pro agente: `validate` tem que terminar sem **erro**; os **avisos** dizem o que ainda
cai no repouso; a folha de conferência é a prova de que ficou certo.

## Limites atuais

- Animação é por poses e movimentos automáticos; ainda não há animação com quadros-chave
  (ex.: um aceno com tempo marcado).
- O Studio não renomeia camadas (o id é usado em poses e movimentos); edite o id no JSON.
- A arte (os PNGs) não sai do Studio: ele monta e anima peças desenhadas fora.
