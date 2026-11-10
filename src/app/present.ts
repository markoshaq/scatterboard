import type { App } from '../app';
import type { ID, PresentOpts } from '../state/schema';
import { cardAriaLabel } from '../cards/factory';
import { closeToolPopup } from '../ui/popup';
import { openViewMenu } from '../ui/toolpopups';

export class Present {
  constructor(private a: App) {}

  // 'Prevent editing' toggle: blocks every mutation entry point while
  // presenting; select/pan/zoom stay live. Checked centrally here.
  locked(): boolean {
    return this.a.presenting && !!this.a.board()?.presentOpts?.edit;
  }


  enter() {
    if (this.a.presenting || this.a.overlayOpen || !this.a.boardId) return;
    this.a.editing.endEdit();
    this.a.overlays.commitLabelEdit();
    this.a.panels.closePanel();
    closeToolPopup();
    this.a.presenting = true;
    this.applyClasses();
    this.a.requestRender();
  }


  exit() {
    if (!this.a.presenting) return;
    this.a.presenting = false;
    this.a.layer.pin.clear();
    this.applyClasses();
    this.a.requestRender();
  }


  toggle() {
    if (this.a.presenting) this.exit();
    else this.enter();
  }


  private applyClasses() {
    const opts = this.a.board()?.presentOpts;
    document.body.classList.toggle('presenting', this.a.presenting);
    document.body.classList.toggle('hide-comments', this.a.presenting && !!opts?.comments);
  }


  // Agent shim: set presentation toggles explicitly (the View menu
  // toggles via toggleOpt). Same direct-mutation path.
  setOpts(o: PresentOpts) {
    const board = this.a.board();
    if (!board) return;
    board.presentOpts = { ...board.presentOpts, ...o };
    this.a.scheduleSave();
    this.applyClasses();
  }


  // Persisted per board, direct field mutation like board.position:
  // no action, no undo entry.
  private toggleOpt(key: keyof PresentOpts) {
    const board = this.a.board();
    if (!board) return;
    board.presentOpts = { ...board.presentOpts, [key]: !board.presentOpts?.[key] };
    this.a.scheduleSave();
    this.applyClasses();
  }


  // 'Focus on selected cards': non-selected canvas items dim. Re-checked
  // in render() so the focus set follows live selection changes.
  dims(id: ID): boolean {
    return this.a.presenting && this.a.sel.size > 0 && !this.a.sel.has(id) && !!this.a.board()?.presentOpts?.focus;
  }


  openViewMenu(anchor: HTMLElement) {
    if (!this.a.boardId) return;
    openViewMenu(anchor, {
      presentOpts: () => this.a.board()?.presentOpts ?? {},
      onToggle: (key) => this.toggleOpt(key),
      grid: () => this.a.board()?.grid ?? true,
      onToggleGrid: () => this.a.toggleGrid(),
      minimap: () => this.a.prefs.minimap !== false,
      onToggleMinimap: () => {
        if (this.a.prefs.minimap === false) delete this.a.prefs.minimap;
        else this.a.prefs.minimap = false;
        this.a.scheduleSave();
        this.a.requestRender();
      },
      onPresent: () => this.enter(),
      onFit: () => this.a.fitView(),
    });
  }


  // Present-mode arrow keys walk the cards in reading order like
  // slides: the landing card is selected (so Focus-on-selected dims
  // the rest) and fitted on screen.
  step(dir: -1 | 1) {
    const els = this.a.layer
      .elements()
      .filter((e) => e.type !== 'line' && e.type !== 'annotation' && !(e.type === 'comment' && e.anchorId !== undefined))
      .map((e) => ({ e, r: this.a.layer.rectOf(e) }))
      .sort((a, b) => a.r.y - b.r.y || a.r.x - b.r.x);
    if (!els.length) return;
    const i = els.findIndex((c) => this.a.sel.has(c.e.id));
    const target = els[i < 0 ? (dir === 1 ? 0 : els.length - 1) : (i + dir + els.length) % els.length]!.e;
    this.a.selectOnly(target.id);
    // Pin the landing card mounted: the fit tween takes ~190ms to bring
    // a far target on screen, and a culled view cannot take focus.
    this.a.layer.pin = new Set([target.id]);
    this.a.vp.fit(this.a.layer.rectOf(target), this.a.fitInsets());
    this.a.render();
    this.a.layer.view(target.id)?.node.focus({ preventScroll: true });
    this.a.announce(`${cardAriaLabel(target)}: ${this.a.panels.snippetFor(target)}`);
  }
}
