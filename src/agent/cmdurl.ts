import { t } from '../strings';
import { choice, toast } from '../ui/toast';
import { parseCommand, URL_SAFE, type AgentApi, type AgentCommand, type AgentHost } from './api';
import { fail } from './validate';

// Decoded ?do= payloads may not exceed this.
const MAX_DO = 64 * 1024;

function b64urlDecode(s: string): string {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=');
  const bin = atob(b64);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export function parseCommandUrl(raw: string): AgentCommand[] {
  let json: string;
  try {
    json = b64urlDecode(raw);
  } catch {
    fail('bad_payload', 'do= is not base64url JSON');
  }
  if (json.length > MAX_DO) fail('too_large', `do= payload exceeds ${MAX_DO} chars`);
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    fail('bad_payload', 'do= is not base64url JSON');
  }
  const list = Array.isArray(data) ? data : (data as { commands?: unknown[] })?.commands;
  if (!Array.isArray(list)) fail('bad_payload', 'do= must be a command array or {commands: []}');
  return list.map(parseCommand);
}

// One-shot command links: plan everything first, then run inside one
// store group so a bad command leaves the board untouched. Links can
// come from anywhere, so a list containing mutations asks first; read
// and navigation commands run straight away.
export async function runCommandUrl(app: AgentHost, api: AgentApi, raw: string) {
  let commands: AgentCommand[];
  try {
    commands = parseCommandUrl(raw);
  } catch {
    toast(t('agentCmdFailed'), 'err');
    return;
  }
  const run = async () => {
    try {
      await api.runCommands(commands);
      void app.flush();
    } catch {
      toast(t('agentCmdFailed'), 'err');
    }
  };
  if (commands.some((c) => !URL_SAFE.has(c.method))) {
    choice(t('agentCmdAsk'), t('agentCmdRun'), () => void run(), undefined, 0);
    return;
  }
  await run();
}
