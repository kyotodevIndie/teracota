---
description: Como criar uma skin (pacote de sprites) pro Teracota.
---

# Criando skins

O visual da Tera vem de uma **skin**: uma pasta com um `skin.json` e os frames em PNG.
O usuário escolhe a skin no menu → **Skin**. O desenho "clássico" em SVG é a reserva
quando não há skin.

## Onde ficam

| Pasta | Pra quê |
|---|---|
| `assets/skins/<id>/` | Skins que vêm com o app (no repositório) |
| `%APPDATA%\Teracota\skins\<id>\` | Skins instaladas por quem usa: é só copiar a pasta |

## `skin.json`

```json
{
  "name": "Tera",
  "size": 260,
  "facing": "right",
  "animations": {
    "idle": { "frames": ["frames/idle/01.png", "frames/idle/02.png"], "durations": [320, 320] },
    "work": { "frames": ["..."], "durations": ["..."], "scale": 0.84 },
    "drag": { "frames": ["..."], "durations": ["..."], "swing": { "feetRight": 0, "center": 1, "feetLeft": 2, "lean": 8 } },
    "land": { "frames": ["..."], "durations": ["..."], "loop": false }
  }
}
```

| Campo | O que é |
|---|---|
| `name` | Nome no menu |
| `size` | Tamanho na tela (px) de cada frame quadrado |
| `facing` | Pra que lado ela olha na animação `walk` (o outro lado é espelhado) |
| `animations.<pose>.frames` | Caminhos dos PNGs, relativos à pasta da skin |
| `animations.<pose>.durations` | Duração de cada frame em ms (padrão: 150) |
| `animations.<pose>.loop` | `false` = toca uma vez (ex.: `land`) |
| `animations.<pose>.scale` | Corrige uma animação que saiu maior ou menor que as outras (ancorada nos pés) |
| `animations.<pose>.swing` | Só em `drag`: escolhe o frame pelo balanço (pés pra direita, centro, pés pra esquerda) e quantos graus de inclinação já vêm desenhados |

## Poses

Só `idle` é obrigatória. Uma pose que faltar cai numa parecida.

| Pose | Quando aparece |
|---|---|
| `idle` | Parada |
| `walk` | Passeando pela tela |
| `drag` | Sendo arrastada |
| `land` | Ao ser solta |
| `work` | Lendo, buscando, editando, rodando comando |
| `think` | Pensando entre um passo e outro |
| `talk` | Falando (balão) quando está parada; também ao delegar pra subagentes |
| `happy` | Terminou, carinho, clique |
| `error` | Algo falhou |
| `sad` | Triste (pelo MCP) |
| `sleep` | Cochilando |
| `wave` | Pedindo atenção ou permissão |
| `surprised` | Recebeu um pedido, susto |

## Requisitos dos frames

- PNG **quadrado**, fundo **transparente**.
- Personagem centralizada, com os **pés sempre na mesma linha**. Senão ela "pula" ao
  trocar de animação.
- Mesmo tamanho e enquadramento em todas as animações. Poses sentadas costumam sair
  maiores: corrija com `scale`.
- Só a parte opaca responde ao mouse, então o contorno da personagem precisa ser bem
  definido.
- Por cima dos frames, o app aplica um movimento contínuo (respirar, quicar ao andar,
  balançar ao ser arrastada).

## Importar um pacote

Pacotes no formato `desktop-pet-sprite-pack-v1` (grades 2×2 com `manifest.json`) podem
ser convertidos:

```bash
pnpm build
pnpm import-skin <pasta-do-pacote> <id> "<Nome>"
```

## Contribuindo com uma skin

- Abra uma issue com o formulário **🎨 Nova skin** ou mande um PR adicionando
  `assets/skins/<id>/`.
- A arte do projeto é [CC BY 4.0](https://github.com/kyotodevIndie/teracota/blob/main/LICENSE-ART.md).
  Skins enviadas entram na mesma licença, com o seu crédito.
- Só envie arte que você fez ou tem direito de distribuir. Personagens de terceiros
  (anime, jogos, marcas) não entram no repositório.
