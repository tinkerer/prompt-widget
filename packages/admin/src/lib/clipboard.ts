export function copyWithTooltip(text: string, e: MouseEvent) {
  navigator.clipboard.writeText(text);
  const tip = document.createElement('div');
  tip.className = 'copy-tooltip';
  tip.textContent = 'Copied!';
  tip.style.left = `${e.clientX}px`;
  tip.style.top = `${e.clientY - 8}px`;
  document.body.appendChild(tip);
  requestAnimationFrame(() => tip.classList.add('visible'));
  setTimeout(() => {
    tip.classList.remove('visible');
    setTimeout(() => tip.remove(), 150);
  }, 800);
}
