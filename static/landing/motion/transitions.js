// Liga as transições do transitions.dev (motion/transitions.css) à landing.
//
// Texts reveal: cada grupo abaixo vira um bloco .t-stagger e seus itens entram em cascata
// na primeira vez que o bloco aparece na tela. O hero fica de fora (tem a própria entrada,
// motion.js) e #medicao também (o momento line-carries-colour já revela aquela seção).
// Com movimento reduzido ou data-motion="off" nada é marcado, então nada fica escondido.

const GROUPS = [
  { block: '#simulador', lines: ['#simulador-h', '#simulador .t-lead', '#simulador .stack-4 > p:last-child', '#simulador .frame'] },
  { block: '#estrategias', lines: ['#estrategias-h', '#estrategias .card'] },
  { block: '#perguntas', lines: ['#perguntas-h', '#perguntas .t-lead', '#perguntas .faq__item'] },
  { block: '#contact .closing__cta', lines: ['#close-h', '#contact .closing__cta .t-lead'] },
];
const MAX_LINE = 8;

const motionOff = () =>
  document.documentElement.dataset.motion === 'off' ||
  matchMedia('(prefers-reduced-motion: reduce)').matches;

function textsReveal() {
  if (!('IntersectionObserver' in window)) return;
  const blocks = [];
  GROUPS.forEach(({ block, lines }) => {
    const root = document.querySelector(block);
    if (!root) return;
    const items = lines.flatMap(sel => [...document.querySelectorAll(sel)]);
    if (!items.length) return;
    root.classList.add('t-stagger');
    items.forEach((el, i) => {
      el.classList.add('t-stagger-line');
      if (i > 0) el.classList.add(`t-stagger-line--${Math.min(i + 1, MAX_LINE)}`);
    });
    blocks.push(root);
  });

  const io = new IntersectionObserver(entries => {
    entries.forEach(e => {
      if (!e.isIntersecting) return;
      e.target.classList.add('is-shown');
      io.unobserve(e.target);
    });
  }, { rootMargin: '0px 0px -12% 0px', threshold: 0 });
  blocks.forEach(b => io.observe(b));
}

// Text states swap: troca o texto de um .t-text-swap em três fases (sai, troca, entra)
export function swapText(el, next) {
  if (el.textContent === next) return;
  if (motionOff()) { el.textContent = next; return; }
  const dur = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--text-swap-dur')) || 150;
  el.classList.add('is-exit');
  clearTimeout(el._tSwap);
  el._tSwap = setTimeout(() => {
    el.textContent = next;
    el.classList.remove('is-exit');
    el.classList.add('is-enter-start');
    void el.offsetHeight; // força o reflow para a entrada animar
    el.classList.remove('is-enter-start');
  }, dur);
}

if (!motionOff()) {
  try { textsReveal(); } catch (e) { console.warn('transitions.js: texts reveal', e); }
}
