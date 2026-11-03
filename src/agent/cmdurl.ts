import { t } from '../strings';
import { toast } from '../ui/toast';
import { parseCommand, type AgentApi, type AgentCommand, type AgentHost } from './api';
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
// store group so a bad command leaves the board untouched.
export async function runCommandUrl(app: AgentHost, api: AgentApi, raw: string) {
  try {
    const commands = parseCommandUrl(raw);
    await api.runCommands(commands);
    void app.flush();
  } catch {
    toast(t('agentCmdFailed'));
  }
}
