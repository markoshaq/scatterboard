import type { App } from '../app';
import { t } from '../strings';
import { choice } from '../ui/toast';
import { createAgentApi, type AgentApi } from './api';
import { runCommandUrl } from './cmdurl';
import { startClient, type AgentClient } from './client';

let client: AgentClient | null = null;
let clientApi: AgentApi | null = null;

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
    choice(t('agentPairAsk'), t('agentPairConnect'), start, undefined, 0);
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
