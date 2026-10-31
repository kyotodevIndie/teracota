# Tera: consolidação do monorepo e conclusão da experiência principal

- **Data:** 2026-10-30.
- **Branch local:** `integ/tera-unified`, a partir de `feat/agent-bridge` @ `8cd8a3c`. Sem push e sem merge na `main`.
- **Ambiente da validação:** Ubuntu, kernel 7.0.0-38, GNOME Shell 50.1 em sessão Wayland.
  - O app roda via XWayland.
  - CPU AMD Ryzen 7 3750H (8 threads); GPU Radeon Vega integrada + GTX 1650 Mobile.
  - Dois monitores, 2560×1440 e 1920×1080, escala 1. A tela principal mediu cerca de 6,94 ms por quadro (144 Hz).
  - Node 24.22.1, pnpm 11.22.0, Electron 44.9.3.

Legenda de evidência:

- **[executado]**: rodado nesta entrega.
- **[Electron real]**: visto no app rodando, dirigido por CDP com captura de janela.
- **[histórico]**: vem de relatórios anteriores e não foi reexecutado.
- **[não verificado]**: não foi validado.

## 1. Resumo

Agora existe uma base única: o monorepo pnpm na branch `integ/tera-unified`. Nela, a Tera:

- vive no desktop com o **rig 2D como renderer padrão**;
- abre a **interface ao ser clicada**;
- continua no desktop quando a interface é fechada.

O Mini Companion saiu. O Pocket não entrou como produto. Os travamentos dos sprites foram diagnosticados e corrigidos na base comum (relógio único de quadros e transição de poses).

**Não está pronto para publicar.** Os bloqueios estão na seção 9. Os três principais:

1. A **arte do rig é provisória**: formas geométricas.
2. A **conversa com o Claude real nunca rodou**: exige `ANTHROPIC_API_KEY`, e o smoke é pago.
3. **Windows**, a plataforma do instalador, **não foi homologado** nesta entrega.

## 2. Origem do código

| Origem | Commit | Destino |
|---|---|---|
| `feat/agent-bridge` | `8cd8a3c` | **Base** (branch criada a partir dela) |
| `origin/feat/tera-rig` | `b0519bf` | **Integrado** por merge (`93dd3eb`), histórico preservado |
| `origin/feat/tera-pocket-phase1` | `38ad405` | **Não integrado** (motivos na seção 4) |
| `origin/feat/tera-pocket-phase0` | `e1a2982` | **Não integrado** (estudos e PoCs; o que tinha valor já está na phase1) |

As quatro cópias locais (`waifu-claude`, `-phase1`, `-pocket` e `-rig`) foram conferidas: árvores limpas e sincronizadas com o remoto. **Nenhuma foi apagada nem alterada**, exceto `waifu-claude`, onde fica a branch nova.

Commits da integração (`8cd8a3c..HEAD`):

| Commit | O que faz |
|---|---|
| `93dd3eb` | Merge do rig |
| `ce86be3` | Remove o Mini Companion |
| `06ba450` | Monorepo pnpm |
| `18025f2` | Rig como renderer padrão + relógio de quadros |
| `a0ff8aa` | Clique abre a interface + robustez do desktop |
| `04a96d0` | Segurança das dependências, empacotamento e docs |

## 3. Organização final

```
tera/ (raiz: package.json com packageManager pnpm@11.22.0, pnpm-workspace.yaml, pnpm-lock.yaml)
├── apps/desktop/          o app Electron (src/main, src/renderer, src/preload, src/shared, scripts, build.mjs)
├── packages/character/    @tera/character: skin, rig (manifesto, matrizes), cena, controladores, RigAnimator
├── packages/agent-bridge/ @tera/agent-bridge: contrato (roda no renderer), BridgeManager, provider simulado
├── assets/                skins: tera-rig (padrão), tera (sprites, fallback); ícones
├── docs/, plugin/, .claude-plugin/, reports/
```

- **Fronteiras:** os pacotes não dependem do Electron nem do app.
- **Regra de arquitetura:** o teste `integrations.test.ts` ("nada de agente fora de `integrations/`") passou a varrer também os pacotes.
- **Bundle:** `zod`, o MCP SDK e os pacotes do workspace entram no bundle. Só o `electron` e o Agent SDK ficam externos (o SDK é ESM com `import.meta`).
- **Agent SDK:** antes ele era `devDependency` e não entrava no pacote. Agora é dependência do app e vai no pacote, sem o binário do Claude Code de cerca de 235 MB que vem junto.

### Comandos (sempre na raiz)

| Comando | O que faz |
|---|---|
| `corepack enable && pnpm install --frozen-lockfile` | Instala exatamente o lockfile |
| `pnpm start` (ou `pnpm dev`) | Builda e abre o app ("Teracota Dev") |
| `pnpm check` | typecheck (3 pacotes) + lint + testes |
| `pnpm build` | Build do app |
| `pnpm pack:linux` / `pnpm pack:win` | App desempacotado em `apps/desktop/release/` |
| `pnpm dist:win` | Instalador NSIS |
| `pnpm audit:prod` | Auditoria das dependências de produção |
| `pnpm docs:dev` / `pnpm docs:build` | Site |

## 4. Preservado, integrado e removido

**Preservado sem mudança de comportamento:**

- hooks do Claude Code e plugin `teracota@teracota`;
- servidor local `127.0.0.1` com as proteções de Origin e Host;
- API `/api/v1/event`;
- MCP `say`/`emote`;
- modos "uma Tera só" ou "uma por sessão";
- passear ou ficar parada;
- skins de terceiros;
- bandeja;
- política de autenticação do Agent Bridge: só `ANTHROPIC_API_KEY`, nunca o login da assinatura.

**Integrado:**

- **Do rig:** motor (manifesto, cena, controladores e inspetor). A seção 6 descreve o que foi acrescentado a ele.
- **Agent Bridge:** passou a ser a interface da Tera, sem flag.

**Removido:**

- **Mini Companion** (janela, modo de UI, simulador e itens do menu). Configurações antigas com `ui: "mini"` voltam para a Tera completa; há teste para isso.
- **`poc/claude-gui`** (lockfile npm próprio; foi superada pelo provider real).
- **Flag `TERACOTA_AGENT_PANEL`**.

**Pocket: não integrado.** O código da phase1 foi inspecionado (relatório anterior e `git show`). Nada dele é necessário à interface unificada desta entrega, e há três impedimentos:

1. O runner usa o login do `claude` do usuário, o que contraria a regra de autenticação vigente.
2. O isolamento de processos dele (Job Object via `koffi` e named pipe) só existe no Windows.
3. Persistência de tarefas não é requisito desta entrega.

Candidatos a aproveitar depois, se a interface ganhar tarefas: a política de comandos (`security/bash.ts`), a classificação de erros (`classify.ts`) e o Core SQLite (`node:sqlite`, sem módulo nativo).

## 5. Diagnóstico da animação (Frente 3)

Medido no Electron real (XWayland, 144 Hz) antes das correções [executado]:

1. **Janela e desenho em relógios diferentes.**
   - A janela andava por um `setInterval` de 16 ms no processo principal: mediana de 16,5 ms, cerca de 60 Hz, sem sincronia com a tela.
   - O corpo era desenhado por outro `requestAnimationFrame`, com um limitador `1000/fps − 2` que, em 144 Hz, dava cerca de 48 fps.
   - Resultado: o quique do corpo e a translação da janela ficavam fora de fase (judder).
2. **A fase do wobble reiniciava a cada troca de pose.** Isso inclui começar e parar de falar (`idle` ↔ `talk`). Pulo medido: cerca de 2 px no topo do desenho.
3. **Só 4 frames por pose, de 140 a 320 ms cada.** Andar ficava a cerca de 7 fps sobre uma janela movida a 60 Hz.
4. **Não são causas:** carregamento e decodificação de imagens (já eram pré-carregadas) e cadência em repouso (estável, cerca de 24 fps).

**Correções, na base comum ao rig e aos sprites:**

- **`FrameClock`:** um `requestAnimationFrame` por janela anda a janela e desenha no mesmo quadro. Parada, pula um número inteiro de quadros da tela.
- **Passeio:** o main só planeja; o renderer executa.
  - Medido depois: desenho a cada quadro da tela durante o passeio.
  - A janela só se move quando muda de pixel e sempre no mesmo quadro do desenho (passos de 1 a 3 quadros).
- **`WobbleMixer`:** relógio contínuo e crossfade de 220 ms entre poses.
- **fps:** 60 em movimento (sincronizado), 24 parada, 15 dormindo, 12 com movimento reduzido.

## 6. Rig 2D

**Pronto e homologado** [Electron real, dev e empacotado]:

- **Formato:** variantes por camada, visibilidade, poses e expressões, tudo validado.
- **`RigAnimator`** (puro, 9 testes): poses com transição suave, piscada só com os olhos abertos, olhar para o cursor, boca ao falar, ciclo de passos, cauda em cadeia e respiração contínua.
- **Movimento reduzido:** menu "Reduzir movimento" + `prefers-reduced-motion`.
  - Medido: 12 fps, nenhum pixel mudou entre dois quadros com 1,3 s de intervalo, e o passeio fica bloqueado.
- **Hit-test:** pela variante visível de cada camada.
- **Carregamento:** todas as variantes são decodificadas antes do primeiro quadro.
  - O main confere se todos os arquivos existem.
  - Um rig com PNG corrompido cai para os sprites (testado no app empacotado).
- **Estados mapeados** (todos capturados em `shots/rig-estados.png`):
  - repouso;
  - fala;
  - pensar;
  - trabalho;
  - erro;
  - feliz;
  - sono;
  - atenção (aceno);
  - ouvindo (surpresa);
  - triste;
  - arrasto (pêndulo);
  - aterrissagem.

**Pendente: a arte.** As camadas são placeholders geométricos.

- A especificação completa está em `docs/dev/rig-art.md`: 18 camadas com tamanho, pivô, pai e z, mais as variantes de olhos (`default`, `closed`, `happy`, `wide`) e de boca (`default`, `open`, `smile`, `frown`).
- A identidade terracota foi mantida como referência. Não houve troca para moletom preto.
- **A personagem não está visualmente concluída.**

## 7. Interface e desktop (Frentes 2, 4 e 5)

**Interface** [Electron real, dev e empacotado]:

- **Clique:** um clique simples na Tera abre a interface ou a traz para a frente. Dormindo, ela acorda e abre (`shots/sleep-wake.png`).
- **Arrasto:** arrastar e soltar não abre a interface. A decisão é do `PointerGesture`, que tem testes.
- **Fechar:** só esconde a janela. A Tera seguiu desenhando e reabrir não criou uma segunda janela.
- **Seção "Agentes no terminal"** (`shots/interface.png`), lendo o estado real desta máquina:
  - estado da conexão: Claude Code "Conectado";
  - botão "Conectar";
  - "Sessões já abertas: copiar `/reload-plugins`";
  - checkbox das falas por MCP.
- **Conexão explícita:** a oferta da primeira execução só convida a abrir a janela; o clique deixou de instalar o plugin.
- **Conversa:** aparece "indisponível: requer `ANTHROPIC_API_KEY`", como manda a política.
- **Foco:** eventos de agente não roubam foco (medido: nenhuma janela focada depois de um `attention`). Só o clique foca a interface.

**Reação a agentes reais** [Electron real]:

- os hooks desta própria sessão do Claude Code levaram a Tera ao estado "terminal" durante comandos Bash (`shots/hooks.png`);
- o MCP `say` funcionou (`initialize` + `tools/call`) depois da atualização do SDK (`shots/mcp-say.png`).

**Desktop:**

- **Linux/Wayland:** em Wayland nativo a janela não se posiciona (medido). O app se reabre uma vez com `--ozone-platform=x11`; o `appendSwitch` chega tarde demais (verificado).
- **Soltar fora da tela:** volta para a área útil mais próxima. Medido: de (−2000, 5000) para (0, 1000).
- **Monitores:** em `display-added`, `display-removed` e `display-metrics-changed`, cada Tera confere se continua visível. Só há teste unitário; nada foi desligado de verdade.
- **Bandeja:** clicar no ícone mostra a Tera e a traz para a tela.
- **Persistência:** a posição foi salva no segundo monitor e restaurada ao reabrir o pacote.

## 8. Gates, medições e plataformas

### Gates [executado]

- **Clone limpo da branch, `pnpm install --frozen-lockfile`:** ok.
- **typecheck:** 3 pacotes ok.
- **lint:** Biome, 97 arquivos, sem achados.
- **testes:** 294 (character 39, agent-bridge 28, desktop 227).
- **build:** ok. **docs:build:** ok.
- **`pnpm start` no clone:** o app sobe, e o binário do Electron é baixado na primeira execução.
- **`pnpm pack:linux`:** ok, cerca de 297 MB (a maior parte é o Electron).
- **App empacotado:**
  - abre com o rig;
  - abre a interface;
  - carrega o Agent SDK de dentro do `asar` (`import()` resolve `query` e `listSessions`);
  - persiste a posição entre execuções;
  - cai para os sprites quando o rig está corrompido.
- **`pnpm audit --prod`:** sem achados.
  - **Antes:** 15, sendo 5 altas.
  - **Correção:** Electron 44.9.3, MCP SDK 1.32.1 e `overrides` dentro da mesma major para `body-parser`, `fast-uri`, `hono`, `@hono/node-server`, `ip-address` e `qs`.
  - **Restante:** avisos só em ferramentas de build e docs (vitepress/vite e undici do electron-builder e do `@electron/get`).

### Desempenho

Ambiente da seção de abertura, sem depurador, CPU em % de um núcleo:

| Configuração | Parada | Passeando | Memória (PSS) |
|---|---|---|---|
| Antes (`8cd8a3c`, sprites) | 19,7% | 24,6–26,1% | 281–332 MiB |
| Agora, sprites | 19,1% | 25,1–26,3% | 287–338 MiB |
| Agora, rig (arte provisória) | 20,9% | 30,6–30,8% | 272–278 MiB |

**Limites propostos, a partir dessas medições:**

- **Parada:** no máximo cerca de 22% de um núcleo nesta máquina, ou seja, o patamar dos sprites com 10% de folga.
- **Passeando:** o rig hoje custa cerca de 5 pontos a mais que os sprites. Reavaliar quando a arte final chegar.
- **Medida de referência:** o custo de base vem em grande parte da composição de uma janela transparente de 320×440 em XWayland.

### Matriz de plataformas

| Plataforma | Situação |
|---|---|
| Linux, GNOME 50, Wayland via XWayland, 2 monitores com escala 1 | **Testado:** dev e pacote `--dir` |
| Linux em Wayland nativo | Não suportado. O app se reabre em XWayland |
| Linux em X11 puro, KDE, outros WMs | Não testado |
| Escalas de DPI mistas ou fracionárias | **Não testado.** Não havia hardware para isso |
| Windows (plataforma do instalador NSIS) | **Não testado nesta entrega.** Os relatórios anteriores cobriam o Windows [histórico] |
| macOS | Não testado |
| AppImage (alvo configurado) | Não gerado. Só `--dir` foi validado |

## 9. Bloqueios para publicar

1. **Arte final do rig em camadas.** Hoje são placeholders; a especificação está em `docs/dev/rig-art.md`. Depende da decisão de identidade (terracota ou preto).
2. **A conversa com o Claude real nunca rodou.** Precisa da `ANTHROPIC_API_KEY` e de autorização para o smoke pago (estimativa abaixo de US$ 0,01, teto de US$ 0,05).
3. **Windows:** gerar e testar o instalador NSIS e homologar o mesmo roteiro (clique, arrasto, click-through, foco, tela cheia, DPI misto) no Windows.
4. **Click-through e arrasto com mouse físico.** Os testes desta entrega usaram eventos sintéticos de CDP, então a passagem de cliques pela área transparente não foi validada com mouse de verdade.
5. **Definir plataformas de distribuição e versão.** A `v0.1.0` já é pre-release desde 2026-10-01; esta entrega pede 0.2.0. Também falta assinar o instalador.
6. **Revisão humana e merge.** A branch é local, sem push nem PR.

## 10. Decisões que ficam com o proprietário

1. Identidade da arte final: terracota (atual) ou moletom preto.
2. Autorizar o smoke pago da conversa, com a `ANTHROPIC_API_KEY` definida por você no ambiente.
3. Plataformas da próxima versão: só Windows, ou também Linux (AppImage). E a numeração (0.2.0?).
4. A interface deve ganhar tarefas e projetos agora? Se sim, aproveitar o Core SQLite e a política de comandos do Pocket, mantendo a regra de autenticação.
