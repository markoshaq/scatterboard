// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { sanitizeHtml } from '../src/ui/sanitize';
import { embedSrc, hostOf } from '../src/net/embeds';

describe('sanitizeHtml', () => {
  it('keeps editor-produced markup intact', () => {
    const html =
      '<p class="tx-sm">task</p><h2>title</h2><blockquote>q</blockquote>' +
      '<pre>code</pre><code class="tx-ic">x</code><span style="color: #ff0000">red</span>' +
      '<p style="text-align: center">c</p><ul><li>a</li></ul><a href="https://x.com">l</a><hr><br>';
    expect(sanitizeHtml(html)).toBe(html);
  });

  it('drops scriptable elements and handlers', () => {
    // happy-dom writes refused iframe loads straight to stderr.
    const quiet = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    const html = sanitizeHtml(
      '<p onclick="x()">hi</p><script>alert(1)</script>' +
        '<img src=x onerror="x()"><iframe src="javascript:x"></iframe>' +
        '<a href="javascript:alert(1)">bad</a><a href="#/b/home">ok</a>',
    );
    quiet.mockRestore();
    expect(html).not.toContain('script');
    expect(html).not.toContain('onerror');
    expect(html).not.toContain('onclick');
    expect(html).not.toContain('javascript');
    expect(html).not.toContain('<img');
    expect(html).toContain('<a href="#/b/home">ok</a>');
  });

  it('strips hostile style values but keeps safe ones', () => {
    const out = sanitizeHtml(
      '<span style="color: #fff; background: url(javascript:x); text-align: center">s</span>',
    );
    expect(out).toContain('color: #fff');
    expect(out).toContain('text-align: center');
    expect(out).not.toContain('url(');
    expect(out).not.toContain('background');
  });

  it('unwraps unknown tags but preserves text', () => {
    expect(sanitizeHtml('<marquee><b>keep</b></marquee>')).toContain('keep');
    expect(sanitizeHtml('<font size="9">big</font>')).toContain('big');
  });
});

describe('embedSrc', () => {
  it('parses youtube watch/share/shorts urls', () => {
    expect(embedSrc('video', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toContain('youtube.com/embed/dQw4w9WgXcQ');
    expect(embedSrc('video', 'https://youtu.be/dQw4w9WgXcQ')).toContain('dQw4w9WgXcQ');
    expect(embedSrc('video', 'https://www.youtube.com/shorts/dQw4w9WgXcQ')).toContain('dQw4w9WgXcQ');
  });

  it('parses vimeo/spotify/soundcloud/maps', () => {
    expect(embedSrc('video', 'https://vimeo.com/123456789')).toContain('player.vimeo.com/video/123456789');
    expect(embedSrc('audio', 'https://open.spotify.com/track/abc123')).toContain('open.spotify.com/embed/track/abc123');
    expect(embedSrc('audio', 'https://soundcloud.com/x/y')).toContain('w.soundcloud.com/player/');
    expect(embedSrc('map', 'https://www.google.com/maps/@45.2,19.8,15z')).toContain('45.2%2C19.8');
  });

  it('rejects non-provider and malformed urls', () => {
    expect(embedSrc('video', 'https://example.com/watch?v=x')).toBeNull();
    expect(embedSrc('audio', 'not a url')).toBeNull();
    expect(embedSrc('map', 'https://evil.com/maps/@1,2')).toBeNull();
    expect(hostOf('')).toBe('');
  });
});

describe('tool popup focus', () => {
  it('focuses the first control, cycles with arrows and Tab, returns focus on close', async () => {
    const anchor = document.createElement('button');
    document.body.appendChild(anchor);
    anchor.focus();
    const content = document.createElement('div');
    const { openToolPopup } = await import('../src/ui/popup');
    const pop = openToolPopup(anchor, content);
    const a = document.createElement('button');
    const b = document.createElement('button');
    a.textContent = 'a';
    b.textContent = 'b';
    content.append(a, b);
    await new Promise((r) => setTimeout(r));
    expect(document.activeElement).toBe(a);

    a.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(document.activeElement).toBe(b);
    b.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(document.activeElement).toBe(a);
    a.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    expect(document.activeElement).toBe(b);
    b.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, shiftKey: true }));
    expect(document.activeElement).toBe(a);

    pop.close();
    expect(document.activeElement).toBe(anchor);
  });
});
