---
description: How to create a skin (sprite pack) for Teracota.
---

# Creating skins

Tera's look comes from a **skin**: a folder with a `skin.json` and PNG frames. Users pick
the skin in the menu → **Skin**. The "classic" SVG drawing is the fallback when there's
no skin.

## Where skins live

| Folder | For |
|---|---|
| `assets/skins/<id>/` | Skins shipped with the app (in the repository) |
| `%APPDATA%\Teracota\skins\<id>\` | Skins installed by users: just copy the folder |

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

| Field | Meaning |
|---|---|
| `name` | Name shown in the menu |
| `size` | On-screen size (px) of each square frame |
| `facing` | Which way she faces in the `walk` animation (the other way is mirrored) |
| `animations.<pose>.frames` | PNG paths, relative to the skin folder |
| `animations.<pose>.durations` | Duration of each frame in ms (default: 150) |
| `animations.<pose>.loop` | `false` = play once (e.g. `land`) |
| `animations.<pose>.scale` | Fixes an animation drawn bigger or smaller than the others (anchored at the feet) |
| `animations.<pose>.swing` | `drag` only: picks the frame from the swing angle (feet right, center, feet left) and how many degrees of lean are already drawn |

## Poses

Only `idle` is required. A missing pose falls back to a similar one.

| Pose | When it shows |
|---|---|
| `idle` | Standing around |
| `walk` | Wandering around the screen |
| `drag` | Being dragged |
| `land` | When dropped |
| `work` | Reading, searching, editing, running commands |
| `think` | Thinking between steps |
| `talk` | Talking (speech bubble) while idle; also when delegating to subagents |
| `happy` | Done, head pats, clicks |
| `error` | Something failed |
| `sad` | Sad (via MCP) |
| `sleep` | Napping |
| `wave` | Asking for attention or permission |
| `surprised` | Got a request, startled |

## Frame requirements

- **Square** PNG with a **transparent** background.
- Character centered, with **feet always on the same line**, or she "jumps" when switching
  animations.
- Same size and framing across all animations. Sitting poses tend to come out bigger:
  fix them with `scale`.
- Only opaque pixels respond to the mouse, so the character's outline should be clear.
- On top of the frames, the app adds continuous motion (breathing, bouncing while
  walking, swinging while dragged).

## Importing a pack

Packs in the `desktop-pet-sprite-pack-v1` format (2×2 sheets with a `manifest.json`) can
be converted:

```bash
pnpm build
pnpm import-skin <pack-folder> <id> "<Name>"
```

## Contributing a skin

- Open an issue with the **🎨 Nova skin** form, or send a PR adding `assets/skins/<id>/`.
- The project's art is [CC BY 4.0](https://github.com/kyotodevIndie/teracota/blob/main/LICENSE-ART.md).
  Contributed skins use the same license, with your credit.
- Only send art you made or have the right to distribute. Third-party characters (anime,
  games, brands) aren't accepted in the repository.
