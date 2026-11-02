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
  uid,
  UNSORTED,
  type Doc,
  type Element,
} from './schema';
import { putBlob } from '../persist/blobs';
import { t } from '../strings';

export function seedDoc(): Doc {
  const doc = emptyDoc();
  const home = createBoard({ id: 'home', title: t('homeTitle') });
  doc.boards[home.id] = home;

  // First-run welcome board: a polished launch plan that doubles as a
  // tour of every card type, laid out like a real working board.
  const now = Date.now();
  const put = (el: Element) => {
    doc.elements[el.id] = el;
    return el;
  };

  const wHead = put(createHeading(doc, home.id, 0, 0, 1));
  wHead.content = { heading: { text: 'Mercury launch', level: 1 } };
  const wSub = put(createHeading(doc, home.id, 0, 58, 2));
  wSub.content = { heading: { text: 'One board, every card type. Double-click anything to edit.', level: 2 } };

  const intro = put(createNote(doc, home.id, 0, 130));
  intro.content = {
    note: {
      text: 'Welcome to Scatterboard\nDrag cards anywhere, double-click to write, draw a line between ideas, label what matters and react where it lands. Everything here is a real card.',
      html: '<p>Welcome to <b>Scatterboard</b></p><p>Drag cards anywhere, <b>double-click</b> to write, draw a line between ideas, label what matters and react where it lands. Everything here is a real card.</p>',
    },
  };
  intro.reactions = ['🚀', '💡', '👀'];

  const howTo = put(createNote(doc, home.id, 300, 130));
  howTo.color = '#e8f0fe';
  howTo.content = {
    note: {
      text: 'Get around fast\nSpace + drag to pan, scroll to zoom, / for every shortcut.',
      html: '<div class="tx-check">Space + drag to pan, scroll to zoom</div><div class="tx-check">/ for every shortcut</div>',
    },
  };
  howTo.labels = [];

  const lblShip = createLabel(home.id, 'Ship it', '#d6508f');
  const lblRisk = createLabel(home.id, 'At risk', '#e8734a');
  const lblWin = createLabel(home.id, 'On track', '#5f9e5f');
  doc.labels[lblShip.id] = lblShip;
  doc.labels[lblRisk.id] = lblRisk;
  doc.labels[lblWin.id] = lblWin;
  intro.labels = [lblShip.id];

  const colNow = put(createColumn(doc, home.id, 0, 330, 'This week'));
  const nowMembers: [string, string | undefined][] = [
    ['Freeze the release branch', '#e9f5ec'],
    ['QA pass on install flow', '#fdf2e0'],
    ['Draft launch notes', undefined],
  ];
  for (const [text, color] of nowMembers) {
    const m = createNote(doc, home.id, 0, 0, text);
    m.parentId = colNow.id;
    if (color) m.color = color;
    doc.elements[m.id] = m;
  }
  const colNext = put(createColumn(doc, home.id, 300, 330, 'Next up'));
  for (const text of ['Record the 45s demo', 'Update the press kit']) {
    const m = createNote(doc, home.id, 0, 0, text);
    m.parentId = colNext.id;
    doc.elements[m.id] = m;
  }
  const colLater = put(createColumn(doc, home.id, 600, 330, 'Later'));
  for (const text of ['Localization sweep', 'Post-launch retro']) {
    const m = createNote(doc, home.id, 0, 0, text);
    m.parentId = colLater.id;
    doc.elements[m.id] = m;
  }

  const wTodo = put(createTodo(doc, home.id, 900, 330));
  wTodo.labels = [lblRisk.id];
  wTodo.content = {
    todo: {
      title: 'Launch checklist',
      showTitle: true,
      items: [
        { id: 'w-t1', text: 'Tag the release build', done: true },
        { id: 'w-t2', text: 'Freeze the changelog', done: false, dueAt: now + 86400000 },
        { id: 'w-t3', text: 'Brief support on top issues', done: false, assignee: 'self' as const },
        { id: 'w-t4', text: 'Flip the pricing page', done: false },
        { id: 'w-t5', text: 'Schedule the announcement', done: false },
      ],
    },
  };

  const archive = createBoard({ title: 'Archive', parentId: home.id });
  doc.boards[archive.id] = archive;
  ['Cut features', 'Old brainstorms', 'Retro notes'].forEach((text, i) => {
    const n = createNote(doc, archive.id, 120, 100 + i * 120, text);
    doc.elements[n.id] = n;
  });
  const archiveCard = put(createBoardCard(doc, home.id, archive.id, 1220, 340));

  const secTools = put(createHeading(doc, home.id, 0, 700, 2));
  secTools.content = { heading: { text: 'Everything is a card', level: 2 } };

  const wDoc = put(createDocument(doc, home.id, 0, 760));
  wDoc.content = {
    document: {
      title: 'Launch brief',
      text: 'Goal\nShip Mercury 1.0 on Friday, no scope creep.\n\nWatchouts\nInstaller on older macs, empty-state copy, pricing page cutover.',
      html: '<h3>Goal</h3><p>Ship <b>Mercury 1.0</b> on Friday, no scope creep.</p><h3>Watchouts</h3><ul><li>Installer on older macs</li><li>Empty-state copy</li><li>Pricing page cutover</li></ul>',
      displayMode: 'detail',
      caption: 'Documents open as a full editor',
    },
  };

  const wTbl = put(createTable(doc, home.id, 340, 760));
  wTbl.content = {
    table: {
      title: 'Capacity',
      caption: 'Hours by area this week',
      cells: [
        [{ text: 'Area' }, { text: 'Owner' }, { text: 'Hours', color: '#fdf2e0' }],
        [{ text: 'Engine' }, { text: 'Ana' }, { text: '9', type: 'number' }],
        [{ text: 'Content' }, { text: 'Lev' }, { text: '6', type: 'number' }],
        [{ text: 'Total' }, { text: '' }, { text: '=SUM(C2:C3)' }],
      ],
    },
  };

  const wSketch = put(createSketch(doc, home.id, 700, 760));
  wSketch.content = {
    sketch: {
      strokes: [
        { pts: [[30, 200], [120, 60], [210, 140], [300, 40], [390, 160], [470, 90]], color: '#323b4a', size: 4 },
        { pts: [[60, 280], [180, 240], [300, 270], [420, 230]], color: '#d6504a', size: 6 },
      ],
    },
  };

  const wLink = put(createLink(doc, home.id, 1080, 760, 'https://example.com'));
  wLink.content = { link: { url: 'https://example.com', title: 'Status page', caption: 'Watch it during the launch window', showPreview: true } };

  const wVid = put(createEmbed(doc, home.id, 'video', 1380, 760));
  wVid.content = {
    embed: {
      kind: 'video',
      url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      title: 'Demo reference',
      caption: 'Tone to match for our cut',
      showPreview: true,
    },
  };

  const sw1 = put(createSwatch(doc, home.id, 0, 1140, '#e8734a'));
  sw1.content = { swatch: { color: '#e8734a', caption: 'Accent', showValue: true } };
  const sw2 = put(createSwatch(doc, home.id, 240, 1140, '#3d84e0'));
  sw2.content = { swatch: { color: '#3d84e0', caption: 'Link blue', showValue: true } };
  const sw3 = put(createSwatch(doc, home.id, 480, 1140, '#5f9e5f'));
  sw3.content = { swatch: { color: '#5f9e5f', caption: 'Go green', showValue: true } };
  const swNote = put(createNote(doc, home.id, 760, 1140, 'Drag these onto the palette well to restyle the board'));
  swNote.color = '#fdf2e0';

  const wl = createLine(doc, home.id, { el: wTodo.id, x: wTodo.x, y: wTodo.y }, { el: colNow.id, x: colNow.x, y: colNow.y });
  wl.content = { line: { ...lineDoc(wl)!, label: 'pull into' } };
  doc.elements[wl.id] = wl;
  const wl2 = createLine(
    doc,
    home.id,
    { el: archiveCard.id, x: archiveCard.x, y: archiveCard.y },
    { x: archiveCard.x + 80, y: archiveCard.y + 240 },
  );
  doc.elements[wl2.id] = wl2;
  const wl3 = createLine(doc, home.id, { el: howTo.id, x: howTo.x, y: howTo.y }, { el: intro.id, x: intro.x, y: intro.y });
  doc.elements[wl3.id] = wl3;

  const wPin = put(createComment(doc, home.id, wTodo.x + 290, wTodo.y + 40, wTodo.id));
  wPin.content = {
    comment: {
      items: [
        { id: 'w-c1', text: 'Demo recording still blocked on the new icon?', createdAt: now - 3600000 },
        { id: 'w-c2', text: 'Icon landed this morning, we are good', createdAt: now - 900000 },
      ],
    },
  };
  const wFree = put(createComment(doc, home.id, 1080, 1140));
  wFree.content = {
    comment: { items: [{ id: 'w-c3', text: 'Parking this thought for the retro', createdAt: now - 7200000 }] },
  };

  const wFiled = createNote(doc, home.id, 0, 0, 'Filed here until it has a home');
  wFiled.parentId = UNSORTED;
  doc.elements[wFiled.id] = wFiled;

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
export async function seedMedia(doc: Doc) {
  const test = doc.boards.test;
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
