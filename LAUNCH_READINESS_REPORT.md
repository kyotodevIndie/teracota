# Relatório de prontidão pro lançamento: Teracota 0.1.0 (beta)

> Gerado em 2026-10-01, no commit `670673d` (`main`, já no GitHub, CI verde).
> **Nada foi publicado:** nenhuma tag, release ou deploy do site. Os passos de publicação
> estão na seção 7 e esperam a sua aprovação.

## Resumo

| Área | Situação |
|---|---|
| Código | Pronto pra beta. 3 problemas de conexão resolvidos e 1 bug real corrigido. |
| Testes | 123 testes (antes, 76). typecheck, lint, build e build do site passando, local e no CI. |
| Site | VitePress bilíngue (pt-BR + en), 20 páginas, pronto. Deploy preparado, **não publicado**. |
| Instalador | `Teracota Setup 0.1.0.exe` gerado e o app empacotado testado. **A instalação em máquina limpa não foi testada.** |
| Release | Versão proposta: **v0.1.0** (pré-lançamento). Notas bilíngues prontas. Workflow revisado. |

---

## 1. Funcionalidades prontas

- **Reação ao Claude Code** pelo plugin `teracota@teracota` (hooks via `curl`):
  - atenta ao receber um pedido;
  - lendo, buscando, editando, terminal, web e delegando;
  - erro;
  - pedido de permissão;
  - terminou;
  - cumprimento e despedida.
- **Modos:** uma Tera só (agrega as sessões, com o projeto no balão) ou uma por sessão (até 5,
  com cor e plaquinha). **Passear** ou **ficar parada.**
- **Interações:** clique, arrasto com balanço físico, carinho, cochilo quando ociosa.
- **Conexão:**
  - oferta automática com um clique;
  - "Conectar ao Claude Code" (CLI);
  - "Conectar sessões já abertas" (`/reload-plugins`);
  - comando manual de uma linha.
- **Falas pelo MCP** (`say`/`emote`): agora **opcionais**, ligadas pelo menu.
- **API local v1** (`/api/v1/event`, com `/event` como alias), com `source`/`lifecycle`.
- **Arquitetura de adapters:** o core não conhece agentes, e um teste garante isso.
- **Skins:** a Tera (13 animações) e o desenho clássico. Suporte a skins de terceiros.
- **App:** bandeja, apresentação na primeira execução, abrir com o Windows, instância única,
  app de desenvolvimento separado ("Teracota Dev").

## 2. Problemas resolvidos (Fase 1)

| Problema | Diagnóstico (evidência) | Solução |
|---|---|---|
| **MCP duplicado** | `claude mcp list` mostrava `plugin:teracota:teracota` **e** `teracota` (pendente, vindo do `.mcp.json` do repositório). O binário do Claude Code suprime a duplicata, mas avisa (`Suppressing plugin MCP server ... duplicates`). | O `.mcp.json` da raiz foi removido. O CONTRIBUTING explica as duas formas de desenvolver (plugin **ou** hooks locais). |
| **App fechado** | Com o MCP no plugin, o Claude Code mostrava `teracota (ECONNREFUSED)` ao abrir a sessão. Isso aconteceu nesta própria sessão de trabalho. Os hooks já falhavam em silêncio. | O MCP **saiu do plugin**. Agora o plugin é só hooks, e o app fechado não gera erro nenhum. As falas viraram opção no menu (`claude mcp add/remove --scope user`), com o efeito colateral documentado. |
| **Sessões abertas** | O binário do Claude Code tem a mensagem oficial "Run /reload-plugins to activate successfully installed plugins". | Confirmado que `/reload-plugins` é o caminho certo (o app já copia o comando). Documentado no guia e no FAQ. |
| **Bug: a Tera "de casa" ia embora** | Achado pelo teste novo do `manager.ts`: quando a sessão da Tera de casa terminava antes das outras, era ela quem saía. Ela é a única que salva a posição. | A Tera de casa fica (livre) e as extras saem. Há um teste específico pra isso. |
| Documentação desatualizada | Os docs de dev diziam "sem testes do core", e a lista de IPC estava sem `notifyClick`. | Corrigidos ao migrar pro site. |

### Limitação que não dá pra resolver no app

- Quem **liga as falas pelo MCP** e fecha o app vê o erro de conexão do MCP no Claude Code. É assim
  que o Claude Code se comporta com servidores MCP indisponíveis. Por isso as falas são opcionais e
  isso está documentado (FAQ e guia do Claude Code). Uma alternativa sem esse erro exigiria um
  runtime externo (Node), o que contraria uma decisão do projeto.

## 3. Testes executados e resultados

### Automatizados (local e no CI)

| Verificação | Resultado |
|---|---|
| `npm run typecheck` | ✅ |
| `npm run lint` (Biome) | ✅ sem diagnósticos |
| `npm test` (Vitest) | ✅ **123/123** em 11 arquivos |
| `npm run build` | ✅ |
| `npm run docs:build` (VitePress, falha com link quebrado) | ✅ |
| `claude plugin validate ./plugin` e `.` | ✅ |
| CI no GitHub (`670673d`) | ✅ todos os passos, inclusive o do site |

**Testes por arquivo** (os de `server`, `manager`, `connect-flow` e `connect` são novos):

| Arquivo | Casos | Cobre |
|---|---|---|
| `src/main/server.test.ts` | 11 | HTTP real: rotas, 204 sempre pro agente, 400/403/404/405, `Origin` e `Host`, **cliente MCP real** chamando `say`/`emote` |
| `src/main/manager.test.ts` | 20 | Roteamento do core com o Electron simulado: modos, agregação de `working`, etiquetas, agentes diferentes, ciclo de vida, limite de 5, sessão fantasma, MCP pra sessão certa, API local |
| `src/main/connect-flow.test.ts` | 11 | Oferta (instalado, conectado, ausente, só uma vez), clique dentro e fora do prazo, sucesso e falha, sessões abertas, falas liga/desliga |
| `src/main/integrations/claude-code/connect.test.ts` | 5 | Comandos da CLI (plugin e MCP) e leitura das respostas |
| `adapter.test.ts`, `integrations.test.ts`, `sessions.test.ts`, `protocol.test.ts`, `skin.test.ts`, `pendulum.test.ts`, `look.test.ts` | 45 + guarda | Já existiam |

### Manuais (com evidência nesta sessão)

- **App empacotado** (`release/win-unpacked`), rodando isolado com config própria, porta 7790 e
  o instalado aberto ao lado:
  - `/health` ok;
  - `/hook` 204;
  - `/api/v1/event` 204;
  - `Origin` 403;
  - MCP `teracota 0.1.0` com `say` e `emote`;
  - **a skin da Tera carregou de `resources/`** (print).

  Depois de fechar: nenhum processo de teste restou, nenhuma entrada de inicialização foi
  criada, e a pasta de teste foi apagada.
- **Site** (navegador, `vitepress preview`):
  - 20 páginas e 20 links internos sem 404;
  - troca de idioma levando à página equivalente;
  - mobile 375px sem rolagem horizontal;
  - modo claro e escuro;
  - metadados SEO e Open Graph por página (título, descrição, `og:image`, `og:url`,
    `og:locale`, canonical);
  - imagens com `alt`;
  - demo interativa (estado, balão e frame corretos ao clicar; o autoplay pausa).
- **Contraste das cores** (WCAG): `#B4532F` sobre branco = 4,98 (AA); `#E8956F` sobre o fundo
  escuro = 7,33 (AAA).
- **Licenças das dependências de produção:** 82 MIT, 7 ISC, 3 BSD. Todas permissivas.

### O que **não** foi testado (sem evidência)

- **Instalar o `.exe` numa máquina limpa** (não havia ambiente disponível; Windows Home não
  tem Sandbox). Rodar o instalador aqui sobrescreveria a instalação do usuário.
- **Ligar e desligar as falas pelo MCP de verdade:** isso altera a configuração global do Claude
  Code do usuário. A lógica foi coberta por testes, e os comandos foram conferidos com
  `claude mcp --help`.
- **Clique na oferta instalando o plugin de verdade** numa máquina sem o plugin (aqui ele já
  está instalado). A instalação pelo menu foi validada antes, em 2026-10-01.
- **`/reload-plugins` reativando os hooks numa sessão aberta:** a evidência é a mensagem
  oficial do Claude Code, não um teste observado.
- **O site publicado no GitHub Pages** e o **workflow de release** (só rodam com tag ou à mão).

## 4. Site

- **Onde:** `docs/` (VitePress 1.6). Configuração e tema em `docs/.vitepress/`.
- **Idiomas:** português na raiz e inglês em `/en/`, com os **mesmos caminhos** (a troca de
  idioma leva à página equivalente).
- **Páginas:**
  - landing, com a demo interativa feita com os frames reais da Tera;
  - guia do usuário: instalação, uso, Claude Code, FAQ e solução de problemas;
  - desenvolvimento: contribuir, arquitetura, integrações, API local, skins.
- **Sem duplicação:**
  - os docs de dev existentes foram **movidos** pro site;
  - o README virou um resumo com links;
  - a seção de skins saiu do README e do CONTRIBUTING;
  - o CONTRIBUTING continua sendo o guia completo de contribuição (o site resume e aponta pra ele).
- **Honestidade:** Focus Mode, Codex/OpenCode, macOS e Linux aparecem só como **planejados**.
- **Visualizar localmente:**
  ```bash
  npm run docs:dev                          # http://localhost:5173/teracota/ (recarrega ao editar)
  npm run docs:build && npm run docs:preview  # versão final em http://localhost:4173/teracota/
  ```
- **Deploy:** `.github/workflows/docs.yml`, **só manual** (`workflow_dispatch`). O endereço será
  `https://kyotodevindie.github.io/teracota/`.

## 5. Instalador

| Item | Valor |
|---|---|
| Arquivo | `release/Teracota Setup 0.1.0.exe` |
| Tamanho | 121,5 MB |
| SHA-256 (build local) | `52875befc5b4abbff3e024de31c6ed3ee6f9f8ba0dc4e9c57bd44e7c50f8d1d8` |
| Tipo | NSIS, um clique, por usuário (`%LOCALAPPDATA%\Programs\teracota`), sem admin |
| Assinatura | **Nenhuma.** O SmartScreen avisa, e isso está documentado no guia, no FAQ e nas notas da release. |

O build local **não é byte a byte igual** ao do CI. O instalador oficial será o gerado
pelo workflow de release, que publica o próprio SHA-256 nas notas.

## 6. Pendências e riscos

**Antes de publicar:**
1. **Testar o instalador do CI numa máquina limpa** (ou numa VM). É o maior risco: nunca foi
   observado.
2. **Ajustes no GitHub:**
   - **Settings → Pages → Source: GitHub Actions** (necessário pro site);
   - **Security → Private vulnerability reporting: Enable** (o SECURITY.md aponta pra lá);
   - **label `skin`** (usada pelo formulário de skin);
   - descrição do repositório.
3. **Data no CHANGELOG:** trocar "a publicar" pela data, no dia.

**Riscos e observações:**
- **Plugin sem MCP, mesma versão (0.1.0):** quem já tem o plugin instalado, só você hoje,
  continua com a cópia antiga, que tem MCP, até atualizar. Recomendado:
  `claude plugin uninstall teracota@teracota`, depois `claude plugin marketplace update teracota`,
  `claude plugin install teracota@teracota`, e ligar as falas no menu se quiser.
- **Sua instalação não está com "Abrir com o Windows" ligado:** a config migrou do Terracota
  como já apresentada, então a etapa que liga isso foi pulada. Ligue no menu. Instalações novas
  não têm esse problema.
- **Instalador sem assinatura:** pode afastar usuários. Mitigado com documentação e SHA-256.
- **App e falas só em português:** o site em inglês avisa.
- **Arte gerada com IA:** a licença CC BY 4.0 foi aplicada, mas a proteção de direitos autorais
  sobre arte gerada por IA é juridicamente incerta em vários países. Vale saber, não bloqueia.
- **Marca "Claude":** usada só pra descrever a compatibilidade, com aviso de não afiliação no
  README, no site e nas notas.
- `PROJECT_STATUS_REPORT.md` (relatório anterior, não versionado) está **desatualizado**
  depois destas mudanças.

## 7. Passos exatos pra publicar

Todos esperam a sua aprovação.

1. **GitHub (site):**
   - Settings → Pages → Source: **GitHub Actions**;
   - Security → **Private vulnerability reporting** → Enable;
   - Issues → Labels → **New label `skin`**;
   - About (engrenagem) → descrição: *Tera, uma gatinha de desktop que reage ao seu agente de
     código 🐾*. O website fica pra depois do passo 6.
2. **Data no CHANGELOG** (`## [0.1.0] — beta (a publicar)` → `## [0.1.0] — 2026-MM-DD`):
   ```bash
   git commit -am "CHANGELOG: data da 0.1.0" && git push
   ```
3. **Tag** (dispara o workflow de release, que cria um **rascunho**):
   ```bash
   git tag v0.1.0
   git push origin v0.1.0
   ```
4. **Acompanhar** em Actions → **Release**. Ele confere se a tag bate com o `package.json` e o
   `plugin.json`, roda o `npm run check`, gera o instalador e cria o rascunho **pré-lançamento**
   com o `.exe`, o `.blockmap`, as notas bilíngues e o SHA-256.
5. **Validar o rascunho:**
   - baixar o `.exe` do rascunho;
   - conferir o SHA-256;
   - instalar numa máquina limpa;
   - conectar ao Claude Code (clique na oferta) e abrir uma sessão.

   Se estiver tudo ok, clicar em **Publish release**.
6. **Site:**
   - Actions → **Site (GitHub Pages)** → **Run workflow**;
   - conferir `https://kyotodevindie.github.io/teracota/`;
   - colocar esse endereço no "Website" do repositório e no README.
7. **Opcional:**
   - publicar o site a cada push, descomentando o gatilho `push` no `docs.yml`;
   - criar issues `good first issue` a partir do ROADMAP.
