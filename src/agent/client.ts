import { t } from '../strings';
import { toast } from '../ui/toast';
import { AgentError, type Dict } from './validate';
import type { AgentApi, AgentHost } from './api';

const DEFAULT_PORT = 7341;

// The app never sends credentials in the clear: the bridge answers
// the hello with a nonce, and both sides prove the shared secret as
// HMAC(secret, nonce). A process squatting the port learns nothing it
// can replay or persist.
async function hmacHex(key: string, data: string): Promise<string> {
  const enc = new TextEncoder();
  const k = await crypto.subtle.importKey('raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', k, enc.encode(data));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Mirrors the literal in settings.ts; kept as a DOM event so the lazy
// chunk never enters the main bundle's import graph.
const AGENT_STATUS_EVENT = 'sb-agent-status';

export interface AgentClient {
  stop(): void;
}

// Persistent bridge session: hello pairs once (token) or reconnects
// (stored bridge key), then answers {id, method, params} requests.
export function startClient(
  app: AgentHost,
  api: AgentApi,
  opts: { token?: string; port?: number } = {},
): AgentClient {
  const port = opts.port ?? DEFAULT_PORT;
  let ws: WebSocket | null = null;
  let active = true;
  let giveUp = false;
  let greeted = false;
  let deniedToast = false;
  let denyCount = 0;
  let offlineToast = false;
  let attempts = 0;
  let timer: number | null = null;
  // The live challenge + the secret we authenticated with (stored key
  // or pairing token): the bridge proves the same secret back before
  // a welcome counts.
  let nonce: string | null = null;
  let authedSecret: string | null = null;
  // Requests serialize: concurrent batches would interleave their store
  // dispatches and merge undo entries.
  let queue: Promise<void> = Promise.resolve();

  const setStatus = (on: boolean) => {
    if (app.agentConnected === on) return;
    app.agentConnected = on;
    window.dispatchEvent(new Event(AGENT_STATUS_EVENT));
  };

  const connect = () => {
    if (!active || giveUp) return;
    // The handshake needs WebCrypto HMAC; an insecure context cannot
    // authenticate at all, so do not retry.
    if (!crypto.subtle) {
      giveUp = true;
      return;
    }
    ws = new WebSocket(`ws://127.0.0.1:${port}`);
    ws.onopen = () => {
      ws!.send(JSON.stringify({ type: 'hello', role: 'app' }));
    };
    ws.onmessage = (ev) => {
      let msg: Dict;
      try {
        msg = JSON.parse(String(ev.data)) as Dict;
      } catch {
        return;
      }
      if (msg.type === 'challenge') return onChallenge(msg);
      if (msg.type === 'welcome') return void onWelcome(msg);
      if (msg.type === 'deny') return onDeny(msg);
      if (!greeted) return;
      if (msg.id !== undefined && typeof msg.method === 'string') {
        queue = queue.then(() => handle(msg as { id: unknown; method: string; params?: unknown }));
      }
    };
    ws.onclose = () => onClose();
  };

  // Answer the bridge's nonce: stored credentials send
  // HMAC(appKey, nonce); first pairing sends HMAC(token, nonce) so the
  // token itself never crosses the wire either.
  const onChallenge = (msg: Dict) => {
    if (typeof msg.nonce !== 'string' || !msg.nonce) return;
    nonce = msg.nonce;
    const bridge = app.prefs.agentBridge;
    void (async () => {
      const auth: Dict = { type: 'auth', role: 'app' };
      try {
        if (bridge) {
          auth.bridgeId = bridge.id;
          auth.mac = await hmacHex(bridge.key, nonce!);
          authedSecret = bridge.key;
        } else if (opts.token) {
          auth.tokenMac = await hmacHex(opts.token, nonce!);
          authedSecret = opts.token;
        } else {
          // Nothing to prove with: stay enabled so a later pairing URL
          // can connect, but stop reconnecting now.
          giveUp = true;
          ws?.close();
          return;
        }
      } catch {
        return;
      }
      ws?.send(JSON.stringify(auth));
    })();
  };

  const onWelcome = async (msg: Dict) => {
    const n = nonce;
    const secret = authedSecret;
    nonce = null;
    // The welcome only counts if the peer proves the same secret we
    // authenticated with: anything else is a port squatter and must
    // never reach persistence or command handling.
    const ok =
      n !== null &&
      secret !== null &&
      typeof msg.proof === 'string' &&
      msg.proof === (await hmacHex(secret, `${n}:bridge`));
    if (!ok) {
      ws?.close();
      return;
    }
    attempts = 0;
    const first = !app.agentConnected;
    greeted = true;
    deniedToast = false;
    setStatus(true);
    if (typeof msg.bridgeId === 'string' && typeof msg.key === 'string') {
      const cur = app.prefs.agentBridge;
      if (!cur || cur.id !== msg.bridgeId || cur.key !== msg.key) {
        app.prefs.agentBridge = { id: msg.bridgeId, key: msg.key };
      }
      app.prefs.agent = true;
      app.scheduleSave();
    }
    if (first) toast(t('agentConnected'), 'ok');
  };

  const onDeny = (msg: Dict) => {
    if (!deniedToast) {
      deniedToast = true;
      toast(t('agentDenied'), 'err');
    }
    if (msg.reason === 'busy') return; // another tab holds the session; keep retrying
    // Auth failure: a stored key the bridge no longer honours is stale.
    if (app.prefs.agentBridge) {
      delete app.prefs.agentBridge;
      app.scheduleSave();
    }
    // A bad token will not heal itself, and without credentials there
    // is nothing left to try: stay enabled so a later pairing URL can
    // connect, but stop reconnecting now.
    if (!opts.token || ++denyCount > 3) giveUp = true;
    ws?.close();
  };

  const onClose = () => {
    const wasOn = app.agentConnected;
    setStatus(false);
    if (wasOn) {
      greeted = false;
      toast(t('agentStatusOff'));
    }
    if (!active || giveUp) return;
    attempts++;
    if (!greeted && attempts === 4 && !offlineToast) {
      offlineToast = true;
      toast(t('agentStatusOff'));
    }
    const delay = Math.min(15000, 800 * 1.7 ** attempts);
    timer = window.setTimeout(connect, delay);
  };

  const handle = async (msg: { id: unknown; method: string; params?: unknown }) => {
    try {
      const result = await api.run(msg.method, msg.params);
      ws?.send(JSON.stringify({ id: msg.id, result }));
    } catch (e) {
      const err = e instanceof AgentError ? e : new AgentError('internal', e instanceof Error ? e.message : String(e));
      ws?.send(JSON.stringify({ id: msg.id, error: { code: err.code, message: err.message } }));
    }
  };

  connect();
  return {
    stop() {
      active = false;
      setStatus(false);
      if (timer !== null) window.clearTimeout(timer);
      ws?.close();
    },
  };
}
