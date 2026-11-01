import './style.css';
import { App } from './app';
import { Store } from './state/store';
import {
  createAnnotation,
  createBoard,
  createBoardCard,
  createColumn,
  createComment,
  createDocument,
  createEmbed,
  createFile,
  createHeading,
  createImage,
  createLabel,
  createLine,
  createLink,
  createNote,
  createSketch,
  createSwatch,
  createTable,
  createTodo,
  emptyDoc,
  lineDoc,
  migrateDoc,
  uid,
  UNSORTED,
  type Doc,
  type Element,
} from './state/schema';
import { LocalStorageAdapter } from './persist/local';
import { SqliteAdapter } from './persist/sqlite';
import { putBlob, purgeOrphanBlobs } from './persist/blobs';
import { t } from './strings';

function seedDoc(): Doc {
  const doc = emptyDoc();
  const home = createBoard({ id: 'home', title: t('homeTitle') });
  doc.boards[home.id] = home;

  // First-run welcome board: a few cards teaching the core gestures.
  const wHead = createHeading(doc, home.id, 0, 0, 1);
  wHead.content = { heading: { text: t('welcomeHead'), level: 1 } };
  doc.elements[wHead.id] = wHead;
  const wNotes = [t('welcomeNote1'), t('welcomeNote2'), t('welcomeNote3')];
  wNotes.forEach((text, i) => {
    const n = createNote(doc, home.id, i * 300, 90, text);
    doc.elements[n.id] = n;
  });
  const wChild = createBoard({ title: t('welcomeBoard'), parentId: home.id });
  doc.boards[wChild.id] = wChild;
  [t('welcomeChild1'), t('welcomeChild2')].forEach((text, i) => {
    const n = createNote(doc, wChild.id, 60, 60 + i * 110, text);
    doc.elements[n.id] = n;
  });
  const wCard = createBoardCard(doc, home.id, wChild.id, 0, 220);
  doc.elements[wCard.id] = wCard;

  const test = createBoard({ id: 'test', title: 'Test harness' });
  doc.boards[test.id] = test;
  const colors = [undefined, '#fdf2e0', '#e8f0fe', '#fdebee', '#e9f5ec', '#f3eafd'];
  const bodies = [
    'Short note',
    'A slightly longer note that wraps onto a second line when the card is narrow',
    'Multi line\nnote with\nthree rows',
    'Idea: sketch the level flow here',
    '',
  ];
  let i = 0;
  const seeded: Element[] = [];
  for (let row = 0; row < 6; row++) {
    for (let col = 0; col < 10; col++) {
      const el = createNote(doc, test.id, -1400 + col * 300, -800 + row * 160, `${bodies[i % bodies.length]} ${i + 1}`);
      const color = colors[i % colors.length];
      if (color) el.color = color;
      doc.elements[el.id] = el;
      seeded.push(el);
      i++;
    }
  }

  const heading = createHeading(doc, test.id, -1400, -1060, 1);
  heading.content = { heading: { text: 'Sprint plan', level: 1 } };
  doc.elements[heading.id] = heading;

  const swatch = createSwatch(doc, test.id, -1080, -1080, '#e8734a');
  swatch.content = { swatch: { color: '#e8734a', caption: 'Primary accent', showValue: true } };
  doc.elements[swatch.id] = swatch;

  const todo = createTodo(doc, test.id, -760, -1120);
  todo.content = {
    todo: {
      title: 'Launch checklist',
      showTitle: true,
      items: [
        { id: 'seed-t1', text: 'Reserve playtest slot', done: true },
        { id: 'seed-t2', text: 'Draft patch notes', done: false },
        {
          id: 'seed-t3',
          text: 'Lock store assets',
          done: false,
          dueAt: Date.now() + 86400000,
        },
        { id: 'seed-t4', text: 'Trim tutorial copy', done: false, assignee: 'self' as const },
        { id: 'seed-t5', text: 'Smoke test build', done: false },
      ],
    },
  };
  doc.elements[todo.id] = todo;

  const a = seeded[12]!;
  const b = seeded[14]!;
  const cNote = seeded[33]!;
  const linkLine = createLine(doc, test.id, { el: a.id, x: a.x, y: a.y }, { el: b.id, x: b.x, y: b.y });
  const lc = lineDoc(linkLine)!;
  linkLine.content = { line: { ...lc, label: 'then' } };
  doc.elements[linkLine.id] = linkLine;

  const freeLine = createLine(
    doc,
    test.id,
    { el: cNote.id, x: cNote.x, y: cNote.y },
    { x: cNote.x + 420, y: cNote.y + 120 },
  );
  doc.elements[freeLine.id] = freeLine;

  const nested = createBoard({ title: 'Nested demo', parentId: test.id });
  doc.boards[nested.id] = nested;
  const nestedTexts = ['Level ideas', 'Boss fight beats', 'Palette refs', 'Open questions'];
  nestedTexts.forEach((text, idx) => {
    const n = createNote(doc, nested.id, 160 + idx * 280, 160, text);
    doc.elements[n.id] = n;
  });

  const rich = createNote(doc, test.id, 340, -160);
  rich.content = {
    note: {
      text: 'Roadmap\nKickoff with the team on Friday. No slip.\nOrder matters:\nAlpha gates\nBeta sweep\nKeep scope tight.',
      html: '<h2>Roadmap</h2><p>Kickoff <b>with the team</b> on <i>Friday</i>. <s>No slip.</s></p><p>Order matters:</p><ul><li>Alpha gates</li><li>Beta sweep</li></ul><p class="tx-co">Keep scope tight.</p>',
    },
  };
  doc.elements[rich.id] = rich;

  const checklist = createNote(doc, test.id, 620, -160);
  checklist.content = {
    note: {
      text: 'Run the tutorial\nCheck the credits roll',
      html: '<div class="tx-check">Run the tutorial</div><div class="tx-check">Check the credits roll</div>',
    },
  };
  doc.elements[checklist.id] = checklist;

  const col = createColumn(doc, test.id, 340, -480, 'Backlog');
  doc.elements[col.id] = col;
  for (let m = 0; m < 3; m++) {
    const member = createNote(doc, test.id, 0, 0, `Column member ${m + 1}`);
    member.parentId = col.id;
    doc.elements[member.id] = member;
  }
  const colDoc = createDocument(doc, test.id, 0, 0);
  colDoc.parentId = col.id;
  colDoc.content = {
    document: { title: 'Spec draft', text: 'Column document body', displayMode: 'icon', caption: '' },
  };
  doc.elements[colDoc.id] = colDoc;
  const boardCard = createBoardCard(doc, test.id, nested.id, 700, -470);
  doc.elements[boardCard.id] = boardCard;

  const ship = createLabel(test.id, 'Ship', '#d6508f');
  const blocked = createLabel(test.id, 'Blocked', '#3d84e0');
  doc.labels[ship.id] = ship;
  doc.labels[blocked.id] = blocked;
  seeded[0]!.labels = [ship.id];
  seeded[5]!.labels = [ship.id, blocked.id];

  const anchorNote = seeded[20]!;
  const pinned = createComment(doc, test.id, anchorNote.x + 260, anchorNote.y, anchorNote.id);
  pinned.content = {
    comment: {
      items: [
        { id: 'seed-c1', text: 'Does this still match the mock?', createdAt: Date.now() - 3600000 },
        { id: 'seed-c2', text: 'Updated it, take another look', createdAt: Date.now() - 600000 },
      ],
    },
  };
  doc.elements[pinned.id] = pinned;

  const freeComment = createComment(doc, test.id, 1080, -200);
  freeComment.content = {
    comment: { items: [{ id: 'seed-c3', text: 'Park this until Friday', createdAt: Date.now() - 7200000 }] },
  };
  doc.elements[freeComment.id] = freeComment;

  seeded[7]!.reactions = ['🔥', '🎉'];

  const filed = createNote(doc, test.id, 0, 0, 'Filed for later sorting');
  filed.parentId = UNSORTED;
  doc.elements[filed.id] = filed;

  const trashNote = createNote(doc, test.id, 0, 0, 'Deleted brainstorm note');
  const trashTodo = createTodo(doc, test.id, 0, 0);
  trashTodo.content = { todo: { title: 'Old checklist', showTitle: true, items: [{ id: 'seed-tx', text: 'Stale item', done: false }] } };
  doc.trash[trashNote.id] = { el: trashNote, deletedAt: Date.now() - 3600000 };
  doc.trash[trashTodo.id] = { el: trashTodo, deletedAt: Date.now() - 90000000 };

  const link = createLink(doc, test.id, 1100, 160, 'https://example.com');
  link.content = { link: { url: 'https://example.com', title: 'example.com', caption: '', showPreview: true } };
  doc.elements[link.id] = link;

  const vid = createEmbed(doc, test.id, 'video', 1480, 160);
  vid.content = {
    embed: { kind: 'video', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', title: 'YouTube video', caption: '', showPreview: true },
  };
  doc.elements[vid.id] = vid;

  const docCard = createDocument(doc, test.id, 1100, 520);
  docCard.content = {
    document: {
      title: 'Launch brief',
      text: 'Goals\nShip the vertical slice by Friday.\nKeep the scope tight.\nNotes\nPlaytest with two new users.\nFix the worst five bugs only.',
      html: '<h3>Goals</h3><p>Ship the vertical slice by Friday.</p><p>Keep the scope tight.</p><h3>Notes</h3><p>Playtest with two new users.</p><p>Fix the worst five bugs only.</p>',
      displayMode: 'icon',
      caption: '',
    },
  };
  doc.elements[docCard.id] = docCard;

  const sk = createSketch(doc, test.id, 1480, 480);
  sk.content = {
    sketch: {
      strokes: [
        {
          pts: [
            [80, 340],
            [160, 180],
            [260, 120],
            [340, 180],
            [420, 320],
          ],
          color: '#323b4a',
          size: 4,
        },
        {
          pts: [
            [120, 380],
            [240, 360],
            [380, 380],
            [500, 350],
          ],
          color: '#d6504a',
          size: 8,
        },
        {
          pts: [
            [450, 140],
            [470, 160],
            [490, 130],
          ],
          color: '#3d84e0',
          size: 4,
        },
      ],
    },
  };
  doc.elements[sk.id] = sk;

  const anno = createAnnotation(doc, test.id, [
    {
      pts: [
        [2160, 560],
        [2210, 520],
        [2280, 510],
        [2330, 560],
        [2310, 620],
        [2240, 630],
        [2160, 560],
      ],
      color: '#323b4a',
      size: 4,
    },
    {
      pts: [
        [2360, 520],
        [2390, 560],
        [2420, 520],
      ],
      color: '#5f9e5f',
      size: 4,
    },
  ]);
  doc.elements[anno.id] = anno;

  const tbl = createTable(doc, test.id, 1100, 920);
  tbl.content = {
    table: {
      title: 'Sprint capacity',
      caption: 'Hours per feature',
      cells: [
        [{ text: 'Feature' }, { text: 'Owner' }, { text: 'Hours', color: '#fdf2e0' }],
        [{ text: 'Combat pass' }, { text: 'Ana' }, { text: '8', type: 'number' }],
        [{ text: 'Boss AI' }, { text: 'Lev' }, { text: '13', type: 'number' }],
        [{ text: 'Ship?' }, { text: '1', type: 'checkbox' }, { text: '=SUM(C2:C3)' }],
      ],
    },
  };
  doc.elements[tbl.id] = tbl;

  return doc;
}

// Media seeds need real blobs in IndexedDB; run once on a fresh doc.
async function seedMedia(doc: Doc) {
  const test = doc.boards['test'];
  if (!test) return;
  const cv = document.createElement('canvas');
  cv.width = 40;
  cv.height = 40;
  const ctx = cv.getContext('2d')!;
  ctx.fillStyle = '#3d84e0';
  ctx.fillRect(0, 0, 40, 40);
  ctx.fillStyle = '#f2d15c';
  ctx.fillRect(10, 10, 20, 20);
  const png = await new Promise<Blob | null>((res) => cv.toBlob(res, 'image/png'));
  if (png) {
    const ref = uid();
    await putBlob(ref, png).catch(() => {});
    const img = createImage(doc, test.id, 1860, 160, ref, 'dot.png', 1, 40, 40);
    doc.elements[img.id] = img;
  }

  // Second image: flat background + shapes so Remove background has
  // something to cut, with draw-on strokes exercising the svg overlay.
  const cv2 = document.createElement('canvas');
  cv2.width = 360;
  cv2.height = 240;
  const c2 = cv2.getContext('2d')!;
  c2.fillStyle = '#e8edf3';
  c2.fillRect(0, 0, 360, 240);
  c2.fillStyle = '#d6508f';
  c2.beginPath();
  c2.arc(120, 120, 58, 0, Math.PI * 2);
  c2.fill();
  c2.fillStyle = '#5f9e5f';
  c2.fillRect(206, 78, 92, 84);
  const png2 = await new Promise<Blob | null>((res) => cv2.toBlob(res, 'image/png'));
  if (png2) {
    const ref = uid();
    await putBlob(ref, png2).catch(() => {});
    const img = createImage(doc, test.id, 1860, 480, ref, 'shapes.png', 360 / 240, 360, 240);
    if ('image' in img.content) {
      img.content.image.strokes = [
        { pts: [[24, 216], [88, 160], [140, 200]], color: '#d6504a', size: 7 },
        {
          pts: [
            [300, 40],
            [336, 40],
            [336, 76],
            [300, 76],
            [300, 40],
          ],
          color: '#323b4a',
          size: 4,
        },
      ];
    }
    doc.elements[img.id] = img;
  }
  const txt = new Blob(['A small seeded file.\n'], { type: 'text/plain' });
  const fileRef = uid();
  await putBlob(fileRef, txt).catch(() => {});
  const file = createFile(doc, test.id, 2160, 160, fileRef, 'notes.txt', txt.size, 'text/plain');
  doc.elements[file.id] = file;
}

function boardIdFromHash(): string | null {
  const m = location.hash.match(/^#\/b\/([^/?#]+)/);
  return m ? m[1]! : null;
}

function editorIdFromHash(): string | null {
  const m = location.hash.match(/^#\/e\/([^/?#]+)/);
  return m ? m[1]! : null;
}

async function boot() {
  // sqlite in OPFS via the sah-pool VFS is the primary store; the
  // localStorage adapter stays as migration source and fallback when
  // the worker or OPFS is unavailable.
  const local = new LocalStorageAdapter();
  const adapter = (await SqliteAdapter.create(local)) ?? local;
  const persisted = await adapter.load();
  const fresh = !(persisted && persisted.version === 1 && Object.keys(persisted.doc.boards).length);
  const doc = fresh ? seedDoc() : migrateDoc(persisted!.doc);
  if (fresh) await seedMedia(doc);
  void purgeOrphanBlobs(doc);
  const store = new Store(doc);
  const app = new App(document.getElementById('app')!, store, adapter);
  app.prefs = persisted?.prefs ?? {};
  app.applyPrefs();
  if (fresh) app.welcomeHint();
  (window as unknown as { __app: App }).__app = app;

  // #/e/<id> boots into the element's editor: synthesize a #/b/ history
  // entry underneath so history.back() exits to the board.
  const eid = editorIdFromHash();
  const eel = eid ? doc.elements[eid] : undefined;
  if (eel && (eel.type === 'document' || eel.type === 'sketch' || eel.type === 'image')) {
    app.openBoard(eel.boardId);
    history.pushState(null, '', `#/e/${eel.id}`);
    app.applyRoute();
  } else {
    const requested = boardIdFromHash() ?? adapter.lastBoard();
    const start = requested && doc.boards[requested] ? requested : 'home';
    app.openBoard(start);
    app.applyRoute();
  }

  window.addEventListener('hashchange', () => app.applyRoute());
  window.addEventListener('pagehide', () => void app.flush());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void app.flush();
  });
}

void boot();

// PWA: production builds register the cache-first service worker so the
// shell (and lazily every hashed asset) works fully offline.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}
