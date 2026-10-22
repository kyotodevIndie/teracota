// Teste de ponta a ponta da POC, contra o Claude Code real. Gera evidências em smoke-out/report.json.
// Usa o modelo haiku e prompts mínimos pra gastar o mínimo de uso.
//   npm run smoke            (todos os cenários)
//   npm run smoke -- C D     (só alguns)

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { AgentSession, findClaude, listProjectSessions, type SessionEvents } from './session';

const OUT = resolve(__dirname, '..', 'smoke-out');
const MODEL = 'haiku';
const claudePath = findClaude();
const report: Record<string, unknown> = { claudePath, startedAt: new Date().toISOString() };

function project(name: string): string {
  const dir = join(OUT, 'projects', name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  return dir;
}

interface Trace { events: [string, unknown][]; deltas: number; text: string; firstDeltaMs?: number; t0: number }

function trace(s: AgentSession): Trace {
  const t: Trace = { events: [], deltas: 0, text: '', t0: Date.now() };
  const log = <K extends keyof SessionEvents>(k: K) => s.on(k, ((...a: unknown[]) => { t.events.push([k, a[0]]); }) as never);
  for (const k of ['state', 'init', 'tool', 'toolResult', 'fileChanged', 'permission', 'result', 'error'] as const) log(k);
  s.on('text', (d) => { t.deltas++; t.text += d; t.firstDeltaMs ??= Date.now() - t.t0; });
  return t;
}

const waitFor = <K extends keyof SessionEvents>(s: AgentSession, k: K, ms = 120_000) =>
  new Promise<SessionEvents[K][0]>((ok, fail) => {
    const timer = setTimeout(() => fail(new Error(`timeout esperando ${k}`)), ms);
    s.once(k, ((v: SessionEvents[K][0]) => { clearTimeout(timer); ok(v); }) as never);
  });

async function open(cwd: string, resume?: string) {
  const s = new AgentSession({ cwd, resume, model: MODEL, claudePath });
  const t = trace(s);
  await s.start();
  return { s, t };
}

const scenarios: Record<string, () => Promise<unknown>> = {
  // A: sessão nova, streaming, autenticação e custo reportados pelo próprio Claude Code
  async A() {
    const dir = project('a');
    const { s, t } = await open(dir);
    t.t0 = Date.now();
    s.send('Responda exatamente com a palavra: abacaxi');
    const r = await waitFor(s, 'result');
    s.close();
    const init = t.events.find(([k]) => k === 'init')?.[1];
    return { init, result: r, deltas: t.deltas, firstDeltaMs: t.firstDeltaMs, streamedText: t.text };
  },

  // B: retomar a sessão de A pelo id e listar sessões do projeto
  async B() {
    const a = report.A as { init: { sessionId: string } } | undefined;
    if (!a) throw new Error('rode o cenário A antes');
    const dir = join(OUT, 'projects', 'a');
    const sessions = await listProjectSessions(dir);
    const { s, t } = await open(dir, a.init.sessionId);
    s.send('Qual palavra você respondeu na mensagem anterior? Responda só a palavra.');
    const r = await waitFor(s, 'result');
    s.close();
    return { listed: sessions.map((x) => ({ id: x.sessionId, summary: x.summary, firstPrompt: x.firstPrompt })),
      resumedId: t.events.find(([k]) => k === 'init')?.[1], result: r };
  },

  // C: pedido de permissão recusado pela interface → arquivo não pode existir
  async C() {
    const dir = project('c');
    const { s, t } = await open(dir);
    s.on('permission', (p) => s.respond(p.id, false));
    s.send(`Use a ferramenta Write pra criar o arquivo ${join(dir, 'nao.txt')} com o conteúdo "x". Se for recusado, não tente de novo, só diga "recusado".`);
    const r = await waitFor(s, 'result');
    s.close();
    return { permissions: t.events.filter(([k]) => k === 'permission').map(([, v]) => v), fileExists: existsSync(join(dir, 'nao.txt')), result: r };
  },

  // D: permissão aprovada → arquivo criado; ferramenta e alteração de arquivo acompanhadas
  async D() {
    const dir = project('d');
    const { s, t } = await open(dir);
    const file = join(dir, 'sim.txt');
    // A interface só aprova escrita dentro do projeto (o teste anterior aprovava tudo e o modelo gravou fora).
    s.on('permission', (p) => {
      const target = String((p.input as { file_path?: string }).file_path ?? '');
      s.respond(p.id, resolve(target).startsWith(resolve(dir)), { reason: 'Só é permitido escrever dentro da pasta do projeto.' });
    });
    s.send(`Use a ferramenta Write pra criar o arquivo ${file} com o conteúdo "ok". Depois responda "feito".`);
    const r = await waitFor(s, 'result');
    s.close();
    return {
      permissions: t.events.filter(([k]) => k === 'permission').map(([, v]) => v),
      tools: t.events.filter(([k]) => k === 'tool' || k === 'toolResult').map(([k, v]) => [k, v]),
      fileChanged: t.events.filter(([k]) => k === 'fileChanged').map(([, v]) => v),
      states: t.events.filter(([k]) => k === 'state').map(([, v]) => v),
      fileContent: existsSync(file) ? readFileSync(file, 'utf8') : null,
      result: r,
    };
  },

  // E: imagem anexada (favicon da Tera)
  async E() {
    const dir = project('e');
    const png = readFileSync(resolve(__dirname, '..', '..', '..', 'docs', 'public', 'favicon.png')).toString('base64');
    const { s } = await open(dir);
    s.send('Descreva esta imagem em no máximo 8 palavras.', [{ mediaType: 'image/png', base64: png }]);
    const r = await waitFor(s, 'result');
    s.close();
    return { result: r };
  },

  // F: interromper uma execução em andamento
  async F() {
    const dir = project('f');
    const { s, t } = await open(dir);
    s.send('Sem usar nenhuma ferramenta, escreva aqui no chat os números de 1 a 400 por extenso, um por linha.');
    await new Promise<void>((ok) => {
      const timer = setTimeout(ok, 15_000);
      const h = () => { if (t.deltas >= 5) { s.off('text', h); clearTimeout(timer); ok(); } };
      s.on('text', h);
    });
    const charsBefore = t.text.length;
    const t1 = Date.now();
    await s.interrupt();
    const r = await waitFor(s, 'result', 30_000);
    const stopMs = Date.now() - t1;
    // a sessão continua utilizável depois do interrupt?
    s.send('Responda só: ainda aqui');
    const after = await waitFor(s, 'result');
    s.close();
    return { charsBefore, stopMs, interruptedResult: r, finalChars: t.text.length, after };
  },

  // F2: interromper enquanto um pedido de permissão está pendente
  async F2() {
    const dir = project('f2');
    const { s, t } = await open(dir);
    s.send(`Use a ferramenta Write pra criar ${join(dir, 'x.txt')} com "x".`);
    await waitFor(s, 'permission');
    await s.interrupt();
    const r = await waitFor(s, 'result', 30_000);
    s.close();
    return { states: t.events.filter(([k]) => k === 'state').map(([, v]) => v), fileExists: existsSync(join(dir, 'x.txt')), result: r };
  },

  // G: duas sessões independentes, em projetos diferentes, ao mesmo tempo
  async G() {
    const [x, y] = await Promise.all([open(project('g1')), open(project('g2'))]);
    x.s.send('Responda só: projeto um');
    y.s.send('Responda só: projeto dois');
    const [rx, ry] = await Promise.all([waitFor(x.s, 'result'), waitFor(y.s, 'result')]);
    const ids = [x.s.sessionId, y.s.sessionId];
    x.s.close(); y.s.close();
    return { sessionIds: ids, distinct: ids[0] !== ids[1], results: [rx, ry] };
  },
};

async function main() {
  mkdirSync(OUT, { recursive: true });
  const reportFile = join(OUT, 'report.json');
  if (existsSync(reportFile)) Object.assign(report, JSON.parse(readFileSync(reportFile, 'utf8')));
  const pick = process.argv.slice(2);
  for (const [name, run] of Object.entries(scenarios)) {
    if (pick.length && !pick.includes(name)) continue;
    const t0 = Date.now();
    process.stdout.write(`cenário ${name}... `);
    try {
      report[name] = await Promise.race([run(), new Promise((_, no) => setTimeout(() => no(new Error('cenário passou de 150 s')), 150_000))]);
      console.log(`ok (${Date.now() - t0} ms)`);
    } catch (err) {
      report[name] = { error: String(err) };
      console.log(`FALHOU: ${err}`);
    }
    writeFileSync(reportFile, JSON.stringify(report, null, 2));
  }
  console.log(`evidências em ${reportFile}`);
  process.exit(0);
}

void main();
