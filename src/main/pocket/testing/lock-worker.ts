// Processo-filho de teste do lock nativo. Uso: lock-worker <nome> <startAtEpochMs> <modo> [ms]
//   modo "try"  : espera startAt, tenta adquirir, imprime WON|BUSY e segura até receber "release" no stdin
//   modo "block": adquire, imprime WON e bloqueia o event loop por [ms] (simula heartbeat vencido)
import { LockBusyError, OsLock } from '../process/os-lock';

const [name, startAt, mode, ms] = process.argv.slice(2) as [string, string, string, string | undefined];

async function main(): Promise<void> {
  while (Date.now() < Number(startAt)) { /* barreira de tempo */ }
  try {
    const lock = await OsLock.acquire(name, `worker-${process.pid}`);
    console.log('WON');
    if (mode === 'block') {
      const until = Date.now() + Number(ms ?? 3000);
      while (Date.now() < until) { /* event loop bloqueado */ }
      console.log('UNBLOCKED');
    }
    process.stdin.on('data', (d) => { if (String(d).includes('release')) void lock.release().then(() => { console.log('RELEASED'); process.exit(0); }); });
    setInterval(() => undefined, 1000);
  } catch (e) {
    console.log(e instanceof LockBusyError ? 'BUSY' : `ERR ${(e as Error).message}`);
    process.exit(0);
  }
}
void main();
