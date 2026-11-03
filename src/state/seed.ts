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

const GUIDE_MD = `# Scatterboard 101

- Double-click any card to edit it
- Drag cards to move them, drop them into columns to file them
- Pull a line out from any card edge to connect ideas
- Space + drag pans, scroll zooms, Z fits the whole board
- / opens every shortcut
- Cards file to Unsorted and recover from Trash, both in the top bar
- Everything saves locally, all the time
`;

// The welcome board references two generated blobs; writes go through
// the normal IndexedDB store so image/file cards resolve like any
// ingest. Best-effort: a failed write just leaves a placeholder.
function seedBlobs(): { imgRef: string; fileRef: string; fileSize: number } {
  const imgRef = uid();
  const fileRef = uid();
  const file = new Blob([GUIDE_MD], { type: 'text/markdown' });
  void putBlob(imgRef, new Blob([COVER_SVG], { type: 'image/svg+xml' })).catch(() => {});
  void putBlob(fileRef, file).catch(() => {});
  return { imgRef, fileRef, fileSize: file.size };
}

export function seedDoc(): Doc {
  const doc = emptyDoc();
  const home = createBoard({ id: 'home', title: t('homeTitle'), icon: 'g:rocket', color: '#e8734a' });
  doc.boards[home.id] = home;
  const bid = home.id;
  const { imgRef, fileRef, fileSize } = seedBlobs();

  // First-open camera, written as the saved transform restore() picks
  // up: the board point that lands on screen centre so the framing
  // holds at any window size.
  const cam = { x: 1.0893690280176525, y: 81.20198682296765, z: 0.9477688080966911 };
  home.position = {
    x: innerWidth / 2 - cam.x * cam.z,
    y: innerHeight / 2 - cam.y * cam.z,
    z: cam.z,
  };

  // First-run welcome board: a poster that is also a working tour of
  // every card type and trick, centred on the origin so the default
  // view opens on the hero.
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

  const lblFeature = createLabel(bid, 'Feature', '#3d84e0');
  const lblTip = createLabel(bid, 'Tip', '#5f9e5f');
  const lblTry = createLabel(bid, 'Try me', '#e8734a');
  const lblIdea = createLabel(bid, 'Idea', '#d6508f');
  doc.labels[lblFeature.id] = lblFeature;
  doc.labels[lblTip.id] = lblTip;
  doc.labels[lblTry.id] = lblTry;
  doc.labels[lblIdea.id] = lblIdea;

  // --- Hero ---
  const h1 = put(createHeading(doc, bid, -520, -280, 1));
  h1.w = 560;
  h1.content = { heading: { text: 'Scatterboard', level: 1 } };
  put(createAnnotation(doc, bid, [{ pts: wavePts(-512, -16, -230, 6, 60), color: '#e8734a', size: 5 }]));
  const h2 = put(createHeading(doc, bid, -516, -210, 2));
  h2.w = 560;
  h2.content = { heading: { text: 'An infinite canvas where every idea gets a card', level: 2 } };

  const intro = note(-516, -160, '', 300);
  intro.content = {
    note: {
      text: 'Welcome aboard\nA local-first planning wall. Everything on this page is a real card: move it, edit it, delete it. Nothing ever leaves your machine.',
      html: '<p><b>Welcome aboard</b></p><p>A local-first planning wall. Everything on this page is a real card: move it, edit it, delete it. Nothing ever leaves your machine.</p>',
    },
  };
  intro.reactions = ['🚀', '💡', '✨'];
  intro.labels = [lblFeature.id];

  const howTo = put(createTodo(doc, bid, -516, 17));
  howTo.w = 280;
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

  const heroImg = put(createImage(doc, bid, 18, -268, imgRef, 'cover.svg', 1.5, 960, 640));
  heroImg.w = 480;
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

  const heroPin = put(createComment(doc, bid, 240, -345, heroImg.id));
  heroPin.content = {
    comment: {
      items: [
        { id: 'w-c1', text: 'Pins are comment threads anchored to a card.', createdAt: now - 5400000 },
        { id: 'w-c2', text: 'Click me to read or reply.', createdAt: now - 4800000 },
      ],
    },
  };

  const lineIntro = createLine(doc, bid, { el: intro.id, x: intro.x, y: intro.y }, { el: heroImg.id, x: heroImg.x, y: heroImg.y });
  lineIntro.content = { line: { ...lineDoc(lineIntro)!, label: 'draw on me' } };
  put(lineIntro);

  // --- The card gallery ---
  const h2gal = put(createHeading(doc, bid, 640, -280, 2));
  h2gal.w = 440;
  h2gal.content = { heading: { text: 'Every idea gets a card', level: 2 } };

  const demoNote = note(640, -242, '', 240);
  demoNote.color = '#fdf2e0';
  demoNote.labels = [lblTip.id];
  demoNote.reactions = ['👍'];
  demoNote.content = {
    note: {
      text: 'Notes carry rich text: bold, italic, inline code, lists and links.',
      html: '<p><b>Notes</b> carry <i>rich text</i>, <code>inline code</code>, lists and links.</p>',
    },
  };

  const wTodo = put(createTodo(doc, bid, 920, -242));
  wTodo.w = 260;
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

  const wTbl = put(createTable(doc, bid, 1220, -242));
  wTbl.w = 360;
  wTbl.content = {
    table: {
      title: 'Launch metrics',
      caption: 'Typed cells and live formulas',
      widths: [130, 80, 80, 70],
      cells: [
        [{ text: 'Metric', color: '#e8f0fe' }, { text: 'This week', color: '#e8f0fe' }, { text: 'Last week', color: '#e8f0fe' }, { text: 'Hit?', color: '#e8f0fe' }],
        [{ text: 'Signups' }, { text: '1890', type: 'number' }, { text: '1240', type: 'number' }, { text: '1', type: 'checkbox' }],
        [{ text: 'Revenue' }, { text: '4600', type: 'currency' }, { text: '3200', type: 'currency' }, { text: '1', type: 'checkbox' }],
        [{ text: 'Churn' }, { text: '0.02', type: 'percent' }, { text: '0.04', type: 'percent' }, { text: '0', type: 'checkbox' }],
        [{ text: 'Trend' }, { text: 'up' }, { text: '=IF(B2>C2,"grew","flat")' }, { text: '2026-11-14', type: 'datetime' }],
      ],
    },
  };

  const wDoc = put(createDocument(doc, bid, 1655, -228));
  wDoc.content = {
    document: {
      title: 'Launch brief',
      text: 'The idea\nOne canvas, every kind of card, zero servers.\n\nWhy it works\nCards stay sharp at any zoom\nUndo goes all the way back\nExports to PNG, PDF, Markdown and zip',
      html: '<h3>The idea</h3><p>One canvas, every kind of card, <b>zero servers</b>.</p><h3>Why it works</h3><ul><li>Cards stay sharp at any zoom</li><li>Undo goes all the way back</li><li>Exports to PNG, PDF, Markdown and zip</li></ul>',
      displayMode: 'detail',
      caption: 'Documents open as a full editor',
    },
  };

  const wLink = put(createLink(doc, bid, 640, 160, 'https://example.com'));
  wLink.content = {
    link: {
      url: 'https://example.com',
      title: 'Link cards',
      caption: 'Paste any URL onto the board',
      desc: 'A saved link with a title, a caption and a preview slot.',
      showPreview: true,
    },
  };

  const wVid = put(createEmbed(doc, bid, 'video', 960, 160));
  wVid.content = {
    embed: {
      kind: 'video',
      url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      title: 'Video embeds',
      caption: 'YouTube and Vimeo play in place',
      showPreview: true,
    },
  };
  const wAud = put(createEmbed(doc, bid, 'audio', 1280, 160));
  wAud.content = {
    embed: {
      kind: 'audio',
      url: 'https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC',
      title: 'Audio embeds',
      caption: 'Spotify and SoundCloud too',
      showPreview: true,
    },
  };
  const wMap = put(createEmbed(doc, bid, 'map', 1600, 160));
  wMap.content = {
    embed: {
      kind: 'map',
      url: 'https://www.google.com/maps/place/Crater+Lake',
      title: 'Map embeds',
      caption: 'Drop a Google Maps link',
      showPreview: true,
    },
  };

  put(createFile(doc, bid, 1680, 439, fileRef, 'scatterboard-101.md', fileSize, 'text/markdown'));

  const wSketch = put(createSketch(doc, bid, 640, 440));
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

  const sw1 = put(createSwatch(doc, bid, 960, 440, '#e8734a'));
  sw1.content = { swatch: { color: '#e8734a', caption: 'Sunset', showValue: true } };
  const sw2 = put(createSwatch(doc, bid, 1200, 440, '#3d84e0'));
  sw2.content = { swatch: { color: '#3d84e0', caption: 'Ocean', showValue: true } };
  const sw3 = put(createSwatch(doc, bid, 1440, 440, '#5f9e5f'));
  sw3.content = { swatch: { color: '#5f9e5f', caption: 'Meadow', showValue: true } };
  const paletteNote = note(1080, 640, 'Swatches hold a palette. Drag one onto the rail colour well to restyle this board.', 480);
  paletteNote.color = '#fdf2e0';
  paletteNote.labels = [lblTip.id];

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

  put(createBoardCard(doc, bid, playground.id, 1960, 449));
  const boardNote = note(1960, 530, 'Boards nest inside boards. Click through to peek.', 240);
  boardNote.labels = [lblFeature.id];

  // --- Organize ---
  const h2org = put(createHeading(doc, bid, -520, 240, 2));
  h2org.w = 440;
  h2org.content = { heading: { text: 'Organize the mess', level: 2 } };

  const colCollect = put(createColumn(doc, bid, -520, 280, 'Collect'));
  const colShape = put(createColumn(doc, bid, -220, 280, 'Shape'));
  const colShip = put(createColumn(doc, bid, 80, 280, 'Ship'));
  const members: [Element, [string, string?][]][] = [
    [colCollect, [['Paste links, images and files straight in'], ['Stray thought? Quick-capture it']]],
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

  const noteUns = note(393, 320, 'Cards file to Unsorted, deleted cards wait in Trash. Both open from the top bar.', 220);
  noteUns.color = '#fdf2e0';

  // --- Power moves ---
  const h2pow = put(createHeading(doc, bid, -520, 690, 2));
  h2pow.w = 400;
  h2pow.content = { heading: { text: 'Power moves', level: 2 } };

  const syncGroup = uid();
  const syncText = 'We are synced notes. Edit either of us and both change.';
  const syncA = note(-520, 730, syncText, 280);
  syncA.syncGroup = syncGroup;
  syncA.labels = [lblFeature.id];
  const syncB = note(-220, 730, syncText, 280);
  syncB.syncGroup = syncGroup;
  syncB.color = '#e9f5ec';

  const locked = note(130, 720, 'I am locked in place. Select me and unlock from the rail to move me.', 240);
  locked.locked = true;
  locked.color = '#fae3e3';
  put(
    createAnnotation(doc, bid, [
      { pts: ellipsePts(250, 765, 175, 125, 64), color: '#d6504a', size: 5 },
      { pts: ellipsePts(250, 765, 166, 117, 64, 0.4), color: '#d6504a', size: 5 },
    ]),
  );

  const demoLbl = note(450, 730, 'Labels and reactions stick to any card. This one wears both.', 280);
  demoLbl.labels = [lblIdea.id, lblTry.id];
  demoLbl.reactions = ['❤️', '🔥', '👀'];

  const freeCom = put(createComment(doc, bid, 461, 931));
  freeCom.content = {
    comment: {
      items: [
        { id: 'w-c3', text: 'Comments float free anywhere on the canvas,', createdAt: now - 7200000 },
        { id: 'w-c4', text: 'or pin to a card, like the cover art above.', createdAt: now - 7000000 },
      ],
    },
  };

  const lineNote = note(1030, 840, 'Lines take labels, arrowheads, dots and dashes. Pull one out from any card edge.', 280);
  lineNote.labels = [lblTip.id];

  const lineSync = createLine(doc, bid, { el: syncA.id, x: syncA.x, y: syncA.y }, { el: syncB.id, x: syncB.x, y: syncB.y });
  lineSync.content = { line: { ...lineDoc(lineSync)!, label: 'synced', dashed: true, weight: 'thin', fromMarker: 'dot', toMarker: 'dot' } };
  put(lineSync);
  const lineCite = createLine(doc, bid, { el: wTbl.id, x: wTbl.x, y: wTbl.y }, { el: wDoc.id, x: wDoc.x, y: wDoc.y });
  lineCite.content = { line: { ...lineDoc(lineCite)!, label: 'cite', weight: 'thin' } };
  put(lineCite);
  const lineFloat = createLine(doc, bid, { el: demoLbl.id, x: demoLbl.x, y: demoLbl.y }, { el: freeCom.id, x: freeCom.x, y: freeCom.y });
  lineFloat.content = { line: { ...lineDoc(lineFloat)!, label: 'or float', dashed: true, weight: 'thin' } };
  put(lineFloat);

  const sl1 = createLine(doc, bid, { x: 1000, y: 1020 }, { x: 1340, y: 980 });
  sl1.content = { line: { ...lineDoc(sl1)!, label: 'thick', weight: 'thick' } };
  put(sl1);
  const sl2 = createLine(doc, bid, { x: 1000, y: 1080 }, { x: 1340, y: 1040 });
  sl2.content = { line: { ...lineDoc(sl2)!, label: 'dashed', dashed: true } };
  put(sl2);
  const sl3 = createLine(doc, bid, { x: 1000, y: 1140 }, { x: 1340, y: 1100 });
  sl3.content = { line: { ...lineDoc(sl3)!, label: 'dots', weight: 'thin', fromMarker: 'dot', toMarker: 'dot' } };
  put(sl3);
  note(1380, 995, 'Weights, dashes, markers and labels, all from the rail.', 260);

  // --- Footer ---
  const h2foot = put(createHeading(doc, bid, -516, 961, 2));
  h2foot.w = 440;
  h2foot.content = { heading: { text: 'Now make it yours', level: 2 } };
  note(
    -516,
    1000,
    'This board is your sandbox: move it, break it, rebuild it. Everything saves locally as you work. Press Z to see the whole thing.',
    480,
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
