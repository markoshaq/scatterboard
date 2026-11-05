import type { App } from '../app';

function inTextField(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement;
  // A focused button is text-like only for its own activation keys:
  // swallowing everything would dead every shortcut while one holds
  // focus.
  if (t.tagName === 'BUTTON') return e.key === ' ' || e.key === 'Enter';
  return t.isContentEditable || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT';
}

export function attachShortcuts(app: App) {
  window.addEventListener('keydown', (e) => {
    // Modal surfaces (element editor, board draw mode, shortcuts scrim)
    // own their keys.
    if (app.overlayOpen || document.querySelector('.short-scrim')) return;
    const meta = e.metaKey || e.ctrlKey;

    // History nav works even mid-edit.
    if (meta && !e.altKey && !e.shiftKey && (e.key === '[' || e.key === ']')) {
      e.preventDefault();
      if (e.key === '[') history.back();
      else history.forward();
      return;
    }

    // Cmd+Opt+P (Ctrl+Alt elsewhere) toggles presentation from anywhere;
    // e.code because Opt+P types a character on macOS.
    if (meta && e.altKey && e.code === 'KeyP') {
      e.preventDefault();
      app.togglePresent();
      return;
    }

    if (inTextField(e)) {
      if (e.key === 'Escape' && app.editingId) {
        e.preventDefault();
        app.endEdit();
      } else if (e.key === 'Escape' && app.presenting) {
        e.preventDefault();
        app.exitPresent();
      } else if (e.key === 'Escape' && (e.target as HTMLElement).tagName === 'BUTTON') {
        app.clearSelection();
      } else if (e.key === 'Enter' && meta && app.editingId) {
        e.preventDefault();
        app.chainCreate();
      }
      return;
    }

    if (e.code === 'Space' && !meta && !e.altKey) {
      app.spaceDown = true;
      document.body.classList.add('pan-mode');
      e.preventDefault();
      return;
    }

    if (meta && e.altKey && e.key.toLowerCase() === 'v') {
      e.preventDefault();
      app.pasteStyles();
      return;
    }

    if (meta && !e.altKey) {
      const k = e.key.toLowerCase();
      if (e.shiftKey && e.key === 'ArrowUp') {
        e.preventDefault();
        app.zOrder('front');
        return;
      }
      if (e.shiftKey && e.key === 'ArrowDown') {
        e.preventDefault();
        app.zOrder('back');
        return;
      }
      if (k === 'x') {
        e.preventDefault();
        app.cutSelection();
        return;
      }
      if (k === 'c') {
        e.preventDefault();
        app.copySelection();
        return;
      }
      if (k === 'v') {
        // The DOM paste event drives all pasting (internal clipboard,
        // OS files, URL text) via app.pasteExternal.
        return;
      }
      if (k === 'z') {
        e.preventDefault();
        if (app.lockedView()) return;
        if (e.shiftKey) app.store.redo();
        else app.store.undo();
        return;
      }
      if (k === 'y') {
        e.preventDefault();
        if (app.lockedView()) return;
        app.store.redo();
        return;
      }
      if (k === 'a') {
        e.preventDefault();
        app.selectAll();
        return;
      }
      if (e.shiftKey && k === 'd') {
        e.preventDefault();
        app.toggleTheme();
        return;
      }
      if (e.shiftKey && (e.key === '<' || e.key === '>')) {
        e.preventDefault();
        app.stepUiScale(e.key === '>' ? 1 : -1);
        return;
      }
      if (k === 'd' && !e.shiftKey) {
        e.preventDefault();
        app.duplicateSelection();
        return;
      }
      if (k === 'u') {
        e.preventDefault();
        app.navUp();
        return;
      }
      if (k === 'f') {
        e.preventDefault();
        app.openSearch();
        return;
      }
      if (e.key === '=' || e.key === '+') {
        e.preventDefault();
        app.vp.zoomStep(1);
        return;
      }
      if (e.key === '-') {
        e.preventDefault();
        app.vp.zoomStep(-1);
        return;
      }
      if (e.key === '0') {
        e.preventDefault();
        app.vp.reset();
        return;
      }
      return;
    }

    if (e.altKey && !meta && e.key === '`') {
      e.preventDefault();
      app.fileToUnsorted();
      return;
    }

    // No other Alt combos: Alt+Arrow is browser Back/Forward and must
    // not fall into the plain-key nudge cases below.
    if (e.altKey) return;

    if (e.shiftKey && e.code === 'KeyD') {
      e.preventDefault();
      app.enterDrawMode();
      return;
    }

    // Card-level keyboard nav (no edit session owns the keys): Tab
    // walks the cards in reading order, Enter opens the card for
    // editing, arrows select the nearest card via app.nudge.
    const cardEl = e.target instanceof HTMLElement ? e.target.closest('.card') : null;
    if (!app.editingId && cardEl) {
      if (e.key === 'Tab') {
        e.preventDefault();
        app.stepCard(e.shiftKey ? -1 : 1);
        return;
      }
      if (e.key === 'Enter' && e.target === cardEl && cardEl instanceof HTMLElement && cardEl.dataset.id) {
        e.preventDefault();
        app.beginEdit(cardEl.dataset.id);
        return;
      }
    }

    switch (e.key) {
      case 'Delete':
      case 'Backspace':
        e.preventDefault();
        app.deleteSelection();
        break;
      case 'Escape':
        // Exiting presentation wins over deselect.
        if (app.presenting) app.exitPresent();
        else app.clearSelection();
        break;
      case 'z':
      case 'Z':
        app.fitView();
        break;
      case 'i':
      case 'I':
        app.eyedrop();
        break;
      case '/':
        e.preventDefault();
        app.openShortcuts();
        break;
      case 'ArrowLeft':
        e.preventDefault();
        app.nudge(e.shiftKey ? -10 : -1, 0);
        break;
      case 'ArrowRight':
        e.preventDefault();
        app.nudge(e.shiftKey ? 10 : 1, 0);
        break;
      case 'ArrowUp':
        e.preventDefault();
        app.nudge(0, e.shiftKey ? -10 : -1);
        break;
      case 'ArrowDown':
        e.preventDefault();
        app.nudge(0, e.shiftKey ? 10 : 1);
        break;
    }
  });

  window.addEventListener('keyup', (e) => {
    if (e.code === 'Space') {
      app.spaceDown = false;
      document.body.classList.remove('pan-mode');
    }
  });

  window.addEventListener('blur', () => {
    app.spaceDown = false;
    document.body.classList.remove('pan-mode');
  });
}
