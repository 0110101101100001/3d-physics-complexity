// code: one change per cycle (about 3 s): the note below goes, the highlight moves to the next changed
// line, the note names that change. The changes are the page's own: the line marked is-mark with the
// note as written in the markup comes first, then every other line that carries data-note="..." (or
// opts.steps [{line, text}]), so the note never shows words the page did not write. The chip is left
// as written.
import { loop } from '../ui.js';
import { swapText } from '../../motion/transitions.js';

export default function init(root, opts = {}) {
  const lines = [...root.querySelectorAll('.ui-code__ln')];
  const hint = root.querySelector('[data-code-hint]'), text = root.querySelector('[data-code-text]');
  if (!lines.length || !hint || !text) return null;
  const first = lines.find(l => l.classList.contains('is-mark')) || lines.find(l => l.dataset.note) || lines[0];
  const steps = opts.steps || [
    { line: +first.dataset.n, text: text.textContent },
    ...lines.filter(l => l !== first && l.dataset.note).map(l => ({ line: +l.dataset.n, text: l.dataset.note })),
  ];
  const mark = n => lines.forEach(l => l.classList.toggle('is-mark', +l.dataset.n === n));
  const put = s => { mark(s.line); if (text.textContent !== s.text) text.textContent = s.text; };
  let k = 0;
  // one cycle (2.7 s): the highlight moves through three changed lines, the note naming each; the
  // last is held 0.4 s
  // A nota troca de frase com o "Text states swap" do transitions.dev (sai subindo com blur,
  // a nova entra de baixo) em vez de sumir e reaparecer.
  const swap = s => { mark(s.line); swapText(text, s.text); };
  return loop(root, async api => {
    for (let n = 0; n < 3; n++) {
      const s = steps[++k % steps.length];
      lines.forEach(l => l.classList.remove('is-mark'));
      await api.wait(260);
      swap(s);
      await api.wait(n < 2 ? 760 : 400);
    }
  }, { still: () => {
    k = 0; clearTimeout(text._tSwap); text.classList.remove('is-exit', 'is-enter-start'); put(steps[0]); hint.classList.remove('is-hidden'); } });
}
