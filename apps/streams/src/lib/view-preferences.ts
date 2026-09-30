import { readable } from 'svelte/store';

// Share one media query across cards; touch layouts do not render hover overlays.
const hoverQuery = typeof window === 'undefined' ? null
  : window.matchMedia('(hover: hover) and (min-width: 801px)');

export const desktopHover = readable(hoverQuery?.matches ?? false, (set) => {
  if (!hoverQuery) return;
  const update = () => set(hoverQuery.matches);
  update();
  hoverQuery.addEventListener('change', update);
  return () => hoverQuery.removeEventListener('change', update);
});
