// Pomodoro: exemplo de plugin da Tera. Roda isolado, sem Node; só fala com a Tera pela
// API `tera` (permissões: say, cards, http). Comandos por HTTP, deste computador:
//   curl -X POST http://127.0.0.1:7777/plugins/pomodoro/iniciar -d '{}'
//   curl -X POST http://127.0.0.1:7777/plugins/pomodoro/parar -d '{}'

let fase = 'parado'; // 'foco' | 'pausa' | 'parado'
let fim = 0;
let total = 0;
let timer = null;

const minutos = (fase) => (fase === 'foco' ? tera.settings.foco : tera.settings.pausa);
const mmss = (ms) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

function desenhar() {
  if (fase === 'parado') {
    tera.card.set('relogio', { title: 'Pomodoro parado', line: 'Ligue de novo nos Ajustes ou por HTTP', level: 'normal' });
    return;
  }
  const falta = fim - Date.now();
  tera.card.set('relogio', {
    title: fase === 'foco' ? `Foco · ${mmss(falta)}` : `Pausa · ${mmss(falta)}`,
    line: fase === 'foco' ? 'Hora de trabalhar' : 'Respira, levanta, bebe água',
    level: fase === 'foco' ? 'normal' : 'done',
    progress: 1 - falta / total,
  });
  if (falta <= 0) trocar();
}

function comecar(nova) {
  fase = nova;
  total = minutos(nova) * 60 * 1000;
  fim = Date.now() + total;
  clearInterval(timer);
  timer = setInterval(desenhar, 1000);
  desenhar();
}

function trocar() {
  if (fase === 'foco') {
    tera.say('Foco concluído! Pausa de ' + tera.settings.pausa + ' min 🍅', { expression: 'happy' });
    comecar('pausa');
  } else {
    tera.say('Fim da pausa, bora voltar!', { expression: 'focused' });
    comecar('foco');
  }
}

function parar() {
  fase = 'parado';
  clearInterval(timer);
  desenhar();
}

tera.onHttp(({ path }) => {
  if (path === '/iniciar') comecar('foco');
  else if (path === '/parar') parar();
  else if (path === '/pular' && fase !== 'parado') trocar();
});

tera.onSettings(() => desenhar());

if (tera.settings.auto) comecar('foco');
else desenhar();
