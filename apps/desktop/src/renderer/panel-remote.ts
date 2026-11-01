// Ajustes → Celular: acompanhar a Tera pelo celular na rede de casa (estilo WhatsApp Web).
// Ligar, mostrar o QR de pareamento, confirmar o celular que leu e desconectar aparelhos.
import type { AppPanelApi, PanelResultLike } from '../shared/app-panel';
import type { RemoteState } from '../shared/remote';

export function mountRemote(opts: {
  api: AppPanelApi;
  unwrap<T>(r: PanelResultLike<T>): T | undefined;
  changed(): void;
  /** Um celular pediu pra conectar: a interface vai pros Ajustes */
  onPending(): void;
}): void {
  const { api, unwrap } = opts;
  const box = document.getElementById('remote')!;
  let state: RemoteState | null = null;
  let tick: number | undefined;

  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  };
  const button = (text: string, cls: string, testid: string, fn: () => Promise<void>) => {
    const b = el('button', cls, text);
    b.type = 'button';
    b.dataset.testid = testid;
    b.onclick = () => void fn();
    return b;
  };
  const apply = (r: PanelResultLike<RemoteState>) => {
    const s = unwrap(r);
    if (s) render(s);
  };

  function render(s: RemoteState): void {
    const hadPending = !!state?.pending;
    state = s;
    clearInterval(tick);
    const card = el('div', 'card glass hit remote');
    const toggle = el('label', 'toggle');
    const text = el('span', 'grow');
    text.append(el('strong', undefined, 'Acompanhar pelo celular'), el('span', 'note', 'Na rede de casa: o celular lê um QR code (como o WhatsApp Web) e vê as sessões, os pedidos e os limites. Tudo cifrado; só acompanha.'));
    const check = el('input');
    check.type = 'checkbox';
    check.checked = s.enabled;
    check.dataset.testid = 'remote-toggle';
    check.onchange = async () => apply(await api.remoteSet(check.checked));
    toggle.append(text, check);
    card.append(toggle);
    if (s.error) card.append(el('div', 'err', s.error));

    if (s.enabled) {
      if (s.pending) {
        const ask = el('div', 'pending');
        ask.append(el('strong', undefined, `Conectar "${s.pending.name}"?`), el('span', 'note', 'Um celular leu o QR code agora. Só aceite se foi você.'));
        const row = el('div', 'row');
        row.append(
          button('Recusar', 'ghost', 'remote-deny', async () => apply(await api.remoteConfirm(false))),
          button('Conectar', 'primary', 'remote-approve', async () => apply(await api.remoteConfirm(true))),
        );
        ask.append(row);
        card.append(ask);
      } else if (s.pairing) {
        const qr = el('img', 'qr');
        qr.src = s.pairing.qr;
        qr.alt = 'QR code pra conectar o celular';
        const left = el('span', 'note');
        const update = () => {
          const secs = Math.max(0, Math.round((s.pairing!.expiresAt - Date.now()) / 1000));
          left.textContent = secs ? `Abra a câmera do celular e leia. Vale por ${secs} s, uma vez.` : 'Venceu: gere outro.';
        };
        update();
        tick = window.setInterval(update, 1000);
        card.append(qr, left);
      } else {
        card.append(button(s.address ? 'Conectar celular' : 'Sem rede local', 'primary', 'remote-pair', async () => apply(await api.remotePair())));
        if (s.address) card.append(el('span', 'note', `O celular precisa estar no mesmo Wi-Fi (este PC: ${s.address}).`));
      }
      if (s.devices.length) {
        const list = el('div', 'devices');
        for (const d of s.devices) {
          const row = el('div', 'row');
          const when = d.lastSeen ? `visto ${new Date(d.lastSeen).toLocaleString()}` : `conectado ${new Date(d.pairedAt).toLocaleDateString()}`;
          const name = el('span', 'grow');
          name.append(el('strong', undefined, d.name), el('span', 'note', when));
          row.append(name, button('Desconectar', 'ghost', `remote-revoke-${d.id}`, async () => apply(await api.remoteRevoke(d.id))));
          list.append(row);
        }
        card.append(list);
      }
    }
    box.replaceChildren(card);
    if (s.pending && !hadPending) opts.onPending();
    opts.changed();
  }

  api.onRemote(render);
  void api.remote().then(apply);
}
