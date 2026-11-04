import type { App } from '../app';
import { t } from '../strings';
import { popDismiss, pushDismiss } from '../ui/popup';
import { createAgentApi, type AgentApi } from './api';
import { runCommandUrl } from './cmdurl';
import { startClient, type AgentClient } from './client';

let client: AgentClient | null = null;
let clientApi: AgentApi | null = null;

// Pairing confirm: a centered modal over a dimmed scrim so the prompt
// cannot be missed (a bottom toast was too easy to overlook).
function pairModal(onConnect: () => void) {
  const scrim = document.createElement('div');
  scrim.className = 'short-scrim pair-scrim';
  const box = document.createElement('div');
  box.className = 'short-box pair-box';
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');
  const title = document.createElement('div');
  title.className = 'pair-title';
  title.textContent = t('agentPairTitle');
  const msg = document.createElement('div');
  msg.className = 'pair-msg';
  msg.textContent = t('agentPairAsk');
  const row = document.createElement('div');
  row.className = 'pair-actions';
  const no = document.createElement('button');
  no.type = 'button';
  no.className = 'pair-btn';
  no.textContent = t('drawCancel');
  const yes = document.createElement('button');
  yes.type = 'button';
  yes.className = 'pair-btn pair-primary';
  yes.textContent = t('agentPairConnect');
  row.append(no, yes);
  box.append(title, msg, row);
  scrim.appendChild(box);
  const handle = {
    close() {
      popDismiss(handle);
      scrim.remove();
    },
  };
  no.addEventListener('click', () => handle.close());
  yes.addEventListener('click', () => {
    handle.close();
    onConnect();
  });
  scrim.addEventListener('pointerdown', (e) => {
    if (e.target === scrim) handle.close();
  });
  document.body.appendChild(scrim);
  pushDismiss(handle);
}

// Settings toggle: on starts a tokenless session (stored key pairs or
// the status line stays disconnected), off drops the socket.
export function setAgentEnabled(app: App, on: boolean) {
  if (!on) {
    client?.stop();
    client = null;
    return;
  }
  if (client) return;
  clientApi ??= createAgentApi(app);
  client = startClient(app, clientApi, {});
}

// Boot entry from boot.ts: the ?do= command list runs once, ?agent=
// pairs a persistent bridge session, and a stored agent pref
// reconnects tokenless. Consumed params are stripped from the URL.
export function init(app: App) {
  const url = new URL(location.href);
  const doRaw = url.searchParams.get('do');
  const agent = url.searchParams.get('agent');
  const port = url.searchParams.get('port');
  clientApi ??= createAgentApi(app);
  const api = clientApi;

  if (doRaw !== null) void runCommandUrl(app, api, doRaw);

  const start = () => {
    if (client) return;
    const opts: { token?: string; port?: number } = {};
    if (agent) opts.token = agent;
    // An out-of-range port throws inside the WebSocket constructor;
    // ignore anything that is not a valid port.
    const p = Number(port);
    if (Number.isInteger(p) && p >= 1 && p <= 65535) opts.port = p;
    client = startClient(app, api, opts);
  };

  if (agent !== null || port !== null) {
    // URL-driven pairing asks first: the socket can drive the board and
    // a welcome persists credentials, same gate as mutating ?do= lists.
    // A centered modal, not a toast, so the prompt cannot be missed.
    pairModal(start);
  } else if (app.prefs.agent) {
    start();
  }

  if (doRaw !== null || agent !== null || port !== null) {
    url.searchParams.delete('do');
    url.searchParams.delete('agent');
    url.searchParams.delete('port');
    history.replaceState(null, '', url);
  }
}
