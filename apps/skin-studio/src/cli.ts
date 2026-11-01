// tera-skin: criar, validar, renderizar e editar skins de rig da Tera.
//
//   tera-skin new <pasta> [--nome "Nome"] [--modelo <pasta>]
//   tera-skin validate <pasta> [--json]
//   tera-skin render <pasta> [--saida <pasta>] [--pivos] [--quadro 220]
//   tera-skin studio <pasta> [--porta 4190] [--sem-abrir]
//   tera-skin schema <pasta>
//
// Pensado pra ser usado por gente e por agentes (Codex, Claude): mensagens em português,
// código de saída 0/1, `validate --json` e a folha de conferência do `render` pra conferir
// o resultado sem abrir o app.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createSkin, writeSchema } from '@tera/skin-kit/scaffold';
import { validateSkinDir, type SkinReport } from '@tera/skin-kit/validate';
import type { RenderJob } from './render-job';
import { startStudio } from './server';

/** Raiz do monorepo (dist/ → apps/skin-studio → raiz) */
const REPO = path.resolve(__dirname, '..', '..', '..');
const DEFAULT_TEMPLATE = path.join(REPO, 'assets', 'skins', 'tera-rig');
/** Rodando via `pnpm skin`, os caminhos são relativos a onde o comando foi digitado */
const CWD = process.env.INIT_CWD ?? process.cwd();

const HELP = `tera-skin — skins de rig da Tera

  tera-skin new <pasta> [--nome "Nome"] [--modelo <pasta>]
      Cria uma skin nova copiando um modelo que já funciona (padrão: o rig provisório da Tera).

  tera-skin validate <pasta> [--json]
      Confere skin.json, rig.json e as partes. Erro = a Tera não carrega; aviso = carrega, mas falta algo.

  tera-skin render <pasta> [--saida <pasta>] [--pivos] [--quadro 220]
      Desenha a skin em cada estado do app, pose, expressão, andando e falando, com o motor da Tera.
      Grava os PNGs e a folha de conferência (folha.png) em <pasta>/previews.

  tera-skin studio <pasta> [--porta 4190] [--sem-abrir]
      Abre o editor visual no navegador. Salva no rig.json; mudanças feitas por fora aparecem na hora.

  tera-skin schema <pasta>
      Escreve rig.schema.json e liga no rig.json (o editor completa e valida os campos).
`;

interface Args {
  cmd: string | undefined;
  dir: string | undefined;
  flags: Record<string, string | true>;
}

export function parseArgs(argv: string[]): Args {
  const flags: Record<string, string | true> = {};
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith('--')) {
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        flags[a.slice(2)] = next;
        i++;
      } else flags[a.slice(2)] = true;
    } else rest.push(a);
  }
  return { cmd: rest[0], dir: rest[1], flags };
}

const str = (v: string | true | undefined) => (typeof v === 'string' ? v : undefined);

/** Caminho curto pra mostrar: relativo se estiver abaixo de onde o comando rodou */
const show = (p: string) => {
  const rel = path.relative(CWD, p);
  return !rel ? '.' : rel.startsWith('..') || path.isAbsolute(rel) ? p : rel;
};

export function formatReport(r: SkinReport, dir: string): string {
  const lines = [r.ok ? `✓ ${r.name ?? dir}: a Tera carrega esta skin` : `✗ ${r.name ?? dir}: a Tera não carregaria esta skin`];
  for (const e of r.errors) lines.push(`  erro: ${e}`);
  for (const w of r.warnings) lines.push(`  aviso: ${w}`);
  if (r.rig) lines.push(`  ${r.rig.layers.length} camadas, ${Object.keys(r.rig.poses).length} poses, ${Object.keys(r.rig.expressions).length} expressões`);
  return lines.join('\n');
}

function electronBinary(): string {
  // o pacote electron, chamado do Node, devolve o caminho do executável
  return require('electron') as unknown as string;
}

async function render(dir: string, flags: Args['flags']): Promise<number> {
  const report = validateSkinDir(dir);
  if (!report.ok || !report.rig) {
    console.error(formatReport(report, dir));
    return 1;
  }
  const skin = JSON.parse(fs.readFileSync(path.join(dir, 'skin.json'), 'utf8')) as { size?: number; facing?: string };
  const outDir = path.resolve(CWD, str(flags.saida) ?? path.join(dir, 'previews'));
  const cell = Math.min(600, Math.max(80, Number(str(flags.quadro)) || 220));
  const job: RenderJob = {
    rig: report.rig,
    baseUrl: `${pathToFileURL(dir).href}/`,
    size: typeof skin.size === 'number' ? skin.size : 260,
    facing: skin.facing === 'left' ? 'left' : 'right',
    debug: flags.pivos === true,
    cell,
    name: report.name ?? path.basename(dir),
  };
  const reqFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tera-skin-')), 'job.tera-render.json');
  fs.writeFileSync(reqFile, JSON.stringify({ job, outDir }));
  const args = [path.join(__dirname, 'render-main.js'), reqFile];
  // Linux sem tela (servidor, CI): o Chromium desenha sem janela nenhuma
  if (process.platform === 'linux' && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) args.push('--ozone-platform=headless');
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  return new Promise((resolve) => {
    const child = spawn(electronBinary(), args, { env, stdio: ['ignore', 'pipe', 'inherit'] });
    let out = '';
    child.stdout.on('data', (d: Buffer) => { out += d.toString(); });
    child.on('close', (code) => {
      fs.rmSync(path.dirname(reqFile), { recursive: true, force: true });
      const line = out.split('\n').find((l) => l.startsWith('TERA_RENDER '));
      const result = line ? (JSON.parse(line.slice('TERA_RENDER '.length)) as { ok: boolean; error?: string; sheet?: string; files?: number }) : null;
      if (!result?.ok) {
        console.error(`✗ não consegui renderizar: ${result?.error ?? `o Electron saiu com código ${code}`}`);
        return resolve(1);
      }
      for (const w of report.warnings) console.log(`  aviso: ${w}`);
      console.log(`✓ ${result.files} imagens em ${show(outDir)}`);
      console.log(`  folha de conferência: ${show(result.sheet!)}`);
      resolve(0);
    });
  });
}

function openBrowser(url: string): void {
  const cmd = process.platform === 'win32' ? 'cmd' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '""', url] : [url];
  spawn(cmd, args, { stdio: 'ignore', detached: true }).unref();
}

export async function main(argv: string[]): Promise<number> {
  const { cmd, dir: rawDir, flags } = parseArgs(argv);
  if (!cmd || cmd === 'help' || flags.help || flags.ajuda) {
    console.log(HELP);
    return cmd ? 0 : 1;
  }
  if (!rawDir) {
    console.error(`informe a pasta da skin: tera-skin ${cmd} <pasta>`);
    return 1;
  }
  const dir = path.resolve(CWD, rawDir);
  switch (cmd) {
    case 'new': {
      const template = path.resolve(CWD, str(flags.modelo) ?? DEFAULT_TEMPLATE);
      const name = str(flags.nome) ?? path.basename(dir);
      try {
        const r = createSkin(template, dir, name);
        console.log(`✓ skin "${name}" criada em ${show(dir)} (${r.files} arquivos)`);
        console.log(`  próximo passo: tera-skin studio ${rawDir}   ou   tera-skin render ${rawDir}`);
        return 0;
      } catch (err) {
        console.error(`✗ ${(err as Error).message}`);
        return 1;
      }
    }
    case 'validate': {
      const report = validateSkinDir(dir);
      if (flags.json) {
        const { rig: _rig, ...rest } = report;
        console.log(JSON.stringify(rest, null, 2));
      } else console.log(formatReport(report, dir));
      return report.ok ? 0 : 1;
    }
    case 'schema': {
      writeSchema(dir, validateSkinDir(dir).rigFile ?? 'rig.json');
      console.log('✓ rig.schema.json escrito e ligado no rig.json');
      return 0;
    }
    case 'render':
      return render(dir, flags);
    case 'studio': {
      if (!fs.existsSync(path.join(dir, 'skin.json'))) {
        console.error(`✗ ${dir} não tem skin.json (crie uma com: tera-skin new ${rawDir})`);
        return 1;
      }
      const port = Number(str(flags.porta)) || 4190;
      const studio = await startStudio({ dir, webDir: path.join(__dirname, 'web'), port }).catch(() => startStudio({ dir, webDir: path.join(__dirname, 'web'), port: 0 }));
      console.log(`Skin Studio: ${studio.url}`);
      console.log('  (Ctrl+C pra fechar)');
      if (!flags['sem-abrir']) openBrowser(studio.url);
      await new Promise<void>((resolve) => process.once('SIGINT', () => resolve()));
      await studio.close();
      return 0;
    }
    default:
      console.error(`comando desconhecido: ${cmd}\n\n${HELP}`);
      return 1;
  }
}

if (require.main === module) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}
