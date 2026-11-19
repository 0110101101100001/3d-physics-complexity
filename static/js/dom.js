// --- dom.js — Pequenos utilitários de DOM partilhados pelos módulos de interface ---

// Só escreve no DOM quando o texto muda (evita relayout desnecessário a cada frame)
export function setText(el, text) {
  const s = String(text);
  if (el && el.textContent !== s) el.textContent = s;
}

// Leituras ao vivo ficam sempre em ms com 3 casas: o valor oscila de um frame para o
// outro, e mudar de formato no meio do caminho faz o número parecer saltar.
export function fmtLiveMs(ms) {
  return `${(ms > 0 ? ms : 0).toFixed(3)} ms`;
}

// Resultados do benchmark: sempre em ms, para as estratégias serem comparáveis de
// relance. Tempos muito pequenos ganham casas decimais em vez de virar "0.000 ms".
export function fmtTime(ms) {
  if (!(ms > 0)) return '0.000 ms';
  if (ms < 0.001) return `${ms.toFixed(5)} ms`;
  if (ms < 0.01) return `${ms.toFixed(4)} ms`;
  return `${ms.toFixed(3)} ms`;
}

// ====================== TOAST NOTIFICATIONS (HUD) ======================
export function showToast(title, message = '', accentColor = '#00ddff') {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  // Limita acúmulo: remove o mais antigo se houver 4 ou mais
  if (container.children.length >= 4) container.removeChild(container.firstChild);

  const toast = document.createElement('div');
  toast.className = 'toast-item';
  toast.style.setProperty('--toast-accent', accentColor);
  const badge = document.createElement('span');
  badge.className = 'toast-badge';
  badge.textContent = title;
  const text = document.createElement('span');
  text.className = 'toast-text';
  text.textContent = message;
  toast.append(badge, text);
  container.appendChild(toast);

  requestAnimationFrame(() => toast.classList.add('show'));
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 200);
  }, 2000);
}
