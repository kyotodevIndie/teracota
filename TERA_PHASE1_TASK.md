Tera Pocket: Fase 1 completa com Waterfall econômico
Execute a Fase 1 inteira da Tera Pocket, do planejamento à implementação, integração, testes, correções e relatório final.
Objetivo principal: entregar o Core e o Runner funcionais, seguros e integrados ao Electron existente, com o menor consumo razoável de tokens, sem sacrificar qualidade, testes ou segurança.
Use o Waterfall /route já configurado no ambiente. Reutilize as definições existentes de agentes, modelos, limites e roteamento. Não recrie a infraestrutura de orquestração.
1. Modo de execução
Autorização: execute continuamente todas as etapas de desenvolvimento e validação previstas neste prompt, sem solicitar aprovação intermediária para alterações de código dentro do escopo.
A aprovação das 12 decisões arquiteturais do contrato já foi concedida.
Só interrompa para perguntar se houver:
Operação destrutiva ou irreversível.
Alteração de credenciais, autenticação ou contas.
Necessidade de consumir recursos pagos adicionais não previstos.
Mudança arquitetural substancial fora das decisões aprovadas.
Alteração do companion de produção que não possa ser feita de forma incremental e reversível.
Bloqueio que não possa ser resolvido com segurança.
Não faça commits, push, deploy, releases ou publicação.
2. Distribuição econômica de trabalho
Scout — Haiku
Delegue prioritariamente ao Haiku:
Leitura e localização de arquivos.
Busca por símbolos, referências e dependências.
Inspeção de Git, estrutura de diretórios e configuração.
Consulta aos relatórios existentes.
Comandos de diagnóstico não destrutivos.
Execução de lint, typecheck, builds e testes.
Captura e classificação inicial de erros.
Identificação de arquivos impactados.
Verificação de resultados e logs.
Resumos de evidências para outros agentes.
Não repasse arquivos inteiros quando um resumo com caminhos, linhas e trechos relevantes for suficiente.
Agrupe leituras e comandos relacionados.
Evite buscas repetidas e logs extensos.
Builder — Sonnet
Responsável por:
Implementação do Core.
Persistência SQLite.
Máquinas de estado.
Gerenciamento de processos.
Adapter Claude Code.
Segurança e permissões.
Reconciliação.
Integração mínima com Electron e UI.
Correção de bugs.
Testes unitários e de integração.
Receba contexto filtrado pelo Scout.
Não refaça investigações já documentadas.
Architect — Opus
Acione somente quando necessário para:
Decisões arquiteturais complexas.
Impasses sobre integração nativa no Windows.
Concorrência, locks e fencing.
Riscos graves de segurança.
Incompatibilidades fundamentais com o contrato.
Não acione Opus para leitura de arquivos, comandos, tarefas triviais ou revisão rotineira.
Antes de escalonar, o Builder deve registrar o problema, alternativas e evidências em um resumo curto.
Reviewer — Sonnet
Execute uma revisão independente ao final dos módulos críticos, priorizando:
Violações do contrato.
Segurança.
Concorrência.
Persistência.
Duplicação de efeitos.
Regressões.
Problemas de integração.
Use diffs e resumos direcionados, não uma releitura integral do projeto.
3. Documentação obrigatória
Consultar:
docs/TERA_POCKET_PHASE0_AUDIT.md
docs/TERA_POCKET_PHASE05_REPORT.md
docs/phase0/runner-contract.md
docs/phase0/safety/results.md
Spec original do Tera Pocket.
A seção 9 do runner-contract.md está integralmente aprovada com as seguintes escolhas:
Divergências de contrato e estados aprovadas.
success → review; conclusão após aprovação.
Escrita livre dentro do workspace autorizado; Bash controlado por política; ações destrutivas e escritas externas exigem aprovação.
Aprovações de uso único com TTL de 10 minutos.
Interrupção limpa com timeout de 10 segundos.
Três retries adicionais, exclusivamente para erros transitórios sem ferramentas autorizadas.
SQLite WAL com synchronous=FULL.
Lock nativo do SO e Windows Job Object, mantendo Electron.
canUseTool no MVP.
Testes reais não destrutivos permitidos.
Execução manual por padrão.
Uso pessoal local inicialmente.
4. Implementação completa
Execute as etapas em ordem de dependência.
A — Auditoria rápida
Inspecionar o estado atual do repositório e worktrees.
Identificar módulos existentes e pontos de integração.
Verificar dependências e versões.
Preservar alterações preexistentes.
Definir arquitetura incremental.
Não gastar tokens reescrevendo a auditoria da Fase 0.5.
B — Core e SQLite
Implementar:
Estados e transições de tarefas.
Estados e transições de sessões.
Journal transacional append-only.
Ledger de efeitos.
Aprovações e gestos.
Identificadores taskId, sessionId, runId.
Replay e recuperação.
Migração segura de dados existentes, se necessária.
Garantias de escritor único.
C — Processos e exclusividade
Implementar:
Lock nativo do sistema operacional.
Windows Job Object com encerramento da árvore.
Integração segura ao processo principal Electron.
Fencing e identificação do proprietário.
Detecção de processos órfãos.
Recuperação de locks abandonados.
Proteção contra sessões concorrentes.
Encerramento limpo e forçado.
Se houver limitações na biblioteca nativa escolhida, investigar alternativas compatíveis com Electron antes de escalar.
Não introduzir Tauri nem Rust como novo host.
D — Adapter Claude Code
Implementar AgentRunner:
capabilities
start
interrupt
resume
resolveApproval
onEvent
Normalizar eventos com taskId, sessionId, runId e sequência.
O Core é a única fonte de verdade. O adapter não altera diretamente o estado das tarefas.
Usar somente mecanismos oficiais suportados.
Não ler nem armazenar credenciais do Claude Code.
E — Permissões
Implementar:
Confinamento de escrita ao workspace autorizado.
Tratamento de caminhos reais, symlinks e junctions.
Classificação de comandos Bash.
Allowlist conservadora.
Detecção de comandos destrutivos.
Aprovação por ação e execução.
Expiração e consumo único.
Fencing antes de permitir efeitos.
Proteção contra reexecução após crash.
Não presumir que cwd confina operações.
Comandos não classificáveis com segurança exigem aprovação ou negação.
F — Reconciliação
Implementar R1–R6 do contrato.
Garantir que:
Crash não provoque execução automática.
Efeitos incertos sejam registrados.
Ações potencialmente repetidas sejam bloqueadas.
O usuário possa revisar evidências.
A retomada exija gesto explícito.
Sessões expiradas não sejam recriadas silenciosamente.
Falhas de autenticação e limite não entrem em retry automático.
G — Integração Electron e UI
Integrar minimamente:
Lista e estados de tarefas.
Iniciar.
Interromper.
Aprovar/negar.
Retomar com prompt editável.
Revisar resultado.
Resolver reconciliação.
Preservar a experiência visual existente do companion.
Não implementar ainda um redesign completo do Focus/Pocket.
5. Estratégia de testes
Haiku deve executar comandos de validação e resumir falhas.
Sonnet deve corrigir problemas encontrados.
Testar:
Máquina de estados.
SQLite e transações.
Corrupção/interrupção de journal.
Concorrência.
Exclusividade.
Recuperação após crash.
Job Object e processos órfãos.
Aprovações duplicadas ou expiradas.
Escrita fora do workspace.
Symlinks/junctions.
Bash composto.
Retry após efeitos.
Retomada de sessão.
Reconciliação.
Integração Electron.
Reaproveitar os 29 testes de segurança da Fase 0.5 quando aplicável.
Testes com Claude Code real devem ser mínimos, isolados e não destrutivos.
Não provocar limite de uso deliberadamente.
Não modificar autenticação.
6. Controle de tokens
Regras obrigatórias:
Reutilizar resultados existentes antes de investigar novamente.
Evitar leituras integrais repetidas.
Enviar ao Builder apenas contexto necessário.
Usar resumos estruturados curtos entre agentes.
Não acionar Opus sem justificativa concreta.
Agrupar comandos relacionados.
Não despejar logs extensos.
Não repetir testes que passaram sem alterações relevantes.
Não criar agentes paralelos sem trabalho independente.
Limitar ciclos de correção; diante de bloqueio real, documentar e escalar.
Preferir diffs e trechos a arquivos inteiros.
Não sacrificar verificações de segurança para economizar tokens.
Não economizar tokens omitindo testes essenciais.
7. Entregáveis
Ao final, produzir:
docs/TERA_POCKET_PHASE1_REPORT.md
Incluindo:
O que foi implementado.
Arquivos modificados.
Arquitetura final.
Testes executados.
Resultados e evidências.
Bugs corrigidos.
Pendências.
Riscos conhecidos.
Compatibilidade com Electron.
Funcionalidades que dependem de testes manuais.
Próximos passos recomendados.
Se uma parte não puder ser concluída com segurança, não fingir conclusão. Entregar o restante funcional e registrar o bloqueio.
8. Critérios de conclusão
A Fase 1 só pode ser considerada concluída quando:
Core e SQLite funcionarem.
Estados e transições forem validados.
Runner integrar com Claude Code.
Aprovações forem seguras.
Lock impedir concorrência.
Crash não causar reexecução automática.
Reconciliação exigir decisão do usuário.
Testes relevantes passarem.
Electron continuar funcional.
Relatório estiver entregue.
9. Execução
Comece imediatamente e percorra todo o fluxo Waterfall até terminar.
Não pare após a auditoria ou planejamento.
Não solicite aprovação entre etapas já autorizadas.
Delegue leituras, buscas, comandos e validações ao Haiku sempre que viável.
Use Sonnet para implementação e Opus apenas quando indispensável.
Preserve os worktrees e alterações existentes.
Não faça commit, push, deploy ou release.
Ao finalizar, apresente um resumo curto com:
Entregas concluídas.
Testes passando/falhando.
Pendências e riscos.
Arquivo do relatório.
Se a Fase 1 está aprovada tecnicamente ou não.

Otimização adicional de consumo
O objetivo é minimizar o consumo total de tokens e o custo dos modelos, não maximizar a quantidade de delegações.
Scout/Haiku: investigações extensas, buscas em múltiplos arquivos, coleta e filtragem de logs.
Builder/Sonnet: implementação e comandos curtos diretamente relacionados às alterações que está fazendo.
Architect/Opus: somente bloqueios complexos com justificativa.
Não delegar tarefas triviais quando o custo de criar e contextualizar outro agente superar o trabalho direto.
Não repetir leitura de arquivos ou execução de testes sem necessidade.
Reutilizar contexto e resultados já disponíveis.
Não criar relatórios intermediários extensos.
Ao final, registrar quantidade de chamadas por modelo, tokens de entrada/saída e custo estimado, somente se essas métricas estiverem disponíveis. Não inventar números.
Priorizar execução eficiente, sem comprometer segurança e testes.
Orçamento de execução: priorize o menor consumo possível. Não crie agentes desnecessários, não repita investigações, limite ciclos de correção e não use Opus sem bloqueio concreto. Se perceber que está entrando em um loop improdutivo, pare, registre o estado e apresente o bloqueio.

Quality Gate — Waterfall
A economia de tokens nunca deve comprometer a qualidade da implementação.
Toda entrega deve passar por revisão independente do Reviewer/Sonnet.
O Reviewer deve verificar correção, legibilidade, manutenção, testes, segurança, regressões e aderência ao contrato aprovado.
O Architect/Opus deve realizar uma revisão arquitetural obrigatória e objetiva dos módulos críticos: persistência SQLite, lock/Job Object, permissões, runner e reconciliação.
O Opus deve receber somente o contrato relevante, resumo da implementação, decisões tomadas, diffs críticos e resultados dos testes. Evitar enviar o repositório inteiro.
Problemas encontrados devem retornar ao Builder/Sonnet para correção.
Após as correções, o Reviewer deve validar novamente os pontos afetados.
O Opus só deve ser acionado novamente quando a correção alterar uma decisão arquitetural ou envolver risco crítico.
Nenhuma entrega crítica será considerada concluída com problemas graves conhecidos ou testes essenciais falhando.
Registrar no relatório quais módulos foram revisados, por qual modelo, problemas identificados e pendências.
Não afirmar que houve revisão do Opus se ela não foi realmente executada.
Objetivo: qualidade de engenharia consistente com o menor consumo razoável de tokens, evitando revisões duplicadas e escalonamentos desnecessários.
