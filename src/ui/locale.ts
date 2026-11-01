import type { Currency } from '../persist/storage';

// Number/currency/date formatting prefs, set once from Prefs on boot
// and on every settings change. browserLang on (default) follows the
// navigator locale; off formats in the UI language.
let useBrowser = true;
let uiLang = 'en';
let currency: Currency = 'USD';

export function setFormatting(opts: { browserLang: boolean; lang: string; currency: Currency }) {
  useBrowser = opts.browserLang;
  uiLang = opts.lang;
  currency = opts.currency;
}

export function currencyOf(): Currency {
  return currency;
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
