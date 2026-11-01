---
description: Tera no celular pela rede de casa — pareamento por QR code e segurança.
---

# Tera no celular

Na rede de casa, o celular acompanha a Tera do PC: sessões abertas (de todas as IAs),
pedidos esperando você, limites de uso e cartões de plugins. É como o WhatsApp Web, com os
papéis invertidos: o PC é quem roda tudo, o celular só olha.

## Usar

1. No PC: interface da Tera → **Ajustes → Celular** → ligue **Acompanhar pelo celular**.
2. **Conectar celular** mostra um QR code (vale 90 segundos, uma vez só).
3. Leia com a câmera do celular, no mesmo Wi-Fi. Dê um nome e toque em **Conectar**.
4. O PC pergunta *"Conectar 'Pixel'?"*: só aceite se foi você.

Pra tirar um celular: **Desconectar** na lista. Desligar o acesso fecha a porta na rede.

## Segurança

- **Desligado por padrão.** Ligado, a porta (7778, ou `TERACOTA_REMOTE_PORT`) só responde a
  endereços da rede local.
- **O QR é descartável**: 90 s, um celular só; um segundo celular com o mesmo QR é recusado,
  e nada entra sem o "sim" no PC.
- **Tudo cifrado.** Na rede local não há HTTPS de verdade (e sem ele o navegador desliga a
  criptografia nativa), então a Tera cifra cada mensagem com o tweetnacl (secretbox:
  XSalsa20-Poly1305) usando a chave que vem no QR, na parte do link depois do `#`, que o
  navegador nunca envia. Quem está no mesmo Wi-Fi só vê bytes cifrados.
- **Pedido gravado e repetido não vale**: cada mensagem tem nonce único e hora (até 60 s).
- **Só acompanha.** O celular não manda comandos nem responde pedidos nesta fase.
- A chave de cada celular fica no `config.json` do app (na sua máquina) e no navegador do
  celular.

## Limites

- Fora de casa não funciona (precisaria de uma ponte na internet ou de uma rede privada
  como o Tailscale).
- Sem HTTPS, o navegador não deixa a página mandar notificação: ela vibra e mostra o número
  de pedidos no título enquanto está aberta.
