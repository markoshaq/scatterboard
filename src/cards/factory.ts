import type { Doc, Element } from '../state/schema';
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
}

export function createCard(el: Element, ctx: CardCtx): CardView {
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
