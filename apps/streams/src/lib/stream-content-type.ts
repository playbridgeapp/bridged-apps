import type { Stream } from './types';

const TYPES: Record<string, string> = {
  m3u8: 'application/vnd.apple.mpegurl',
  mpd: 'application/dash+xml',
  mkv: 'video/x-matroska',
  webm: 'video/webm',
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  mov: 'video/quicktime',
  avi: 'video/x-msvideo',
  ts: 'video/mp2t'
};

function extensionType(name: string | undefined): string | undefined {
  const match = name?.toLowerCase().match(/\.([a-z0-9]{2,4})$/);
  return match ? TYPES[match[1]] : undefined;
}

/**
 * The stream's MIME type for the host, from its URL path or, for links without an extension
 * (debrid and resolver links), the addon's `behaviorHints.filename`. Unknown stays undefined:
 * the host then works it out itself, rather than being told a Matroska file is MP4.
 */
export function streamContentType(stream: Pick<Stream, 'url' | 'behaviorHints'>): string | undefined {
  let path: string | undefined;
  try {
    path = stream.url ? decodeURIComponent(new URL(stream.url).pathname) : undefined;
  } catch {
    path = undefined;
  }
  return extensionType(path) ?? extensionType(stream.behaviorHints?.filename?.trim());
}
