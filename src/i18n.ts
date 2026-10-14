import english from '../media/translations.json';

export type Language = 'ja' | 'en';
let language: Language = 'ja';
export function resolveLanguage(locale: string): Language {
  return /^ja(?:-|$)/i.test(locale) ? 'ja' : 'en';
}
export function setLanguage(locale: string): void { language = resolveLanguage(locale); }
export function getLanguage(): Language { return language; }
export function translate(locale: Language, message: string, ...values: unknown[]): string {
  const text = locale === 'en' ? (english as Record<string, string>)[message] ?? message : message;
  return text.replace(/\{(\d+)\}/g, (placeholder, index) => Number(index) < values.length ? String(values[Number(index)]) : placeholder);
}
export function t(message: string, ...values: unknown[]): string { return translate(language, message, ...values); }
export function translations(locale: Language): Record<string, string> { return locale === 'en' ? english : {}; }
