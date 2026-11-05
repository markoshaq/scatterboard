import { openToolPopup, type ToolPopup } from '../../ui/popup';
import { FORMULA_NAMES } from '../formula';

// What the formula autocomplete reads or mutates on the card.
export interface FxHost {
  cellEls: HTMLElement[][];
  focusedCell(): { r: number; c: number } | null;
  pushCell(cellEl: HTMLElement): void;
}

// '=' autocomplete anchored to the editing cell: rows of formula names
// filtered by what the cell already starts with. Enter/click splices
// `=NAME(` into the cell text.
export class TableFx {
  private fx: { pop: ToolPopup; node: HTMLElement } | null = null;

  constructor(private host: FxHost) {}

  get isOpen() {
    return !!this.fx;
  }

  // Enter while editing accepts the top suggestion.
  accept() {
    this.fx?.node.querySelector<HTMLElement>('.pop-row')?.click();
  }

  open(cellEl: HTMLElement) {
    if (this.fx) {
      this.render(cellEl);
      return;
    }
    const node = document.createElement('div');
    node.className = 'menu-body';
    node.addEventListener('pointerdown', (e) => e.preventDefault());
    const pop = openToolPopup(cellEl.getBoundingClientRect(), node);
    this.fx = { pop, node };
    this.render(cellEl);
  }

  private render(cellEl: HTMLElement) {
    if (!this.fx) return;
    const m = /^=([A-Za-z]*)/.exec(cellEl.innerText.replace(/\n$/, ''));
    const filter = (m?.[1] ?? '').toUpperCase();
    const names = FORMULA_NAMES.filter((n) => n.startsWith(filter));
    if (!names.length) {
      this.close();
      return;
    }
    this.fx.node.textContent = '';
    for (const name of names) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'pop-row';
      const lab = document.createElement('span');
      lab.className = 'pop-label';
      lab.textContent = name;
      row.appendChild(lab);
      row.addEventListener('click', () => this.pick(name));
      this.fx.node.appendChild(row);
    }
  }

  private pick(name: string) {
    const f = this.host.focusedCell();
    const el = f ? this.host.cellEls[f.r]?.[f.c] : null;
    this.close();
    if (!el) return;
    el.textContent = `=${name}(`;
    this.host.pushCell(el);
    el.focus();
    const sel = getSelection()!;
    sel.selectAllChildren(el);
    sel.collapseToEnd();
  }

  close() {
    this.fx?.pop.close();
    this.fx = null;
  }
}
