import type { Currency } from '../persist/storage';

// Number/currency/date formatting prefs, set once from Prefs on boot
// and on every settings change. browserLang on (default) follows the
// navigator locale; off formats in the UI language.
let useBrowser = true;
let uiLang = 'en';
let currency: Currency = 'USD';

const CURRENCIES: readonly Currency[] = ['USD', 'EUR', 'GBP', 'JPY'];

// Currency the app picks when the user has not chosen one: mapped off
// the browser region, USD as the catch-all.
const EUR_REGIONS = new Set([
  'AT', 'BE', 'CY', 'DE', 'EE', 'ES', 'FI', 'FR', 'GR', 'HR', 'IE', 'IT',
  'LT', 'LU', 'LV', 'MT', 'NL', 'PT', 'SI', 'SK',
]);
export function autoCurrency(): Currency {
  try {
    const region = new Intl.Locale(navigator.language).region;
    if (region === 'GB') return 'GBP';
    if (region === 'JP') return 'JPY';
    if (region && EUR_REGIONS.has(region)) return 'EUR';
  } catch {
    // odd locale string; fall through to the default
  }
  return 'USD';
}

export function setFormatting(opts: { browserLang: boolean; lang: string; currency: Currency | null }) {
  useBrowser = opts.browserLang;
  uiLang = opts.lang;
  // A corrupt persisted value would throw RangeError in toLocaleString
  // on every table render; whitelist and fall back. null = auto.
  currency = opts.currency && CURRENCIES.includes(opts.currency) ? opts.currency : autoCurrency();
}

export function localeTag(): string {
  return useBrowser ? navigator.language : uiLang;
}

export function fmtNumber(n: number): string {
  return n.toLocaleString(localeTag());
}

export function fmtCurrency(n: number): string {
  return n.toLocaleString(localeTag(), { style: 'currency', currency });
}

export function fmtDate(ts: number): string {
  return new Date(ts).toLocaleDateString(localeTag());
}
