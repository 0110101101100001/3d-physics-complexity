// --- menu.js — Menu "mais opções" da barra superior ---
// Abre no botão, fecha ao escolher um item, com Esc, clicando fora ou saindo pelo Tab.
// Setas, Home e End andam entre os itens (padrão de menu da WAI-ARIA).

const button = document.getElementById('moreBtn');
const menu = document.getElementById('moreMenu');
const items = () => [...menu.querySelectorAll('[role^="menuitem"]')];

export const isMenuOpen = () => !menu.hidden;

export function closeMenu({ focusButton = false } = {}) {
  if (menu.hidden) return;
  menu.hidden = true;
  button.setAttribute('aria-expanded', 'false');
  if (focusButton) button.focus();
}

function openMenu(focusIndex = 0) {
  menu.hidden = false;
  button.setAttribute('aria-expanded', 'true');
  const list = items();
  list[(focusIndex + list.length) % list.length]?.focus();
}

button.addEventListener('click', () => (isMenuOpen() ? closeMenu() : openMenu()));
button.addEventListener('keydown', e => {
  if (e.key === 'ArrowDown') { e.preventDefault(); openMenu(0); }
  if (e.key === 'ArrowUp') { e.preventDefault(); openMenu(-1); }
});

menu.addEventListener('keydown', e => {
  const list = items();
  const i = list.indexOf(document.activeElement);
  const move = { ArrowDown: i + 1, ArrowUp: i - 1, Home: 0, End: list.length - 1 }[e.key];
  if (move !== undefined) {
    e.preventDefault();
    list[(move + list.length) % list.length].focus();
  } else if (e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation(); // o Esc fecha só o menu, não sai da apresentação
    closeMenu({ focusButton: true });
  } else if (e.key === 'Tab') {
    closeMenu();
  } else if (e.key === ' ' || e.key === 'Enter') {
    e.stopPropagation(); // ativa o item; o Espaço não pausa a simulação aqui
  }
});

// Escolher um item fecha o menu (o próprio item trata o clique em ui.js)
menu.addEventListener('click', e => {
  if (e.target.closest('[role^="menuitem"]')) closeMenu();
});

document.addEventListener('pointerdown', e => {
  if (isMenuOpen() && !e.target.closest('.tool-menu')) closeMenu();
});
