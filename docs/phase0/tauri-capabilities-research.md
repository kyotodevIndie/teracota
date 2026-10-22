# Capacidades Tauri v2 no Windows — pesquisa direta (Fase 0)

Pesquisa feita pelo orquestrador (o Scout não tinha WebFetch). Documentação lida: docs.rs (tauri, tauri-utils) e GitHub. **Limitação:** as páginas de referência do v2.tauri.app foram truncadas antes da seção WindowConfig; os campos foram confirmados por docs.rs.

| Capacidade | Status | Evidência |
|---|---|---|
| Janela transparente sem moldura | PARCIAL | `transparent`, `decorations` existem (docs.rs tauri-utils WindowConfig). Windows: `noRedirectionBitmap` evita flash branco ao criar janela transparente. Fundo transparente também depende do HTML/CSS. |
| Always-on-top | CONFIRMADO, sem nível | `set_always_on_top(bool)` (docs.rs WebviewWindow). **Não há nível equivalente a 'screen-saver' do Electron.** Acima de tela cheia: NÃO VERIFICADO. |
| Click-through | **NÃO ENCONTRADO por região** | `set_ignore_cursor_events(bool)` é por janela inteira. Não há `forward` nem modo por pixel na documentação. Issue #13070 (fechada como duplicada) pede click-through para janelas transparentes. **Hit test por pixel precisaria de workaround (ex.: alternar ignore com base no polling de cursor, como a Teracota faz hoje).** |
| Alternar cursor events em janela transparente | **RISCO no Windows** | Issue #15947 (ABERTA): janela transparente always-on-top renderiza áreas transparentes erradas (wallpaper preto) em Windows 10, "composition race when toggling cursor events or minimizing". **Exatamente o padrão de uso da Teracota.** |
| Não roubar foco | CONFIRMADO parcial | `focus` e `focusable` existem; `set_focus()` traz para frente e foca. Equivalente a showInactive: NÃO DOCUMENTADO diretamente; exige teste. |
| Skip taskbar | CONFIRMADO | `skip_taskbar`: oculta da barra no Windows e Linux. |
| Visível em todos os espaços | NÃO SUPORTADO no Windows | `visible_on_all_workspaces`: "Unsupported on Windows, iOS, and Android". |
| Sombra | PARCIAL | `shadow`: no Windows, `false` não tem efeito em janela com decorações; sem decorações, `true` dá borda branca de 1 px. |
| Posição e DPI | CONFIRMADO | `set_position`, `scale_factor`, `cursor_position` (origem no canto do monitor principal no Windows; coordenadas podem ser negativas). |
| Arrastar janela | CONFIRMADO | `start_dragging()` (desktop). Compatibilidade com click-through ativo: NÃO VERIFICADO. |
| Drag and drop HTML5 de arquivos | PARCIAL | `drag_drop_enabled` (padrão ligado): precisa ser desligado no Windows para drag-and-drop HTML5 no frontend, pois o Tauri substitui o handler do WebView2. Relevante para a área de soltar arquivos do Pocket. |
| Capabilities | CONFIRMADO | Permissões por janela e comando (docs v2 — página de capabilities retornou 404 nesta consulta; a estrutura `src-tauri/capabilities/*.json` precisa de confirmação). |
| Tray, single-instance, autostart | CONFIRMADO por nome | Plugins oficiais; detalhes de comportamento NÃO VERIFICADOS. |
| WebView2 | PRESENTE nesta máquina | WebView2 Runtime 154.0.4258.62. |

## Riscos para a paridade
1. **Click-through por pixel** (alto): sem equivalente documentado ao `forward:true`. Hoje a Teracota depende dele para o hit test do personagem.
2. **Alternar cursor events em janela transparente no Windows** (alto): issue #15947 aberta, com o mesmo gatilho que o nosso.
3. **Nível de always-on-top** (médio): sem 'screen-saver'; comportamento acima de tela cheia não verificado.

**Conclusão preliminar:** a viabilidade depende de um PoC real com o cursor do Windows. Não é possível decidir por documentação.
