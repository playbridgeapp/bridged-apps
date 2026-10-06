// Fades an <img> in once it has loaded, so posters and thumbnails don't pop in over their placeholder.
export function fadeIn(node: HTMLImageElement) {
  const show = () => node.classList.add('is-loaded');
  node.classList.add('fade-img');
  if (node.complete) show();
  else {
    node.addEventListener('load', show, { once: true });
    node.addEventListener('error', show, { once: true });
  }
  return { destroy() { node.removeEventListener('load', show); node.removeEventListener('error', show); } };
}
