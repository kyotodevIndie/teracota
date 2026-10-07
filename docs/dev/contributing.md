---
description: Como contribuir com o Teracota (código, skins, integrações, documentação).
---

# Contribuindo

Toda contribuição conta: reportar um bug, sugerir uma ideia, mexer no código, desenhar
uma skin, integrar outro agente ou melhorar esta documentação.

O guia completo, com estilo de código, testes, commits e pull requests, é o
**[CONTRIBUTING.md](https://github.com/kyotodevIndie/teracota/blob/main/CONTRIBUTING.md)**.
Esta página é só o caminho rápido.

## Rodando pelo código

Precisa de **Node.js 22+**. Windows é a plataforma suportada; Linux é experimental.

```bash
git clone https://github.com/kyotodevIndie/teracota.git
cd teracota
npm install
npm start          # builda e abre o app ("Teracota Dev")
npm run check      # typecheck + lint + testes (rode antes de abrir um PR)
npm run dist       # gera o instalador em release/
npm run docs:dev   # este site, em http://localhost:5173/teracota/
```

Rodando pelo código, o app se chama **Teracota Dev** e convive com o Teracota instalado.
Só a porta é a mesma: use `TERACOTA_PORT=7788 npm start` se o instalado estiver aberto.

## Por onde começar

| Quero... | Leia |
|---|---|
| Entender a arquitetura | [Arquitetura](./architecture) |
| Integrar outro agente de código | [Integrações com agentes](./integrations) |
| Fazer a Tera reagir a uma ferramenta minha | [API local](./api) |
| Desenhar uma skin | [Criando skins](./skins) |
| Ver o que está planejado | [ROADMAP](https://github.com/kyotodevIndie/teracota/blob/main/ROADMAP.md) |
| Pegar uma tarefa | Issues [`good first issue`](https://github.com/kyotodevIndie/teracota/labels/good%20first%20issue) |

## Regras que o CI cobra

- `npm run check` precisa passar: typecheck, lint (Biome) e testes (Vitest).
- **Nada específico de um agente fora de `src/main/integrations/<agente>/`.** Um teste
  garante isso.
- **Nunca atrapalhar o agente:** integrações falham em silêncio quando o app está fechado.

## Comunidade

- [Código de Conduta](https://github.com/kyotodevIndie/teracota/blob/main/CODE_OF_CONDUCT.md)
- [Segurança](https://github.com/kyotodevIndie/teracota/blob/main/SECURITY.md): falhas são
  reportadas em privado, não em issue pública.
- [Changelog](https://github.com/kyotodevIndie/teracota/blob/main/CHANGELOG.md)
