# Instruções para agentes (Codex, Claude e afins)

Projeto: **Teracota**, a Tera, uma personagem de desktop que acompanha agentes de código.
Monorepo pnpm; textos, comentários e mensagens em **português do Brasil**.

## Antes de entregar

```bash
pnpm check
```

(typecheck + lint + testes de todos os pacotes). Não faça push nem publique nada sem o
dono pedir.

## Mapa

| Pasta | O quê |
|---|---|
| `apps/desktop` | O app Electron (a Tera, a interface, o servidor local) |
| `apps/skin-studio` | `tera-skin` (criar/validar/renderizar skins) e o Skin Studio |
| `packages/character` | Rig 2D, animação, cena — o motor de desenho da Tera |
| `packages/skin-kit` | Validação de skin, JSON Schema do rig, skin nova |
| `packages/agent-bridge` | Ponte com agentes (conversa pela API) |
| `assets/skins` | Skins que vêm com o app |
| `docs/dev` | Documentação técnica |

## Trabalhando numa skin

Leia `docs/dev/skin-studio.md` (fluxo completo) e `docs/dev/rig-art.md` (as peças).
Depois de mexer numa skin:

```bash
pnpm skin validate <pasta>
```

```bash
pnpm skin render <pasta>
```

e abra `<pasta>/previews/folha.png` pra conferir. `validate` não pode ter **erro**.

## Regras que os testes cobram

- O núcleo do app e a interface não citam nenhuma IA pelo nome: o que é de um agente fica
  em `apps/desktop/src/main/integrations/<agente>/`.
- Os estados da Tera em `packages/character/src/states.ts` têm que bater com
  `apps/desktop/src/renderer/states.ts`.
