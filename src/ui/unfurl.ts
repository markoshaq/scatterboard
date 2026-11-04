// Optional online extra: fetch a page's <title>/OG tags through a
// public CORS proxy so link cards can self-fill. Everything degrades
// silently to the manual title offline or on failure.
const PROXY = 'https://api.allorigins.win/raw?url=';

interface UnfurlResult {
  title?: string;
  desc?: string;
  image?: string;
}

function meta(doc: Document, key: string): string | null {
  return doc.querySelector(`meta[property="${key}"], meta[name="${key}"]`)?.getAttribute('content')?.trim() ?? null;
}

// Only the head of the page carries meta tags; cap the body read so a
// huge or slow response can't hold the request open past the timer.
const MAX_HTML = 256 * 1024;

export async function fetchLinkPreview(url: string): Promise<UnfurlResult | null> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 8000);
  try {
    const res = await fetch(PROXY + encodeURIComponent(url), { signal: ctl.signal });
    if (!res.ok) return null;
    // The abort signal covers the body read too; the slice caps size.
    const html = (await res.text()).slice(0, MAX_HTML);
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const image = meta(doc, 'og:image');
    const out: UnfurlResult = {};
    const title = meta(doc, 'og:title') ?? doc.title?.trim() ?? null;
    const desc = meta(doc, 'og:description') ?? meta(doc, 'description');
    if (title) out.title = title;
    if (desc) out.desc = desc;
    if (image) {
      // A bad og:image must not sink the title/desc already parsed.
      try {
        const u = new URL(image, url);
        if (u.protocol === 'http:' || u.protocol === 'https:') out.image = u.href;
      } catch {
        /* malformed og:image: skip */
      }
    }
    return Object.keys(out).length ? out : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
