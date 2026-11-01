// Light/dark theme state. Chrome surfaces read CSS vars flipped by
// body.dark; canvas drawing and card-tint code paths read these helpers.
export type ThemeMode = 'light' | 'dark';

let mode: ThemeMode = 'light';

export function isDark(): boolean {
  return mode === 'dark';
}

export function setTheme(m: ThemeMode) {
  mode = m;
  document.body.classList.toggle('dark', m === 'dark');
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

export function canvasColors(): CanvasColors {
  return mode === 'dark'
    ? {
        bg: '#1d1d19',
        grid: '#45453d',
        ink: '#b0b0a4',
        accent: '#6d97f5',
        selHalo: 'rgba(109, 151, 245, 0.32)',
        guide: '#f0506e',
        grab: '#2a2a25',
        marqF: 'rgba(109, 151, 245, 0.14)',
        marqS: 'rgba(109, 151, 245, 0.6)',
      }
    : {
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
