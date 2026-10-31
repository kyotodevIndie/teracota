---
description: Como instalar o Teracota no Windows e conectar a Tera ao Claude Code.
---

# Instalação

## Requisitos

- **Windows 10 ou 11, 64 bits.** macOS e Linux ainda não são suportados (estão no
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
ela avisa: **"Achei o Claude Code! Clica em mim pra abrir minha janela e conectar 🔌"**.
Clique nela e, na janela que abre, em **Conectar ao Claude Code**. Ela só instala com esse
botão.

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
