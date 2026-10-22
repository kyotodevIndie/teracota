# Inventário Electron atual (Scout, Fase 0)

Base: branch `main` (05dc270), worktree `K:\dev\waifu-claude-pocket`.
Nota: `src/main/companion/`, `ui-mode.ts` e `companion.*` existem só na branch `feat/mini-companion` (não commitados) e **não foram analisados aqui**.

| # | Comportamento atual | Arquivo:linha | Específico do Electron | Risco p/ Tauri |
|---|---|---|---|---|
| 1 | BrowserWindow 320x440, transparent, frame:false, resizable:false, hasShadow:false, skipTaskbar:true, alwaysOnTop:true, show:false; depois setAlwaysOnTop(true,'screen-saver'), setVisibleOnAllWorkspaces(true); showInactive no ready-to-show | entity.ts:54-77 | sim | Nível 'screen-saver' sem equivalente direto no Tauri; hasShadow/visibleOnAllWorkspaces dependem de API por SO |
| 2 | Click-through: setIgnoreMouseEvents(true,{forward:true}); renderer pede via IPC; reasserção a cada 1 s; reset ao did-finish-load | entity.ts:75,82,139; app.ts:192,255-256; preload.ts:12; main.ts:27 | sim | `forward:true` não existe no Tauri; eventos repassados não confiáveis no Windows (comentário app.ts:197-201) |
| 2b | Polling do cursor a cada 33 ms (getCursorScreenPoint), envia posição relativa só quando muda | entity.ts:10,97-105; app.ts:202-205,290 | sim | Necessário também no Tauri; é a fonte de verdade do hover |
| 3 | Máscara alfa: nativeImage.resize 64x64 do frame; canal A por byte; por pose e frame; teste no renderer com escala, FEET_Y, flip e HIT_ALPHA=40 | skins.ts:41-47,59; shared/skin.ts:44; sprite-character.ts:17,94-108; wobble.ts:19 | sim | Reimplementar decodificação/resize no Rust (crate `image`) ou no renderer; cuidar de flip e escala |
| 4 | Drag: mousedown no personagem → threshold 4 px → startDrag; mousemove → moveBy(dx,dy) via IPC; main faz setBounds; soltar → dragEnd → settle → persistência; blur cancela | app.ts:22,169-186,215-257; entity.ts:142-150; main.ts:28-29 | parcial (setBounds/IPC) | Usa screenX global com DPI fracionado; setBounds evita crescer no Windows (walker.ts:123) |
| 4b | Persistência: só a Tera "home" grava x,y no config.json (debounce 500 ms); carregada se isOnScreen | manager.ts:256-269; config.ts:16-17,51-60 | não | Baixo |
| 5 | Foco: janela nunca recebe foco (show:false + showInactive); blur → release(false) | entity.ts:64,77,164; app.ts:246 | sim | focus:false na criação; comportamento de foco varia por SO |
| 6 | Tray: click → mostra todas; right-click → popUpContextMenu; tooltip | main.ts:35-41 | sim | Clique direito/esquerdo varia |
| 6b | Menu (tray e botão direito): visibilidade, roam/stay, single/multi, skins, voltar ao canto, conectar agentes, abrir com o sistema, sair; em dev: recarregar e DevTools | menu.ts:41-82; main.ts:31 | sim | Reconstruir com menu API do Tauri (checkbox/radio) |
| 7 | Single-instance; segunda instância mostra as Teras e fala | main.ts:48-56 | sim | Plugin single-instance |
| 7b | Auto-start (setLoginItemSettings) só empacotado e não Linux; primeiro run; toggle no menu | manager.ts:49-53; menu.ts:43,65-69 | sim | Plugin autostart; regra empacotado/dev |
| 7c | app.dock.hide() (macOS), setName 'Dev' em dev, setAppUserModelId('com.teracota.app'), window-all-closed não sai | main.ts:45,51,59,74 | sim | AUMID importa no Windows para notificações/tray |
| 8 | HTTP 127.0.0.1:7777 (TERACOTA_PORT). Rotas: GET /health; POST /mcp (stateless; GET/DELETE → 405); POST /api/v1/event e /event; POST /hook e /integrations/claude-code (204 mesmo com erro). Qualquer Origin → 403; Host só 127.0.0.1/localhost; body máx 8 MB | server.ts:15,17,53-57,61-129; protocol.ts:4,53-54; adapter.ts:108; mcp.ts:25,40 | não (node http) | Alto: reescrever em Rust com as mesmas regras; MCP Streamable HTTP stateless |
| 9 | Multi-monitor: cornerPosition no primary workArea; isOnScreen em getAllDisplays; walker usa getDisplayMatching; freeSpot só no primário | entity.ts:23-37; manager.ts:259,277-288; walker.ts:105-110 | sim | Alto: DPI misto, workArea, coordenadas físicas vs lógicas |
| 10 | Renderer canvas 2D; fps adaptativo 60/24/15; rAF; pendulum só no drag; SVG como fallback | sprite-character.ts:58-60,112-123,181-192,204-223; app.ts:161-173 | não | Baixo |
| 11 | Sem Notification nativa; balões são HTML | bubble.ts:6-33; adapter.ts:84 | não | Baixo |
| 12 | Config em userData/config.json; legado appData/Terracota e appData/waifu-claude; leitura tolerante | config.ts:16-60 | sim (app.getPath) | Médio: caminho e migração |
| 13 | Build: esbuild (node22 externo; renderer chrome130 iife); electron-builder NSIS x64 oneClick, perMachine:false, extraResources assets→assets, files dist/** sem .map e sem scripts | package.json:14-15,39-76; build.mjs:1-38 | sim | Alto para empacotamento e instalador |

## 5 riscos mais altos para migrar a Tauri
1. Click-through + hit test no Windows: sem `forward:true`; hover depende de polling de cursor.
2. Janela sem foco, transparente, always-on-top em nível 'screen-saver': Z-order e foco variam.
3. Drag e posicionamento com DPI misto e multi-monitor.
4. Servidor HTTP e MCP com as regras de Origin/Host e MCP stateless.
5. Empacotamento e identidade: NSIS/extraResources, userData e legado, autostart e single-instance.

## Não verificado
pendulum.ts, wobble.ts, svg-character.ts, mcp.ts (schemas), connect-flow.ts, scripts/, testes.
