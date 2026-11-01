// Electron escondido do `tera-skin render`: abre a página de render (o mesmo motor da Tera),
// desenha a skin e grava os PNGs. Recebe o caminho de um JSON com { job, outDir } e
// escreve no stdout uma linha "TERA_RENDER <json>" com o resumo.
import fs from 'node:fs';
import path from 'node:path';
import { BrowserWindow, app } from 'electron';
import type { RenderJob, RenderResult } from './render-job';

interface Request {
  job: RenderJob;
  outDir: string;
}

const fail = (msg: string) => {
  process.stdout.write(`TERA_RENDER ${JSON.stringify({ ok: false, error: msg })}\n`);
  app.exit(1);
};

const writePng = (file: string, dataUrl: string) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.from(dataUrl.replace(/^data:image\/png;base64,/, ''), 'base64'));
};

app.disableHardwareAcceleration(); // desenho em CPU: igual em qualquer máquina, sem GPU
app.whenReady().then(async () => {
  const reqFile = process.argv.find((a) => a.endsWith('.tera-render.json'));
  if (!reqFile) return fail('pedido de render não informado');
  const { job, outDir } = JSON.parse(fs.readFileSync(reqFile, 'utf8')) as Request;
  const win = new BrowserWindow({
    show: false,
    width: 400,
    height: 400,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.webContents.on('console-message', (e) => {
    if (e.level === 'error') process.stderr.write(`[página] ${e.message}\n`);
  });
  try {
    await win.loadFile(path.join(__dirname, 'web', 'render.html'));
    const result = (await win.webContents.executeJavaScript(`window.teraRender(${JSON.stringify(job)})`)) as RenderResult;
    const files: string[] = [];
    for (const c of result.cells) {
      const file = path.join(outDir, c.group, `${c.file}.png`);
      writePng(file, c.png);
      files.push(file);
    }
    const sheet = path.join(outDir, 'folha.png');
    writePng(sheet, result.sheet);
    process.stdout.write(`TERA_RENDER ${JSON.stringify({ ok: true, sheet, files: files.length })}\n`);
    app.exit(0);
  } catch (err) {
    fail((err as Error).message);
  }
});
