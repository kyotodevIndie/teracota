# Paridade Electron x Tauri - resultados

Harness: `poc/parity/` (electron/, tauri/, shared/, harness/run-parity.ps1). Logs brutos por execucao: `docs/phase0/parity/raw/*.json`.
Ambiente: Windows 11, 2 monitores (1920x1080 primario; 2560x1440 em x=-2560,y=-355), ambos em escala 100%. Electron 44.4.5, Tauri 2.12.2 (WebView2). Um host por vez, nunca simultaneos. Mesma pagina (`shared/`), janela 320x440 transparente, sem moldura, topmost, sem foco, fora da barra; polling de cursor 33 ms; mascara alfa 64x64 (alfa>40) - Electron via nativeImage no main, Tauri via canvas no JS enviada ao Rust.
Todas as medicoes abaixo: n=3 (M1/M2), n=5+5 (M3), uma grade (M4). Ruido = desvio padrao (sd) entre execucoes.

## Resumo

| Metrica | Status |
|---|---|
| M1 memoria | MEDIDO |
| M2 CPU idle e arrasto simulado | MEDIDO |
| M3 primeiro frame | MEDIDO |
| M4 click-through | MEDIDO |
| M9 multi-monitor (coord. negativas) | MEDIDO |
| M6 foco | MEDIDO |
| M8 bandeja | MEDIDO por API; clique real NAO TESTADO (clicar no icone da bandeja nao e confiavel por automacao) |
| M5 hover (latencia) | NAO TESTADO nesta rodada (codigo pronto: `run-parity.ps1 -Metric M5`; priorizacao do coordenador) |
| M7 arrasto fisico | NAO TESTADO nesta rodada (codigo pronto: M7) |
| M10 DPI misto | NAO TESTADO: exige alterar a escala de exibicao do sistema (proibido); alem disso ambos os monitores estao em 100% |
| M11 z-order sobre tela cheia | NAO TESTADO nesta rodada (codigo pronto: M11) |

## M1 Memoria (Private Bytes da arvore, apos 60 s de animacao) - MEDIDO

| Host | Janelas | Execucoes (MiB private) | Media | sd | WorkingSet (ref., MiB) | Processos |
|---|---|---|---|---|---|---|
| Electron | 1 | 123.0 / 125.2 / 126.4 | 124.9 | 1.7 | 297.6 / 295.8 / 296.2 | 4 |
| Tauri | 1 | 134.4 / 133.8 / 134.3 | 134.2 | 0.3 | 342.2 / 340.3 / 340.8 | 7 |
| Electron | 3 | 192.9 / 191.1 / 188.2 | 190.7 | 2.4 | 446.9 / 446.0 / 444.5 | 6 |
| Tauri | 3 | 212.2 / 212.3 / 215.2 | 213.2 | 1.7 | 486.4 / 485.3 / 488.9 | 9 |

Observacao: nesta carga, Tauri (WebView2) usou ~9 MiB (1 janela) e ~22 MiB (3 janelas) a MAIS de Private Bytes que Electron; diferenca acima do ruido observado (sd <= 2.4) em ambos os casos. Escopo: 1 sprite 4 frames, sem logica do app real; nao extrapolar para o app completo (HIPOTESE). A arvore Tauri inclui os msedgewebview2 filhos do app.

## M2 CPU (media da arvore em 60 s, % de 1 nucleo) - MEDIDO

| Host | Cenario | Execucoes | Media | sd |
|---|---|---|---|---|
| Electron | idle (1 janela, animando) | 3.10 / 2.08 / 1.77 | 2.32 | 0.69 |
| Tauri | idle (1 janela, animando) | 5.78 / 5.55 / 5.18 | 5.50 | 0.30 |
| Electron | idle, 3 janelas | 5.10 / 4.90 / 6.09 | 5.36 | 0.64 |
| Tauri | idle, 3 janelas | 13.70 / 13.57 / 14.50 | 13.92 | 0.51 |
| Electron | cursor em movimento (SetCursorPos ~8 ms, elipse sobre o sprite, sem botao) | 3.07 / 3.36 / 3.98 | 3.47 | 0.47 |
| Tauri | cursor em movimento | 7.29 / 6.30 / 6.28 | 6.62 | 0.58 |

Observacao: Tauri consumiu mais CPU em todos os cenarios, diferenca > 2 sd. Causa NAO investigada (HIPOTESE: o polling em thread Rust com `webview_windows()`/`cursor_position()` a cada 33 ms e a pilha WebView2; nao foi feito profiling). O "arrasto simulado" aqui e movimento do cursor sem botao pressionado; o arrasto com botao e o M7 (nao executado).

## M3 Inicializacao (inicio do processo ate primeiro frame pintado; ms) - MEDIDO

Metodo: Date.now() no rAF apos o primeiro desenho menos Process.StartTime (resolucao de ~ms; inclui, no Tauri, a decodificacao das mascaras no canvas antes do rAF). "Frio" = perfil novo (userData/WebView2), com cache de arquivos do SO NAO limpo (reboot proibido), portanto e "frio de perfil", nao frio de disco.

| Host | Tipo | Execucoes | Media | p50 | sd |
|---|---|---|---|---|---|
| Electron | frio | 395 / 372 / 374 / 580 / 367 | 417.6 | 374 | 91 (um outlier 580) |
| Electron | quente | 371 / 358 / 370 / 422 / 378 | 379.8 | 371 | 25 |
| Tauri | frio | 2959 / 2809 / 3388 / 2909 / 3167 | 3046 | 2959 | 231 |
| Tauri | quente | 662 / 675 / 659 / 669 / 665 | 666 | 665 | 6 |

Observacao: Electron foi mais rapido ate o primeiro frame nos dois casos (quente ~0.37 s vs ~0.67 s; frio ~0.4 s vs ~3.0 s), diferencas muito acima do ruido. A grande penalidade do Tauri esta na criacao do perfil WebView2 novo. Em producao o perfil WebView2 do app persiste, entao o caso relevante tende a ser o "quente" (HIPOTESE). Fora desta medicao: um smoke test unico, na primeira execucao do Electron no sistema, levou ~11 s (outlier de primeira execucao; nao reproduzido; causa nao investigada).

## M4 Click-through (WindowFromPoint + GA_ROOT, cursor real via SetCursorPos, espera 300 ms) - MEDIDO

Grade 16x22 = 352 pontos por frame, frames 0 e 2 da pose idle congelados = 704 pontos por host (89 esperados como "captura"). Esperado = alfa>40 do PNG em resolucao total (ou retangulo de teste). "Borda" = celula 64x64 com pixels mistos (a quantizacao da mascara torna a divergencia inevitavel ali).

| Host | Pontos | Divergentes | Taxa | Fora de borda | Em borda (20 pontos) | Tipo |
|---|---|---|---|---|---|---|
| Electron | 704 | 2 | 0.28% | 0/684 | 2/20 | 1 devia capturar e atravessou; 1 devia atravessar e capturou |
| Tauri | 704 | 1 | 0.14% | 0/684 | 1/20 | 1 devia atravessar e capturou |

Observacao: 0 divergencias fora das celulas de borda nos dois hosts; as 1-2 divergencias estao em celulas de borda da mascara 64x64 (quantizacao / resampling diferente entre nativeImage e canvas). Diferenca de 1 ponto entre hosts = inconclusivo (n=1 grade). O hit-test funcionou com a janela transparente nos dois hosts (alfa 0 da janela nao captura quando a mascara manda atravessar).

## M9 Multi-monitor (posicao final via GetWindowRect e clique) - MEDIDO

Alvos (px fisicos): primario (600,200); secundario (-2200,100); secundario com y negativo (-2200,-300); a cavalo dos monitores (-160,100); primario de volta. Escala 100% nos dois monitores.

| Host | Alvos com posicao exata | Tamanho final | Retangulo captura clique | Area vazia atravessa |
|---|---|---|---|---|
| Electron | 5/5 | 320x440 em todos | 5/5 | 5/5 |
| Tauri | 5/5 | 320x440 em todos | 5/5 | 5/5 |

Observacao: sem diferenca. Valido so para escala igual (100%) nos dois monitores; comportamento com escalas diferentes e M10 (NAO TESTADO).

## M6 Foco - MEDIDO

5 execucoes por host: o foreground (GetForegroundWindow) antes, 0.5 s e 2.5 s depois de mostrar a janela permaneceu o mesmo; nunca foi um processo do host. Ambos: 0/5 roubos de foco. Sem diferenca. (Janela criada oculta e mostrada via showInactive/show com focusable=false.)

## M8 Bandeja - MEDIDO por API; clique real NAO TESTADO

- Electron: `Tray` criada; listeners `click`=1 e `right-click`=1; menu de contexto definido (`setContextMenu`).
- Tauri: `TrayIcon` criado (feature `tray-icon`), rect 32x48 em (1706,1032); menu e `on_tray_icon_event`/`on_menu_event` registrados.
- Clique esquerdo/direito reais e abertura do menu: NAO TESTADO (clicar no icone da bandeja do Windows nao e confiavel por automacao).

## Nao testado / pendente

- M5, M7, M11: harness implementado (`run-parity.ps1 -HostName <h> -Metric M5|M7|M11`) mas NAO executado nesta rodada; sem dados.
- M10: ver acima.
- Limites gerais: um unico PC/sessao; sem varrer a variacao entre dias; M1/M2 com apenas 1 sprite (nao e o app real); polling de 33 ms usa os timers padrao de cada host (resolucao de timer do Windows pode diferir entre Node e Rust - HIPOTESE, nao medido).
- Nenhuma conclusao de "superioridade" geral e feita: so ha diferencas acima do ruido em M1, M2 e M3 (favoraveis ao Electron neste PoC) e nenhuma em M4, M6, M9.
