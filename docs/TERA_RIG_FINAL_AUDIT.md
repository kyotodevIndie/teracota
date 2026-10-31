# Auditoria final do rig 2D da Tera

> Data: 2026-10-09 · Branch auditada: `feat/tera-rig` (worktree `K:\dev\waifu-claude-rig`, base `05dc270`, sem commit)
> Escopo: auditoria e validação. **Nenhum código de produção foi alterado.** Os únicos arquivos novos são este relatório e as capturas em `reports/tera-rig-audit/`.
> Ambiente: Windows 11, 8 núcleos, Electron 44.4.5, monitor principal 1920×1080 a 100% de escala, segundo monitor 2560×1440.

## Respostas diretas

| Pergunta | Resposta |
|---|---|
| **O motor de rig está pronto?** | **Parcialmente.** A geometria (camadas, hierarquia, pivôs, ordem de desenho, matrizes), a validação do manifesto, o clique por pixel transformado e o fallback estão sólidos e verificados. Faltam variantes de imagem por camada, visibilidade e a tabela de expressões. Sem isso, nenhuma expressão, piscada ou troca de boca é possível. |
| **O que ainda falta implementar?** | Expressões (troca de imagem por camada), piscada, olhar pro cursor (cabeça e íris), boca falando, poses próprias (hoje todas usam o corpo base) e a integração do rig no Mini Companion. |
| **O que precisa ser corrigido antes da arte definitiva?** | (1) Estender o schema com **variantes** e **visibilidade** por camada, porque hoje cada camada aceita uma imagem fixa. (2) Separar olhos e boca do arquivo do rosto (hoje estão pintados na imagem, então não piscam). (3) Definir a orientação da personagem: a arte é de frente, e o `facing` do manifesto não bate com a posição da cauda. (4) Fechar `close()` nos bitmaps e chamar `destroy()` quando o personagem sai. Nenhum desses é bloqueio grave; (1) e (3) precisam estar decididos antes de encomendar a arte. |
| **Podemos começar pelas expressões faciais?** | **Sim, mas pelo motor, não pela arte.** A primeira etapa é estender o schema e o `RigScene` com variantes e visibilidade, com testes, usando placeholders com olhos e boca separados. A arte final do rosto entra depois, já encaixada nesse contrato. |
| **Existe motivo técnico pra abandonar a abordagem?** | **Não.** O Canvas 2D com camadas e pivôs atende expressões, piscada, olhar e cabelo em cadeia. Só haveria motivo pra considerar malha deformável (PixiJS ou similar) se o cabelo ou a roupa precisarem dobrar de verdade, e isso não está no escopo atual. Não há razão pra reescrever nada agora. |

---

## 1. Estado atual do rig

**Arquivos principais (`feat/tera-rig`):**

| Arquivo | Papel | Estado |
|---|---|---|
| `src/shared/rig.ts` | Contrato, validação, matrizes, máscara de clique | Sólido, 40+ testes |
| `src/renderer/rig/scene.ts` | Carregamento das camadas, desenho em ordem de `z`, hit test | Funcional; sem `close()` |
| `src/renderer/rig/rig-character.ts` | Implementa `Character`; movimento do corpo e cauda | Funcional; `expression`, `anim`, `setTalking` e `lookAt` não fazem nada |
| `src/renderer/rig/controllers.ts` | Respiração, cadeia de balanço (cauda), mistura de ajustes | Funcional; cadeia com `drive` dependente do frame |
| `src/main/skins.ts` | Carrega e valida o rig, dev-only, fallback explícito pra `tera` | Funcional |
| `src/renderer/app.ts` | Ordem: rig → skin original → SVG | Funcional |
| `dev/skins/tera-rig/` | Rig de teste: 16 camadas **geométricas** provisórias | Provisório, não é a arte |
| `scripts/rig-inspect/` | Página de inspeção (pivôs, camada sob o cursor, benchmark) | Funcional |

**Rig de teste:** 16 camadas (corpo, 2 braços, 2 mãos, 2 pernas, 2 sapatos, cabeça, rosto, 2 orelhas, 3 segmentos de cauda). Hierarquia com raiz no corpo; respiração no corpo; cadeia de balanço nas 3 partes da cauda.

## 2. Funcionalidades: completas, parciais e ausentes

### Completas (verificadas)

| Funcionalidade | Evidência |
|---|---|
| Validação do `rig.json` com erros nomeados (pai inexistente, ciclo, raiz dupla, caminho inseguro, faixa de números, limite de 64 camadas, ids repetidos) | 13 testes em `rig.test.ts` |
| Hierarquia e herança de transformação (pai → filho) | Teste de matrizes; inspeção visual com pivôs |
| Ordem de desenho por `z`, independente da hierarquia | Teste; inspeção visual (cauda atrás do corpo) |
| Limites de rotação procedural (`limits`) | Teste (`rotation: 999` → preso em 20°) |
| Clique por pixel transformado, camada de cima primeiro | 6 testes + medição com cursor real (ver §3) |
| Click-through fora do desenho | Medição com o cursor real do Windows (`WindowFromPoint`) |
| Arrasto com o mouse real, pendulo e posição salva | Arrasto de 260 px, janela movida 1500 → 1240, posição salva |
| Fallback: rig inválido → skin original; rig com PNG corrompido → skin original | Testado no Electron (ver §3) |
| Rig só aparece em desenvolvimento | Pacote inspecionado: nenhum `dev/`, nenhum `tera-rig` |
| Modo multi: 3 Teras com as etiquetas certas; sessão que termina remove só a sua | Captura + teste manual |

### Parciais

| Funcionalidade | O que existe | O que falta |
|---|---|---|
| **Respiração** | Escala do corpo (1,5%) via controlador | Confirmada só numericamente (teste). A amplitude é de 2–3 px, abaixo do que as capturas conseguem mostrar com segurança. |
| **Movimento da cauda** | Cadeia com mola, reage ao arrasto e ao andar | O `drive` mede a variação do ângulo **por quadro**, então depende da taxa de quadros (ver P-05). |
| **Andar** | Flip + inclinação + quique (wobble das sprites) | Com arte de frente, o flip só espelha a imagem; não comunica direção (ver P-04). |
| **Balanço do arrasto** | Pêndulo da Tera original aplicado no corpo | Visível, porém leve no teste (o movimento do mouse foi relativamente lento). |
| **Troca de skin pelo menu** | Config e reinício cobertos (`tera-rig` → `tera`) | Clique no menu nativo não foi automatizado; ver §5. |

### Ausentes

| Funcionalidade | Motivo |
|---|---|
| Expressões (`neutral`, `happy`, `focused`, `confused`, `surprised`, `sleepy`, `sad`) | `Look.expression` é ignorado. Não há variantes de imagem nem tabela de expressões. |
| Piscada | Depende de olhos separados e de variantes. |
| Olhar pro cursor | `lookAt()` é no-op. `LayerOffset` já tem `dx`/`dy`, então o mecanismo existe; falta ligar. |
| Boca falando | `setTalking()` é no-op. |
| Poses próprias (`work`, `wave`, `sleep`, etc.) | Todas caem no corpo base. |
| Mini Companion usando o rig | `loadSpriteSkin()` foi escrito, mas a branch do mini não existe neste worktree. |

## 3. Capturas e evidências visuais

Todas em `reports/tera-rig-audit/`.

| Arquivo | O que mostra | Fonte |
|---|---|---|
| `06-inspecao-repouso-pivos.jpg` | Repouso com pivôs (pontos) e caixas de cada camada | Página de inspeção (navegador interno) |
| `07-inspecao-arrasto-balanco.png` | Pose de arrasto: corpo inclinado, cauda reagindo | Página de inspeção |
| `08-inspecao-andando-esquerda.png` | Andando pra esquerda: flip do desenho | Página de inspeção |
| `01-electron-repouso.png` | Repouso no Electron real, fundo transparente | Electron (janela real) |
| `02-electron-arrasto-meio.png` | Meio do arrasto com o mouse real | Electron |
| `03-electron-multi-3-teras.png` | Três Teras no modo multi, etiquetas `alpha`/`beta`/`gama` | Electron |
| `04-electron-evento-sleeping.png` | Estado `sleeping` pela API local: balão e ícone | Electron |
| `05-fallback-rig-corrompido.png` | Fallback: rig com PNG corrompido, mostra a Tera original | Electron |

**Não foi feita gravação em vídeo.** A evidência de movimento vem de capturas e de medições, não de um clipe. Não afirmo ter visto a respiração a olho nu.

**Observações visuais:**
- Proporções: a cabeça é grande e o corpo é compacto; as mãos são círculos. Isso é esperado de um placeholder, mas as proporções finais precisam ser definidas com a arte.
- Cor: moletom terracota, igual ao visual de referência, sem o detalhe da gola nem do capuz.
- Transparência: fora das camadas, o fundo é transparente (confirmado no Electron e na inspeção).
- Clique atravessando: o canto da caixa, fora do desenho, deixa o clique passar; o torso não.

**Verificações de clique com cursor real (Windows, `WindowFromPoint`):**
- Cursor sobre o torso → `TERACOTA`.
- Cursor no canto da caixa (fora do desenho) → outra janela.
- Cursor volta ao torso → `TERACOTA`.

**Hit test por camada (inspeção):** rosto → `face`, torso → `body`, ponta da cauda → `tail_3`, vão entre as pernas → `null`.

## 4. Problemas encontrados

Severidade: **Alta** = bloqueia a próxima etapa; **Média** = precisa ser resolvido antes da arte definitiva; **Baixa** = dívida ou melhoria.

| ID | Sev. | Problema | Evidência | Recomendação |
|---|---|---|---|---|
| **P-01** | **Alta** | Cada camada aceita **uma imagem fixa**. Não há variantes, então expressões e piscada exigem reescrever o carregamento. | `rig.ts`: `image: string`; `scene.ts`: um `ImageBitmap` por camada | Adicionar `variants` e `visible` por camada, com teste. Mudança aditiva. |
| **P-02** | **Alta** | `Look.expression` e `Look.anim` são **ignorados** pelo rig. Todas as expressões ficam iguais. | `rig-character.ts`: `expression` e `anim` só aparecem no inicializador | Ligar a tabela de expressões ao `RigScene` depois de P-01. |
| **P-03** | Média | Olhos e boca estão **pintados** na imagem do rosto (placeholder), então não piscam nem mudam. | `make-rig-placeholders.ts`: `face.png` com olhos e boca | Separar olhos e boca em camadas no placeholder e na arte. |
| **P-04** | Média | **Orientação inconsistente:** `facing: "right"` no manifesto, mas a cauda está do lado direito da arte de frente. Andar só espelha, sem direção. | `skin.json`: `facing`; inspeção: andando à esquerda | Decidir a orientação antes da arte. Com arte de frente, andar precisa de outro sinal (ex.: inclinação e passo), não só flip. |
| **P-05** | Baixa | O `drive` da cadeia usa a **variação do ângulo por quadro** (`swingVelocity * 6`), então muda com a taxa de quadros (24 ou 60 fps). | `rig-character.ts`: `drive`; `controllers.ts` | Usar variação por segundo (dividir pelo `dt`). |
| **P-06** | Baixa | `ImageBitmap` nunca é fechado (`close()`), e `destroy()` nunca é chamado no app. | `grep close()` em `src/renderer/rig`: 0 ocorrências; `destroy()` sem chamadas | Fechar bitmaps em `destroy()` e chamar ao trocar de skin. Hoje a troca recarrega a página, então a memória é liberada pelo navegador. |
| **P-07** | Média | Máscara de clique com **64 px** no lado maior: detalhes finos (ponta da cauda, ahoge) podem não acertar em arte de 1024 px. | `scene.ts`: `MASK_MAX = 64` | Subir a máscara (ex.: 128 px) e medir o custo na inspeção. |
| **P-08** | Baixa | `GRIP_Y` duplicado (`wobble.ts` e `rig-character.ts`). | Dois `0.04` | Centralizar quando houver a segunda ocorrência. |
| **P-09** | Baixa | O código do renderer do rig (`RigCharacter`, `rig.ts`) vai pro pacote de produção, mesmo sem assets. | `app.js` do pacote: 3 ocorrências de `RigCharacter` | Aceitável; se quiser zero código morto, isolar atrás de um import dinâmico. |
| **P-10** | Média | **Não testado:** escalas de 125%/150%, segundo monitor com o rig, e troca de skin pelo menu nativo. | Ver §5 | Testar antes do lançamento do rig. |
| **P-11** | Baixa | O Mini Companion ainda não usa o rig (função pronta, branch fora deste worktree). | `loadSpriteSkin()` sem chamadas | Ligar ao juntar as branches. |

**Não encontrei:** falhas nos testes, erro de carregamento no Electron com o rig válido, vazamento visível de janela, nem problema de clique atravessando.

## 5. Resultados dos testes

### Regressões automatizadas

| Verificação | Resultado |
|---|---|
| `npm run check` (typecheck + lint + testes) | **Passou.** 13 arquivos, **149 testes** (123 pré-existentes + 26 novos). Falhas pré-existentes: **nenhuma**. |
| `node build.mjs` | Passou. |
| Empacotamento isolado (`electron-builder --win --dir`) | Passou. Saída em pasta temporária, não em `release/`. |
| Pacote contém assets experimentais? | **Não.** `app.asar` lista `dist/main.js`, `preload.js`, `renderer/app.js`, `index.html`, `style.css` e `package.json`. `resources/assets/skins` contém só `tera`. Nenhum `dev/`, `rig-inspect` ou `make-rig-placeholders`. |
| Executável empacotado com `tera-rig` na config | Inicia sem erro e cai pra `tera` (`getSkin` → `{id: "tera", rig: false}`). |
| `feat/mini-companion` intacta | Confirmado: `HEAD` em `05dc270`, mesmo diff (`5 files, 71 insertions, 5 deletions`), sem stash. |
| Nenhum commit/push no worktree | `HEAD` em `05dc270`; todas as alterações estão não commitadas. |

**Não executado:** o instalador NSIS (`npm run dist`). Foi gerada a versão desempacotada, que é o que o NSIS empacota. Não confirmei o instalador em si.

### Testes manuais no Electron (perfil isolado, porta de teste)

| Teste | Resultado |
|---|---|
| Rig em repouso, fundo transparente | ✅ Visto |
| Hover com cursor real | ✅ Classe `hovering` aplicada |
| Clique atravessando (cursor real, `WindowFromPoint`) | ✅ Dentro do desenho → Teracota; canto transparente → outra janela |
| Arrasto com o mouse real | ✅ Janela de x=1500 para x=1240; posição salva |
| Balanço do arrasto | ⚠️ Visível, leve. Não medi o ângulo. |
| Eventos pela API local (`listening`, `typing`, `terminal`, `error`, `happy`, `sleeping`) | ✅ 6× HTTP 204; balão e ícone certos; sem erro no console |
| Multi com 3 sessões | ✅ 3 Teras com etiquetas; uma sessão encerrada → fica 2 |
| Fallback: rig inválido | ✅ Log do main; cai pra `tera` |
| Fallback: PNG corrompido | ✅ Cai pra `tera` (captura 05) |
| Troca de skin pelo menu nativo | ❌ Não automatizado. Coberto só por configuração + reinício. |
| Segundo monitor com o rig | ❌ Não testado |
| Escala 125%/150% | ❌ Não testado (escala do sistema em 100%) |
| Acesso de sessão real do Claude Code | ❌ Não testado; usei a API local, que é o mesmo caminho de entrada |

### Inspeção (navegador interno, sem Electron)

- Carregamento: 16 camadas, pivôs e caixas corretos.
- Hit test: ver §3.

## 6. Comparação de desempenho

**Condições:** mesma máquina, mesmo perfil, mesmo script de medição (`perf.ps1` + contagem de `clearRect`, que as duas implementações chamam uma vez por quadro). Processos do Electron: 4 (single) e 6 (multi).

**Aviso importante:** os números variam muito entre execuções nesta máquina (ex.: rig em repouso: 7,8% e 19,4% em duas rodadas). Estou tratando como **faixa**, não como comparação precisa. Com essa variação, **não há diferença de CPU que eu consiga afirmar** entre rig e sprites.

| Métrica | Rig (faixa) | Tera original (faixa) | Tipo |
|---|---|---|---|
| CPU em repouso, 1 Tera | 7,8% – 19,4% (3 rodadas: 16,9 / 19,4 / 7,8) | 10,2% – 18,3% (3 rodadas: 18,3 / 15,0 / 10,2) | **Medido**, ruído alto |
| CPU arrastando, 1 Tera | 6,5% – 10,2% (3 rodadas) | 20,2% (1 rodada) | **Medido**, poucas amostras |
| Memória (working set), 1 Tera | 344 – 384 MB (3 rodadas) | 407 – 412 MB (2 rodadas) | **Medido**, o Electron domina |
| Quadros por segundo, repouso | 21,3 – 22,5 fps (alvo 24) | 21,3 – 21,5 fps (alvo 24) | **Medido** |
| Quadros por segundo, arrastando | 43,5 – 47,6 fps (alvo 60) | 43,8 fps | **Medido**; alvo não atingido nos dois, mesmo comportamento |
| CPU, 3 Teras em repouso | 36,0% (1 rodada) | 25,9% (1 rodada) | **Medido**, 1 amostra cada |
| Memória, 3 Teras | 596 MB (1 rodada) | 792 MB (1 rodada) | **Medido**, 1 amostra cada; não conclusivo |
| Tempo de desenho por quadro (síncrono, 600 quadros) | **média 0,04–0,05 ms**, pior 0,3–3,9 ms | **não medido** neste harness | **Medido** só pro rig |
| Hit test | **2–4 µs** por chamada (10 mil chamadas) | — | **Medido** só pro rig |

**Leitura honesta:**
- O rig **não ficou claramente mais pesado** que a Tera original, em nenhuma métrica que eu consiga separar do ruído.
- Não medi o tempo de desenho da Tera original no mesmo harness, então não posso afirmar que o desenho do rig é mais barato ou mais caro que o das sprites.
- A taxa de quadros durante o arrasto não chega a 60 fps em nenhuma das duas. Vale investigar antes da arte definitiva, porque afeta a fluidez percebida.
- **Multi (3 Teras):** o custo cresce de forma linear com as instâncias nas duas skins. Não há diferença que eu possa atribuir ao rig.

**Estimativas (não medidas):** nenhuma usada como dado.

## 7. Riscos arquiteturais

| Risco | Gravidade | Comentário |
|---|---|---|
| Expressões exigem variantes por camada (P-01) | Alta | Mudança aditiva, mas toca em `load` e `draw`. Fazer antes de encomendar o rosto. |
| Orientação indefinida (P-04) | Média | Uma decisão de arte que afeta o código (direção do andar). Decidir antes. |
| Canvas 2D sem malha | Média (futura) | Cabelo e roupa só dobram com cadeias de camadas, não com deformação. Se a arte exigir dobra de tecido, a conversa com malha (PixiJS) volta. |
| Taxa de quadros no arrasto (§6) | Média | Não atinge o alvo nos dois renderers. Pode ser limite do ambiente de teste. |
| Clique por máscara de 64 px (P-07) | Média | Pode perder detalhes finos. Subir a resolução tem custo que precisa ser medido. |
| Parâmetros de escala no `drive` (P-05) | Baixa | Dependente de quadro; corrigível localmente. |
| Memória de bitmap sem fechar (P-06) | Baixa | Não vaza na prática hoje, porque a troca recarrega a página. |

**O que a arquitetura já suporta sem reescrita:**
- ✅ Olhar pro cursor: `LayerOffset` já tem `dx`/`dy` por camada, então é só ligar.
- ✅ Cabelo em cadeia: `ChainSway` é genérico (qualquer lista de camadas).
- ✅ Acessórios e roupas: basta um novo filho na hierarquia (ex.: chapéu preso em `head`).
- ⚠️ Expressões, piscada e boca: **exigem** P-01 e P-03 (variantes e visibilidade). É extensão, não reescrita.
- ⚠️ Dobra de tecido: não suportada hoje (sem malha).

## 8. Prontidão para receber arte definitiva

**Parcialmente pronto.**

**Pode começar agora:**
- A **arte das camadas** do corpo, desde que siga o contrato atual (imagem fixa, pivô, `at`, `z`), que já funciona.
- A **peça de validação** de cabeça e rosto, que pedi na etapa anterior.

**Antes de encomendar a arte do rosto:**
1. P-01: variantes e visibilidade por camada.
2. P-03: olhos e boca separados no placeholder (pra validar o contrato com a mesma estrutura da arte).
3. P-04: decisão de orientação (frente, 3/4 ou lateral).

**Antes do lançamento do rig (não bloqueia a arte):**
- P-06 (fechar bitmaps), P-07 (máscara), P-10 (escalas, segundo monitor, menu).

## 9. Recomendações para a próxima fase

Ordem sugerida (todas ficam no motor; nenhuma exige arte nova):

1. **Schema v2 e variantes** (P-01): `variants` por camada (`{ "neutral": "...", "happy": "..." }`) e `visible` (padrão `true`). Testes de parser e de seleção. Compatível com o rig atual.
2. **Tabela de expressões** (P-02): `expressions` no `rig.json` mapeando `Expression` → variantes/visibilidade. `RigCharacter` aplica o `look.expression`. Teste com placeholders.
3. **Piscada e olhar** com os controladores existentes: piscada trocando visibilidade (olhos abertos ↔ fechados) com agendador aleatório; olhar via `dx`/`dy` das íris e rotação limitada da cabeça (`limits` já existe).
4. **Placeholder de rosto separado** (P-03): olhos, boca e sobrancelhas em camadas, pra validar 1–3.
5. **Decisão de orientação** (P-04), registrada no `skin.json`.
6. **Correções baixas:** P-05 (`drive` por segundo), P-06 (`close()` e `destroy()`), P-07 (máscara de 128 px, medida).
7. **Testes pendentes** (P-10): 125%/150%, segundo monitor, troca pelo menu nativo.
8. **Quando as artes chegarem:** encaixar no contrato da etapa 1 e rodar a página de inspeção antes de ligar ao app.

**Próximo passo imediato, se aprovado:** implementar o item 1 (schema v2 com variantes e visibilidade) no worktree, com testes. Não toca em hooks, integração ou outras skins.

---

*Relatório gerado a partir das medições e inspeções descritas. Onde algo não foi executado, está marcado como não testado.*
