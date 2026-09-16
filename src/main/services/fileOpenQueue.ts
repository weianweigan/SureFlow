import { posix, win32 } from 'node:path'
import { realpathSync } from 'node:fs'
import { ASSOCIATED_EXTENSIONS } from '../../shared/settings/fileAssociations'

export function normalizeOpenPath(value: string, cwd: string, platform = process.platform): string | null {
  if (!value || value.startsWith('-') || value.includes('\0')) return null
  const paths = platform === 'win32' ? win32 : posix
  if (!ASSOCIATED_EXTENSIONS.includes(paths.extname(value).slice(1).toLowerCase() as 'sfb' | 'sfzip')) return null
  let path = paths.resolve(cwd, value)
  try { path = realpathSync.native(path) } catch { /* Missing paths still reach the UI with a readable error. */ }
  return platform === 'win32' ? path.toLowerCase() : path
}

export class FileOpenQueue {
  private pending = new Set<string>()
  enqueue(paths: string[], cwd: string, platform = process.platform): void {
    for (const value of paths) {
      const path = normalizeOpenPath(value, cwd, platform)
      if (path) this.pending.add(path)
    }
  }
  drain(): string[] {
    const result = [...this.pending]
    this.pending.clear()
    return result
  }
  get size(): number { return this.pending.size }
}
