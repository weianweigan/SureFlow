import { afterEach, beforeEach, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
let directory: string
const git = (...args: string[]) => execFileSync('git', args, { cwd: directory, stdio: 'pipe' })
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'sureflow-release-'))
  mkdirSync(join(directory, 'tools'))
  copyFileSync(resolve('tools/release-notes.cjs'), join(directory, 'tools/release-notes.cjs'))
  writeFileSync(join(directory, 'package.json'), JSON.stringify({ version: '1.1.0' }))
  git('init'); git('config', 'user.email', 'test@example.invalid'); git('config', 'user.name', 'Test')
  git('add', '.'); git('commit', '-m', 'Initial version'); git('tag', 'v1.0.0')
  git('commit', '--allow-empty', '-m', 'Fix update progress'); git('tag', 'v1.1.0')
})
afterEach(() => rmSync(directory, { recursive: true, force: true }))
const run = (tag: string) => execFileSync(process.execPath, ['tools/release-notes.cjs'], {
  cwd: directory, env: { ...process.env, GITHUB_REF_NAME: tag }, stdio: 'pipe'
})
it('generates notes only from commits since the previous release', () => {
  run('v1.1.0')
  const notes = readFileSync(join(directory, '.release-notes.md'), 'utf8')
  expect(notes).toContain('# SureFlow v1.1.0')
  expect(notes).toContain('Fix update progress')
  expect(notes).not.toContain('Initial version')
})
it('rejects mismatched and prerelease tags before packaging', () => {
  expect(() => run('v1.2.0')).toThrow()
  expect(() => run('v1.1.0-beta.1')).toThrow()
})
