export type NavigationMotion = 'push' | 'back' | 'history';

/** Browser history gestures already animate their snapshots; never animate them twice. */
export function screenMotion(direction: NavigationMotion, reduced: boolean, width: number, outgoing = false) {
  const distance = width;
  return {
    duration: reduced || direction === 'history' ? 0 : 280,
    x: direction === 'back' ? (outgoing ? distance : -distance * 0.28) : (outgoing ? -distance * 0.28 : distance)
  };
}

export function screenTransition(node: Element, options: { direction: NavigationMotion; outgoing?: boolean }) {
  const motion = screenMotion(options.direction, window.matchMedia('(prefers-reduced-motion: reduce)').matches, node.clientWidth, options.outgoing);
  return {
    duration: motion.duration,
    easing: (t: number) => 1 - Math.pow(1 - t, 3),
    css: (t: number) => `transform: translate3d(${(1 - t) * motion.x}px,0,0)`
  };
}
