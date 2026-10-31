// Percorre todos os estados do personagem (com o app aberto): npm run demo
import { getPort, type CompanionEvent } from '../src/shared/protocol';

const steps: CompanionEvent[] = [
  { state: 'listening', working: true, say: 'Hm? Nova tarefa!' },
  { state: 'reading' }, { state: 'searching' }, { state: 'thinking' },
  { state: 'typing' }, { state: 'terminal' }, { state: 'web' }, { state: 'delegating' },
  { state: 'error', say: 'Ops...' },
  { state: 'attention', say: 'Ei, preciso de você!' },
  { state: 'happy', working: false, say: 'Terminei! ✨' },
  { state: 'sad' }, { state: 'sleeping' }, { state: 'idle' },
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

(async () => {
  for (const ev of steps) {
    console.log(ev.state);
    try {
      await fetch(`http://127.0.0.1:${getPort()}/event`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(ev),
      });
    } catch {
      console.error('App não está rodando (npm start)');
      process.exit(1);
    }
    await sleep(2200);
  }
})();
