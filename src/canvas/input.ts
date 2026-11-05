import type { App } from '../app';
import { boardRefOf, type ID } from '../state/schema';
import type { LineHit } from './lines';

const DRAG_SLOP = 3;

export function attachPointer(root: HTMLElement, app: App) {
  // One active pointer at a time for mouse/pen: a second pointer must
  // not start a parallel gesture that fights the in-flight one. Touch
  // tracks all fingers in `touches` so a second finger can switch the
  // session into a pinch (zoom + pan).
  let activePointer: number | null = null;
  const touches = new Map<number, { x: number; y: number }>();
  let pinching = false;
  let pinchPrev: { d: number; cx: number; cy: number } | null = null;
  const pinchGeom = () => {
    const [a, b] = [...touches.values()];
    return { d: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
  };
  root.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'touch') {
      if (pinching) {
        touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
        pinchPrev = null;
        return;
      }
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (touches.size === 1) {
        activePointer = e.pointerId;
        onDown(e, app);
        return;
      }
      // Second finger: cancel the first finger's gesture (the cancel
      // paths undo any in-flight marquee/drag cleanly), then pinch. The
      // synthetic cancel runs `release` too and drops finger 1 from
      // `touches`, so re-add it to keep the tracked pair intact.
      if (activePointer !== null) {
        const firstId = activePointer;
        const firstPos = touches.get(firstId)!;
        window.dispatchEvent(new PointerEvent('pointercancel', { pointerId: firstId, pointerType: 'touch' }));
        touches.set(firstId, firstPos);
      }
      pinching = true;
      pinchPrev = pinchGeom();
      return;
    }
    if (e.button !== 0 && e.button !== 1) return;
    if (activePointer !== null && e.pointerId !== activePointer) return;
    activePointer = e.pointerId;
    onDown(e, app);
  });
  root.addEventListener('pointermove', (e) => {
    const p = touches.get(e.pointerId);
    if (p) {
      p.x = e.clientX;
      p.y = e.clientY;
    }
    if (!pinching || touches.size < 2) return;
    const cur = pinchGeom();
    if (pinchPrev) {
      if (pinchPrev.d > 0) app.vp.zoomAt(cur.d / pinchPrev.d, cur.cx, cur.cy);
      app.vp.panBy(cur.cx - pinchPrev.cx, cur.cy - pinchPrev.cy);
    }
    pinchPrev = cur;
  });
  const release = (e: PointerEvent) => {
    if (e.pointerId === activePointer) activePointer = null;
    if (e.pointerType !== 'touch') return;
    touches.delete(e.pointerId);
    // Reset the baseline whenever the tracked pair changes so the next
    // move does not jump; a lone remaining finger keeps the pinch flag
    // until it lifts, so picking a drag back up cannot jump the board.
    pinchPrev = touches.size >= 2 ? pinchGeom() : null;
    if (touches.size === 0) pinching = false;
  };
  window.addEventListener('pointerup', release);
  window.addEventListener('pointercancel', release);
  // Links inside rich text open externally; an editing card's caret
  // still owns its clicks, so only non-editing cards are caught here.
  root.addEventListener('click', (e) => {
    const a = (e.target as HTMLElement).closest?.('.card:not(.editing) a[href]');
    if (!(a instanceof HTMLAnchorElement)) return;
    // Only real http(s) links open externally: mailto: triggers the
    // mail client anyway and #/b/... is same-tab internal navigation.
    if (!/^https?:/i.test(a.getAttribute('href') ?? '')) return;
    e.preventDefault();
    window.open(a.href, '_blank', 'noopener');
  });
  root.addEventListener('dblclick', (e) => onDblClick(e, app));
  root.addEventListener('wheel', (e) => onWheel(e, app), { passive: false });
  root.addEventListener('contextmenu', (e) => onContextMenu(e, app));
  root.addEventListener('pointermove', (e) => {
    // Reused point object: no allocation per move.
    app.pointer ??= { x: 0, y: 0 };
    app.pointer.x = (e.clientX - app.vp.x) / app.vp.z;
    app.pointer.y = (e.clientY - app.vp.y) / app.vp.z;
  });
  // OS file drops: images become image cards, everything else file cards.
  root.addEventListener('dragover', (e) => {
    e.preventDefault();
  });
  root.addEventListener('drop', (e) => {
    e.preventDefault();
    const files = e.dataTransfer?.files;
    if (files?.length) app.ingestFileList([...files], app.boardPoint(e));
  });
  // OS clipboard paste (Cmd+V): internal clipboard -> files -> URL text.
  window.addEventListener('paste', (e) => app.pasteExternal(e));
  attachGesture(root, app);
}

function onDown(e: PointerEvent, app: App) {
  if (e.button === 1) {
    e.preventDefault();
    app.startPan(e);
    return;
  }
  if (e.button !== 0) return;

  if (app.editingId) {
    const editingCard = app.layer.view(app.editingId)?.node;
    if (editingCard?.contains(e.target as Node)) {
      if (app.isTextTarget(e)) return;
      if ((e.target as HTMLElement).closest?.('[data-noclick]')) return;
      app.endEdit();
    } else {
      app.endEdit();
    }
  }

  if (app.spaceDown) {
    e.preventDefault();
    app.startPan(e);
    return;
  }

  // Endpoint grabs paint on the chrome layer above cards, so they must
  // win over whatever card happens to be underneath too.
  const hit = app.lineHit(app.boardPoint(e));
  if (hit?.kind === 'end' && hit.which) {
    app.startEndpointGesture(hit.id, hit.which, e);
    return;
  }

  const cardId = app.cardIdAt(e);
  if (cardId) {
    onCardDown(e, app, cardId);
    return;
  }

  onBackgroundDown(e, app, hit);
}

function onCardDown(e: PointerEvent, app: App, cardId: ID) {
  // Cmd+Opt+click a board card opens it in a new window.
  if ((e.metaKey || e.ctrlKey) && e.altKey) {
    const card = app.doc.elements[cardId];
    const ref = card ? boardRefOf(card) : null;
    if (ref) window.open(app.boardUrl(ref), '_blank', 'width=1280,height=840');
    return;
  }
  startElementDrag(e, app, cardId);
}

// Select + drag wiring shared with annotation picks: their ink svg has
// no card DOM, so they reach this without going through cardIdAt.
export function startElementDrag(e: PointerEvent, app: App, cardId: ID) {
  const wasSelected = app.sel.has(cardId);
  if (e.shiftKey) {
    app.toggleSelect(cardId);
    return;
  }
  if (!wasSelected) app.selectOnly(cardId);

  let dragIds = [...app.sel].filter((id) => {
    const el = app.doc.elements[id];
    return !!el && el.type !== 'line' && !el.locked && !(el.type === 'comment' && el.anchorId !== undefined);
  });
  if (!dragIds.length) return;
  let origins = new Map<ID, { x: number; y: number }>();
  for (const id of dragIds) {
    if (app.doc.elements[id]) origins.set(id, app.cardOrigin(id));
  }
  const pid = e.pointerId;
  const startX = e.clientX;
  const startY = e.clientY;
  let moved = false;
  let grouped = false;
  let wantClone = e.altKey;
  const start = app.boardPoint(e);

  const move = (ev: PointerEvent) => {
    if (ev.pointerId !== pid) return;
    if (!moved && Math.hypot(ev.clientX - startX, ev.clientY - startY) < DRAG_SLOP) return;
    moved = true;
    if (!grouped) {
      app.store.beginGroup();
      grouped = true;
      if (wantClone) {
        wantClone = false;
        const r = app.cloneForDrag(dragIds);
        if (r) {
          dragIds = r.ids;
          origins = r.origins;
        }
      }
    }
    app.dragMove(dragIds, origins, start, ev);
  };
  const cleanup = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', cancel);
  };
  const cancel = (ev: PointerEvent) => {
    if (ev.pointerId !== pid) return;
    cleanup();
    app.abortDrag();
    if (grouped) app.store.endGroup('move');
  };
  const up = (ev: PointerEvent) => {
    if (ev.pointerId !== pid) return;
    cleanup();
    if (moved) app.endDrag(ev);
    if (grouped) app.store.endGroup('move');
    if (!moved && wasSelected) {
      if (app.sel.size > 1) app.selectOnly(cardId);
      else if (app.clickEdits(cardId) && !(ev.target as HTMLElement).closest?.('[data-noclick], a[href]')) {
        app.beginEdit(cardId, { x: ev.clientX, y: ev.clientY });
      }
    }
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', cancel);
}

// `hit` was already resolved in onDown: reusing it avoids a second
// full line-resolution pass per background click.
function onBackgroundDown(e: PointerEvent, app: App, hit: LineHit | null) {
  const pt = app.boardPoint(e);
  if (hit?.kind === 'end' && hit.which) {
    app.startEndpointGesture(hit.id, hit.which, e);
    return;
  }
  if (hit?.kind === 'body') {
    if (e.shiftKey) app.toggleSelect(hit.id);
    else {
      app.selectOnly(hit.id);
      app.startLineDrag(hit.id, e);
    }
    return;
  }
  // One finger on empty canvas pans (a second finger upgrades to
  // pinch). A held-still press past ~500ms switches the gesture to a
  // marquee instead, the only multi-select gesture a phone offers. A
  // tap still clears the selection, matching the marquee path's
  // no-move outcome.
  if (e.pointerType === 'touch') {
    const pid = e.pointerId;
    let panned = false;
    let marquee = false;
    const longPress = window.setTimeout(() => {
      marquee = true;
      app.setMarquee({ x1: pt.x, y1: pt.y, x2: pt.x, y2: pt.y });
    }, 500);
    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== pid) return;
      if (marquee) {
        const cur = app.boardPoint(ev);
        app.setMarquee({ x1: pt.x, y1: pt.y, x2: cur.x, y2: cur.y });
        return;
      }
      if (Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) < DRAG_SLOP + 5) return;
      window.clearTimeout(longPress);
      panned = true;
      cleanup();
      app.startPan(ev);
    };
    const done = (ev: PointerEvent) => {
      if (ev.pointerId !== pid) return;
      window.clearTimeout(longPress);
      cleanup();
      if (marquee) {
        if (ev.type === 'pointerup') app.marqueeSelect(false);
        app.setMarquee(null);
        return;
      }
      if (!panned && ev.type === 'pointerup') app.clearSelection();
    };
    const cleanup = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', done);
      window.removeEventListener('pointercancel', done);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', done);
    window.addEventListener('pointercancel', done);
    return;
  }
  const pid = e.pointerId;
  const start = pt;
  let moved = false;
  const move = (ev: PointerEvent) => {
    if (ev.pointerId !== pid) return;
    if (!moved && Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) < DRAG_SLOP) return;
    moved = true;
    const cur = app.boardPoint(ev);
    app.setMarquee({ x1: start.x, y1: start.y, x2: cur.x, y2: cur.y });
  };
  const cleanup = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', cancel);
  };
  const cancel = (ev: PointerEvent) => {
    if (ev.pointerId !== pid) return;
    cleanup();
    app.setMarquee(null);
  };
  const up = (ev: PointerEvent) => {
    if (ev.pointerId !== pid) return;
    cleanup();
    if (moved) {
      app.marqueeSelect(ev.shiftKey);
    } else {
      app.clearSelection();
    }
    app.setMarquee(null);
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', cancel);
}

function onDblClick(e: MouseEvent, app: App) {
  // A second click on a rich-text link stays a navigation, not editing.
  if ((e.target as HTMLElement).closest?.('a[href]')) return;
  const cardId = app.cardIdAt(e as PointerEvent);
  if (cardId) {
    if (app.editingId === cardId) return;
    app.cardDblClick(cardId, e);
    return;
  }
  if ((e.target as HTMLElement).closest('.card')) return;
  const p = app.boardPoint(e);
  const hit = app.lineHit(p);
  if (hit?.kind === 'body' || hit?.kind === 'end') {
    app.overlays.startLabelEdit(hit.id);
    return;
  }
  app.createNoteAt(p.x, p.y, { x: e.clientX, y: e.clientY });
}

function onWheel(e: WheelEvent, app: App) {
  e.preventDefault();
  let dx = e.deltaX;
  let dy = e.deltaY;
  if (e.deltaMode === 1) {
    dx *= 16;
    dy *= 16;
  }
  if (e.ctrlKey || e.metaKey) {
    const factor = Math.exp(-dy * 0.002);
    app.vp.zoomAt(factor, e.clientX, e.clientY);
    return;
  }
  if (e.shiftKey && dx === 0) {
    dx = dy;
    dy = 0;
  }
  app.vp.panBy(-dx, -dy);
}

function onContextMenu(e: MouseEvent, app: App) {
  // No browser context menu anywhere; right-click opens the element's
  // own tool list instead.
  e.preventDefault();
  app.tools.contextMenu(e);
}

// Safari sends gesture events for trackpad pinch instead of ctrl+wheel.
// Bound on document, not root: an unsuppressed pinch over chrome
// (topbar, panels, sheets) page-zooms the whole app on iOS Safari.
// Only gestures that start on the canvas drive the board zoom.
function attachGesture(root: HTMLElement, app: App) {
  let last = 1;
  let onCanvas = false;
  document.addEventListener('gesturestart', (e) => {
    e.preventDefault();
    last = (e as GestureEvent).scale;
    onCanvas = e.target instanceof Node && root.contains(e.target);
  });
  document.addEventListener('gesturechange', (e) => {
    e.preventDefault();
    const g = e as GestureEvent;
    if (onCanvas) app.vp.zoomAt(g.scale / last, g.clientX, g.clientY);
    last = g.scale;
  });
}

interface GestureEvent extends UIEvent {
  scale: number;
  clientX: number;
  clientY: number;
}
