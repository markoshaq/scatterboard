import type { Action, ElementPatch } from '../state/actions';
import type { Store } from '../state/store';
import { builtinTemplates, instantiateActions, snapshotTemplate } from '../state/templates';
import {
  createFile,
  createImage,
  createLine,
  embedDoc,
  lineDoc,
  linkDoc,
  migrateDoc,
  nextZ,
  survivingBoard,
  tableDoc,
  uid,
  type Doc,
  type Element,
  type ElementType,
  type ID,
  type PresentOpts,
} from '../state/schema';
import type { Viewport, Rect } from '../canvas/viewport';
import { resolveLine } from '../canvas/lines';
import { remapElements } from '../state/clone';
import { autoTitled } from '../app/editing';
import type { Prefs } from '../persist/storage';
import {
  fail,
  vBoardId,
  vBool,
  vBoolOpt,
  vElId,
  vElementPatch,
  vEnum,
  vId,
  vNoParentCycle,
  vNum,
  vNumOpt,
  vObj,
  vParentId,
  vStr,
  vStrOpt,
  type Dict,
} from './validate';
import { buildElement, mergeContent } from './build';
import { checkNoOverwrite, checkParentCycles, ELEMENT_TYPES, scrubMove, vAction } from './vaction';

// The slice of App the command surface needs; tests stub it, App
// satisfies it structurally.
export interface AgentHost {
  store: Store;
  prefs: Prefs;
  vp: Viewport;
  boardId: ID | null;
  agentConnected: boolean;
  doc: Doc;
  lockedView(): boolean;
  openBoard(id: ID): void;
  sel: ReadonlySet<ID>;
  setSelection(ids: Iterable<ID>): void;
  deleteSelection(): void;
  stampBoardColor(el: Element): void;
  scheduleSave(): void;
  editing: { endEdit(): void };
  layer: { rectOf(el: Element): Rect };
  panels: { deleteBoardCascade(id: ID): void };
  applyPrefs(): void;
  exporter: {
    snapshotPng(boardId?: ID, region?: Rect, scale?: number): Promise<Blob | null>;
    boardRaster(scale: number, region?: Rect): Promise<HTMLCanvasElement | null>;
    mediaZip(boardId: ID): Promise<Blob | null>;
  };
  blobStore: { put(id: ID, blob: Blob): Promise<void> };
  flush(): Promise<void>;
  presenting: boolean;
  enterPresent(): void;
  exitPresent(): void;
  setPresentOpts(o: PresentOpts): void;
}

export interface AgentCommand {
  method: string;
  params?: unknown;
}

// [{method, params}] | {name, args} | [method, params] tuple.
export function parseCommand(raw: unknown): AgentCommand {
  if (Array.isArray(raw) && typeof raw[0] === 'string') {
    return raw.length > 1 ? { method: raw[0], params: raw[1] } : { method: raw[0] };
  }
  const o = vObj(raw, 'command');
  const m = o.method ?? o.name;
  return { method: vStr(m, 'command.method', 64), params: o.params ?? o.args };
}

// Commands that change the doc; reads, navigation and present are
// exempt from the presenting lock.
const MUTATING = new Set([
  'create',
  'patch',
  'remove',
  'connect',
  'undo',
  'redo',
  'batch',
  'dispatch',
  'restore',
  'emptyTrash',
  'instantiate',
  'saveTemplate',
  'upload',
  'import',
  'unfurl',
  'duplicate',
  'removeBoard',
  'saveSnapshot',
  'deleteSnapshot',
  'restoreSnapshot',
]);

// Commands a ?do= link may run without asking: reads, selection,
// navigation and exports. Everything else confirms first.
export const URL_SAFE = new Set([
  'boards',
  'openBoard',
  'state',
  'labels',
  'search',
  'elements',
  'get',
  'trash',
  'select',
  'view',
  'snapshot',
  'export',
  'templates',
  'snapshots',
]);

const EXPORT_FORMATS = new Set(['png', 'pdf', 'md', 'txt', 'doc', 'json', 'zip', 'csv']);
const PRESENT_KEYS = new Set(['on', 'focus', 'comments', 'edit']);

// Prefs an agent may set: doc-adjacent behaviour flags and formatting,
// never identity/session state (agent, agentBridge) or bookkeeping
// (commentSeen, recentBoards, helpers). lang is excluded: applying it
// reloads the tab and kills the session.
const PREF_BOOLS = new Set([
  'reminders',
  'unfurl',
  'noOverlap',
  'ink',
  'undoArrows',
  'autoEdit',
  'spellcheck',
  'minimap',
  'browserLang',
  'welcomed',
]);
const PREF_ENUMS: Record<string, Set<string>> = {
  theme: new Set(['light', 'dark']),
  unsortedSort: new Set(['added', 'oldest', 'modified', 'alpha', 'type']),
  currency: new Set(['USD', 'EUR', 'GBP', 'JPY']),
};
const PREF_NUMS: Record<string, [number, number]> = { uiScale: [0.5, 2], guideAlpha: [0, 1] };

// Per-type friendly content prop names accepted by create/patch.
const TYPE_PROPS: Record<string, Set<string>> = {
  note: new Set(['text', 'html']),
  heading: new Set(['text', 'html', 'level']),
  todo: new Set(['title', 'items', 'showTitle']),
  column: new Set(['title']),
  board: new Set(['ref', 'title']),
  swatch: new Set(['value', 'caption', 'showValue']),
  line: new Set(['from', 'to', 'label', 'dashed', 'weight', 'route', 'fromMarker', 'toMarker']),
  comment: new Set(['text', 'items', 'add', 'anchor', 'anchorId']),
  link: new Set(['url', 'title', 'caption', 'showPreview', 'desc', 'image']),
  embed: new Set(['kind', 'url', 'title', 'caption', 'showPreview']),
  image: new Set(['caption', 'alt', 'strokes']),
  file: new Set([]),
  document: new Set(['title', 'text', 'html', 'caption', 'displayMode']),
  sketch: new Set(['strokes']),
  annotation: new Set(['strokes']),
  table: new Set(['title', 'caption', 'cells', 'widths']),
};

const COMMON_PROPS = new Set(['x', 'y', 'w', 'color', 'parentId', 'boardId', 'labels', 'reactions']);
const PATCH_TOP = new Set([
  'x', 'y', 'w', 'z', 'locked', 'color', 'anchorId', 'boardId', 'parentId', 'labels', 'reactions', 'syncGroup',
]);

// Upload payloads arrive as raw base64 or a base64 data URL. Anything
// else fails loudly rather than producing a corrupt blob.
function b64ToBlob(s: string, mime?: string): Blob {
  const m = /^data:([^;,]*);base64,(.*)$/s.exec(s);
  const type = m?.[1] || mime || 'application/octet-stream';
  const b64 = (m ? m[2]! : s).replace(/\s/g, '');
  if (!b64 || !/^[A-Za-z0-9+/]*={0,2}$/.test(b64)) fail('bad_field', 'data must be base64 or a base64 data URL');
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${blob.type || 'image/png'};base64,${btoa(bin)}`;
}

type Runner = () => unknown | Promise<unknown>;

export function createAgentApi(app: AgentHost) {
  const doc = () => app.doc;

  // Agent dispatches carry the 'agent' tag so the batch's store group
  // never absorbs a user edit that lands while an async runner awaits:
  // foreign work becomes its own undo entry instead.
  const dispatch = (a: Action) => {
    app.store.dispatch(a, 'agent');
  };

  // A cross-board move cannot be expressed by the patch alone: column
  // members follow their column, and line ends anchored to the moved
  // card freeze at their last resolved point on the old board.
  const moveExtras = (el: Element, newBoard: ID): Action[] => {
    const out: Action[] = [];
    const d = doc();
    if (el.type === 'column') {
      for (const m of Object.values(d.elements)) {
        if (m.parentId !== el.id) continue;
        const mp: ElementPatch = { boardId: newBoard, parentId: el.id };
        scrubMove(m, mp, d);
        out.push({ type: 'element.patch', id: m.id, patch: mp });
      }
    }
    for (const le of Object.values(d.elements)) {
      if (le.type !== 'line' || le.boardId !== el.boardId) continue;
      const c = lineDoc(le);
      if (!c || (c.from.el !== el.id && c.to.el !== el.id)) continue;
      const rl = resolveLine(le, d, (t) => app.layer.rectOf(t));
      const line = { ...c };
      if (c.from.el === el.id) line.from = { x: Math.round(rl?.x1 ?? c.from.x), y: Math.round(rl?.y1 ?? c.from.y) };
      if (c.to.el === el.id) line.to = { x: Math.round(rl?.x2 ?? c.to.x), y: Math.round(rl?.y2 ?? c.to.y) };
      out.push({ type: 'element.patch', id: le.id, patch: { content: { line } } });
    }
    return out;
  };

  // Raw-action fixups the action itself cannot express: expanding here
  // keeps the dispatch command and the friendly patch path aligned.
  const expandAction = (a: Action): Action => {
    if (a.type === 'element.patch') {
      const el = doc().elements[a.id];
      const nb = a.patch.boardId;
      if (!el || nb === undefined || nb === el.boardId) return a;
      const extras = moveExtras(el, nb);
      return extras.length ? { type: 'batch', actions: [a, ...extras] } : a;
    }
    if (a.type === 'label.delete') {
      // Elements keep no dead label refs, same as deleteLabel in tools.
      const lid = a.label.id;
      const extras = Object.values(doc().elements)
        .filter((e) => e.labels.includes(lid))
        .map((e): Action => ({ type: 'element.patch', id: e.id, patch: { labels: e.labels.filter((l) => l !== lid) } }));
      return extras.length ? { type: 'batch', actions: [a, ...extras] } : a;
    }
    if (a.type === 'batch') {
      return { type: 'batch', actions: a.actions.map(expandAction) };
    }
    return a;
  };

  const guard = () => {
    if (app.lockedView()) fail('locked', 'board is read-only while presenting');
  };

  const requireBoard = (): ID => {
    const bid = app.boardId;
    if (!bid || !doc().boards[bid]) fail('no_board', 'no board is open');
    return bid;
  };

  const elView = (el: Element): Dict => {
    const v: Dict = { ...el };
    if (el.boardId === app.boardId) v.rect = app.layer.rectOf(el);
    return v;
  };

  function checkKeys(o: Dict, allowed: Set<string>) {
    for (const k of Object.keys(o)) {
      if (!allowed.has(k)) fail('bad_field', `unknown field ${k}`);
    }
  }

  function checkProps(type: ElementType, p: Dict, extra: Set<string>) {
    checkKeys(p, new Set([...extra, ...(TYPE_PROPS[type] ?? [])]));
  }

  // >0 while a planned batch's own store group is open: nested batches
  // join it by running flat. A group opened by anyone else (a user
  // drag or edit session) is never joined.
  let agentDepth = 0;

  async function runPlanned(planned: Runner[]): Promise<unknown[]> {
    // Inside an outer agent batch the parent owns rollback.
    if (agentDepth > 0) {
      const flat: unknown[] = [];
      for (const r of planned) flat.push(await r());
      return flat;
    }
    guard();
    // An open edit session holds a store group; closing it first keeps
    // this batch a single undo entry and the abort undo-able. A group
    // that still survives (an in-flight user gesture) is refused
    // rather than joined: commands would merge into the user's undo
    // entry and an abort would undo their half-finished work.
    app.editing.endEdit();
    if (app.store.inGroup) fail('busy', 'a board gesture is in progress');
    app.store.beginGroup('agent');
    agentDepth++;
    try {
      const out: unknown[] = [];
      for (const r of planned) out.push(await r());
      app.store.endGroup('agent');
      return out;
    } catch (e) {
      // Only roll back when the group actually landed a history entry:
      // undoing a leaf-free group would pop the user's previous action.
      if (app.store.endGroup()) {
        app.store.undo();
        // The undo queues the partial batch as redo; it must not replay.
        app.store.clearFuture();
      }
      throw e;
    } finally {
      agentDepth--;
    }
  }

  function plan(method: string, params: unknown): Runner {
    switch (method) {
      case 'boards':
        return () =>
          Object.values(doc().boards).map((b) => ({
            id: b.id,
            title: b.title,
            parentId: b.parentId,
            icon: b.icon,
            color: b.color,
            grid: b.grid,
            position: b.position,
            presentOpts: b.presentOpts,
          }));
      case 'openBoard': {
        if (params !== null && typeof params === 'object') checkKeys(vObj(params, 'params'), new Set(['id']));
        const id = vBoardId(doc(), params !== null && typeof params === 'object' ? vObj(params, 'params').id : params);
        return () => {
          app.openBoard(id);
          return { ok: true };
        };
      }
      case 'state':
        return () => {
          const vp = app.vp;
          return {
            boardId: app.boardId,
            selection: [...app.sel],
            view: { x: (vp.vw / 2 - vp.x) / vp.z, y: (vp.vh / 2 - vp.y) / vp.z, z: vp.z },
            presenting: app.presenting,
            locked: app.lockedView(),
            connected: app.agentConnected,
          };
        };
      case 'labels': {
        const o = params === undefined ? {} : vObj(params, 'params');
        checkKeys(o, new Set(['boardId']));
        const bid = o.boardId === undefined ? null : vBoardId(doc(), o.boardId);
        return () =>
          Object.values(doc().labels)
            .filter((l) => bid === null || l.boardId === bid)
            .map((l) => ({ ...l }));
      }
      case 'search': {
        const o = vObj(params, 'params');
        checkKeys(o, new Set(['query', 'boardId', 'all']));
        const q = vStr(o.query, 'query', 2048);
        const all = vBoolOpt(o.all, 'all') ?? false;
        const bid = o.boardId === undefined ? null : vBoardId(doc(), o.boardId);
        return async () => {
          const { searchBoard } = await import('../ui/search');
          const boards = all ? Object.keys(doc().boards) : [bid ?? requireBoard()];
          return boards.flatMap((b) => searchBoard(doc(), b, q));
        };
      }
      case 'elements': {
        const o = params === undefined ? {} : vObj(params, 'params');
        checkKeys(o, new Set(['boardId']));
        const bid = o.boardId === undefined ? requireBoard() : vBoardId(doc(), o.boardId);
        return () => Object.values(doc().elements).filter((e) => e.boardId === bid).map(elView);
      }
      case 'get': {
        const o = vObj(params, 'params');
        checkKeys(o, new Set(['id']));
        const id = vId(o.id, 'id');
        return () => {
          const el = doc().elements[id];
          return el ? elView(el) : null;
        };
      }
      case 'create': {
        guard();
        const o = vObj(params, 'params');
        const type = vStr(o.type, 'type', 32) as ElementType;
        if (!ELEMENT_TYPES.has(type)) fail('bad_type', `unknown card type ${type}`);
        const p: Dict = o.props === undefined ? { ...o } : { ...vObj(o.props, 'props') };
        delete p.type;
        checkProps(type, p, COMMON_PROPS);
        const built = buildElement({ app, requireBoard }, type, p);
        return () => {
          guard();
          dispatch(built.action);
          return { id: built.id };
        };
      }
      case 'patch': {
        guard();
        const o = vObj(params, 'params');
        const id = vId(o.id, 'id');
        const el = doc().elements[id];
        if (!el) fail('not_found', `no element ${id}`);
        const raw = o.patch === undefined ? { ...o } : { ...vObj(o.patch, 'patch') };
        delete raw.id;
        const contentKeys = TYPE_PROPS[el.type] ?? new Set<string>();
        const topRaw: Dict = {};
        const contentProps: Dict = {};
        const d = doc();
        // parentId and labels must resolve against the board the
        // element ends up on, which a same-patch boardId can move.
        const targetBoard = raw.boardId === undefined ? el.boardId : vBoardId(d, raw.boardId);
        for (const [k, v] of Object.entries(raw)) {
          if (PATCH_TOP.has(k)) topRaw[k] = v;
          else if (contentKeys.has(k)) contentProps[k] = v;
          else fail('bad_field', `unknown field ${k}`);
        }
        const top = vElementPatch(d, el, topRaw, targetBoard, id);
        if (Object.keys(contentProps).length) mergeContent(d, el, contentProps);
        return () => {
          guard();
          const cur = doc().elements[id];
          if (!cur) fail('not_found', `no element ${id}`);
          const patch: ElementPatch = { ...top };
          // Re-check against the live doc: a sibling command earlier in
          // the batch may have reparented into a cycle since plan time.
          if (patch.parentId !== undefined && patch.parentId !== null) {
            vNoParentCycle(doc(), id, patch.parentId);
          }
          const extra: Action[] = [];
          if (Object.keys(contentProps).length) {
            const m = mergeContent(doc(), cur, contentProps);
            patch.content = m.content;
            if (m.top) Object.assign(patch, m.top);
            if (m.extra) extra.push(...m.extra);
          }
          scrubMove(cur, patch, doc());
          if (patch.boardId !== undefined && patch.boardId !== cur.boardId) {
            extra.push(...moveExtras(cur, patch.boardId));
          }
          const actions: Action[] = [{ type: 'element.patch', id, patch }, ...extra];
          dispatch(actions.length > 1 ? { type: 'batch', actions } : actions[0]!);
          return { ok: true };
        };
      }
      case 'remove': {
        guard();
        const id = vId(vObj(params, 'params').id, 'id');
        if (!doc().elements[id]) fail('not_found', `no element ${id}`);
        return () => {
          guard();
          if (!doc().elements[id]) fail('not_found', `no element ${id}`);
          app.setSelection([id]);
          app.deleteSelection();
          return { ok: true };
        };
      }
      case 'connect': {
        guard();
        const o = vObj(params, 'params');
        const from = vElId(doc(), o.from, 'from');
        const to = vElId(doc(), o.to, 'to');
        const fa = doc().elements[from]!;
        const ta = doc().elements[to]!;
        // Same endpoint rules as vLineEnd on the create path: lines,
        // annotations and comments can never anchor a line end.
        const badEnd = (e: Element) => e.type === 'line' || e.type === 'annotation' || e.type === 'comment';
        if (from === to) fail('bad_field', 'line endpoints must differ');
        if (badEnd(fa) || badEnd(ta)) fail('bad_field', 'an endpoint cannot be a line, annotation or comment');
        if (fa.boardId !== ta.boardId) fail('bad_field', 'endpoints are on different boards');
        const opts: Dict = {};
        for (const k of Object.keys(o)) {
          if (k === 'label' || k === 'dashed' || k === 'weight' || k === 'route' || k === 'fromMarker' || k === 'toMarker') opts[k] = o[k];
          else if (k !== 'from' && k !== 'to') fail('bad_field', `unknown field ${k}`);
        }
        return () => {
          guard();
          const a = doc().elements[from];
          const b = doc().elements[to];
          if (!a || !b) fail('not_found', 'endpoint element is gone');
          if (badEnd(a) || badEnd(b)) fail('bad_field', 'an endpoint cannot be a line, annotation or comment');
          if (a.boardId !== b.boardId) fail('bad_field', 'endpoints are on different boards');
          const ra = app.layer.rectOf(a);
          const rb = app.layer.rectOf(b);
          const el = createLine(
            doc(),
            a.boardId,
            { el: from, x: Math.round(ra.x + ra.w), y: Math.round(ra.y + ra.h / 2) },
            { el: to, x: Math.round(rb.x), y: Math.round(rb.y + rb.h / 2) },
          );
          el.content = mergeContent(doc(), el, opts).content;
          dispatch({ type: 'element.create', el });
          return { id: el.id };
        };
      }
      case 'removeBoard': {
        guard();
        const o = vObj(params, 'params');
        checkKeys(o, new Set(['id']));
        const id = vBoardId(doc(), o.id);
        return () => {
          guard();
          if (!doc().boards[id]) fail('not_found', `no board ${id}`);
          app.panels.deleteBoardCascade(id);
          return { ok: true };
        };
      }
      case 'trash':
        return () =>
          Object.entries(doc().trash).map(([id, e]) => ({ id, deletedAt: e.deletedAt, el: e.el }));
      case 'restore': {
        guard();
        const o = vObj(params, 'params');
        checkKeys(o, new Set(['id', 'boardId', 'x', 'y']));
        const id = vId(o.id, 'id');
        if (!doc().trash[id]) fail('not_found', `no trash entry ${id}`);
        const boardId =
          o.boardId === undefined ? (app.boardId ?? doc().trash[id]!.el.boardId) : vBoardId(doc(), o.boardId);
        if (!doc().boards[boardId]) fail('not_found', `no board ${boardId}`);
        const x = vNumOpt(o.x, 'x');
        const y = vNumOpt(o.y, 'y');
        return () => {
          guard();
          const entry = doc().trash[id];
          if (!entry) fail('not_found', `no trash entry ${id}`);
          if (!doc().boards[boardId]) fail('not_found', `no board ${boardId}`);
          // Same fixups as the trash panel's drop-restore: dead or
          // foreign-board anchors/labels/syncGroups would hide the card.
          const el: Element = {
            ...entry.el,
            boardId,
            parentId: null,
            x: Math.round(x ?? entry.el.x),
            y: Math.round(y ?? entry.el.y),
            z: nextZ(doc()),
          };
          if (el.anchorId !== undefined && doc().elements[el.anchorId]?.boardId !== boardId) {
            delete el.anchorId;
          }
          el.labels = el.labels.filter((l) => doc().labels[l]?.boardId === boardId);
          if (boardId !== entry.el.boardId) delete el.syncGroup;
          app.stampBoardColor(el);
          dispatch({ type: 'batch', actions: [{ type: 'element.create', el }, { type: 'trash.remove', id }] });
          app.setSelection([el.id]);
          return { id: el.id };
        };
      }
      case 'emptyTrash': {
        guard();
        return () => {
          guard();
          const ids = Object.keys(doc().trash);
          if (ids.length) {
            dispatch({ type: 'batch', actions: ids.map((id) => ({ type: 'trash.remove' as const, id })) });
          }
          return { removed: ids.length };
        };
      }
      case 'select': {
        const arr = Array.isArray(params) ? params : vObj(params ?? {}, 'params').ids;
        if (!Array.isArray(arr)) fail('bad_params', 'ids must be an array');
        const ids = arr.map((i) => vElId(doc(), i, 'ids[]'));
        return () => {
          app.setSelection(ids);
          return { selected: ids.length };
        };
      }
      case 'view': {
        const o = params === undefined ? {} : vObj(params, 'params');
        checkKeys(o, new Set(['x', 'y', 'z']));
        const x = vNumOpt(o.x, 'x');
        const y = vNumOpt(o.y, 'y');
        const z = vNumOpt(o.z, 'z');
        return () => {
          const vp = app.vp;
          const zz = z === undefined ? vp.z : Math.min(4, Math.max(0.1, z));
          // x/y are the board point to center on; missing keeps the
          // current center.
          const cx = x ?? (vp.vw / 2 - vp.x) / vp.z;
          const cy = y ?? (vp.vh / 2 - vp.y) / vp.z;
          // snapTo cancels a running zoom tween; direct writes would
          // be overwritten each frame until it settles.
          vp.snapTo({ x: vp.vw / 2 - cx * zz, y: vp.vh / 2 - cy * zz, z: zz });
          return {
            x: (vp.vw / 2 - vp.x) / vp.z,
            y: (vp.vh / 2 - vp.y) / vp.z,
            z: vp.z,
          };
        };
      }
      case 'present': {
        // Not mutating on purpose: a prevent-editing lock would
        // otherwise block the agent from leaving presentation mode.
        const o = params === undefined ? {} : vObj(params, 'params');
        checkKeys(o, PRESENT_KEYS);
        const on = vBoolOpt(o.on, 'on');
        const opts: PresentOpts = {};
        if (o.focus !== undefined) opts.focus = vBool(o.focus, 'focus');
        if (o.comments !== undefined) opts.comments = vBool(o.comments, 'comments');
        if (o.edit !== undefined) opts.edit = vBool(o.edit, 'edit');
        return () => {
          if (Object.keys(opts).length) app.setPresentOpts(opts);
          if (on === true) app.enterPresent();
          else if (on === false) app.exitPresent();
          const board = app.boardId ? doc().boards[app.boardId] : undefined;
          return { presenting: app.presenting, presentOpts: board?.presentOpts ?? {} };
        };
      }
      case 'prefs': {
        const o = params === undefined ? {} : vObj(params, 'params');
        checkKeys(o, new Set(['set']));
        const set = o.set === undefined ? null : vObj(o.set, 'set');
        if (!set) return () => ({ ...app.prefs });
        const writes: [string, unknown][] = [];
        for (const [k, v] of Object.entries(set)) {
          if (PREF_BOOLS.has(k)) writes.push([k, vBool(v, `prefs.${k}`)]);
          else if (PREF_ENUMS[k]) writes.push([k, vEnum(v, `prefs.${k}`, PREF_ENUMS[k]!)]);
          else if (PREF_NUMS[k]) {
            const [lo, hi] = PREF_NUMS[k]!;
            writes.push([k, Math.min(hi, Math.max(lo, vNum(v, `prefs.${k}`)))]);
          } else fail('bad_field', `unknown pref ${k}`);
        }
        return () => {
          guard();
          for (const [k, v] of writes) (app.prefs as Dict)[k] = v;
          app.scheduleSave();
          app.applyPrefs();
          return { ok: true };
        };
      }
      case 'snapshots': {
        const o = params === undefined ? {} : vObj(params, 'params');
        checkKeys(o, new Set(['id']));
        const id = o.id === undefined ? null : vId(o.id, 'id');
        return async () => {
          const { listSnapshots, readSnapshot } = await import('../persist/snapshots');
          if (id === null) return listSnapshots();
          const w = await readSnapshot(id).catch(() => null);
          if (!w) fail('not_found', `no snapshot ${id}`);
          const sd = migrateDoc(w.doc);
          // Browse view: enough to pick a board for restoreSnapshot.
          return {
            boards: Object.values(sd.boards).map((b) => ({ id: b.id, title: b.title, parentId: b.parentId })),
            elements: Object.values(sd.elements).map((e) => ({
              id: e.id,
              type: e.type,
              boardId: e.boardId,
              parentId: e.parentId,
            })),
          };
        };
      }
      case 'saveSnapshot': {
        guard();
        const o = params === undefined ? {} : vObj(params, 'params');
        checkKeys(o, new Set(['name']));
        const name = vStrOpt(o.name, 'name', 256);
        return async () => {
          guard();
          const { createSnapshot } = await import('../persist/snapshots');
          const { fmtDate } = await import('../locale');
          const meta = await createSnapshot(doc(), app.prefs, name ?? fmtDate(Date.now()), false);
          return { id: meta.id, name: meta.name, createdAt: meta.createdAt };
        };
      }
      case 'deleteSnapshot': {
        guard();
        const o = vObj(params, 'params');
        checkKeys(o, new Set(['id']));
        const id = vId(o.id, 'id');
        return async () => {
          guard();
          const { deleteSnapshot } = await import('../persist/snapshots');
          await deleteSnapshot(id);
          return { ok: true };
        };
      }
      case 'restoreSnapshot': {
        guard();
        const o = vObj(params, 'params');
        checkKeys(o, new Set(['id', 'boardId', 'hostId']));
        const id = vId(o.id, 'id');
        const snapBoard = vStrOpt(o.boardId, 'boardId');
        const hostId = o.hostId === undefined ? undefined : vBoardId(doc(), o.hostId);
        return async () => {
          guard();
          const { readSnapshot } = await import('../persist/snapshots');
          const w = await readSnapshot(id).catch(() => null);
          if (!w) fail('not_found', `no snapshot ${id}`);
          const sd = migrateDoc(w.doc);
          const rootId = snapBoard ?? survivingBoard(sd) ?? '';
          if (!sd.boards[rootId]) fail('not_found', `no board ${rootId} in snapshot`);
          const host = hostId ?? survivingBoard(doc(), undefined, app.boardId);
          if (!host) fail('not_found', 'no host board to attach to');
          // Browse-style restore: the snapshot board lands as a new
          // sub-board (undoable), never a whole-workspace replace.
          const { restoreSnapshotBoardActions } = await import('../ui/snapbrowse');
          const res = restoreSnapshotBoardActions(doc(), sd, rootId, host);
          if (!res) fail('restore', 'snapshot restore failed');
          dispatch({ type: 'batch', actions: res.actions });
          app.openBoard(res.boardId);
          return { boardId: res.boardId };
        };
      }
      case 'undo':
        guard();
        return () => {
          guard();
          app.store.undo();
          return { ok: true };
        };
      case 'redo':
        guard();
        return () => {
          guard();
          app.store.redo();
          return { ok: true };
        };
      case 'duplicate': {
        guard();
        const o = vObj(params, 'params');
        checkKeys(o, new Set(['ids', 'dx', 'dy']));
        if (!Array.isArray(o.ids)) fail('bad_params', 'ids must be an array');
        const ids = o.ids.map((i) => vElId(doc(), i, 'ids[]'));
        const dx = vNumOpt(o.dx, 'dx') ?? 24;
        const dy = vNumOpt(o.dy, 'dy') ?? 24;
        return () => {
          guard();
          // Collect column members like cloneForDrag: a duplicated
          // column carries its cards along.
          const src = new Map<ID, Element>();
          for (const id of ids) {
            const el = doc().elements[id];
            if (!el) continue;
            src.set(id, el);
            if (el.type === 'column') {
              for (const m of Object.values(doc().elements)) {
                if (m.parentId === el.id) src.set(m.id, m);
              }
            }
          }
          if (!src.size) fail('not_found', 'no elements left to duplicate');
          // Members cloned without their column land on the canvas at
          // their rendered spot, not their stored column-space coords.
          const els = [...src.values()].map((e) => {
            if (e.parentId === null || src.has(e.parentId)) return e;
            const r = app.layer.rectOf(e);
            return { ...e, x: Math.round(r.x), y: Math.round(r.y) };
          });
          const rectOf = (t: Element) => app.layer.rectOf(t);
          const { clones } = remapElements(doc(), els, (e) => e.boardId, dx, dy, {
            resolveEnd: (e, which) => {
              const l = resolveLine(e, doc(), rectOf);
              if (!l) return null;
              return which === 'from' ? { x: l.x1, y: l.y1 } : { x: l.x2, y: l.y2 };
            },
          });
          dispatch({ type: 'batch', actions: clones.map((el) => ({ type: 'element.create' as const, el })) });
          const top = clones.filter((c) => c.parentId === null);
          app.setSelection((top.length ? top : clones).map((c) => c.id));
          return { ids: clones.map((c) => c.id) };
        };
      }
      case 'snapshot': {
        const o = params === undefined ? {} : vObj(params, 'params');
        checkKeys(o, new Set(['boardId', 'x', 'y', 'w', 'h', 'scale']));
        const bid = o.boardId === undefined ? requireBoard() : vBoardId(doc(), o.boardId);
        const region =
          o.x !== undefined || o.y !== undefined || o.w !== undefined || o.h !== undefined
            ? { x: vNum(o.x, 'x'), y: vNum(o.y, 'y'), w: vNum(o.w, 'w'), h: vNum(o.h, 'h') }
            : undefined;
        if (region && (region.w <= 0 || region.h <= 0)) fail('bad_field', 'region w/h must be positive');
        const scale = Math.min(4, Math.max(0.1, vNumOpt(o.scale, 'scale') ?? 2));
        // Canvas caps around 32k px per side; refuse early rather than
        // crash the tab allocating a huge raster.
        if (region && Math.max(region.w, region.h) * scale > 16384) {
          fail('too_large', 'region exceeds the canvas limit');
        }
        return async () => {
          const blob = await app.exporter.snapshotPng(bid, region, scale);
          if (!blob) fail('snapshot', 'board snapshot failed');
          return { dataUrl: await blobToDataUrl(blob) };
        };
      }
      case 'templates':
        return () => [
          ...builtinTemplates().map((t) => ({ id: t.id, name: t.name, builtin: true, elements: t.elements.length })),
          ...Object.values(doc().templates).map((t) => ({
            id: t.id,
            name: t.name,
            builtin: false,
            elements: t.elements.length,
          })),
        ];
      case 'instantiate': {
        guard();
        const o = vObj(params, 'params');
        checkKeys(o, new Set(['id', 'boardId', 'x', 'y']));
        const id = vId(o.id, 'id');
        const tpl = builtinTemplates().find((t) => t.id === id) ?? doc().templates[id];
        if (!tpl) fail('not_found', `no template ${id}`);
        const hostId =
          o.boardId === undefined ? app.boardId : o.boardId === null ? null : vBoardId(doc(), o.boardId);
        const center = app.vp.toBoard(app.vp.vw / 2, app.vp.vh / 2);
        const at = { x: vNumOpt(o.x, 'x') ?? center.x, y: vNumOpt(o.y, 'y') ?? center.y };
        return () => {
          guard();
          const { actions, boardId, cardId } = instantiateActions(doc(), tpl, hostId, at);
          dispatch({ type: 'batch', actions });
          if (hostId === null) app.openBoard(boardId);
          return { boardId, cardId };
        };
      }
      case 'saveTemplate': {
        guard();
        const o = params === undefined ? {} : vObj(params, 'params');
        checkKeys(o, new Set(['boardId', 'name']));
        const bid = o.boardId === undefined ? requireBoard() : vBoardId(doc(), o.boardId);
        const name = vStrOpt(o.name, 'name', 256) ?? '';
        return () => {
          guard();
          const tpl = snapshotTemplate(doc(), bid, name);
          if (!tpl) fail('no_board', 'no such board');
          dispatch({ type: 'template.create', tpl });
          return { id: tpl.id, name: tpl.name };
        };
      }
      case 'upload': {
        guard();
        const o = vObj(params, 'params');
        checkKeys(o, new Set(['data', 'name', 'mime', 'boardId', 'parentId', 'x', 'y', 'caption']));
        const data = vStr(o.data, 'data', 48 * 1024 * 1024);
        const name = vStrOpt(o.name, 'name', 512);
        const mime = vStrOpt(o.mime, 'mime', 128);
        const boardId = o.boardId === undefined ? requireBoard() : vBoardId(doc(), o.boardId);
        const parentId = o.parentId === undefined ? null : vParentId(doc(), o.parentId, boardId);
        const center = app.vp.toBoard(app.vp.vw / 2, app.vp.vh / 2);
        const x = Math.round(vNumOpt(o.x, 'x') ?? center.x);
        const y = Math.round(vNumOpt(o.y, 'y') ?? center.y);
        const caption = vStrOpt(o.caption, 'caption');
        return async () => {
          guard();
          const blob = b64ToBlob(data, mime);
          let el: Element | null = null;
          if (blob.type.startsWith('image/')) {
            try {
              const { prepareImage } = await import('../ingest/files');
              const { blob: baked, aspect, natW, natH } = await prepareImage(blob);
              const ref = uid();
              await app.blobStore.put(ref, baked);
              el = createImage(doc(), boardId, x, y, ref, name ?? 'image', aspect, natW, natH);
            } catch {
              el = null; // undecodable image falls back to a file card
            }
          }
          if (!el) {
            const ref = uid();
            // File-card blobs only ever download, but a stored html/svg
            // payload is a script vector the day anything previews it
            // inline: keep the bytes, drop the script-capable type.
            const ft = blob.type.toLowerCase();
            const safe =
              ft === 'text/html' || ft === 'image/svg+xml' || ft === 'application/xhtml+xml'
                ? new Blob([blob], { type: 'application/octet-stream' })
                : blob;
            try {
              await app.blobStore.put(ref, safe);
            } catch {
              fail('blob', 'blob store rejected the upload');
            }
            el = createFile(doc(), boardId, x, y, ref, name ?? 'file', safe.size, safe.type);
          }
          // The async blob work may have outlasted the target: the
          // board could be gone and the parent may have left it.
          if (!doc().boards[boardId]) fail('not_found', `no board ${boardId}`);
          el.parentId =
            parentId !== null && doc().elements[parentId]?.boardId === boardId ? parentId : null;
          app.stampBoardColor(el);
          if (caption !== undefined) el.content = mergeContent(doc(), el, { caption }).content;
          dispatch({ type: 'element.create', el });
          app.setSelection([el.id]);
          return { id: el.id, type: el.type };
        };
      }
      case 'export': {
        const o = params === undefined ? {} : vObj(params, 'params');
        checkKeys(o, new Set(['format', 'boardId', 'subs', 'hi', 'id']));
        const format = vEnum(o.format, 'format', EXPORT_FORMATS);
        if (format !== 'csv' && o.id !== undefined) fail('bad_field', 'id only applies to csv');
        const bid = o.boardId === undefined ? requireBoard() : vBoardId(doc(), o.boardId);
        const subs = vBoolOpt(o.subs, 'subs') ?? false;
        const hi = vBoolOpt(o.hi, 'hi') ?? false;
        return async () => {
          const { slugFileName } = await import('../export/download');
          const base = slugFileName(doc().boards[bid]?.title ?? 'board');
          if (format === 'png') {
            const blob = await app.exporter.snapshotPng(bid);
            if (!blob) fail('export', 'png export failed');
            return { name: `${base}.png`, mime: 'image/png', dataUrl: await blobToDataUrl(blob) };
          }
          if (format === 'pdf') {
            const scale = hi ? 2 : 1;
            const prev = app.boardId;
            if (bid !== prev) app.openBoard(bid);
            try {
              const cv = await app.exporter.boardRaster(scale);
              const { toBlob } = await import('../export/boardpng');
              const blob = cv && (await toBlob(cv, 'image/jpeg', hi ? 0.95 : 0.8));
              if (!cv || !blob) fail('export', 'pdf export failed');
              const jpeg = new Uint8Array(await blob.arrayBuffer());
              const { jpegToPdf } = await import('../export/pdf');
              const pdf = jpegToPdf(jpeg, cv.width, cv.height, (cv.width / scale) * 0.75, (cv.height / scale) * 0.75);
              return { name: `${base}.pdf`, mime: 'application/pdf', dataUrl: await blobToDataUrl(pdf) };
            } finally {
              // The raster needed the target board open; leave the user
              // on the board they were actually looking at. A board the
              // agent opened since is left alone.
              if (prev && prev !== bid && doc().boards[prev] && app.boardId === bid) app.openBoard(prev);
            }
          }
          if (format === 'md' || format === 'txt' || format === 'doc') {
            const { boardItems, toMarkdown, toPlain, toWordHtml } = await import('../export/linear');
            const title = doc().boards[bid]?.title ?? '';
            const items = boardItems(doc(), bid, subs);
            const text = format === 'md' ? toMarkdown(title, items) : format === 'txt' ? toPlain(title, items) : toWordHtml(title, items);
            const ext = format === 'doc' ? 'doc' : format;
            const mime = format === 'md' ? 'text/markdown' : format === 'txt' ? 'text/plain' : 'application/msword';
            return { name: `${base}.${ext}`, mime, text };
          }
          if (format === 'csv') {
            if (o.id === undefined) fail('bad_params', 'csv export needs a table element id');
            const el = doc().elements[vElId(doc(), o.id, 'id')];
            const td = el ? tableDoc(el) : null;
            if (!td) fail('bad_field', 'csv export needs a table element');
            const { serializeCsv } = await import('../cards/table/csv');
            return { name: `${slugFileName(td.title || 'table')}.csv`, mime: 'text/csv', text: serializeCsv(td.cells) };
          }
          if (format === 'json') {
            const { exportBoard } = await import('../export/boardio');
            const text = exportBoard(doc(), bid);
            if (!text) fail('export', 'json export failed');
            return { name: `${base}.json`, mime: 'application/json', text };
          }
          const blob = await app.exporter.mediaZip(bid);
          if (!blob) fail('export', 'board has no media to zip');
          return { name: `${base}-files.zip`, mime: 'application/zip', dataUrl: await blobToDataUrl(blob) };
        };
      }
      case 'import': {
        guard();
        const o = vObj(params, 'params');
        checkKeys(o, new Set(['data', 'boardId']));
        const data = vStr(o.data, 'data', 16 * 1024 * 1024);
        const hostId = o.boardId === undefined ? null : vBoardId(doc(), o.boardId);
        return async () => {
          guard();
          const { parseBoardExport, importActions } = await import('../export/boardio');
          const parsed = parseBoardExport(data);
          const host = hostId ?? survivingBoard(doc(), undefined, app.boardId);
          const res = parsed && host ? importActions(doc(), parsed, host) : null;
          if (!res) fail('bad_payload', 'data is not a board export, or no host board exists');
          dispatch({ type: 'batch', actions: res.actions });
          app.openBoard(res.boardId);
          return { boardId: res.boardId };
        };
      }
      case 'unfurl': {
        guard();
        const o = vObj(params, 'params');
        checkKeys(o, new Set(['id']));
        const id = vElId(doc(), o.id, 'id');
        return async () => {
          guard();
          const el = doc().elements[id];
          if (!el) fail('not_found', `no element ${id}`);
          const link = linkDoc(el);
          const embed = embedDoc(el);
          const url = link?.url ?? embed?.url;
          if (!url) fail('bad_field', 'element is not a link/embed card with a url');
          // Links honour the user's online-extra pref; embeds enrich
          // without it (creating one already opted into the provider).
          if (link && app.prefs.unfurl === false) return { ok: false, reason: 'link unfurl is disabled in settings' };
          if (!navigator.onLine) return { ok: false, reason: 'offline' };
          const { fetchLinkPreview } = await import('../ui/unfurl');
          const res = await fetchLinkPreview(url);
          if (!res) return { ok: false, reason: 'no preview returned' };
          if (link) {
            dispatch({
              type: 'element.patch',
              id,
              patch: {
                content: {
                  link: {
                    ...link,
                    title: autoTitled(link.title, url) ? (res.title ?? link.title) : link.title,
                    ...(res.desc !== undefined ? { desc: res.desc } : {}),
                    ...(res.image !== undefined ? { image: res.image } : {}),
                  },
                },
              },
            });
          } else if (embed && res.title && autoTitled(embed.title, url)) {
            dispatch({ type: 'element.patch', id, patch: { content: { embed: { ...embed, title: res.title } } } });
          }
          return { ok: true, title: res.title, desc: res.desc, image: res.image };
        };
      }
      case 'batch': {
        guard();
        const list = Array.isArray(params) ? params : vObj(params, 'params').commands;
        if (!Array.isArray(list)) fail('bad_params', 'commands must be an array');
        const planned = list.map((c) => {
          const cmd = parseCommand(c);
          return plan(cmd.method, cmd.params);
        });
        return () => runPlanned(planned);
      }
      case 'dispatch': {
        guard();
        const o = vObj(params, 'params');
        const action = vAction(doc(), 'type' in o ? o : o.action, 0);
        return () => {
          guard();
          checkNoOverwrite(doc(), action);
          checkParentCycles(doc(), action);
          dispatch(expandAction(action));
          return { ok: true };
        };
      }
      default:
        fail('unknown_method', `no command ${method}`);
    }
  }

  return {
    async run(method: string, params?: unknown): Promise<unknown> {
      if (MUTATING.has(method)) {
        guard();
        app.editing.endEdit();
        // See runPlanned: mutating work never joins a group it did not
        // open (a user gesture in progress).
        if (app.store.inGroup) fail('busy', 'a board gesture is in progress');
      }
      return plan(method, params)();
    },
    // Plan every command first, then run them inside one store group:
    // a bad command aborts everything, a good list is one undo entry.
    async runCommands(commands: AgentCommand[]): Promise<unknown[]> {
      const planned = commands.map((c) => {
        if (MUTATING.has(c.method)) guard();
        return plan(c.method, c.params);
      });
      return runPlanned(planned);
    },
  };
}

export type AgentApi = ReturnType<typeof createAgentApi>;
