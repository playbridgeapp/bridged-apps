import type { Meta, Video } from './types';

function imdbId(meta: Meta): string | undefined {
  return meta.imdb_id || meta.imdbId || (/^tt\d+$/.test(meta.id) ? meta.id : undefined);
}

function tmdbId(meta: Meta): string | undefined {
  if (meta.tmdbId != null) return String(meta.tmdbId);
  return /^tmdb:(\d+)$/.exec(meta.id)?.[1];
}

/** Receiver metadata for a cast. Series-level IMDb/TMDB ids let the TV look up skip segments. */
export function castMetadata(meta: Meta, video?: Video): Record<string, unknown> {
  const imdb = imdbId(meta);
  const tmdb = tmdbId(meta);
  return {
    title: meta.name,
    ...(meta.description ? { overview: meta.description.slice(0, 2000) } : {}),
    ...(meta.poster ? { posterUrl: meta.poster } : {}),
    ...(meta.background ? { backdropUrl: meta.background } : {}),
    ...(meta.releaseInfo ? { year: meta.releaseInfo.slice(0, 4) } : {}),
    ...(meta.genres?.length ? { genres: meta.genres.slice(0, 8) } : {}),
    ...(imdb ? { imdbId: imdb } : {}),
    ...(tmdb ? { tmdbId: tmdb } : {}),
    ...(video?.season != null ? { season: video.season } : {}),
    ...(video?.episode != null ? { episode: video.episode } : {}),
    ...(video?.title ? { episodeTitle: video.title } : {})
  };
}
