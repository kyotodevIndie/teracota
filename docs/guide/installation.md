---
description: Como instalar o Teracota no Windows e conectar a Tera ao Claude Code.
---

# Instalação

## Requisitos

- **Windows 10 ou 11, 64 bits.** O Linux é [experimental](#linux-experimental); o macOS
  ainda não é suportado (está no
  [roadmap](https://github.com/kyotodevIndie/teracota/blob/main/ROADMAP.md)).
- **Claude Code** com suporte a plugins (CLI ou app desktop), pra Tera reagir ao Claude.
  Sem ele, ela funciona como pet de desktop e pela [API local](/dev/api).
- Não precisa de Node, Python ou permissão de administrador.

## 1. Baixar e instalar

1. Baixe o `Teracota Setup x.y.z.exe` na
   [página de releases](https://github.com/kyotodevIndie/teracota/releases/latest).
2. Rode o instalador. Ele instala só pro seu usuário, em
   `%LOCALAPPDATA%\Programs\teracota`, cria atalhos no menu Iniciar e na área de
   trabalho, e abre a Tera no fim.

::: warning Aviso do Windows (SmartScreen)
O instalador ainda **não tem assinatura digital** (o certificado é pago, e o projeto
é independente). Por isso o Windows mostra **"O Windows protegeu o computador"**.
Clique em **Mais informações → Executar assim mesmo**.

O código é aberto e o instalador é gerado pelo GitHub Actions a partir dele. Se
preferir, dá pra [gerar o seu](/dev/contributing#rodando-pelo-codigo).
:::

## 2. Primeira abertura

A Tera aparece no canto da tela, se apresenta, e um ícone dela surge na **bandeja do
sistema** (perto do relógio). Na primeira vez, ela também liga **Abrir com o Windows**.
Dá pra desligar no menu.

## 3. Conectar ao Claude Code

Uns segundos depois de abrir, se o Claude Code estiver instalado e ainda sem o plugin,
ela avisa: **"Achei o Claude Code! Clica em mim que eu me conecto 🔌"**. Um clique
nela e pronto. Ela só instala com esse clique.

Se a oferta não aparecer, ou se você preferir fazer à mão:

- **Pelo menu:** botão direito na Tera → **Conectar ao Claude Code**.
- **No terminal** (PowerShell, bash ou zsh):
  ```bash
  claude plugin marketplace add kyotodevIndie/teracota; claude plugin install teracota@teracota
  ```
- **Dentro do Claude Code**, estes dois comandos, **um de cada vez**:
  ```
  /plugin marketplace add kyotodevIndie/teracota
  /plugin install teracota@teracota
  ```

### Sessões que já estavam abertas

Sessões novas do Claude Code já vêm conectadas. Nas que estavam abertas antes da
instalação, rode `/reload-plugins`. O menu **Conectar sessões já abertas** copia esse
comando pra você colar. Reiniciar a sessão também funciona.

### Falas do Claude (opcional)

O Claude também pode fazer a Tera falar e reagir quando quiser. Pra ligar: menu →
**Deixar o Claude Code falar pela Tera**. Os detalhes estão em
[Claude Code → Falas pelo MCP](./claude-code#falas-pelo-mcp-opcional).

## Linux (experimental)

Ainda não há instalador pra Linux: roda-se pelo código. Foi testado no **Arch com
Hyprland** (Wayland); outras distros e ambientes devem funcionar, mas não foram
validados. [Relatos e ajuda](/dev/contributing) são bem-vindos.

```bash
git clone https://github.com/kyotodevIndie/teracota.git
cd teracota
npm install
npm start
```

Pra gerar o app empacotado: `npm run pack:linux` e rode `release/linux-unpacked/teracota`
(ou `npm run dist:linux` pra um AppImage).

- **Wayland:** o compositor ignora a posição pedida pela janela, então a Tera se
  reabre sozinha via XWayland pra ficar no canto e passear.
- **Bandeja:** precisa de suporte a StatusNotifier (a bandeja do Waybar tem). No GNOME
  deve exigir a extensão AppIndicator.
- **Abrir com o sistema:** ainda não existe no Linux, e o item não aparece no menu.
- **Hyprland:** por ser uma janela flutuante, ela recebe blur, borda e sombra, e não
  acompanha você entre workspaces. Em `hyprland.conf`:
  ```
  windowrule = match:class ^teracota$, no_blur on
  windowrule = match:class ^teracota$, no_shadow on
  windowrule = match:class ^teracota$, border_size 0
  windowrule = match:class ^teracota$, pin on
  ```

## Atualizar

Feche a Tera (menu → **Sair do Teracota**), baixe a versão nova e instale **por cima**.
Não precisa desinstalar antes, e suas preferências são mantidas. Pra atualizar o plugin:

```bash
claude plugin marketplace update teracota
claude plugin update teracota@teracota
```

## Desinstalar

1. **App:** Configurações do Windows → **Apps** → **Teracota** → Desinstalar.
2. **Plugin**, se instalou:
   ```bash
   claude plugin uninstall teracota@teracota
   claude plugin marketplace remove teracota
   ```
3. **Falas pelo MCP**, se ligou: `claude mcp remove --scope user teracota`
4. **Preferências** (opcional): apague a pasta `%APPDATA%\Teracota`.
