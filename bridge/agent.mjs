#!/usr/bin/env node
// scatterboard-agent: localhost bridge between a live Scatterboard tab
// and AI agents. The app dials out over WebSocket (ws://127.0.0.1) and
// this process is also an MCP stdio server. Register it with
// `npm run agent:setup` (bridge/setup.mjs) rather than project config:
// IDE-embedded Devin only reads the user config for MCP servers.
//
// Flags: --port=N (7341), --origin=URL (extra allowed Origin, repeatable),
// --app=URL (pairing target), --token=T (fixed pairing token, testing).

import { execFile } from 'node:child_process';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { homedir, platform } from 'node:os';
import { join } from 'node:path';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { WebSocketServer } from 'ws';

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
// Session key: issued on pairing, presented on tokenless reconnect.
const key = createHmac('sha256', secret).update('scatterboard-agent').digest('hex');
// Pairing token: fresh every run unless --token pins one.
const token = String(flags.token ?? randomBytes(16).toString('base64url'));

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
const wss = new WebSocketServer({ noServer: true });
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
    pending.set(id, { resolve, reject, sock: null });
    send(appSock, { id, method, params });
    setTimeout(() => {
      if (pending.delete(id)) reject({ code: 'timeout', message: 'Scatterboard did not answer in 30s' });
    }, 30000);
  });
}

function greet(ws, msg) {
  if (!msg || msg.type !== 'hello') return deny(ws, 'expected hello');
  const authed = msg.token === token || (msg.bridgeId === bridgeId && msg.key === key);
  if (!authed) return deny(ws, 'bad credentials');
  ws.greeted = true;
  if (msg.role !== 'agent') {
    // One app session at a time; agents share the socket pool.
    if (appSock && appSock.readyState === appSock.OPEN) return deny(ws, 'busy');
    ws.isApp = true;
    appSock = ws;
  }
  send(ws, { type: 'welcome', bridgeId, key });
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
      clearTimeout(greetTimer);
      greet(ws, msg);
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
  sb_elements: 'elements',
  sb_get: 'get',
  sb_create: 'create',
  sb_patch: 'patch',
  sb_remove: 'remove',
  sb_connect: 'connect',
  sb_select: 'select',
  sb_view: 'view',
  sb_snapshot: 'snapshot',
  sb_undo: 'undo',
  sb_redo: 'redo',
  sb_batch: 'batch',
  sb_dispatch: 'dispatch',
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
    description: 'List all boards as {id,title,parentId}',
    inputSchema: obj({}),
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
      'Create a card. type: note|column|board|todo|heading|swatch|line|comment|link|embed|document|sketch|annotation|table. ' +
      'props: {x,y,w,color,parentId("unsorted"|columnId|null),boardId,labels,reactions} plus per-type fields: ' +
      'text/html (note,heading,document), level (heading), title (todo,column,board,document,table), items (todo,comment), ' +
      'url/kind (link,embed), value/caption (swatch), cells {B2:{text}} (table), strokes (sketch,annotation), ' +
      'from/to {el,x,y} (line), ref (board card to an existing board), anchorId (comment)',
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
        dashed: BOOL,
        fromMarker: { type: 'string', enum: ['none', 'arrow', 'dot'] },
        toMarker: { type: 'string', enum: ['none', 'arrow', 'dot'] },
      },
      ['from', 'to'],
    ),
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
    name: 'sb_snapshot',
    description: 'PNG snapshot of a board (default: the open board), returned as an image',
    inputSchema: obj({ boardId: STR }),
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
    description: 'Dispatch a raw store action: element.*, board.*, label.* or batch (trash.*/template.* are rejected)',
    inputSchema: obj({ action: { type: 'object' } }, ['action']),
  },
];

function openBrowser(url) {
  const plat = platform();
  if (plat === 'win32') execFile('cmd', ['/c', 'start', '', url], () => {});
  else if (plat === 'darwin') execFile('open', [url], () => {});
  else execFile('xdg-open', [url], () => {});
}

const text = (s) => ({ content: [{ type: 'text', text: s }] });

const mcp = new Server({ name: 'scatterboard-agent', version: '0.1.0' }, { capabilities: { tools: {} } });
mcp.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));
mcp.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params;
  try {
    if (name === 'sb_open') {
      const base = typeof args?.url === 'string' ? args.url : APP_URL;
      const url = `${base}${base.includes('?') ? '&' : '?'}agent=${token}`;
      openBrowser(url);
      return text(`Opened ${url}`);
    }
    if (name === 'sb_status') {
      const pairUrl = `${APP_URL}${APP_URL.includes('?') ? '&' : '?'}agent=${token}`;
      return text(JSON.stringify({ connected: !!appSock, bridgeId, port: PORT, pairUrl }));
    }
    const method = METHODS[name];
    if (!method) return { ...text(`unknown tool ${name}`), isError: true };
    const result = await requestApp(method, args ?? {});
    if (name === 'sb_snapshot' && result && typeof result.dataUrl === 'string') {
      return { content: [{ type: 'image', data: result.dataUrl.split(',')[1] ?? '', mimeType: 'image/png' }] };
    }
    return text(JSON.stringify(result));
  } catch (e) {
    return { content: [{ type: 'text', text: `${e?.code ?? 'error'}: ${e?.message ?? String(e)}` }], isError: true };
  }
});

console.error(`scatterboard-agent on ws://127.0.0.1:${PORT}`);
console.error(`pair: ${APP_URL}${APP_URL.includes('?') ? '&' : '?'}agent=${token}`);
await mcp.connect(new StdioServerTransport());
