// Resume tipos de evento de um transcript sem imprimir conteúdo.
import fs from 'node:fs';
const f = process.argv[2]; const L = fs.readFileSync(f, 'utf8').split('\n').filter(Boolean);
const rows = L.map((l, i) => { try { const j = JSON.parse(l); const c = j.message?.content; const items = Array.isArray(c) ? c.map(x => x.type + (x.name ? ':' + x.name : '')).join('+') : (typeof c === 'string' ? 'text' : ''); return `${i + 1} ${j.type}${j.subtype ? '/' + j.subtype : ''} [${items}] stop=${j.message?.stop_reason ?? '-'} ts=${j.timestamp ?? ''}`; } catch { return `${i + 1} <parse-error>`; } });
console.log('lines', L.length); console.log(rows.join('\n'));
