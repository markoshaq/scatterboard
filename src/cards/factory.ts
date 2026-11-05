import type { Doc, Element, ID } from '../state/schema';
import { embedDoc } from '../state/schema';
import { t, type StringKey } from '../strings';
import { NoteCard, type CardEvents, type CardView } from './note';
import { ColumnCard } from './column';
import { BoardCard } from './board';
import { TodoCard } from './todo';
import { HeadingCard } from './heading';
import { SwatchCard } from './swatch';
import { CommentCard } from './comment';
import { LinkCard } from './link';
import { ImageCard } from './image';
import { FileCard } from './file';
import { DocumentCard } from './document';
import { SketchCard } from './sketch';
import { TableCard } from './table';

export interface CardCtx {
  doc: Doc;
  events: CardEvents;
  // Layer hooks so nested views (column members) join the layer's flat
  // view map; absent in standalone contexts.
  registerView?: (v: CardView) => void;
  unregisterView?: (v: CardView) => void;
  // BoardIndex-backed lookups: keep update() off the O(doc) scans.
  members?: (id: ID) => Element[];
  cardCount?: (boardId: ID) => number;
  // Viewport zoom, for counter-scale buckets that would otherwise need
  // a layout read inside update().
  zoom?: () => number;
  // Member views are built through the ctx (never a direct factory
  // import): keeps column -> factory from closing a module cycle.
  createCard(el: Element, ctx: CardCtx): CardView;
}

const CARD_TYPE_LABELS: Record<string, StringKey> = {
  note: 'railNote',
  todo: 'railTodo',
  heading: 'railHeading',
  table: 'railTable',
  column: 'railColumn',
  document: 'railDocument',
  sketch: 'railSketch',
  swatch: 'railColor',
  comment: 'railComment',
  board: 'railBoard',
  link: 'railLink',
  image: 'railImage',
  file: 'railFile',
};

// Screen-reader name for a card view: the localized card type, with
// embeds naming their provider kind. Exported for the keyboard-nav
// live announcement in App.stepCard.
export function cardAriaLabel(el: Element): string {
  if (el.type === 'embed') {
    const kind = embedDoc(el)?.kind;
    return t(kind === 'audio' ? 'railAudio' : kind === 'map' ? 'railMap' : 'railVideo');
  }
  const key = CARD_TYPE_LABELS[el.type];
  return key ? t(key) : el.type;
}

export function createCard(el: Element, ctx: CardCtx): CardView {
  const view = buildCard(el, ctx);
  // Tabbable by keyboard nav only (stepCard focuses it); pointer clicks
  // keep their own selection path and never show a focus ring.
  view.node.tabIndex = -1;
  view.node.setAttribute('role', 'group');
  view.node.setAttribute('aria-label', cardAriaLabel(el));
  return view;
}

function buildCard(el: Element, ctx: CardCtx): CardView {
  switch (el.type) {
    case 'note':
      return new NoteCard(el, ctx.events);
    case 'column':
      return new ColumnCard(el, ctx);
    case 'board':
      return new BoardCard(el, ctx);
    case 'todo':
      return new TodoCard(el, ctx);
    case 'heading':
      return new HeadingCard(el, ctx.events);
    case 'swatch':
      return new SwatchCard(el, ctx);
    case 'comment':
      return new CommentCard(el, ctx);
    case 'link':
    case 'embed':
      return new LinkCard(el, ctx);
    case 'image':
      return new ImageCard(el, ctx);
    case 'file':
      return new FileCard(el, ctx);
    case 'document':
      return new DocumentCard(el, ctx);
    case 'sketch':
      return new SketchCard(el, ctx);
    case 'table':
      return new TableCard(el, ctx);
    case 'line':
    case 'annotation':
      throw new Error(`${el.type} elements have no card view`);
  }
}
