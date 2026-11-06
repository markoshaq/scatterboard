#!/usr/bin/env node
// scatterboard-mcp: localhost bridge between a live Scatterboard tab
// and AI agents. The app dials out over WebSocket (ws://127.0.0.1) and
// this process is also an MCP stdio server. `npx scatterboard-mcp
// install` registers it in the Devin/Windsurf user configs (project
// config alone is ignored by IDE-embedded Devin); `npm run agent:setup`
// does the same against this checkout for repo dev.
//
// Flags: --port=N (7341), --origin=URL (extra allowed Origin, repeatable),
// --app=URL (pairing target), --token=T (fixed pairing token, testing).

import { execFile } from 'node:child_process';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { homedir, platform } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { WebSocketServer } from 'ws';

if (process.argv[2] === 'install' || process.argv[2] === '--install') {
  const { installMcp } = await import('./install.mjs');
  installMcp({ local: process.argv.includes('--local') });
  process.exit(0);
}

const flags = {};
const extraOrigins = [];
for (const a of process.argv.slice(2)) {
  const m = /^--([a-z]+)(?:=(.*))?$/.exec(a);
  if (!m) continue;
  if (m[1] === 'origin') extraOrigins.push(m[2]);
  else flags[m[1]] = m[2] ?? 'true';
}
const PORT = Number(flags.port) || 7341;
const APP_URL = String(flags.app ?? 'https://markoshaq.github.io/scatterboard/');

// --- identity ---

const configDir =
  platform() === 'win32'
    ? join(process.env.APPDATA || join(homedir(), 'AppData', 'Roaming'), 'scatterboard-agent')
    : join(homedir(), '.config', 'scatterboard-agent');
const configFile = join(configDir, 'config.json');
let config = null;
try {
  config = JSON.parse(readFileSync(configFile, 'utf8'));
} catch {
  config = null;
}
if (!config || typeof config.bridgeId !== 'string' || typeof config.secret !== 'string') {
  config = { bridgeId: randomUUID(), secret: randomBytes(32).toString('hex') };
  if (!existsSync(configDir)) mkdirSync(configDir, { recursive: true });
  writeFileSync(configFile, JSON.stringify(config, null, 2), { mode: 0o600 });
}
const { bridgeId, secret } = config;
// Session keys: appKey pairs app sockets, key serves agent sockets.
// Keeping them apart means a stolen agent key cannot squat the app
// slot and hijack other agents' requests.
const appKey = createHmac('sha256', secret).update('scatterboard-app').digest('hex');
const key = createHmac('sha256', secret).update('scatterboard-agent').digest('hex');
// Pairing token: fresh every run unless --token pins one, and rotated
// after each successful app hello so a leaked URL cannot be replayed.
const tokenPinned = !!flags.token && flags.token !== 'true';
let token = tokenPinned ? String(flags.token) : randomBytes(16).toString('base64url');

// --- websocket server ---

const allowed = new Set(['https://markoshaq.github.io', ...extraOrigins]);
function originOk(origin) {
  // Non-browser clients (node ws, curl) send no Origin; browsers always
  // do, and theirs must be allowlisted.
  if (!origin) return true;
  if (allowed.has(origin)) return true;
  try {
    const u = new URL(origin);
    return (u.hostname === 'localhost' || u.hostname === '127.0.0.1') && (u.protocol === 'http:' || u.protocol === 'https:');
  } catch {
    return false;
  }
}

const http = createServer((req, res) => {
  res.writeHead(404);
  res.end();
});
const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 * 1024 });
wss.on('headers', (headers, req) => {
  // Chrome Private Network Access: https pages may not open ws:// on
  // loopback unless the upgrade echoes this header.
  if (req.headers['access-control-request-private-network']) {
    headers.push('Access-Control-Allow-Private-Network: true');
  }
});
http.on('upgrade', (req, socket, head) => {
  if (!originOk(req.headers.origin)) {
    socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
});
http.on('error', (e) => {
  console.error(`scatterboard-agent: port ${PORT} unavailable (${e.code ?? e}); is another instance running?`);
  process.exit(1);
});
http.listen(PORT, '127.0.0.1');

// --- sessions ---

let appSock = null;
const pending = new Map();
let reqSeq = 0;

const send = (ws, obj) => {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
};
const deny = (ws, reason) => {
  send(ws, { type: 'deny', reason });
  ws.close();
};

function requestApp(method, params) {
  return new Promise((resolve, reject) => {
    if (!appSock || appSock.readyState !== appSock.OPEN) {
      reject({ code: 'no-app', message: 'no Scatterboard session connected; run sb_open to pair one' });
      return;
    }
    const id = `b${++reqSeq}`;
    pending.set(id, { resolve, reject });
    send(appSock, { id, method, params });
    setTimeout(() => {
      if (pending.delete(id)) reject({ code: 'timeout', message: 'Scatterboard did not answer in 30s' });
    }, 30000);
  });
}

const hmacOf = (k, s) => createHmac('sha256', k).update(s).digest('hex');

function welcomeApp(ws, proofSecret, proofNonce) {
  // One app session at a time; agents share the socket pool.
  if (appSock && appSock.readyState === appSock.OPEN) return deny(ws, 'busy');
  ws.greeted = true;
  ws.isApp = true;
  appSock = ws;
  // The bridge proves the same secret back: a port squatter that
  // answered the hello cannot mint a welcome the app will trust.
  send(ws, { type: 'welcome', bridgeId, key: appKey, proof: hmacOf(proofSecret, `${proofNonce}:bridge`) });
}

function greet(ws, msg) {
  if (!msg || (msg.type !== 'hello' && msg.type !== 'auth')) return deny(ws, 'expected hello');
  if (msg.type === 'hello') {
    if (msg.role !== 'app') {
      if (!(msg.bridgeId === bridgeId && msg.key === key)) return deny(ws, 'bad credentials');
      ws.greeted = true;
      send(ws, { type: 'welcome', bridgeId, key });
      return;
    }
    // Legacy hellos still carry credentials inline so older app
    // versions connect; anything else gets a challenge nonce and
    // proves the secret as HMAC instead of sending it.
    if (msg.bridgeId === bridgeId && msg.key === appKey) return welcomeApp(ws, appKey, '');
    if (msg.token === token) {
      const presented = token;
      if (!tokenPinned) token = randomBytes(16).toString('base64url');
      return welcomeApp(ws, presented, '');
    }
    ws.nonce = randomBytes(16).toString('base64url');
    send(ws, { type: 'challenge', nonce: ws.nonce });
    return;
  }
  // msg.type === 'auth': an app answering its challenge nonce.
  const n = ws.nonce;
  ws.nonce = undefined;
  if (!n) return deny(ws, 'expected hello');
  if (typeof msg.tokenMac === 'string' && msg.tokenMac === hmacOf(token, n)) {
    const presented = token;
    if (!tokenPinned) token = randomBytes(16).toString('base64url');
    return welcomeApp(ws, presented, n);
  }
  if (msg.bridgeId === bridgeId && typeof msg.mac === 'string' && msg.mac === hmacOf(appKey, n)) {
    return welcomeApp(ws, appKey, n);
  }
  return deny(ws, 'bad credentials');
}

wss.on('connection', (ws) => {
  ws.isApp = false;
  ws.greeted = false;
  const greetTimer = setTimeout(() => {
    if (!ws.greeted) ws.close();
  }, 10000);
  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      return;
    }
    if (!ws.greeted) {
      // The timer survives the hello -> challenge -> auth handshake:
      // only a successful greet disarms it.
      greet(ws, msg);
      if (ws.greeted) clearTimeout(greetTimer);
      return;
    }
    if (ws.isApp) {
      // App sockets only answer: match pending requests by bridge id.
      if (msg && msg.id !== undefined && msg.method === undefined) {
        const p = pending.get(msg.id);
        if (p) {
          pending.delete(msg.id);
          if (msg.error !== undefined) p.reject(msg.error);
          else p.resolve(msg.result);
        }
      }
      return;
    }
    // Agent sockets issue requests; the bridge re-ids them so several
    // agents cannot collide.
    if (msg && msg.id !== undefined && typeof msg.method === 'string') {
      const oid = msg.id;
      requestApp(msg.method, msg.params).then(
        (result) => send(ws, { id: oid, result }),
        (error) =>
          send(ws, {
            id: oid,
            error: { code: error?.code ?? 'error', message: error?.message ?? String(error) },
          }),
      );
    }
  });
  ws.on('close', () => {
    clearTimeout(greetTimer);
    if (ws.isApp && appSock === ws) {
      appSock = null;
      for (const [id, p] of pending) {
        pending.delete(id);
        p.reject({ code: 'no-app', message: 'Scatterboard session closed' });
      }
    }
  });
});

// --- MCP stdio server ---

const METHODS = {
  sb_openboard: 'openBoard',
  sb_boards: 'boards',
  sb_state: 'state',
  sb_labels: 'labels',
  sb_search: 'search',
  sb_elements: 'elements',
  sb_get: 'get',
  sb_create: 'create',
  sb_patch: 'patch',
  sb_remove: 'remove',
  sb_connect: 'connect',
  sb_trash: 'trash',
  sb_restore: 'restore',
  sb_emptytrash: 'emptyTrash',
  sb_select: 'select',
  sb_view: 'view',
  sb_present: 'present',
  sb_snapshot: 'snapshot',
  sb_templates: 'templates',
  sb_instantiate: 'instantiate',
  sb_savetemplate: 'saveTemplate',
  sb_upload: 'upload',
  sb_export: 'export',
  sb_import: 'import',
  sb_unfurl: 'unfurl',
  sb_duplicate: 'duplicate',
  sb_undo: 'undo',
  sb_redo: 'redo',
  sb_batch: 'batch',
  sb_dispatch: 'dispatch',
  sb_removeboard: 'removeBoard',
  sb_prefs: 'prefs',
  sb_snapshots: 'snapshots',
  sb_savesnapshot: 'saveSnapshot',
  sb_deletesnapshot: 'deleteSnapshot',
  sb_restoresnapshot: 'restoreSnapshot',
};

const STR = { type: 'string' };
const NUM = { type: 'number' };
const BOOL = { type: 'boolean' };
const obj = (properties, required = []) => ({ type: 'object', properties, required });

const TOOLS = [
  {
    name: 'sb_open',
    description: 'Open Scatterboard in the default browser with a pairing URL; call this first when no session is connected',
    inputSchema: obj({ url: { ...STR, description: 'app URL override, defaults to the deployed app' } }),
  },
  {
    name: 'sb_status',
    description: 'Bridge status: whether a Scatterboard tab is connected, plus the pairing URL',
    inputSchema: obj({}),
  },
  {
    name: 'sb_boards',
    description: 'List all boards as {id,title,parentId,icon,color,grid,position,presentOpts}',
    inputSchema: obj({}),
  },
  {
    name: 'sb_state',
    description: 'What is open right now: {boardId, selection, view {x,y,z}, presenting, locked, connected}',
    inputSchema: obj({}),
  },
  {
    name: 'sb_labels',
    description: 'List labels ({id,boardId,name,color}); boardId filters to one board, omitted returns all',
    inputSchema: obj({ boardId: STR }),
  },
  {
    name: 'sb_search',
    description: 'Find cards and boards by text. query required; boardId scopes to one board (default: the open board); all:true searches every board',
    inputSchema: obj({ query: STR, boardId: STR, all: BOOL }, ['query']),
  },
  {
    name: 'sb_openboard',
    description: 'Open a board by id in the connected tab',
    inputSchema: obj({ id: STR }, ['id']),
  },
  {
    name: 'sb_elements',
    description: 'List elements on a board (default: the open board), each with id/type/x/y/w/content/rect',
    inputSchema: obj({ boardId: STR }),
  },
  {
    name: 'sb_get',
    description: 'Get one element by id',
    inputSchema: obj({ id: STR }, ['id']),
  },
  {
    name: 'sb_create',
    description:
      'Create a card. type: note|column|board|todo|heading|swatch|line|comment|link|embed|document|sketch|annotation|table (image/file via sb_upload). ' +
      'props: {x,y,w,color,parentId("unsorted"|columnId|null),boardId,labels,reactions} plus per-type fields: ' +
      'text/html (note,heading,document), level (heading), title (todo,column,board,document,table), ' +
      'showTitle and items [{text,done,dueAt,dueTime,recur{f,n},assignee:"self",reactions}] (todo), text/items/add/anchorId (comment), ' +
      'url/title/caption/showPreview/desc/image (link), kind/url/title/caption/showPreview (embed), value/caption/showValue (swatch), ' +
      'from/to {el,x,y}/label/dashed/weight thin|medium|thick/route straight|elbow/fromMarker|toMarker none|arrow|dot (line), ' +
      'title/text/html/caption/displayMode icon|detail (document), caption/alt/strokes (image), ' +
      'cells {B2:{text,html,type,alignH,alignV,color}}/widths [numbers] (table), strokes (sketch,annotation), ' +
      'ref/title (board card to an existing or new board)',
    inputSchema: obj({ type: STR, props: { type: 'object' } }, ['type']),
  },
  {
    name: 'sb_patch',
    description:
      'Patch an element: top fields x,y,w,z,locked,color,boardId,parentId,labels,reactions,syncGroup,anchorId ' +
      '(null clears) plus the per-type content props from sb_create',
    inputSchema: obj({ id: STR, patch: { type: 'object' } }, ['id', 'patch']),
  },
  {
    name: 'sb_remove',
    description: 'Move an element to trash (undoable)',
    inputSchema: obj({ id: STR }, ['id']),
  },
  {
    name: 'sb_connect',
    description: 'Draw a connector line between two cards',
    inputSchema: obj(
      {
        from: STR,
        to: STR,
        label: STR,
        weight: { type: 'string', enum: ['thin', 'medium', 'thick'] },
        route: { type: 'string', enum: ['straight', 'elbow'] },
        dashed: BOOL,
        fromMarker: { type: 'string', enum: ['none', 'arrow', 'dot'] },
        toMarker: { type: 'string', enum: ['none', 'arrow', 'dot'] },
      },
      ['from', 'to'],
    ),
  },
  {
    name: 'sb_trash',
    description: 'List trashed elements as {id, deletedAt, el}',
    inputSchema: obj({}),
  },
  {
    name: 'sb_restore',
    description: 'Restore a trashed element to a board (default: the open board); x/y default to its old spot',
    inputSchema: obj({ id: STR, boardId: STR, x: NUM, y: NUM }, ['id']),
  },
  {
    name: 'sb_emptytrash',
    description: 'Empty the trash permanently (one undoable entry)',
    inputSchema: obj({}),
  },
  {
    name: 'sb_select',
    description: 'Select elements by id',
    inputSchema: obj({ ids: { type: 'array', items: STR } }, ['ids']),
  },
  {
    name: 'sb_view',
    description: 'Pan/zoom the viewport: center board point (x,y) at zoom z; omitted fields keep current values',
    inputSchema: obj({ x: NUM, y: NUM, z: NUM }),
  },
  {
    name: 'sb_present',
    description:
      'Presentation mode: on enters, off exits; focus dims unselected cards, comments hides comment pins, edit prevents editing (per-board, persisted)',
    inputSchema: obj({ on: BOOL, focus: BOOL, comments: BOOL, edit: BOOL }),
  },
  {
    name: 'sb_snapshot',
    description:
      'PNG raster of a board (default: the open board), returned as an image. x,y,w,h crop to a board-space region (all four required together); scale defaults to 2. Not a version-history snapshot; see sb_snapshots',
    inputSchema: obj({ boardId: STR, x: NUM, y: NUM, w: NUM, h: NUM, scale: NUM }),
  },
  {
    name: 'sb_templates',
    description: 'List templates (builtin presets and saved) as {id,name,builtin,elements}',
    inputSchema: obj({}),
  },
  {
    name: 'sb_instantiate',
    description:
      'Instantiate a template into a new board: child of boardId with a board card at x,y (default: open board, viewport center); boardId null makes a root project board and opens it',
    inputSchema: obj({ id: STR, boardId: { type: ['string', 'null'] }, x: NUM, y: NUM }, ['id']),
  },
  {
    name: 'sb_savetemplate',
    description: 'Save a board (default: the open board) as a reusable template',
    inputSchema: obj({ boardId: STR, name: STR }),
  },
  {
    name: 'sb_upload',
    description:
      'Create an image or file card from base64 data (or a base64 data URL). Type comes from the data URL, else mime, else application/octet-stream; image/* gets a downscaled image card (caption applies), anything else a file card',
    inputSchema: obj(
      {
        data: STR,
        name: STR,
        mime: STR,
        caption: STR,
        boardId: STR,
        parentId: STR,
        x: NUM,
        y: NUM,
      },
      ['data'],
    ),
  },
  {
    name: 'sb_export',
    description:
      'Export a board (default: the open board). format: png (image), pdf, md, txt, doc, json, zip (media files), csv (one table card; id required). subs includes sub-boards in text exports; hi renders pdf at 2x. Returns {name,mime,dataUrl} or {name,mime,text}',
    inputSchema: obj(
      {
        format: { type: 'string', enum: ['png', 'pdf', 'md', 'txt', 'doc', 'json', 'zip', 'csv'] },
        boardId: STR,
        id: STR,
        subs: BOOL,
        hi: BOOL,
      },
      ['format'],
    ),
  },
  {
    name: 'sb_import',
    description: 'Import a board JSON export (the text produced by format=json), attached under boardId or the Home/root board; opens the imported board',
    inputSchema: obj({ data: STR, boardId: STR }, ['data']),
  },
  {
    name: 'sb_unfurl',
    description: 'Fetch the link/embed card\'s page preview and back-fill title/desc/image (link cards need the app\'s unfurl setting on)',
    inputSchema: obj({ id: STR }, ['id']),
  },
  {
    name: 'sb_duplicate',
    description: 'Clone elements in place with fresh ids (selection, column membership and line endpoints follow); dx/dy offset defaults to 24',
    inputSchema: obj({ ids: { type: 'array', items: STR }, dx: NUM, dy: NUM }, ['ids']),
  },
  { name: 'sb_undo', description: 'Undo the last change', inputSchema: obj({}) },
  { name: 'sb_redo', description: 'Redo', inputSchema: obj({}) },
  {
    name: 'sb_batch',
    description: 'Run several commands as one undo entry; on any failure nothing changes. commands: [{method,params}]',
    inputSchema: obj({ commands: { type: 'array', items: { type: 'object' } } }, ['commands']),
  },
  {
    name: 'sb_dispatch',
    description:
      'Dispatch a raw store action: element.*, board.*, label.*, template.patch, template.delete or batch (trash.*, board.delete and template.create are rejected; use sb_restore/sb_emptytrash/sb_removeboard/sb_savetemplate)',
    inputSchema: obj({ action: { type: 'object' } }, ['action']),
  },
  {
    name: 'sb_removeboard',
    description: 'Delete a board and its whole subtree: elements, labels, sub-boards and dangling board cards elsewhere. One undoable batch; fails on the last board',
    inputSchema: obj({ id: STR }, ['id']),
  },
  {
    name: 'sb_prefs',
    description:
      'Read app prefs, or pass set:{key:value} to change one of: reminders, unfurl, noOverlap, ink, undoArrows, autoEdit, spellcheck, minimap, browserLang, welcomed, theme (light|dark), unsortedSort, currency, uiScale, guideAlpha',
    inputSchema: obj({ set: { type: 'object' } }),
  },
  {
    name: 'sb_snapshots',
    description: 'List version-history snapshots {id,name,createdAt,auto}; pass id to browse the snapshot\'s boards and elements (for sb_restoresnapshot)',
    inputSchema: obj({ id: STR }),
  },
  {
    name: 'sb_savesnapshot',
    description: 'Save the whole workspace as a named version-history snapshot',
    inputSchema: obj({ name: STR }),
  },
  {
    name: 'sb_deletesnapshot',
    description: 'Delete a version-history snapshot by id',
    inputSchema: obj({ id: STR }, ['id']),
  },
  {
    name: 'sb_restoresnapshot',
    description:
      'Restore one board out of a snapshot into the live doc as a new sub-board: boardId picks the snapshot board (default: its root board), hostId picks the live parent board (default: a surviving root). Undoable; does not replace the workspace',
    inputSchema: obj({ id: STR, boardId: STR, hostId: STR }, ['id']),
  },
];

function pairUrlFor(base) {
  const hash = base.indexOf('#');
  const head = hash < 0 ? base : base.slice(0, hash);
  const tail = hash < 0 ? '' : base.slice(hash);
  return `${head}${head.includes('?') ? '&' : '?'}agent=${token}${tail}`;
}

function openBrowser(url) {
  const plat = platform();
  if (plat === 'win32') execFile('cmd', ['/c', 'start', '', url], () => {});
  else if (plat === 'darwin') execFile('open', [url], () => {});
  else execFile('xdg-open', [url], () => {});
}

const text = (s) => ({ content: [{ type: 'text', text: s }] });

const pkg = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'package.json'), 'utf8'));
const mcp = new Server({ name: 'scatterboard-agent', version: pkg.version }, { capabilities: { tools: {} } });
mcp.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));
mcp.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params;
  try {
    if (name === 'sb_open') {
      const base = typeof args?.url === 'string' && /^https?:\/\//i.test(args.url) ? args.url : APP_URL;
      const url = pairUrlFor(base);
      openBrowser(url);
      return text(`Opened ${url}`);
    }
    if (name === 'sb_status') {
      const pairUrl = pairUrlFor(APP_URL);
      return text(JSON.stringify({ connected: !!appSock, bridgeId, port: PORT, pairUrl, agentKey: key }));
    }
    const method = METHODS[name];
    if (!method) return { ...text(`unknown tool ${name}`), isError: true };
    const result = await requestApp(method, args ?? {});
    if (result && typeof result.dataUrl === 'string') {
      const mime = typeof result.mime === 'string' ? result.mime : 'image/png';
      if (mime.startsWith('image/')) {
        return { content: [{ type: 'image', data: result.dataUrl.split(',')[1] ?? '', mimeType: mime }] };
      }
    }
    if (result && typeof result.text === 'string' && typeof result.name === 'string' && typeof result.mime === 'string') {
      return text(result.text);
    }
    return text(JSON.stringify(result));
  } catch (e) {
    return { content: [{ type: 'text', text: `${e?.code ?? 'error'}: ${e?.message ?? String(e)}` }], isError: true };
  }
});

console.error(`scatterboard-agent on ws://127.0.0.1:${PORT}`);
console.error(`pair: ${pairUrlFor(APP_URL)}`);
await mcp.connect(new StdioServerTransport());
