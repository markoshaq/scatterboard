// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { sanitizeHtml } from '../src/ui/sanitize';
import { embedSrc, hostOf } from '../src/net/embeds';
import { attachPointer } from '../src/canvas/input';
import type { App } from '../src/app';

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

describe('tilt-wheel suppression', () => {
  it('swallows wheel deltas while the middle button pans and strays after release', () => {
    const root = document.createElement('div');
    const panBy = vi.fn();
    const app = { vp: { panBy, zoomAt: vi.fn() }, startPan: vi.fn() } as unknown as App;
    attachPointer(root, app);
    root.dispatchEvent(new PointerEvent('pointerdown', { button: 1, pointerId: 1, buttons: 4 }));
    // Both axes die while the button is held: the pressing finger cannot
    // also be scrolling the wheel.
    root.dispatchEvent(new WheelEvent('wheel', { deltaX: 53, cancelable: true }));
    root.dispatchEvent(new WheelEvent('wheel', { deltaY: -120, cancelable: true }));
    expect(panBy).not.toHaveBeenCalled();
    window.dispatchEvent(new PointerEvent('pointerup', { button: 1, pointerId: 1, buttons: 0 }));
    // A driver-late tilt delta inside the grace window is still eaten;
    // a real vertical scroll right after release goes through.
    root.dispatchEvent(new WheelEvent('wheel', { deltaX: 53, cancelable: true }));
    expect(panBy).not.toHaveBeenCalled();
    root.dispatchEvent(new WheelEvent('wheel', { deltaY: -120, cancelable: true }));
    expect(panBy).toHaveBeenCalledTimes(1);
  });
});

function pointerApp() {
  return {
    vp: { zoomAt: vi.fn(), panBy: vi.fn() },
    startPan: vi.fn(),
    boardPoint: (e: PointerEvent) => ({ x: e.clientX, y: e.clientY }),
    lineHit: () => null,
    cardIdAt: () => null,
    editingId: null,
    spaceDown: false,
    sel: new Set(),
    doc: { elements: {} },
    gestures: { trackGesture: vi.fn(() => vi.fn()) },
    setMarquee: vi.fn(),
    marqueeSelect: vi.fn(),
    clearSelection: vi.fn(),
    selectOnly: vi.fn(),
    toggleSelect: vi.fn(),
    startLineDrag: vi.fn(),
    startEndpointGesture: vi.fn(),
    endEdit: vi.fn(),
    isTextTarget: () => false,
    layer: { view: () => undefined },
    pointerClient: null,
    ingestFileList: vi.fn(),
    pasteExternal: vi.fn(),
    createNoteAt: vi.fn(),
    cardDblClick: vi.fn(),
    boardUrl: vi.fn(),
    cloneForDrag: vi.fn(),
    cardOrigin: vi.fn(),
    dragMove: vi.fn(),
    abortDrag: vi.fn(),
    endDrag: vi.fn(),
    clickEdits: () => false,
    beginEdit: vi.fn(),
    store: { beginGroup: vi.fn(), endGroup: vi.fn() },
    tools: { contextMenu: vi.fn() },
    overlays: {},
  } as unknown as App;
}

describe('pointer gestures', () => {
  it('middle button starts a pan; right button is ignored', () => {
    const root = document.createElement('div');
    const app = pointerApp();
    attachPointer(root, app);
    root.dispatchEvent(new PointerEvent('pointerdown', { button: 1, pointerId: 1, buttons: 4 }));
    expect(app.startPan).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new PointerEvent('pointerup', { button: 1, pointerId: 1, buttons: 0 }));
    root.dispatchEvent(new PointerEvent('pointerdown', { button: 2, pointerId: 2, buttons: 2 }));
    expect(app.startPan).toHaveBeenCalledTimes(1);
    expect(app.gestures.trackGesture).not.toHaveBeenCalled();
  });

  it('a second non-touch pointer cannot start a parallel gesture', () => {
    const root = document.createElement('div');
    const app = pointerApp();
    attachPointer(root, app);
    root.dispatchEvent(new PointerEvent('pointerdown', { button: 0, pointerId: 1, buttons: 1, clientX: 10, clientY: 10 }));
    expect(app.gestures.trackGesture).toHaveBeenCalledTimes(1);
    root.dispatchEvent(new PointerEvent('pointerdown', { button: 0, pointerId: 2, buttons: 1, clientX: 50, clientY: 50 }));
    expect(app.gestures.trackGesture).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new PointerEvent('pointerup', { button: 0, pointerId: 1, buttons: 0 }));
    // Once the first pointer lifts, a new one may start a gesture.
    root.dispatchEvent(new PointerEvent('pointerdown', { button: 0, pointerId: 2, buttons: 1, clientX: 50, clientY: 50 }));
    expect(app.gestures.trackGesture).toHaveBeenCalledTimes(2);
    window.dispatchEvent(new PointerEvent('pointerup', { button: 0, pointerId: 2, buttons: 0 }));
  });

  it('dragging empty canvas runs a marquee and selects on release', () => {
    const root = document.createElement('div');
    const app = pointerApp();
    attachPointer(root, app);
    root.dispatchEvent(new PointerEvent('pointerdown', { button: 0, pointerId: 9, buttons: 1, clientX: 10, clientY: 10 }));
    window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 9, buttons: 1, clientX: 40, clientY: 40 }));
    expect(app.setMarquee).toHaveBeenCalledWith({ x1: 10, y1: 10, x2: 40, y2: 40 });
    window.dispatchEvent(new PointerEvent('pointerup', { button: 0, pointerId: 9, buttons: 0 }));
    expect(app.marqueeSelect).toHaveBeenCalledWith(false);
    expect(app.setMarquee).toHaveBeenLastCalledWith(null);
  });

  it('a second finger switches the session into pinch zoom + pan', () => {
    const root = document.createElement('div');
    const app = pointerApp();
    attachPointer(root, app);
    root.dispatchEvent(new PointerEvent('pointerdown', { button: 0, pointerId: 1, pointerType: 'touch', buttons: 1, clientX: 100, clientY: 100 }));
    expect(app.gestures.trackGesture).toHaveBeenCalledTimes(1);
    // Second finger cancels finger 1's pan session and arms the pinch.
    root.dispatchEvent(new PointerEvent('pointerdown', { button: 0, pointerId: 2, pointerType: 'touch', buttons: 1, clientX: 100, clientY: 200 }));
    root.dispatchEvent(new PointerEvent('pointermove', { pointerId: 2, pointerType: 'touch', buttons: 1, clientX: 100, clientY: 300 }));
    // Span doubled 100 -> 200 around the new midpoint (100, 200).
    expect(app.vp.zoomAt).toHaveBeenCalledWith(2, 100, 200);
    expect(app.vp.panBy).toHaveBeenCalledWith(0, 50);
    window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, pointerType: 'touch', buttons: 0 }));
    window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 2, pointerType: 'touch', buttons: 0 }));
  });
});
