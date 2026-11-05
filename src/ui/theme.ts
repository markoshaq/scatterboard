// Light/dark theme state. Chrome surfaces read CSS vars flipped by
// body.dark; canvas drawing and card-tint code paths read these helpers.
type ThemeMode = 'light' | 'dark';

let mode: ThemeMode = 'light';

export function isDark(): boolean {
  return mode === 'dark';
}

export function setTheme(m: ThemeMode) {
  mode = m;
  // html.dark is what the pre-paint boot script in index.html sets;
  // keep both in sync so runtime switches flip either origin.
  document.documentElement.classList.toggle('dark', m === 'dark');
  document.body.classList.toggle('dark', m === 'dark');
  document.documentElement.style.setProperty('color-scheme', m);
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', m === 'dark' ? '#1d1d19' : '#f6f6f2');
}

// OS-level dark preference; the app follows it while prefs.theme stays
// unset (the "System" choice in Settings).
export function systemDark(): boolean {
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  } catch {
    return false;
  }
}

export function setUiScale(s: number) {
  document.body.style.setProperty('--ui', String(s));
}

export interface CanvasColors {
  bg: string;
  grid: string;
  ink: string;
  accent: string;
  selHalo: string;
  guide: string;
  grab: string;
  marqF: string;
  marqS: string;
}

// Hoisted constants: callers fetch these per canvas frame, so the
// objects must not be re-allocated per call.
const DARK_COLORS: CanvasColors = {
  bg: '#1d1d19',
  grid: '#45453d',
  ink: '#b0b0a4',
  accent: '#6d97f5',
  selHalo: 'rgba(109, 151, 245, 0.32)',
  guide: '#f0506e',
  grab: '#2a2a25',
  marqF: 'rgba(109, 151, 245, 0.14)',
  marqS: 'rgba(109, 151, 245, 0.6)',
};

const LIGHT_COLORS: CanvasColors = {
  bg: '#f6f6f2',
  grid: '#cfcfc7',
  ink: '#5c5c52',
  accent: '#356df3',
  selHalo: 'rgba(53, 109, 243, 0.3)',
  guide: '#f0506e',
  grab: '#ffffff',
  marqF: 'rgba(53, 109, 243, 0.08)',
  marqS: 'rgba(53, 109, 243, 0.6)',
};

export function canvasColors(): CanvasColors {
  return mode === 'dark' ? DARK_COLORS : LIGHT_COLORS;
}

// Card colours are user-picked pastels; dark mode renders them as a dark
// surface tinted toward the pick so light card text stays legible.
export function cardBg(color: string | undefined): string {
  if (!color) return '';
  return mode === 'dark' ? `color-mix(in srgb, ${color} 26%, #262620)` : color;
}

export function defaultTile(): string {
  return mode === 'dark' ? '#3a3a34' : '#ccd6ea';
}

// Resolve the theme at module eval, before saved prefs land in
// applyPrefs: scatterboard:theme mirrors an explicit choice, and no
// mirror means follow the OS. This way neither direction flashes the
// wrong theme while the workspace loads.
let savedTheme: string | null = null;
// Same Node >=22 stub guard as bootLang(): under vitest the binding
// exists but has no Storage methods and warns on access.
if (typeof process === 'undefined' || !process.versions?.node) {
  try {
    savedTheme = localStorage.getItem('scatterboard:theme');
  } catch {}
}
setTheme(savedTheme === 'light' || savedTheme === 'dark' ? savedTheme : systemDark() ? 'dark' : 'light');
