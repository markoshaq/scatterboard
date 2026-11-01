// Optional online extra: fetch a page's <title>/OG tags through a
// public CORS proxy so link cards can self-fill. Everything degrades
// silently to the manual title offline or on failure.
const PROXY = 'https://api.allorigins.win/raw?url=';

export interface UnfurlResult {
  title?: string;
  desc?: string;
  image?: string;
}

function meta(doc: Document, key: string): string | null {
  return doc.querySelector(`meta[property="${key}"], meta[name="${key}"]`)?.getAttribute('content')?.trim() ?? null;
}

export async function fetchLinkPreview(url: string): Promise<UnfurlResult | null> {
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 8000);
    const res = await fetch(PROXY + encodeURIComponent(url), { signal: ctl.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    const html = await res.text();
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const image = meta(doc, 'og:image');
    const out: UnfurlResult = {};
    const title = meta(doc, 'og:title') ?? doc.title?.trim() ?? null;
    const desc = meta(doc, 'og:description') ?? meta(doc, 'description');
    if (title) out.title = title;
    if (desc) out.desc = desc;
    if (image) out.image = new URL(image, url).href;
    return Object.keys(out).length ? out : null;
  } catch {
    return null;
  }
}
