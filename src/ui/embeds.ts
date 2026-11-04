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

function parseUrl(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

// host === domain or a subdomain of it (m.youtube.com, player.vimeo.com).
// Raw-string regexes would also match 'evil.example/youtu.be/x'.
function hostIs(u: URL, domain: string): boolean {
  const h = u.hostname.toLowerCase();
  return h === domain || h.endsWith(`.${domain}`);
}

function youtubeId(url: string): string | null {
  const u = parseUrl(url);
  if (!u) return null;
  if (hostIs(u, 'youtu.be')) {
    const m = u.pathname.match(/^\/([\w-]{6,})/);
    return m?.[1] ?? null;
  }
  if (hostIs(u, 'youtube.com')) {
    const m = u.pathname.match(/^\/(?:shorts|embed|live)\/([\w-]{6,})/);
    if (m) return m[1]!;
    const v = u.pathname === '/watch' ? u.searchParams.get('v') : null;
    if (v && /^[\w-]{6,}$/.test(v)) return v;
  }
  return null;
}

function vimeoId(url: string): string | null {
  const u = parseUrl(url);
  if (!u || !hostIs(u, 'vimeo.com')) return null;
  const m = u.pathname.match(/^\/(?:video\/)?(\d{6,})/);
  return m?.[1] ?? null;
}

function spotifyEmbed(url: string): string | null {
  const u = parseUrl(url);
  if (u?.hostname.toLowerCase() !== 'open.spotify.com') return null;
  const m = u.pathname.match(/^\/(track|album|playlist|episode|show|artist)\/([\w]+)/);
  return m ? `https://open.spotify.com/embed/${m[1]}/${m[2]}` : null;
}

// decodeURIComponent throws on truncated escapes like %E0 pasted raw.
function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

function mapQuery(url: string): string | null {
  const at = url.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
  if (at) return `${at[1]},${at[2]}`;
  const place = url.match(/\/maps\/place\/([^/@]+)/);
  if (place) return safeDecode(place[1]!).replace(/\+/g, ' ');
  const search = url.match(/\/maps\/search\/([^/@]+)/);
  if (search) return safeDecode(search[1]!).replace(/\+/g, ' ');
  const q = url.match(/[?&]q=([^&]+)/);
  if (q) return safeDecode(q[1]!).replace(/\+/g, ' ');
  return url;
}

// Google Maps hosts: google.<tld>/maps and maps.google.<tld> plus the
// two short-link hosts. The tld shape (google.com, google.co.uk) keeps
// lookalikes like google.com.evil.example out.
function isGoogleMaps(u: URL): boolean {
  const h = u.hostname.toLowerCase().replace(/^www\./, '');
  if (h === 'maps.app.goo.gl') return true;
  if (h === 'goo.gl') return u.pathname.startsWith('/maps');
  if (/^maps\.google\.[a-z]{2,}(\.[a-z]{2})?$/.test(h)) return true;
  return /^google\.[a-z]{2,}(\.[a-z]{2})?$/.test(h) && u.pathname.startsWith('/maps');
}

// A human title derived from the URL itself, no fetch. Google Maps
// carries the place in /maps/place/<name>/, search or ?q=; unlike
// mapQuery the title prefers the name over the coordinates.
export function urlTitle(url: string): string | null {
  const u = parseUrl(url);
  if (!u || !isGoogleMaps(u)) return null;
  const place = url.match(/\/maps\/(?:place|search)\/([^/@]+)/) ?? url.match(/[?&]q=([^&]+)/);
  if (place) return safeDecode(place[1]!).replace(/\+/g, ' ');
  const at = url.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
  return at ? `${at[1]},${at[2]}` : null;
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
    const u = parseUrl(url);
    if (u && hostIs(u, 'soundcloud.com')) {
      return `https://w.soundcloud.com/player/?url=${encodeURIComponent(url)}&auto_play=true`;
    }
    return null;
  }
  // map
  const u = parseUrl(url);
  if (u && isGoogleMaps(u)) {
    const q = mapQuery(url);
    return q ? `https://www.google.com/maps?q=${encodeURIComponent(q)}&output=embed` : null;
  }
  return null;
}

export const EMBED_ALLOW =
  'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';
