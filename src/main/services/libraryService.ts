/**
 * 库文件服务（PRD-002 §3.1 库包形态）
 *
 * 一个库 = 一个文件夹：library.sflib（版本化 JSON 入口）+ docs/ + models/。
 * 用户库位于 userData/libraries/，内置库位于安装目录 builtin-libraries/（只读）。
 *
 * 本模块为纯 Node 逻辑（不依赖 BrowserWindow / dialog），便于测试；
 * 对话框等 UI 能力由 ipc/libraryIpc.ts 注入。
 */

import { existsSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { mkdtemp, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { join, basename, resolve } from 'node:path'
import type { Dirent } from 'node:fs'
import AdmZip from 'adm-zip'
import type { CavityLibrary, LibrarySummary, ImportSource } from '../../shared/cavity/types'
export type { ImportSource } from '../../shared/cavity/types'

export const LIBRARY_ENTRY_FILE = 'library.sflib'

/* ---------- 路径 ---------- */

export interface LibraryPaths {
  /** 用户库根目录（可写） */
  userRoot: string
  /** 内置库目录（只读，允许不存在） */
  builtinRoot: string
}

/* ---------- 读取 ---------- */

/** 解析单个库文件夹为摘要；非库文件夹（无入口文件）返回 null */
export async function summarizeLibraryDir(
  dirPath: string,
  source: 'user' | 'builtin'
): Promise<LibrarySummary | null> {
  const entryPath = join(dirPath, LIBRARY_ENTRY_FILE)
  if (!existsSync(entryPath)) return null
  try {
    const raw = await readFile(entryPath, 'utf-8')
    const lib = JSON.parse(raw) as CavityLibrary
    if (lib.kind !== 'cavity-library') return null
    return {
      id: lib.id,
      name: lib.name,
      source: source === 'builtin' ? 'builtin' : lib.source === 'team' ? 'team' : 'user',
      dirPath,
      templateCount: Array.isArray(lib.templates) ? lib.templates.length : 0,
      readonly: source === 'builtin' || lib.source === 'builtin'
    }
  } catch {
    return null
  }
}

/** 扫描全部库（用户库 + 内置库） */
export async function listLibraries(paths: LibraryPaths): Promise<LibrarySummary[]> {
  const result: LibrarySummary[] = []
  for (const root of [
    { dir: paths.userRoot, source: 'user' as const },
    { dir: paths.builtinRoot, source: 'builtin' as const }
  ]) {
    if (!existsSync(root.dir)) continue
    let entries: Dirent[] = []
    try {
      entries = await readdir(root.dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const e of entries) {
      if (!e.isDirectory()) continue
      const s = await summarizeLibraryDir(join(root.dir, e.name), root.source)
      if (s) result.push(s)
    }
  }
  return result
}

/** 读库：解析 + 结构校验（kind / schemaVersion） */
export async function readLibrary(dirPath: string): Promise<CavityLibrary> {
  const entryPath = join(dirPath, LIBRARY_ENTRY_FILE)
  const raw = await readFile(entryPath, 'utf-8')
  let lib: CavityLibrary
  try {
    lib = JSON.parse(raw) as CavityLibrary
  } catch (e) {
    throw new Error(`library.sflib 不是合法 JSON：${(e as Error).message}`)
  }
  if (lib.kind !== 'cavity-library') {
    throw new Error(`非法库文件：kind 应为 cavity-library，实际为 ${String(lib.kind)}`)
  }
  if (lib.schemaVersion !== 1) {
    throw new Error(`不支持的库版本：schemaVersion=${String(lib.schemaVersion)}`)
  }
  return lib
}

/* ---------- 写入 ---------- */

/** 原子写：先写 tmp 再 rename，避免半写损坏库文件 */
export async function writeLibrary(dirPath: string, lib: CavityLibrary): Promise<void> {
  const entryPath = join(dirPath, LIBRARY_ENTRY_FILE)
  const tmpPath = entryPath + '.tmp'
  const json = JSON.stringify(lib, null, 2)
  await writeFile(tmpPath, json, 'utf-8')
  await rename(tmpPath, entryPath)
}

/** 新建库：建目录 + 空入口 + docs/ + models/；返回摘要 */
export async function createLibrary(
  paths: LibraryPaths,
  lib: CavityLibrary
): Promise<LibrarySummary> {
  const dirName = await uniqueDirName(paths.userRoot, lib.name)
  const dirPath = join(paths.userRoot, dirName)
  await mkdir(join(dirPath, 'docs'), { recursive: true })
  await mkdir(join(dirPath, 'models'), { recursive: true })
  await writeLibrary(dirPath, lib)
  return {
    id: lib.id,
    name: lib.name,
    source: lib.source,
    dirPath,
    templateCount: 0,
    readonly: false
  }
}

/** 同步序保证目录名不冲突：MyLibrary → MyLibrary-2 → MyLibrary-3 … */
async function uniqueDirName(root: string, base: string): Promise<string> {
  const safe = base.replace(/[\\/:*?"<>|]/g, '_').trim() || 'MyLibrary'
  let candidate = safe
  let i = 2
  while (existsSync(join(root, candidate))) {
    candidate = `${safe}-${i++}`
  }
  return candidate
}

/* ---------- 导入 ---------- */


/**
 * 导入库：.sfzip（zip，防 zip-slip）解压或整文件夹复制到 userData/libraries/。
 * 导入后返回摘要；源目录保持不动。
 */
export async function importLibrary(
  paths: LibraryPaths,
  src: ImportSource
): Promise<LibrarySummary> {
  const base = basename(src.kind === 'sfzip' ? src.zipPath : src.folderPath)
  const desiredName =
    src.kind === 'sfzip' ? base.replace(/\.sfzip$/i, '') : base.replace(/\.sflib$/i, '')
  const dirName = await uniqueDirName(paths.userRoot, desiredName || 'ImportedLibrary')
  const finalPath = join(paths.userRoot, dirName)
  await mkdir(paths.userRoot, { recursive: true })
  const destPath = await mkdtemp(join(paths.userRoot, '.import-'))
  try {
    if (src.kind === 'folder') {
      const libDir = existsSync(join(src.folderPath, LIBRARY_ENTRY_FILE))
        ? src.folderPath : await locateLibraryInDir(src.folderPath)
      if (!libDir) throw new Error('所选文件夹中未找到 library.sflib，不是合法库包')
      const { cp } = await import('node:fs/promises')
      await cp(libDir, destPath, { recursive: true })
    } else {
      const zip = new AdmZip(src.zipPath)
      for (const entry of zip.getEntries()) {
        const name = entry.entryName
        if (name.includes('..') || /^[/\\]/.test(name) || /^[a-zA-Z]:/.test(name)) {
          throw new Error(`压缩包包含非法路径条目：${name}`)
        }
      }
      zip.extractAllTo(destPath, true)
    }
    const lib = await readLibrary(destPath)
    if (!lib.id || typeof lib.name !== 'string' || !Array.isArray(lib.templates) || !Array.isArray(lib.categories)) {
      throw new Error('库包缺少必要字段')
    }
    // Re-import creates an independent library; update explicit self-references too.
    const oldId = lib.id
    lib.id = randomUUID()
    for (const template of lib.templates) {
      for (const hole of template.holes ?? []) {
        if (hole.ref?.libraryId === oldId) hole.ref.libraryId = lib.id
      }
    }
    lib.source = 'user'
    lib.meta = { ...lib.meta, origin: lib.meta?.origin ?? null }
    await writeLibrary(destPath, lib)
    await rename(destPath, finalPath)
    return {
      id: lib.id, name: lib.name, source: 'user', dirPath: finalPath,
      templateCount: lib.templates.length, readonly: false
    }
  } catch (error) {
    // Only remove the temporary directory created by this import attempt.
    await rm(destPath, { recursive: true, force: true })
    throw error
  }
}

/** 在目录树中向下查找（最多 2 层）包含入口文件的子目录 */
async function locateLibraryInDir(dir: string, depth = 0): Promise<string | null> {
  if (depth > 2) return null
  if (existsSync(join(dir, LIBRARY_ENTRY_FILE))) return dir
  let entries: Dirent[] = []
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return null
  }
  for (const e of entries) {
    if (!e.isDirectory()) continue
    const found = await locateLibraryInDir(join(dir, e.name), depth + 1)
    if (found) return found
  }
  return null
}

/* ---------- 删除 ---------- */

/** 删除库文件夹（调用方应传入回收站函数，如 shell.trashItem） */
export async function deleteLibrary(
  dirPath: string,
  trash: (p: string) => Promise<void>
): Promise<void> {
  const entryPath = join(dirPath, LIBRARY_ENTRY_FILE)
  if (!existsSync(entryPath)) {
    throw new Error('目录中不含 library.sflib，拒绝删除')
  }
  // 防御：解析后必须仍位于 dirPath 内
  if (resolve(entryPath) !== entryPath) throw new Error('路径异常，拒绝删除')
  try {
    await trash(dirPath)
  } catch {
    // 回收站不可用（如某些 Linux）：退化为永久删除
    await rm(dirPath, { recursive: true, force: true })
  }
}

/* ---------- 导出 ---------- */

/** 导出库为 .sfzip 文件 */
export async function exportLibrary(dirPath: string, targetZipPath: string): Promise<void> {
  const entryPath = join(dirPath, LIBRARY_ENTRY_FILE)
  if (!existsSync(entryPath)) {
    throw new Error('目录中不含 library.sflib，无法导出')
  }
  const zip = new AdmZip()
  zip.addLocalFolder(dirPath)
  await zip.writeZipPromise(targetZipPath, { overwrite: true })
}

/* ---------- 重命名 ---------- */

/** 重命名库名称（更新 library.sflib） */
export async function renameLibrary(
  dirPath: string,
  newName: string
): Promise<LibrarySummary> {
  const lib = await readLibrary(dirPath)
  const trimmed = newName.trim()
  if (!trimmed) throw new Error('库名称不能为空')
  lib.name = trimmed
  await writeLibrary(dirPath, lib)
  return {
    id: lib.id,
    name: lib.name,
    source: lib.source,
    dirPath,
    templateCount: Array.isArray(lib.templates) ? lib.templates.length : 0,
    readonly: false
  }
}

