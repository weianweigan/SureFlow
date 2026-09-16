import { describe, expect, it } from 'vitest'
import { FileOpenQueue, normalizeOpenPath } from '../fileOpenQueue'
import { mkdtempSync, writeFileSync, symlinkSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

describe('system file queue', () => {
  it('accepts only sfb/sfzip, preserves spaces and handles case-insensitive extensions', () => {
    const queue = new FileOpenQueue()
    queue.enqueue(['工程 1.SFB', '孔腔.sfzip', '--flag', 'other.pdf', 'archive.zip', 'model.step'], '/tmp', 'posix')
    expect(queue.drain()).toEqual(['/tmp/工程 1.SFB', '/tmp/孔腔.sfzip'])
    expect(queue.size).toBe(0)
  })
  it('deduplicates cold-start requests and allows later reopen', () => {
    const queue = new FileOpenQueue()
    queue.enqueue(['a.sfb', './a.sfb', 'b.sfzip'], '/tmp', 'posix')
    expect(queue.size).toBe(2)
    queue.drain()
    queue.enqueue(['a.sfb'], '/tmp', 'posix')
    expect(queue.size).toBe(1)
  })
  it('normalizes Windows paths independently of the test host', () => {
    const queue = new FileOpenQueue()
    queue.enqueue(['工程 1.SFB', '孔腔.sfzip', '--flag', 'other.pdf', 'archive.zip'], 'C:\\Projects', 'win32')
    expect(queue.drain()).toEqual(['c:\\projects\\工程 1.sfb', 'c:\\projects\\孔腔.sfzip'])
    expect(normalizeOpenPath('A File.SFB', 'C:\\Projects', 'win32')).toBe('c:\\projects\\a file.sfb')
    expect(normalizeOpenPath('--project.sfb', '/tmp', 'posix')).toBeNull()
  })
  it('resolves symlinks to avoid duplicate project tabs', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sureflow-path-'))
    try {
      writeFileSync(join(dir, 'real.sfb'), '{}')
      symlinkSync(join(dir, 'real.sfb'), join(dir, 'alias.sfb'))
      expect(normalizeOpenPath(join(dir, 'real.sfb'), dir)).toBe(normalizeOpenPath(join(dir, 'alias.sfb'), dir))
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
})
