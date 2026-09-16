import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import AdmZip from 'adm-zip'
import {
  createLibrary,
  exportLibrary,
  readLibrary,
  renameLibrary,
  writeLibrary,
  LIBRARY_ENTRY_FILE,
  type LibraryPaths
} from '../libraryService'
import { defaultLibrary } from '../../../shared/cavity/types'

describe('libraryService: exportLibrary & renameLibrary', () => {
  let tmpDir: string
  let paths: LibraryPaths

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sureflow-lib-test-'))
    paths = {
      userRoot: path.join(tmpDir, 'user'),
      builtinRoot: path.join(tmpDir, 'builtin')
    }
    await fs.mkdir(paths.userRoot, { recursive: true })
    await fs.mkdir(paths.builtinRoot, { recursive: true })
  })

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  it('renames a library correctly on disk', async () => {
    const lib = defaultLibrary('OriginalLib', 'user')
    const summary = await createLibrary(paths, lib)
    expect(summary.name).toBe('OriginalLib')

    const updated = await renameLibrary(summary.dirPath, 'RenamedLib')
    expect(updated.name).toBe('RenamedLib')

    const reloaded = await readLibrary(summary.dirPath)
    expect(reloaded.name).toBe('RenamedLib')
  })

  it('exports a library to a valid .sfzip archive containing library.sflib', async () => {
    const lib = defaultLibrary('ExportTestLib', 'user')
    const summary = await createLibrary(paths, lib)

    const targetZip = path.join(tmpDir, 'ExportTestLib.sfzip')
    await exportLibrary(summary.dirPath, targetZip)

    const stat = await fs.stat(targetZip)
    expect(stat.size).toBeGreaterThan(0)

    const zip = new AdmZip(targetZip)
    const entryNames = zip.getEntries().map((e) => e.entryName)
    expect(entryNames).toContain(LIBRARY_ENTRY_FILE)
  })
})
