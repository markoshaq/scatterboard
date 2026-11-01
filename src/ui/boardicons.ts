import { iconBlobRef } from '../state/schema';
import { blobUrl } from '../persist/blobs';
import { S } from './icons';

// Board icon set: our own glyphs in the same stroke style as the rail
// icons, each with keyword tags for picker search and Recommended
// matching against board title words.

interface BoardIcon {
  id: string;
  svg: string;
  kw: string[];
}

const B = (id: string, svg: string, kw: string[]): BoardIcon => ({ id, svg: S(svg), kw: [id, ...kw] });

const BOARD_ICONS: BoardIcon[] = [
  B('flag', `<path d="M5 17V3.5"/><path d="M5 4c2-1.5 4-1.5 6 0s4 1.5 5 .5V11c-1 1-3 .5-5-.5s-4-1.5-6 0"/>`, ['goal', 'milestone', 'start', 'ship', 'launch', 'mark']),
  B('target', `<circle cx="10" cy="10" r="6.5"/><circle cx="10" cy="10" r="3.5"/><circle cx="10" cy="10" r="1" fill="currentColor" stroke="none"/>`, ['goal', 'aim', 'focus', 'objective']),
  B('rocket', `<path d="M10 3c3 1.5 4.5 5 4.5 8.5l-3 2h-3l-3-2C5.5 8 7 4.5 10 3z"/><circle cx="10" cy="8.5" r="1.6"/><path d="M6.5 13.5 5 17l3.5-1.5M13.5 13.5 15 17l-3.5-1.5"/>`, ['launch', 'ship', 'release', 'space', 'fast']),
  B('bulb', `<path d="M10 3a5 5 0 0 1 2.5 9.3c-.5.4-.5 1-.5 1.7h-4c0-.7 0-1.3-.5-1.7A5 5 0 0 1 10 3z"/><path d="M8.5 16.5h3"/>`, ['idea', 'brainstorm', 'think', 'light', 'concept']),
  B('star', `<path d="m10 3.5 2 4.3 4.7.5-3.5 3.2.9 4.6L10 13.8 5.9 16l.9-4.6-3.5-3.1 4.7-.5z"/>`, ['favorite', 'feature', 'best', 'rate']),
  B('heart', `<path d="M10 16s-6.5-4-6.5-8.5A3.6 3.6 0 0 1 10 5a3.6 3.6 0 0 1 6.5 2.5C16.5 12 10 16 10 16z"/>`, ['love', 'health', 'fav', 'like']),
  B('bolt', `<path d="M11 3 5 11h4l-1 6 7-9h-4z"/>`, ['fast', 'power', 'energy', 'quick', 'sprint']),
  B('fire', `<path d="M10 3c1 2.5 4.5 4.5 4.5 8.5a4.5 4.5 0 0 1-9 0c0-2 1-3.5 2-5 .5 1 1 1.5 1.5 1.5C9 6.5 9.5 4.5 10 3z"/>`, ['hot', 'urgent', 'streak', 'burn']),
  B('check', `<path d="m4 10.5 4 4 8-9"/>`, ['done', 'todo', 'task', 'complete', 'yes']),
  B('list', `<path d="M7 5.5h9M7 10h9M7 14.5h9"/><circle cx="4" cy="5.5" r="1" fill="currentColor" stroke="none"/><circle cx="4" cy="10" r="1" fill="currentColor" stroke="none"/><circle cx="4" cy="14.5" r="1" fill="currentColor" stroke="none"/>`, ['todo', 'tasks', 'backlog', 'plan', 'items']),
  B('calendar', `<rect x="3.5" y="4.5" width="13" height="12" rx="2"/><path d="M3.5 8.5h13M7 3v3M13 3v3"/>`, ['date', 'schedule', 'week', 'sprint', 'plan']),
  B('clock', `<circle cx="10" cy="10" r="6.5"/><path d="M10 6.5V10l3 2"/>`, ['time', 'deadline', 'hours', 'schedule']),
  B('pin', `<path d="M10 17s5-5.2 5-8.7a5 5 0 0 0-10 0C5 11.8 10 17 10 17z"/><circle cx="10" cy="8.2" r="1.8"/>`, ['place', 'map', 'location', 'mark']),
  B('map', `<path d="m3 5.5 4.5-2 5 2 4.5-2v11l-4.5 2-5-2-4.5 2z"/><path d="M7.5 3.5v11M12.5 5.5v11"/>`, ['world', 'travel', 'level', 'area', 'route']),
  B('compass', `<circle cx="10" cy="10" r="6.5"/><path d="m13 7-1.8 4.2L7 13l1.8-4.2z"/>`, ['explore', 'direction', 'research', 'nav']),
  B('search', `<circle cx="9" cy="9" r="5.5"/><path d="m13.5 13.5 3.5 3.5"/>`, ['find', 'research', 'look', 'scan']),
  B('book', `<path d="M4 4.5A1.5 1.5 0 0 1 5.5 3H16v13H5.5A1.5 1.5 0 0 0 4 17.5z"/><path d="M4 16V4.5M8 7h5"/>`, ['docs', 'read', 'spec', 'story', 'lore', 'notes']),
  B('doc', `<path d="M5.5 2.5h6L15 6v11.5h-9.5z"/><path d="M11 2.5V6.5h4"/><path d="M7.5 9.5h5M7.5 12.5h5"/>`, ['document', 'write', 'spec', 'design', 'gdd']),
  B('chat', `<path d="M4 4.5h12a1.5 1.5 0 0 1 1.5 1.5v6a1.5 1.5 0 0 1-1.5 1.5H9l-3.6 3v-3H4a1.5 1.5 0 0 1-1.5-1.5V6A1.5 1.5 0 0 1 4 4.5z"/>`, ['talk', 'feedback', 'discuss', 'review', 'comment']),
  B('people', `<circle cx="7" cy="7" r="2.8"/><path d="M2.5 16c.6-3 2.5-4.5 4.5-4.5s3.9 1.5 4.5 4.5"/><circle cx="14" cy="8" r="2.2"/><path d="M13.5 11.7c2 .1 3.5 1.4 4 4.3"/>`, ['team', 'user', 'person', 'crew', 'playtest']),
  B('user', `<circle cx="10" cy="6.5" r="3"/><path d="M4 16.5c.8-3.4 3.2-5 6-5s5.2 1.6 6 5"/>`, ['person', 'me', 'assignee', 'profile']),
  B('palette', `<path d="M10 3.5a6.5 6.5 0 1 0 0 13c1 0 1.5-.5 1.5-1.3 0-1.2-1-1.4-1-2.4 0-.8.6-1.3 1.6-1.3h1.6c1.4 0 2.8-1 2.8-2.7C16.5 5.6 13.6 3.5 10 3.5z"/><circle cx="6.8" cy="8.5" r="1.1" fill="currentColor" stroke="none"/><circle cx="10" cy="6.5" r="1.1" fill="currentColor" stroke="none"/><circle cx="13.4" cy="8" r="1.1" fill="currentColor" stroke="none"/><circle cx="6.5" cy="12" r="1.1" fill="currentColor" stroke="none"/>`, ['art', 'color', 'mood', 'style', 'visual', 'moodboard']),
  B('brush', `<path d="m13.5 3.5 3 3L9 14l-3.5.5L5 11z"/><path d="M5 14.5c-1.5.5-2 2-2 2.5 1.5.5 3.5 0 4.5-1"/>`, ['paint', 'art', 'draw', 'concept', 'sketch']),
  B('image', `<rect x="3" y="3.5" width="14" height="13" rx="2.5"/><circle cx="7.5" cy="8" r="1.4"/><path d="M4 14.5l4-4 3 3 3-3.5 3 3.5"/>`, ['picture', 'ref', 'reference', 'screenshot', 'asset', 'moodboard']),
  B('camera', `<rect x="3" y="6.5" width="14" height="10" rx="2"/><circle cx="10" cy="11.5" r="2.8"/><path d="M7 6.5 8 4.5h4l1 2"/>`, ['photo', 'screenshot', 'capture', 'shot']),
  B('film', `<rect x="3" y="4" width="14" height="12" rx="2"/><path d="M7 4v12M13 4v12M3 8.5h4M3 11.5h4M13 8.5h4M13 11.5h4"/>`, ['video', 'cutscene', 'trailer', 'movie', 'anim']),
  B('music', `<path d="M7 14.5V5.8l7-1.8v8.2"/><circle cx="5.5" cy="14.5" r="2"/><circle cx="12.5" cy="12.2" r="2"/>`, ['audio', 'sound', 'sfx', 'song', 'score']),
  B('gamepad', `<rect x="2.5" y="6.5" width="15" height="8" rx="4"/><path d="M6.5 8.8v3.4M4.8 10.5h3.4"/><circle cx="13" cy="9.5" r="1" fill="currentColor" stroke="none"/><circle cx="15" cy="11.5" r="1" fill="currentColor" stroke="none"/>`, ['game', 'play', 'control', 'gamedev', 'dev']),
  B('sword', `<path d="m4 16 9.5-9.5M13.5 4l2.5 2.5L9.5 13M6.5 11.5l2 2M4.5 15.5l-1 1"/>`, ['combat', 'weapon', 'fight', 'rpg', 'boss']),
  B('shield', `<path d="M10 2.8 4 5.5v5c0 4 3 6 6 7 3-1 6-3 6-7v-5z"/>`, ['defense', 'armor', 'safe', 'protect']),
  B('gem', `<path d="M6.5 3.5h7L17 8l-7 8.5L3 8z"/><path d="M3 8h14M7.5 8l2.5 8.5L12.5 8"/>`, ['loot', 'rare', 'reward', 'treasure', 'epic']),
  B('coin', `<circle cx="10" cy="10" r="6.5"/><path d="M10 6v8M7.5 7.5c.6-.8 4.4-1 4.4.9 0 1.8-4.4 1.2-4.4 3.1 0 1.9 3.8 1.7 4.4.9"/>`, ['money', 'currency', 'economy', 'shop', 'gold']),
  B('key', `<circle cx="6.5" cy="6.5" r="3"/><path d="m8.8 8.8 7.7 7.7M14 13l2-2M16.5 15.5l1.5-1.5"/>`, ['unlock', 'secret', 'access', 'door']),
  B('puzzle', `<path d="M8 4.5c0-1.5 4-1.5 4 0V6h2.5c1.5 0 1.5 4 0 4H12v2.5c0 1.5-4 1.5-4 0V10H5.5c-1.5 0-1.5-4 0-4H8z"/>`, ['mechanic', 'system', 'fit', 'piece', 'design']),
  B('grid', `<rect x="3.5" y="3.5" width="13" height="13" rx="2"/><path d="M8 3.5v13M12.5 3.5v13M3.5 8h13M3.5 12.5h13"/>`, ['level', 'layout', 'table', 'tiles', 'map']),
  B('code', `<path d="M7.5 6 4.5 10l3 4M12.5 6l3 4-3 4"/>`, ['dev', 'script', 'tech', 'program', 'engine']),
  B('bug', `<rect x="6" y="7.5" width="8" height="8" rx="3.5"/><path d="M10 7.5V5M6 10H3.5M6 13.5H3.5M14 10h2.5M14 13.5h2.5M7.5 5.5 6 4M12.5 5.5 14 4"/>`, ['fix', 'issue', 'qa', 'test', 'defect']),
  B('wrench', `<path d="M13.5 3.5a3.8 3.8 0 0 0-5 5L3 14l3 3 5.5-5.5a3.8 3.8 0 0 0 5-5l-2.8 2.8-2.7-.3-.3-2.7z"/>`, ['tool', 'fix', 'build', 'repair', 'tune']),
  B('box', `<path d="m10 3 6.5 3.5v7L10 17l-6.5-3.5v-7z"/><path d="m3.5 6.5 6.5 3.5 6.5-3.5M10 10v7"/>`, ['asset', 'pack', 'package', 'item', 'kit']),
  B('folder', `<path d="M3 5.5a1.5 1.5 0 0 1 1.5-1.5h4l2 2.5h5a1.5 1.5 0 0 1 1.5 1.5v6a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 3 14z"/>`, ['files', 'project', 'organize', 'group']),
  B('archive', `<rect x="3" y="3.5" width="14" height="4" rx="1"/><path d="M4.5 7.5v7a1.5 1.5 0 0 0 1.5 1.5h8a1.5 1.5 0 0 0 1.5-1.5v-7"/><path d="M8.5 10.5h3"/>`, ['store', 'old', 'done', 'keep']),
  B('link', `<path d="M8.5 11.5l3-3"/><path d="M9.7 7.3 11 6a2.5 2.5 0 0 1 3.5 3.5l-1.3 1.3"/><path d="M10.3 12.7 9 14a2.5 2.5 0 0 1-3.5-3.5l1.3-1.3"/>`, ['url', 'ref', 'web', 'source']),
  B('globe', `<circle cx="10" cy="10" r="6.5"/><path d="M3.5 10h13M10 3.5c-4 4-4 9 0 13 4-4 4-9 0-13z"/>`, ['web', 'world', 'site', 'online', 'community']),
  B('home', `<path d="m3.5 9.5 6.5-5.5 6.5 5.5"/><path d="M5.5 8.5V16h9V8.5"/><path d="M8.5 16v-4h3v4"/>`, ['main', 'start', 'base', 'hub']),
  B('trophy', `<path d="M6.5 4h7v4.5a3.5 3.5 0 0 1-7 0z"/><path d="M6.5 5H4a2.5 2.5 0 0 0 2.5 3.5M13.5 5H16a2.5 2.5 0 0 1-2.5 3.5"/><path d="M10 12v2.5M7 16.5h6"/>`, ['win', 'award', 'rank', 'achievement', 'goal']),
  B('medal', `<circle cx="10" cy="12" r="4"/><path d="m7.5 8.5-2-5h4l1.5 3 1.5-3h4l-2 5"/>`, ['award', 'badge', 'rank', 'win']),
  B('chart', `<path d="M4 4v12h12"/><path d="M7.5 12.5v-4M11 12.5v-6.5M14.5 12.5V8"/>`, ['stats', 'data', 'metrics', 'progress', 'analytics']),
  B('money', `<rect x="3" y="6" width="14" height="9" rx="1.5"/><circle cx="10" cy="10.5" r="2.2"/><path d="M5.5 8.5h.01M14.5 12.5h.01"/>`, ['budget', 'cost', 'finance', 'cash']),
  B('cart', `<path d="M3.5 4h2l2 9h8l1.8-6.5H6"/><circle cx="8.5" cy="16" r="1.2"/><circle cx="14.5" cy="16" r="1.2"/>`, ['shop', 'store', 'buy', 'market']),
  B('tag', `<path d="M3.5 3.5h5.2l7.3 7.3a1.8 1.8 0 0 1 0 2.5l-2.7 2.7a1.8 1.8 0 0 1-2.5 0L3.5 8.7z"/><circle cx="7" cy="7" r="1.3" fill="currentColor" stroke="none"/>`, ['label', 'price', 'category', 'meta']),
  B('bookmark', `<path d="M5.5 3.5h9V17l-4.5-3L5.5 17z"/>`, ['save', 'mark', 'keep', 'fav']),
  B('bell', `<path d="M10 3.5c-3 0-4.5 2-4.5 5v3L4 14h12l-1.5-2.5v-3c0-3-1.5-5-4.5-5z"/><path d="M8.5 16a1.6 1.6 0 0 0 3 0"/>`, ['alert', 'notify', 'remind', 'ping']),
  B('sun', `<circle cx="10" cy="10" r="3.5"/><path d="M10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.7 4.7l1.4 1.4M13.9 13.9l1.4 1.4M15.3 4.7l-1.4 1.4M6.1 13.9l-1.4 1.4"/>`, ['day', 'bright', 'weather', 'light']),
  B('moon', `<path d="M16 12.5A6.5 6.5 0 0 1 7.5 4a6.5 6.5 0 1 0 8.5 8.5z"/>`, ['night', 'dark', 'sleep', 'evening']),
  B('leaf', `<path d="M15.5 4.5c-6 0-9.5 2.5-9.5 8a3.5 3.5 0 0 0 7 .5c3-1 2.5-5.5 2.5-8.5z"/><path d="M6.5 15.5c2-4 4.5-6.5 7.5-8.5"/>`, ['nature', 'plant', 'green', 'eco', 'forest']),
  B('tree', `<path d="M10 3 5.5 9.5h2.5L5 14h10l-3-4.5h2.5z"/><path d="M10 14v3"/>`, ['nature', 'forest', 'wood', 'outdoor']),
  B('wave', `<path d="M3 8.5c2.5-3 5-3 7 0s4.5 3 7 0"/><path d="M3 13.5c2.5-3 5-3 7 0s4.5 3 7 0"/>`, ['water', 'ocean', 'sea', 'flow']),
  B('mountain', `<path d="m3 15.5 5-8 3 4.5 2-2.5 4 6z"/><path d="m8 7.5.9 1.6L10 8l1.1 1.1L12 7.5"/>`, ['peak', 'climb', 'goal', 'outdoor', 'terrain']),
  B('paw', `<circle cx="6" cy="7" r="1.6"/><circle cx="10" cy="5.5" r="1.6"/><circle cx="14" cy="7" r="1.6"/><path d="M10 9.5c-2.5 0-4.5 2-4.5 4a2.3 2.3 0 0 0 4.5.8 2.3 2.3 0 0 0 4.5-.8c0-2-2-4-4.5-4z"/>`, ['pet', 'animal', 'creature', 'cat', 'dog']),
  B('gift', `<rect x="4" y="7.5" width="12" height="9" rx="1"/><path d="M10 7.5v9M4 11h12M10 7.5C8 7.5 6 6.8 6 5.2 6 3.5 9 3.5 10 7.5c1-4 4-4 4-2.3 0 1.6-2 2.3-4 2.3z"/>`, ['reward', 'present', 'bonus', 'surprise']),
];

const BY_ID = new Map(BOARD_ICONS.map((i) => [i.id, i]));

function boardIcon(id: string): BoardIcon | undefined {
  return BY_ID.get(id);
}

// Recommended icons for a board title: match each word to keyword tags
// and flatten, deduped.
export function recommendedIcons(title: string, cap = 18): BoardIcon[] {
  const words = title
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 1);
  const out: BoardIcon[] = [];
  const seen = new Set<string>();
  for (const w of words) {
    for (const ic of BOARD_ICONS) {
      if (seen.has(ic.id)) continue;
      if (ic.kw.some((k) => k.includes(w) || w.includes(k))) {
        seen.add(ic.id);
        out.push(ic);
        if (out.length >= cap) return out;
      }
    }
  }
  return out;
}

export function searchIcons(q: string): BoardIcon[] {
  const s = q.trim().toLowerCase();
  if (!s) return BOARD_ICONS;
  return BOARD_ICONS.filter((ic) => ic.kw.some((k) => k.includes(s)));
}

// Letters & numbers row: monogram of initials, each title letter,
// digits 0-9.
export function letterIcons(title: string): string[] {
  const words = title.trim().split(/\s+/).filter(Boolean);
  const out: string[] = [];
  if (words.length) {
    const mono = words
      .slice(0, 2)
      .map((w) => w[0])
      .join('')
      .toUpperCase();
    if (mono) out.push(mono);
  }
  for (const w of words.slice(0, 6)) {
    const c = w[0]!.toUpperCase();
    if (!out.includes(c)) out.push(c);
  }
  for (let d = 0; d <= 9; d++) out.push(String(d));
  return out;
}

// Render a board icon into a container. 'g:' glyph, 'c:'/'e:' text,
// 'b:' image blob. Empty/undefined falls back to the title initial.
export function mountBoardIcon(host: HTMLElement, icon: string | undefined, title: string) {
  host.textContent = '';
  host.classList.remove('bicon-img');
  if (icon?.startsWith('g:')) {
    const ic = boardIcon(icon.slice(2));
    if (ic) {
      host.innerHTML = ic.svg;
      return;
    }
  }
  if (icon?.startsWith('c:') || icon?.startsWith('e:')) {
    host.textContent = icon.slice(2);
    return;
  }
  const ref = iconBlobRef(icon);
  if (ref) {
    host.classList.add('bicon-img');
    void blobUrl(ref).then((u) => {
      if (!u || !host.isConnected) return;
      const img = document.createElement('img');
      img.src = u;
      img.alt = '';
      host.appendChild(img);
    });
    return;
  }
  host.textContent = title.trim().charAt(0).toUpperCase() || '?';
}
