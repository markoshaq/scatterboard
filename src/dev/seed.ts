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
} from '../state/schema';
import { putBlob } from '../persist/blobs';
import { t } from '../strings';

function circlePts(cx: number, cy: number, r: number, n = 48, from = 0): [number, number][] {
  const pts: [number, number][] = [];
  for (let i = 0; i <= n; i++) {
    const a = from + (i / n) * Math.PI * 2;
    pts.push([Math.round(cx + Math.cos(a) * r), Math.round(cy + Math.sin(a) * r)]);
  }
  return pts;
}

function ellipsePts(cx: number, cy: number, rx: number, ry: number, n = 56, from = 0): [number, number][] {
  const pts: [number, number][] = [];
  for (let i = 0; i <= n; i++) {
    const a = from + (i / n) * Math.PI * 2;
    pts.push([Math.round(cx + Math.cos(a) * rx), Math.round(cy + Math.sin(a) * ry)]);
  }
  return pts;
}

function wavePts(x1: number, x2: number, y: number, amp: number, period: number): [number, number][] {
  const pts: [number, number][] = [];
  for (let x = x1; x <= x2; x += 8) pts.push([x, Math.round(y + Math.sin((x - x1) / period) * amp)]);
  return pts;
}

// Cover art shipped with the welcome board: scattered card shapes over
// a gradient nightfall. Drawn as SVG so the seeded blob stays tiny.
const COVER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="640" viewBox="0 0 960 640">
<defs>
<linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
<stop offset="0" stop-color="#101832"/>
<stop offset=".55" stop-color="#2a4a86"/>
<stop offset="1" stop-color="#e08a54"/>
</linearGradient>
<radialGradient id="s" cx=".5" cy=".5" r=".5">
<stop offset="0" stop-color="#ffe2b0" stop-opacity=".85"/>
<stop offset="1" stop-color="#ffe2b0" stop-opacity="0"/>
</radialGradient>
</defs>
<rect width="960" height="640" fill="url(#g)"/>
<g fill="#fff" opacity=".18">
<rect x="120" y="80" width="96" height="62" rx="8" transform="rotate(-8 168 111)"/>
<rect x="420" y="56" width="96" height="62" rx="8" transform="rotate(6 468 87)"/>
<rect x="700" y="110" width="96" height="62" rx="8" transform="rotate(-5 748 141)"/>
</g>
<g stroke="#fff" stroke-width="1.5" opacity=".3">
<line x1="150" y1="150" x2="220" y2="90"/>
<line x1="220" y1="90" x2="300" y2="140"/>
<line x1="300" y1="140" x2="360" y2="80"/>
<line x1="560" y1="170" x2="640" y2="110"/>
<line x1="640" y1="110" x2="730" y2="160"/>
<line x1="820" y1="70" x2="880" y2="130"/>
</g>
<g fill="#fff">
<circle cx="150" cy="150" r="4" opacity=".9"/>
<circle cx="220" cy="90" r="3" opacity=".7"/>
<circle cx="300" cy="140" r="4" opacity=".9"/>
<circle cx="360" cy="80" r="2.5" opacity=".6"/>
<circle cx="560" cy="170" r="3" opacity=".7"/>
<circle cx="640" cy="110" r="4" opacity=".9"/>
<circle cx="730" cy="160" r="2.5" opacity=".6"/>
<circle cx="820" cy="70" r="3" opacity=".8"/>
<circle cx="880" cy="130" r="4" opacity=".9"/>
<circle cx="90" cy="220" r="2.5" opacity=".6"/>
<circle cx="430" cy="190" r="2" opacity=".5"/>
<circle cx="510" cy="70" r="3" opacity=".8"/>
<circle cx="70" cy="60" r="3" opacity=".7"/>
<circle cx="910" cy="230" r="2.5" opacity=".6"/>
<circle cx="250" cy="230" r="2" opacity=".5"/>
</g>
<circle cx="700" cy="404" r="170" fill="url(#s)"/>
<circle cx="700" cy="404" r="76" fill="#ffdca6"/>
<path d="M0 470 L160 330 L300 440 L430 350 L560 470 L700 390 L840 480 L960 410 L960 640 L0 640 Z" fill="#26365e"/>
<path d="M0 545 L120 430 L260 525 L400 450 L560 555 L720 470 L880 565 L960 505 L960 640 L0 640 Z" fill="#1a2745"/>
<path d="M0 605 L200 515 L380 590 L560 525 L760 605 L960 545 L960 640 L0 640 Z" fill="#111c33"/>
</svg>`;

// Second seeded picture: an abstract board motif on the dot grid,
// distinct from the hero cover so the gallery shows different art.
const ART_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="320" viewBox="0 0 480 320">
<defs>
<pattern id="d" width="24" height="24" patternUnits="userSpaceOnUse">
<circle cx="3" cy="3" r="1.6" fill="#ffffff" opacity=".16"/>
</pattern>
<linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
<stop offset="0" stop-color="#1b2745"/>
<stop offset="1" stop-color="#10182e"/>
</linearGradient>
</defs>
<rect width="480" height="320" fill="url(#bg)"/>
<rect width="480" height="320" fill="url(#d)"/>
<rect x="70" y="70" width="120" height="80" rx="10" fill="#e8734a" transform="rotate(-6 130 110)"/>
<rect x="220" y="52" width="120" height="80" rx="10" fill="#3d84e0" transform="rotate(4 280 92)"/>
<rect x="150" y="180" width="120" height="80" rx="10" fill="#5f9e5f" transform="rotate(-3 210 220)"/>
<circle cx="376" cy="198" r="46" fill="#d6508f"/>
<g stroke="#fff" stroke-width="2" opacity=".5" fill="none">
<line x1="190" y1="112" x2="220" y2="100"/>
<line x1="268" y1="222" x2="332" y2="200"/>
</g>
<circle cx="190" cy="112" r="4" fill="#fff"/>
<circle cx="332" cy="200" r="4" fill="#fff"/>
</svg>`;

const GUIDE_MD = `# Scatterboard 101

- Double-click any card to edit it
- Drag cards to move them, drop them into columns to file them
- Pull a line out from any card edge to connect ideas
- Space + drag pans, scroll zooms, Z fits the whole board
- / opens every shortcut
- Cards file to Unsorted and recover from Trash, both in the top bar
- Everything saves locally, all the time
`;

// The welcome board references three generated blobs; writes go
// through the normal IndexedDB store so image/file cards resolve like
// any ingest. Best-effort: a failed write just leaves a placeholder.
function seedBlobs(): { imgRef: string; artRef: string; fileRef: string; fileSize: number } {
  const imgRef = uid();
  const artRef = uid();
  const fileRef = uid();
  const file = new Blob([GUIDE_MD], { type: 'text/markdown' });
  void putBlob(imgRef, new Blob([COVER_SVG], { type: 'image/svg+xml' })).catch(() => {});
  void putBlob(artRef, new Blob([ART_SVG], { type: 'image/svg+xml' })).catch(() => {});
  void putBlob(fileRef, file).catch(() => {});
  return { imgRef, artRef, fileRef, fileSize: file.size };
}

export function seedDoc(): Doc {
  const doc = emptyDoc();
  const home = createBoard({ id: 'home', title: t('homeTitle'), icon: 'g:rocket', color: '#e8734a' });
  doc.boards[home.id] = home;
  const bid = home.id;
  const { imgRef, artRef, fileRef, fileSize } = seedBlobs();

  // First-open camera, written as the saved transform restore() picks
  // up: the board point that lands on screen centre so the framing
  // holds at any window size. Centres the hero band below.
  const cam = { x: -140, y: 170, z: 0.8 };
  home.position = {
    x: innerWidth / 2 - cam.x * cam.z,
    y: innerHeight / 2 - cam.y * cam.z,
    z: cam.z,
  };

  // First-run welcome board: a top-to-bottom guided tour. Sections run
  // in reading order down the page on one shared grid (left margin
  // -720, 40px gutters), each headed by a numbered title with a colour
  // tick, and every card type and feature appears once, live.
  const now = Date.now();
  const put = (el: Element) => {
    doc.elements[el.id] = el;
    return el;
  };
  const note = (x: number, y: number, text: string, w?: number) => {
    const el = put(createNote(doc, bid, x, y, text));
    if (w !== undefined) el.w = w;
    return el;
  };
  const X0 = -720;
  // Numbered section header: level-2 title plus a short colour tick to
  // its left, drawn as an annotation stroke.
  const section = (y: number, text: string, color: string) => {
    const h = put(createHeading(doc, bid, X0, y, 2));
    h.w = 560;
    h.content = { heading: { text, level: 2 } };
    put(createAnnotation(doc, bid, [{ pts: [[X0 - 18, y + 3], [X0 - 18, y + 29]], color, size: 7 }]));
  };

  const lblFeature = createLabel(bid, 'Feature', '#3d84e0');
  const lblTip = createLabel(bid, 'Tip', '#5f9e5f');
  const lblTry = createLabel(bid, 'Try me', '#e8734a');
  const lblIdea = createLabel(bid, 'Idea', '#d6508f');
  doc.labels[lblFeature.id] = lblFeature;
  doc.labels[lblTip.id] = lblTip;
  doc.labels[lblTry.id] = lblTry;
  doc.labels[lblIdea.id] = lblIdea;

  // --- Hero: title, welcome, controls, cover art ---
  const h1 = put(createHeading(doc, bid, X0, -40, 1));
  h1.w = 560;
  h1.content = { heading: { text: 'Scatterboard', level: 1 } };
  put(createAnnotation(doc, bid, [{ pts: wavePts(X0 + 8, X0 + 290, 12, 5, 60), color: '#e8734a', size: 5 }]));
  const h2 = put(createHeading(doc, bid, X0 + 4, 24, 2));
  h2.w = 560;
  h2.content = { heading: { text: 'An infinite canvas where every idea gets a card', level: 2 } };

  const intro = note(X0 + 4, 88, '', 300);
  intro.content = {
    note: {
      text: 'Welcome aboard\nA local-first planning wall. Everything on this page is a real card: move it, edit it, delete it. Nothing ever leaves your machine.',
      html: '<p><b>Welcome aboard</b></p><p>A local-first planning wall. Everything on this page is a real card: move it, edit it, delete it. Nothing ever leaves your machine.</p>',
    },
  };
  intro.reactions = ['🚀', '💡', '✨'];
  intro.labels = [lblFeature.id];

  const howTo = put(createTodo(doc, bid, -376, 88));
  howTo.w = 300;
  howTo.color = '#e8f0fe';
  howTo.content = {
    todo: {
      title: 'Get around',
      showTitle: true,
      items: [
        { id: 'w-g1', text: 'Space + drag to pan', done: false },
        { id: 'w-g2', text: 'Scroll to zoom', done: false },
        { id: 'w-g3', text: 'Z to fit the board', done: false },
        { id: 'w-g4', text: '/ for every shortcut', done: false },
      ],
    },
  };
  howTo.labels = [lblTip.id];

  const tip = note(-376, 272, 'Pull a line out from any card edge to connect ideas, like this one.', 300);
  tip.labels = [lblTip.id];

  const heroImg = put(createImage(doc, bid, -16, -40, imgRef, 'cover.svg', 1.5, 960, 640));
  heroImg.w = 560;
  heroImg.content = {
    image: {
      blobRef: imgRef,
      name: 'cover.svg',
      caption: 'Draw right on images',
      aspect: 1.5,
      natW: 960,
      natH: 640,
      strokes: [
        { pts: ellipsePts(700, 404, 122, 122, 64), color: '#e8734a', size: 14 },
        { pts: [[500, 240], [560, 300], [604, 344]], color: '#e8734a', size: 10 },
        { pts: [[604, 344], [566, 332]], color: '#e8734a', size: 10 },
        { pts: [[604, 344], [596, 304]], color: '#e8734a', size: 10 },
      ],
    },
  };

  const heroPin = put(createComment(doc, bid, 60, -140, heroImg.id));
  heroPin.content = {
    comment: {
      items: [
        { id: 'w-c1', text: 'Pins are comment threads anchored to a card.', createdAt: now - 5400000 },
        { id: 'w-c2', text: 'Click me to read or reply.', createdAt: now - 4800000 },
      ],
    },
  };

  const lineTip = createLine(doc, bid, { el: tip.id, x: tip.x, y: tip.y }, { el: heroImg.id, x: heroImg.x, y: heroImg.y });
  lineTip.content = { line: { ...lineDoc(lineTip)!, label: 'like this' } };
  put(lineTip);

  // --- 1 · Meet the cards: the writing surfaces ---
  section(480, '1 · Meet the cards', '#3d84e0');

  const demoNote = note(X0, 560, '', 320);
  demoNote.color = '#fdf2e0';
  demoNote.labels = [lblTip.id];
  demoNote.reactions = ['👍'];
  demoNote.content = {
    note: {
      text: 'Notes carry rich text: bold, italic, inline code, lists and links.',
      html: '<p><b>Notes</b> carry <i>rich text</i>, <code>inline code</code>, lists and links.</p>',
    },
  };

  const wTodo = put(createTodo(doc, bid, -360, 560));
  wTodo.w = 320;
  wTodo.labels = [lblFeature.id];
  wTodo.content = {
    todo: {
      title: 'Try me first',
      showTitle: true,
      items: [
        { id: 'w-t1', text: 'Double-click a card to edit', done: true },
        { id: 'w-t2', text: 'Drag me into a column below', done: true },
        { id: 'w-t3', text: 'Press / to see every shortcut', done: false, dueAt: now + 86400000 },
        { id: 'w-t4', text: 'Pull a line from my edge', done: false, assignee: 'self' as const, reactions: ['👀'] },
        { id: 'w-t5', text: 'File a card to Unsorted', done: false },
        { id: 'w-t6', text: 'Make this board yours', done: false },
      ],
    },
  };

  const wDoc = put(createDocument(doc, bid, 0, 560));
  wDoc.w = 320;
  wDoc.content = {
    document: {
      title: 'Launch brief',
      text: 'The idea\nOne canvas, every kind of card, zero servers.\n\nWhy it works\nCards stay sharp at any zoom\nUndo goes all the way back\nExports to PNG, PDF, Markdown and zip',
      html: '<h3>The idea</h3><p>One canvas, every kind of card, <b>zero servers</b>.</p><h3>Why it works</h3><ul><li>Cards stay sharp at any zoom</li><li>Undo goes all the way back</li><li>Exports to PNG, PDF, Markdown and zip</li></ul>',
      displayMode: 'detail',
      caption: 'Documents open as a full editor',
    },
  };

  const wTbl = put(createTable(doc, bid, 360, 560));
  wTbl.w = 340;
  wTbl.content = {
    table: {
      title: 'Launch metrics',
      caption: 'Typed cells and live formulas',
      widths: [120, 75, 75, 70],
      cells: [
        [{ text: 'Metric', color: '#e8f0fe' }, { text: 'This week', color: '#e8f0fe' }, { text: 'Last week', color: '#e8f0fe' }, { text: 'Hit?', color: '#e8f0fe' }],
        [{ text: 'Signups' }, { text: '1890', type: 'number' }, { text: '1240', type: 'number' }, { text: '1', type: 'checkbox' }],
        [{ text: 'Revenue' }, { text: '4600', type: 'currency' }, { text: '3200', type: 'currency' }, { text: '1', type: 'checkbox' }],
        [{ text: 'Churn' }, { text: '0.02', type: 'percent' }, { text: '0.04', type: 'percent' }, { text: '0', type: 'checkbox' }],
        [{ text: 'Trend' }, { text: 'up' }, { text: '=IF(B2>C2,"grew","flat")' }, { text: '2026-11-14', type: 'datetime' }],
      ],
    },
  };

  // --- 2 · Bring in the web: links, embeds, files ---
  section(920, '2 · Bring in the web', '#5f9e5f');

  const wLink = put(createLink(doc, bid, X0, 1000, 'https://example.com'));
  wLink.w = 280;
  wLink.content = {
    link: {
      url: 'https://example.com',
      title: 'Link cards',
      caption: 'Paste any URL onto the board',
      desc: 'A saved link with a title, a caption and a preview slot.',
      showPreview: true,
    },
  };

  const wVid = put(createEmbed(doc, bid, 'video', -420, 1000));
  wVid.w = 280;
  wVid.content = {
    embed: {
      kind: 'video',
      url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      title: 'Video embeds',
      caption: 'YouTube and Vimeo play in place',
      showPreview: true,
    },
  };
  const wAud = put(createEmbed(doc, bid, 'audio', -120, 1000));
  wAud.w = 280;
  wAud.content = {
    embed: {
      kind: 'audio',
      url: 'https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC',
      title: 'Audio embeds',
      caption: 'Spotify and SoundCloud too',
      showPreview: true,
    },
  };
  const wMap = put(createEmbed(doc, bid, 'map', 180, 1000));
  wMap.w = 280;
  wMap.content = {
    embed: {
      kind: 'map',
      url: 'https://www.google.com/maps/place/Crater+Lake',
      title: 'Map embeds',
      caption: 'Drop a Google Maps link',
      showPreview: true,
    },
  };

  put(createFile(doc, bid, 500, 1000, fileRef, 'scatterboard-101.md', fileSize, 'text/markdown'));

  // --- 3 · Pictures, sketches and colour ---
  section(1340, '3 · Pictures, sketches and colour', '#d6508f');

  const artImg = put(createImage(doc, bid, X0, 1420, artRef, 'palette-study.svg', 1.5, 480, 320));
  artImg.w = 340;
  artImg.content = {
    image: { blobRef: artRef, name: 'palette-study.svg', caption: 'Paste or drop images anywhere', aspect: 1.5, natW: 480, natH: 320 },
  };

  const wSketch = put(createSketch(doc, bid, -320, 1420));
  wSketch.w = 340;
  wSketch.content = {
    sketch: {
      strokes: [
        { pts: ellipsePts(300, 205, 62, 105, 56), color: '#323b4a', size: 5 },
        { pts: circlePts(300, 195, 26, 32), color: '#3d84e0', size: 6 },
        { pts: [[238, 272], [186, 344], [252, 306]], color: '#e8734a', size: 6 },
        { pts: [[362, 272], [414, 344], [348, 306]], color: '#e8734a', size: 6 },
        { pts: [[272, 306], [282, 372], [296, 318], [310, 374], [326, 306]], color: '#e8734a', size: 7 },
        { pts: [[140, 96], [140, 124]], color: '#f2b25c', size: 4 },
        { pts: [[126, 110], [154, 110]], color: '#f2b25c', size: 4 },
        { pts: [[470, 96], [470, 124]], color: '#f2b25c', size: 4 },
        { pts: [[456, 110], [484, 110]], color: '#f2b25c', size: 4 },
        { pts: [[505, 292], [505, 314]], color: '#f2b25c', size: 4 },
        { pts: [[494, 303], [516, 303]], color: '#f2b25c', size: 4 },
      ],
    },
  };
  wSketch.labels = [lblIdea.id];

  const sw1 = put(createSwatch(doc, bid, 60, 1420, '#e8734a'));
  sw1.content = { swatch: { color: '#e8734a', caption: 'Sunset', showValue: true } };
  const sw2 = put(createSwatch(doc, bid, 280, 1420, '#3d84e0'));
  sw2.content = { swatch: { color: '#3d84e0', caption: 'Ocean', showValue: true } };
  const sw3 = put(createSwatch(doc, bid, 500, 1420, '#5f9e5f'));
  sw3.content = { swatch: { color: '#5f9e5f', caption: 'Meadow', showValue: true } };

  const paletteNote = note(60, 1620, 'Swatches hold a palette. Drag one onto the rail colour well to restyle this board.', 440);
  paletteNote.color = '#fdf2e0';
  paletteNote.labels = [lblTip.id];

  // --- 4 · Organize the mess: columns, boards, filing ---
  section(1770, '4 · Organize the mess', '#e8734a');

  const colCollect = put(createColumn(doc, bid, X0, 1850, 'Collect'));
  colCollect.w = 300;
  const colShape = put(createColumn(doc, bid, -360, 1850, 'Shape'));
  colShape.w = 300;
  const colShip = put(createColumn(doc, bid, 0, 1850, 'Ship'));
  colShip.w = 300;
  const members: [Element, [string, string?][]][] = [
    [colCollect, [['Paste links, images and files straight in'], ['Stray thought? Quick-capture it'], ['Search finds it all later']]],
    [colShape, [['Drag cards onto a column'], ['Colour sets the mood', '#e9f5ec'], ['Label what matters']]],
    [colShip, [['Focus mode fades the rest'], ['Export: PNG, PDF, Markdown, zip']]],
  ];
  for (const [col, list] of members) {
    for (const [text, color] of list) {
      const m = createNote(doc, bid, 0, 0, text);
      m.parentId = col.id;
      if (color) m.color = color;
      doc.elements[m.id] = m;
    }
  }
  colShip.labels = [lblFeature.id];

  const playground = createBoard({ title: 'The Playground', parentId: bid, icon: 'g:gamepad', color: '#7c5cd6' });
  doc.boards[playground.id] = playground;
  const pg1 = createHeading(doc, playground.id, 0, 0, 1);
  pg1.w = 340;
  pg1.content = { heading: { text: 'The Playground', level: 1 } };
  doc.elements[pg1.id] = pg1;
  const pg2 = createNote(doc, playground.id, 0, 90, 'Nested boards keep big maps tidy. This one lives inside Welcome.');
  doc.elements[pg2.id] = pg2;
  const pgCol = createColumn(doc, playground.id, 320, 90, 'Experiments');
  doc.elements[pgCol.id] = pgCol;
  const pgM = createNote(doc, playground.id, 0, 0, 'Break things safely in here');
  pgM.parentId = pgCol.id;
  doc.elements[pgM.id] = pgM;
  const pgBack = createBoardCard(doc, playground.id, bid, 320, 320);
  doc.elements[pgBack.id] = pgBack;

  put(createBoardCard(doc, bid, playground.id, 360, 1850));
  const boardNote = note(360, 1934, 'Boards nest inside boards. Click through to peek.', 320);
  boardNote.labels = [lblFeature.id];
  const noteUns = note(360, 2030, 'Cards file to Unsorted, deleted ones wait in Trash. Both open from the top bar.', 320);
  noteUns.color = '#fdf2e0';

  // --- 5 · Power moves: sync, lock, lines, threads ---
  section(2220, '5 · Power moves', '#7c5cd6');

  const syncGroup = uid();
  const syncText = 'We are synced notes. Edit either of us and both change.';
  const syncA = note(X0, 2300, syncText, 320);
  syncA.syncGroup = syncGroup;
  syncA.labels = [lblFeature.id];
  const syncB = note(-360, 2300, syncText, 320);
  syncB.syncGroup = syncGroup;
  syncB.color = '#e9f5ec';

  const lineSync = createLine(doc, bid, { el: syncA.id, x: syncA.x, y: syncA.y }, { el: syncB.id, x: syncB.x, y: syncB.y });
  lineSync.content = { line: { ...lineDoc(lineSync)!, label: 'synced', dashed: true, weight: 'thin', fromMarker: 'dot', toMarker: 'dot' } };
  put(lineSync);

  const locked = note(0, 2300, 'I am locked in place. Select me and unlock from the rail to move me.', 320);
  locked.locked = true;
  locked.color = '#fae3e3';
  put(
    createAnnotation(doc, bid, [
      { pts: ellipsePts(160, 2344, 186, 78, 64), color: '#d6504a', size: 5 },
      { pts: ellipsePts(160, 2344, 177, 71, 64, 0.4), color: '#d6504a', size: 5 },
    ]),
  );

  const demoLbl = note(360, 2300, 'Labels and reactions stick to any card. This one wears both.', 320);
  demoLbl.labels = [lblIdea.id, lblTry.id];
  demoLbl.reactions = ['❤️', '🔥', '👀'];

  const freeCom = put(createComment(doc, bid, 361, 2410));
  freeCom.content = {
    comment: {
      items: [
        { id: 'w-c3', text: 'Comments float free anywhere on the canvas,', createdAt: now - 7200000 },
        { id: 'w-c4', text: 'or pin to a card, like the cover art up top.', createdAt: now - 7000000 },
      ],
    },
  };

  const sl1 = createLine(doc, bid, { x: X0, y: 2460 }, { x: -420, y: 2420 });
  sl1.content = { line: { ...lineDoc(sl1)!, label: 'thick', weight: 'thick' } };
  put(sl1);
  const sl2 = createLine(doc, bid, { x: X0, y: 2520 }, { x: -420, y: 2480 });
  sl2.content = { line: { ...lineDoc(sl2)!, label: 'dashed', dashed: true } };
  put(sl2);
  const sl3 = createLine(doc, bid, { x: X0, y: 2580 }, { x: -420, y: 2540 });
  sl3.content = { line: { ...lineDoc(sl3)!, label: 'dots', weight: 'thin', fromMarker: 'dot', toMarker: 'dot' } };
  put(sl3);

  const lineNote = note(-360, 2430, 'Lines take labels, arrowheads, dots and dashes. Pull one out from any card edge.', 320);
  lineNote.labels = [lblTip.id];

  // --- 6 · Make it yours ---
  section(2680, '6 · Make it yours', '#e8734a');
  note(
    X0 + 4,
    2760,
    'This board is your sandbox: move it, break it, rebuild it. Everything saves locally as you work. Press Z to see the whole thing.',
    560,
  );

  // Unsorted, Trash and a saved template round out the tour: something
  // is already waiting in each surface the app offers.
  const wFiled = createNote(doc, bid, 0, 0, 'Filed to Unsorted until it has a home');
  wFiled.parentId = UNSORTED;
  doc.elements[wFiled.id] = wFiled;
  const trashed = createNote(doc, bid, 0, 0, 'Deleted cards wait in Trash. Restore me or empty it out.');
  doc.trash[trashed.id] = { el: trashed, deletedAt: now };

  const tplLabels = [
    createLabel('tpl-retro', 'Keep', '#5f9e5f'),
    createLabel('tpl-retro', 'Drop', '#e8734a'),
    createLabel('tpl-retro', 'Try', '#3d84e0'),
  ];
  const tplEls: Element[] = [];
  const tplHead = createHeading(doc, 'tpl-retro', 0, 0, 1);
  tplHead.w = 340;
  tplHead.content = { heading: { text: 'Retro', level: 1 } };
  tplEls.push(tplHead);
  ['Went well', 'To change', 'Try next'].forEach((title, i) => {
    const c = createColumn(doc, 'tpl-retro', i * 320, 80, title);
    tplEls.push(c);
    const m = createNote(doc, 'tpl-retro', 0, 0, 'First card here');
    m.parentId = c.id;
    m.labels = [tplLabels[i]!.id];
    tplEls.push(m);
  });
  doc.templates['tpl-retro'] = {
    id: 'tpl-retro',
    name: 'Retro',
    board: { ...createBoard({ title: 'Retro', icon: 'g:wave' }), id: 'tpl-retro' },
    elements: tplEls,
    labels: tplLabels,
    createdAt: now,
  };

  return doc;
}

// Dev-only profiling board (?seed=N): reproduces the perf-harness mix
// (bulk notes, columns, lines, pinned comments, tables, todos, ink,
// board cards) so render-layer timings are comparable across runs.
export function seedPerfDoc(notes = 1600): Doc {
  const doc = emptyDoc();
  const home = createBoard({ id: 'home', title: 'Home' });
  doc.boards[home.id] = home;
  const perf = createBoard({ id: 'perf', title: 'Perf', parentId: 'home' });
  doc.boards[perf.id] = perf;
  const bid = perf.id;
  const put = (el: Element) => {
    doc.elements[el.id] = el;
    return el;
  };

  const COLS = 40;
  for (let i = 0; i < notes; i++) {
    put(createNote(doc, bid, (i % COLS) * 260, Math.floor(i / COLS) * 160, `note ${i}`));
  }

  for (let c = 0; c < 6; c++) {
    const col = put(createColumn(doc, bid, COLS * 260 + 60 + c * 320, 0, `col ${c}`));
    for (let m = 0; m < 15; m++) {
      const note = createNote(doc, bid, 0, 0, `member ${m}`);
      note.parentId = col.id;
      put(note);
    }
  }

  const canvasNotes = Object.values(doc.elements).filter((e) => e.type === 'note' && e.parentId === null);
  for (let i = 0; i < 150; i++) {
    const a = canvasNotes[i % canvasNotes.length]!;
    const b = canvasNotes[(i * 7 + 13) % canvasNotes.length]!;
    put(createLine(doc, bid, { el: a.id, x: a.x, y: a.y }, { el: b.id, x: b.x, y: b.y }));
  }

  for (let i = 0; i < 60; i++) {
    const anchor = canvasNotes[(i * 11 + 5) % canvasNotes.length]!;
    put(createComment(doc, bid, 0, 0, anchor.id));
  }

  for (let i = 0; i < 2; i++) {
    const tbl = put(createTable(doc, bid, COLS * 260 + 60, 500 + i * 700));
    tbl.content = {
      table: {
        title: `table ${i}`,
        caption: '',
        cells: Array.from({ length: 12 }, (_, r) => Array.from({ length: 10 }, (_, c) => ({ text: `r${r}c${c}` }))),
      },
    };
  }

  for (let i = 0; i < 3; i++) {
    const todo = put(createTodo(doc, bid, COLS * 260 + 500, 500 + i * 450));
    if ('todo' in todo.content) {
      todo.content.todo.items = Array.from({ length: 20 }, (_, j) => ({
        id: uid(),
        text: `item ${j}`,
        done: j % 3 === 0,
      }));
    }
  }

  for (let i = 0; i < 10; i++) {
    const pts: [number, number][] = [];
    for (let j = 0; j < 500; j++) pts.push([i * 120 + j * 0.6, 1800 + Math.sin(j / 8) * 60]);
    put(createAnnotation(doc, bid, [{ pts, color: '#323b4a', size: 3 }]));
  }

  for (let i = 0; i < 4; i++) {
    const sub = createBoard({ title: `sub ${i}`, parentId: bid });
    doc.boards[sub.id] = sub;
    put(createBoardCard(doc, bid, sub.id, COLS * 260 + 60 + i * 300, 1400));
  }

  return doc;
}
