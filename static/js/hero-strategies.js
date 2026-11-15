// Abas de estratégia no hero: a mesma troca do simulador (glitch e a cena muda por baixo).
// Avança sozinha enquanto o hero está na tela; para de vez quando o visitante escolhe uma
// aba, e pausa com o ponteiro ou o foco em cima. Com movimento reduzido não avança nem pisca.
import { glitch, prefersReducedMotion } from './glitch.js';

const INTERVAL = 4200;

const host = document.querySelector('[data-strat-host]');
if (host) {
  const tabs = [...host.querySelectorAll('[data-strat]')];
  const shots = [...host.querySelectorAll('[data-strat-shot]')];
  const fact = host.querySelector('[data-strat-fact]');
  let current = tabs.findIndex((t) => t.getAttribute('aria-pressed') === 'true');
  if (current < 0) current = 0;
  let chosen = false;
  let hovering = false;
  let visible = true;
  let timer = 0;

  const show = (i) => {
    if (i === current) return;
    current = i;
    glitch(host);
    // a troca acontece no pico da falha, como no simulador
    tabs.forEach((t, j) => t.setAttribute('aria-pressed', String(j === i)));
    shots.forEach((s) => { s.hidden = s.dataset.stratShot !== tabs[i].dataset.strat; });
    host.dataset.active = tabs[i].dataset.strat;
    if (fact) fact.textContent = tabs[i].dataset.fact;
  };

  const schedule = () => {
    clearTimeout(timer);
    if (chosen || hovering || !visible || document.hidden || prefersReducedMotion()) return;
    timer = setTimeout(() => { show((current + 1) % tabs.length); schedule(); }, INTERVAL);
  };

  tabs.forEach((tab, i) => tab.addEventListener('click', () => { chosen = true; clearTimeout(timer); show(i); }));
  host.addEventListener('pointerenter', () => { hovering = true; schedule(); });
  host.addEventListener('pointerleave', () => { hovering = false; schedule(); });
  host.addEventListener('focusin', () => { hovering = true; schedule(); });
  host.addEventListener('focusout', () => { hovering = false; schedule(); });
  document.addEventListener('visibilitychange', schedule);
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(([e]) => { visible = e.isIntersecting; schedule(); }, { threshold: 0.4 }).observe(host);
  }
  schedule();
}
