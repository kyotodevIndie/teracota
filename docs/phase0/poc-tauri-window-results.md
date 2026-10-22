# PoC Tauri v2: janela transparente, always-on-top, click-through (Fase 0)

Código: `poc/tauri-window/` (Rust + HTML estático, sem npm). Scripts e logs de teste: `poc/tauri-window/tests/` (`stage1..4.ps1`, `*.log`, capturas `*.png`).

## Ambiente e versões (Cargo.lock)

Windows 11 10.0.26200, Rust 1.98.1, WebView2 154, 2 monitores (primário 1920x1080 em (0,0); secundário 2560x1440 em (-2560,-355)), ambos com scale_factor = 1.0.
tauri 2.12.2, tauri-build 2.7.1, tao 0.37.1, wry 0.57.0, webview2-com 0.39.1. Build release: 7 min 32 s (frio), exe 7,3 MB. Sem erros de ambiente.

Janela: 320x440, `transparent`, `decorations:false`, `alwaysOnTop`, `skipTaskbar`, `focus:false`, `resizable:false`, `shadow:false`. Retângulo vermelho 200x200 em CSS (60,120). Commands: `set_ignore(bool)`, `get_ignore()`, `set_emulation(bool)`. Modo emulado: thread a cada 33 ms, `cursor_position` vs retângulo, `set_ignore_cursor_events(!dentro)`. Para os testes há um canal TCP em 127.0.0.1:47600 (só no PoC) que dispara as mesmas funções.

Metodologia: PowerShell com `WindowFromPoint` + `GetAncestor(GA_ROOT)` (o HWND devolvido é filho do WebView2, que pertence ao processo `msedgewebview2`; sem GA_ROOT o PID não bate com o do app, e a primeira rodada do T2 em `stage1.log` foi descartada por isso), PID do app identificado via `Start-Process -PassThru`.

## Resultados

| Hipótese | Procedimento | Resultado | Evidência | Status |
|---|---|---|---|---|
| H1 (T1) Janela transparente sem fundo/borda | Captura (CopyFromScreen) 700x900 antes de abrir; captura da área 320x440 depois; comparar pixels fora do retângulo | 100800 px fora do retângulo, 0 diferem da captura prévia; 40000/40000 px do retângulo vermelhos puros. Confirmado também sobre fundo branco (pixel fora = 255,255,255) | stage1.log (T1), stage4.log (T6), t1_after.png, t6_shot.png | CONFIRMADO |
| H2 (T2) Com ignore=true a janela não é alvo de hit-test, dentro nem fora do retângulo | `ignore 1`; WindowFromPoint (root) dentro e fora | Dentro: PID 7608 (outra janela); fora: 7608; app = 23884. Controle com ignore=false: ambos = 23884 (a janela transparente inteira captura cliques, inclusive fora do retângulo) | stage2.log (T2, T2-control) | CONFIRMADO |
| H3 (T3) Modo emulado (polling 33 ms) dá click-through por região do retângulo | Cursor real fora/dentro/fora, espera 300 ms, WindowFromPoint; depois 15 ciclos medindo latência (poll de 1 ms) | Dentro = PoC, fora = outra janela, nos dois monitores. Latência de entrada: média 28,5 ms (min 15, max 46) no primário; 28,7 (11-51) no secundário. Saída: média 22,4 ms (14-47) / 22,0 (15-46). Consistente com o polling de 33 ms mais a granularidade do timer do Windows (~15 ms); não foi isolada a contribuição de cada um | stage2.log (T3 primário e secundário) | CONFIRMADO (hit-test por retângulo, não por pixel alfa) |
| H4 (T4) Alternar ignore 200x em 20 s com cursor na borda não gera áreas pretas/brancas (issue tauri #15947) | 200 toggles/20 s (0 erros, 20073-20284 ms), cursor em x=60 do retângulo, captura contínua da janela (1497 frames) sobre fundo branco e comparação com referência; mais 10 s de modo emulado com cursor oscilando na borda (201 frames) | 0 frames com artefato (0 px diferentes fora do retângulo, 0 px escuros). Em rodada prévia sobre fundo escuro (stage2.log) houve 7 frames com diferenças de até 1440 px, mas o fundo era um terminal em atividade e o critério "escuro" não distingue; descartada como inválida e repetida sobre fundo branco estático. O issue não foi reproduzido nesta máquina/GPU/WebView2 154 | stage4.log (T4-white, T4b), stage2.log | CONFIRMADO para este ambiente (não reproduz); não generaliza para outras GPUs/drivers |
| H5 (T5) Iniciar não rouba foco | GetForegroundWindow (PID) antes de iniciar e 2 s depois, em 2 execuções | Rodada 1: antes 14216, depois 14216 (app 23884). Rodada 2: antes 7608, depois 7608 (app 21152) | stage1.log (T5), stage3.log (linha run2) | CONFIRMADO |
| H6 (T6) Always-on-top sobre janela maximizada | Janela Windows Forms maximizada branca (processo próprio) aberta depois do PoC; captura da área do PoC | 2500/2500 amostras vermelhas visíveis; WindowFromPoint dentro = PID do PoC; foreground foi para a janela maximizada (PoC não pegou o foco e continuou por cima). Usei Forms em vez do Bloco de Notas: a tentativa com notepad (stage3.log) não detectou o processo novo (app da Store/instância única), então foi substituída | stage4.log (T6), t6_shot.png | CONFIRMADO (não testado com Notepad, nem tela cheia exclusiva/jogos/UAC) |
| H7 (T7) Arrasto programático/por região | (a) `start_dragging` chamado de thread externa sem mousedown no webview + mouse_event sintético: sem efeito. (b) `data-tauri-drag-region` no retângulo (+ capability `core:window:allow-start-dragging`), mouse_event down, SetCursorPos em 5 passos até +120,+120, up. (c) `set_position` com ignore=true | (a) retorna Ok, posição inalterada (200,200). (b) ignore=false: moveu de (200,200) para (292,197) (cursor deslocou 120,120; o movimento sintético não é fiel, mas prova que o drag nativo funciona). ignore=true: sem movimento (200,200), pois o clique não chega ao webview. (c) set_position funciona com ignore=true: (200,200) -> (300,250) | stage2.log e stage3.log (T7) | CONFIRMADO: drag via região só com ignore=false (no modo emulado funciona porque ignore=false sobre o retângulo); set_position independe de ignore. Delta exato do arrasto sintético INCONCLUSIVO |
| H8 (T8) Multi-monitor/coordenadas negativas | `set_position` para (-2400,0), (1700,800), (-200,200) (cruzando a fronteira); info; captura; hit-test; T3 no secundário | Posições aplicadas exatamente, `outer_position` = (-2400,0), scale_factor 1.0 nos dois, 2500/2500 amostras vermelhas no secundário, ignore=true/false e modo emulado corretos com coordenadas negativas (ver T2/T3 no secundário). monitor1 pos (-2560,-355) | stage2.log (T8) | CONFIRMADO para escala 1.0; DPI misto INCONCLUSIVO |
| H9 (T9) Cold start e memória | Tempo de Start-Process até o canal de controle responder; WorkingSet64 após 20 s parado | Cold start até processo pronto: 2764 ms (1ª), 1385 ms (2ª, cache quente); `MainWindowHandle` válido. Memória após 20 s: app 24,5 MB; filhos msedgewebview2 (6 processos com o user-data do app): 298,6 MB; total aproximado 323 MB | stage1.log (T9), stage3.log | CONFIRMADO (valores medidos uma vez; "pronto" = socket responde, não primeiro frame pintado) |

## Modo emulado Teracota: funciona e é estável?

Funciona: ignore=true por padrão, vira false enquanto o cursor global está dentro do retângulo, vira true ao sair, em ambos os monitores, sem erros em 200+ trocas e sem artefatos visuais nos testes. Limitações observadas:
- O hit-test é por retângulo; não é por pixel/alfa. Formas não retangulares (sprite) exigiriam máscara de alfa no lado Rust.
- Latência de 15-50 ms por causa do polling de 33 ms (mais granularidade do timer); o primeiro pixel clicado logo ao entrar pode ser perdido.
- Estabilidade medida só por ~30 s de transições e 1 execução por teste; sem teste de longa duração.

## Não medido (e por quê)

- DPI misto (>100%): os dois monitores estão em 100%, então a conversão `cursor_position`/`scale_factor` com escala diferente de 1 não foi exercitada.
- Notepad maximizado literal (T6): processo novo não detectável via `Get-Process`; usada janela Forms maximizada.
- Tela cheia exclusiva, jogos, UAC/janelas elevadas: fora do escopo.
- Latência de primeiro frame (cold start visual) e memória sob uso real (sprites/animação).
- Issue #15947 em outras GPUs/drivers: só uma máquina.
- Arrasto real com mouse físico: usei `mouse_event`/`SetCursorPos` sintéticos.
- Diferença de memória frente à janela Electron atual: não medida (fora do escopo; sem comparação).
- Nenhum arquivo em `src/` ou outros worktrees foi alterado; nada de commit/push.
- Processos de teste (app PoC, janela Forms) foram encerrados ao final (`app_alive_after_quit=False`).
