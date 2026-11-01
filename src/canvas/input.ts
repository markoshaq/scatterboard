import type { App } from '../app';
import { boardRefOf, type ID } from '../state/schema';

const DRAG_SLOP = 3;

export function attachPointer(root: HTMLElement, app: App) {
  // One active pointer at a time: a second finger down must not start a
  // parallel gesture that fights the in-flight one.
  let activePointer: number | null = null;
  root.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 && e.button !== 1) return;
    if (activePointer !== null && e.pointerId !== activePointer) return;
    activePointer = e.pointerId;
    onDown(e, app);
  });
  const release = (e: PointerEvent) => {
    if (e.pointerId === activePointer) activePointer = null;
  };
  window.addEventListener('pointerup', release);
  window.addEventListener('pointercancel', release);
  root.addEventListener('dblclick', (e) => onDblClick(e, app));
  root.addEventListener('wheel', (e) => onWheel(e, app), { passive: false });
  root.addEventListener('contextmenu', (e) => onContextMenu(e));
  root.addEventListener('pointermove', (e) => {
    app.pointer = app.boardPoint(e);
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

  onBackgroundDown(e, app);
}

function onCardDown(e: PointerEvent, app: App, cardId: ID) {
  // Cmd+Opt+click a board card opens it in a new window.
  if ((e.metaKey || e.ctrlKey) && e.altKey) {
    const card = app.doc.elements[cardId];
    const ref = card ? boardRefOf(card) : null;
    if (ref) window.open(app.boardUrl(ref), '_blank', 'width=1280,height=840');
    return;
  }
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
  const start = { x: e.clientX, y: e.clientY };

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
      else if (app.clickEdits(cardId) && !(ev.target as HTMLElement).closest?.('[data-noclick]')) {
        app.beginEdit(cardId, { x: ev.clientX, y: ev.clientY });
      }
    }
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', cancel);
}

function onBackgroundDown(e: PointerEvent, app: App) {
  const pt = app.boardPoint(e);
  const hit = app.lineHit(pt);
  if (hit?.kind === 'end' && hit.which) {
    app.startEndpointGesture(hit.id, hit.which, e);
    return;
  }
  if (hit?.kind === 'body') {
    if (e.shiftKey) app.toggleSelect(hit.id);
    else app.selectOnly(hit.id);
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
    app.startLabelEdit(hit.id);
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

function onContextMenu(e: MouseEvent) {
  // No context menus anywhere; just suppress the browser's.
  e.preventDefault();
}

// Safari sends gesture events for trackpad pinch instead of ctrl+wheel.
function attachGesture(root: HTMLElement, app: App) {
  let last = 1;
  root.addEventListener('gesturestart', (e) => {
    e.preventDefault();
    last = (e as GestureEvent).scale;
  });
  root.addEventListener('gesturechange', (e) => {
    e.preventDefault();
    const g = e as GestureEvent;
    app.vp.zoomAt(g.scale / last, g.clientX, g.clientY);
    last = g.scale;
  });
}

interface GestureEvent extends UIEvent {
  scale: number;
  clientX: number;
  clientY: number;
}
