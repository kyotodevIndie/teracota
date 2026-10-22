// Renderer da POC. Todo texto vindo do Claude Code entra via textContent (nunca innerHTML).
const $ = (id) => document.getElementById(id);
const log = $('log');
let dir = null;
let streaming = null; // <div> da resposta em andamento

function line(cls, text) {
  const d = document.createElement('div');
  d.className = `msg ${cls}`;
  d.textContent = text;
  log.append(d);
  log.scrollTop = log.scrollHeight;
  return d;
}

$('pick').onclick = async () => {
  dir = await window.poc.pickProject();
  if (!dir) return;
  $('dir').textContent = dir;
  const list = await window.poc.listSessions(dir);
  $('sessions').replaceChildren(new Option('(nova sessão)', ''),
    ...list.map((s) => new Option(`${new Date(s.when).toLocaleString()} — ${(s.title || s.id).slice(0, 60)}`, s.id)));
  $('open').disabled = false;
};

$('open').onclick = async () => {
  log.replaceChildren();
  await window.poc.open(dir, $('sessions').value || null, $('model').value || null);
  for (const id of ['prompt', 'send', 'stop']) $(id).disabled = false;
};

async function readImages() {
  return Promise.all([...$('image').files].map((f) => new Promise((ok) => {
    const r = new FileReader();
    r.onload = () => ok({ mediaType: f.type, base64: String(r.result).split(',')[1] });
    r.readAsDataURL(f);
  })));
}

$('send').onclick = async () => {
  const text = $('prompt').value.trim();
  if (!text) return;
  const images = await readImages();
  line('user', `› ${text}${images.length ? `  [+${images.length} imagem(ns)]` : ''}`);
  streaming = null;
  $('prompt').value = '';
  $('image').value = '';
  await window.poc.send(text, images);
};
$('prompt').onkeydown = (e) => { if (e.key === 'Enter') $('send').click(); };
$('stop').onclick = () => window.poc.interrupt();

function permissionCard(p) {
  const card = document.createElement('div');
  card.className = 'perm';
  const title = document.createElement('b');
  title.textContent = `O Claude Code quer usar ${p.toolName}`;
  const pre = document.createElement('pre');
  pre.textContent = JSON.stringify(p.input, null, 2);
  const actions = document.createElement('div');
  const btn = (label, allow, always) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.onclick = () => { window.poc.respond(p.id, allow, always); actions.textContent = allow ? '✔ permitido' : '✖ recusado'; };
    return b;
  };
  actions.append(btn('Permitir', true, false), ' ', btn('Sempre nesta sessão', true, true), ' ', btn('Recusar', false, false));
  card.append(title, pre, actions);
  log.append(card);
  log.scrollTop = log.scrollHeight;
}

window.poc.on((ch, p) => {
  switch (ch) {
    case 'state': $('state').textContent = p; break;
    case 'init': line('meta', `sessão ${p.sessionId} · ${p.model} · Claude Code ${p.claudeCodeVersion} · auth: ${p.apiKeySource === 'none' ? 'login do Claude Code' : p.apiKeySource}`); break;
    case 'text':
      streaming ??= line('', '');
      streaming.textContent += p;
      log.scrollTop = log.scrollHeight;
      break;
    case 'tool': streaming = null; line('tool', `⚙ ${p.name} ${JSON.stringify(p.input).slice(0, 160)}`); break;
    case 'toolResult': line(p.isError ? 'err' : 'tool', `${p.isError ? '✖' : '↳'} ${p.preview}`); break;
    case 'fileChanged': line('file', `✎ ${p.tool}: ${p.path}`); break;
    case 'permission': permissionCard(p); break;
    case 'result': streaming = null; line('meta', `— ${p.subtype} · ${p.turns} turno(s) · ${(p.durationMs / 1000).toFixed(1)} s · custo estimado US$ ${p.costUsd.toFixed(4)}`); break;
    case 'error': line('err', `erro: ${p}`); break;
  }
});
