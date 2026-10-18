import { normalizeLocale, translate, type Locale } from '../../src/shared/i18n';

function detectLocale(): Locale {
  if (typeof window !== 'undefined') {
    const requested = new URLSearchParams(window.location.search).get('lang');
    if (requested) return normalizeLocale(requested);
  }
  if (typeof document !== 'undefined') {
    const declared = document.body?.dataset.locale || document.documentElement.lang;
    if (declared) return normalizeLocale(declared);
  }
  if (typeof navigator !== 'undefined') return normalizeLocale(navigator.language);
  return 'en';
}

export const locale = detectLocale();
export const dateLocale = locale === 'zh-cn' ? 'zh-CN' : 'en-US';

if (typeof document !== 'undefined') document.documentElement.lang = dateLocale;

export function t(message: string, ...values: (string | number)[]): string {
  return translate(locale, message, ...values);
}
