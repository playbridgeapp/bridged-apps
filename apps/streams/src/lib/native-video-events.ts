const forwardedEvents = ['loadedmetadata', 'canplay', 'playing', 'seeked', 'waiting', 'stalled', 'timeupdate', 'pause'] as const;

type NativeMedia = Pick<HTMLMediaElement, 'readyState' | 'addEventListener' | 'removeEventListener'>;

/** Movi's internal native fallback does not relay these shadow-video events. */
export function forwardNativeVideoEvents(host: EventTarget, video: NativeMedia, isCurrent: () => boolean): () => void {
  let active = true;
  const forward = (event: Event) => {
    if (active && isCurrent()) host.dispatchEvent(new Event(event.type));
  };
  // Movi already forwards ended/error. Relaying ended twice could advance
  // or resolve the episode queue twice.
  for (const type of forwardedEvents) video.addEventListener(type, forward);
  // A handoff may attach to media whose readiness events have already fired.
  if (video.readyState >= 1) forward(new Event('loadedmetadata'));
  if (video.readyState >= 3) forward(new Event('canplay'));
  return () => {
    active = false;
    for (const type of forwardedEvents) video.removeEventListener(type, forward);
  };
}
