import type { EmbedKind } from '../state/schema';

// Client-side provider URL parsing. Builds iframe embed URLs from the
// pasted URL only; no fetching, no API keys.
export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function youtubeId(url: string): string | null {
  const m =
    url.match(/youtu\.be\/([\w-]{6,})/) ??
    url.match(/youtube\.com\/(?:shorts|embed|live)\/([\w-]{6,})/) ??
    url.match(/youtube\.com\/watch\?[^#]*\bv=([\w-]{6,})/);
  return m?.[1] ?? null;
}

function vimeoId(url: string): string | null {
  const m = url.match(/vimeo\.com\/(?:video\/)?(\d{6,})/);
  return m?.[1] ?? null;
}

function spotifyEmbed(url: string): string | null {
  const m = url.match(/open\.spotify\.com\/(track|album|playlist|episode|show|artist)\/([\w]+)/);
  return m ? `https://open.spotify.com/embed/${m[1]}/${m[2]}` : null;
}

function mapQuery(url: string): string | null {
  const at = url.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
  if (at) return `${at[1]},${at[2]}`;
  const place = url.match(/\/maps\/place\/([^/@]+)/);
  if (place) return decodeURIComponent(place[1]!).replace(/\+/g, ' ');
  const search = url.match(/\/maps\/search\/([^/@]+)/);
  if (search) return decodeURIComponent(search[1]!).replace(/\+/g, ' ');
  const q = url.match(/[?&]q=([^&]+)/);
  if (q) return decodeURIComponent(q[1]!).replace(/\+/g, ' ');
  return url;
}

// The iframe src for a pasted URL, or null when the provider isn't
// recognised for this embed kind.
export function embedSrc(kind: EmbedKind, url: string): string | null {
  if (kind === 'video') {
    const yt = youtubeId(url);
    if (yt) return `https://www.youtube.com/embed/${yt}?rel=0&autoplay=1`;
    const vm = vimeoId(url);
    if (vm) return `https://player.vimeo.com/video/${vm}?autoplay=1`;
    return null;
  }
  if (kind === 'audio') {
    const sp = spotifyEmbed(url);
    if (sp) return sp;
    if (/soundcloud\.com/.test(url)) {
      return `https://w.soundcloud.com/player/?url=${encodeURIComponent(url)}&auto_play=true`;
    }
    return null;
  }
  // map
  if (/google\.[\w.]+\/maps|maps\.app\.goo\.gl|goo\.gl\/maps|maps\.google\./.test(url)) {
    const q = mapQuery(url);
    return q ? `https://www.google.com/maps?q=${encodeURIComponent(q)}&output=embed` : null;
  }
  return null;
}

export const EMBED_ALLOW =
  'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';
