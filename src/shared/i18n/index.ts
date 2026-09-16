import english from './en.json'
export type Locale = 'zh-CN' | 'en-US'
let locale: Locale = 'zh-CN'
const listeners = new Set<() => void>()
export const getLocale = (): Locale => locale
export const subscribeLocale = (listener: () => void): (() => void) => {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
export function setLocale(next: Locale): void {
  if (next === locale) return
  locale = next
  for (const listener of listeners) listener()
}
/** Only explicitly marked application messages are translated. Document data is never traversed. */
export function t<T>(source: T): T {
  if (locale !== 'en-US' || typeof source !== 'string') return source
  const key = source.trim().replace(/\s+/g, ' ')
  const translated = (english as Record<string, string>)[key]
  return (translated === undefined ? source : source.replace(source.trim(), translated)) as T
}
/** Interpolation keeps file paths, names and user-entered values out of message lookup. */
export function msg(strings: TemplateStringsArray, ...values: unknown[]): string {
  const key = strings.reduce((text, part, index) => text + (index ? `{${index - 1}}` : '') + part, '')
  const translated = t(key)
  return translated.replace(/\{(\d+)\}/g, (match, index: string) => Number(index) < values.length ? String(values[Number(index)]) : match)
}

const escapePattern = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const diagnosticPatterns = Object.entries(english).filter(([key]) => /\{\d+\}/.test(key)).map(([key, value]) => ({
  pattern: new RegExp('^' + key.split(/\{\d+\}/).map(escapePattern).join('(.*?)') + '$', 's'), value
}))
/** For renderer-owned diagnostics/progress only, never for document names or text fields. */
export function translateMessage(source: string): string {
  if (locale !== 'en-US') return source
  const direct = t(source)
  if (direct !== source) return direct
  const normalized = source.trim().replace(/\s+/g, ' ')
  for (const { pattern, value } of diagnosticPatterns) {
    const match = normalized.match(pattern)
    if (match) return value.replace(/\{(\d+)\}/g, (_, index: string) => match[Number(index) + 1] ?? '')
  }
  return source
}
