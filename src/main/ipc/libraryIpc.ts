import { t as _t } from '../../shared/i18n'
/**
 * 库管理 IPC（命名约定：'library:动作'，对齐 window:* 既有模式）
 *
 * 主进程持有文件系统能力（fs / dialog / shell.trashItem），
 * 渲染层经 preload 暴露的 libraryApi 异步调用。
 */

import { app, dialog, ipcMain, shell } from 'electron'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import {
  createLibrary,
  deleteLibrary,
  exportLibrary,
  importLibrary,
  listLibraries,
  readLibrary,
  renameLibrary,
  writeLibrary,
  type ImportSource,
  type LibraryPaths
} from '../services/libraryService'
import type { CavityLibrary } from '../../shared/cavity/types'
import {
  fetchRegistryIndex,
  matchOnlinePackages,
  downloadAndInstallOnlinePackage
} from '../services/libraryRegistryService'

/** 内置库目录：生产 = resources/builtin-libraries；开发 = 工程 libraries（独立仓）或 resources/builtin-libraries */
function builtinRoot(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'builtin-libraries')
  }
  const devLibraries = join(app.getAppPath(), 'libraries')
  return existsSync(devLibraries)
    ? devLibraries
    : join(app.getAppPath(), 'resources', 'builtin-libraries')
}

function paths(): LibraryPaths {
  return {
    userRoot: join(app.getPath('userData'), 'libraries'),
    builtinRoot: builtinRoot()
  }
}

/** 用户选择导入来源（.sfzip 或文件夹），取消返回 null */
async function pickSource(): Promise<ImportSource | null> {
  const isMac = process.platform === 'darwin'
  const r = await dialog.showOpenDialog({
    title: _t("导入孔腔库"),
    properties: isMac ? ['openFile', 'openDirectory'] : ['openFile'],
    filters: [{ name: _t("库包 (.sfzip)"), extensions: ['sfzip', 'zip'] }]
  })
  if (r.canceled || !r.filePaths[0]) return null

  const p = r.filePaths[0]
  if (existsSync(p)) {
    const { statSync } = await import('node:fs')
    if (statSync(p).isDirectory()) {
      return { kind: 'folder', folderPath: p }
    }
  }
  return { kind: 'sfzip', zipPath: p }
}

export function registerLibraryIpc(): void {
  ipcMain.handle('library:list', () => listLibraries(paths()))

  ipcMain.handle('library:read', (_e, dirPath: string) => readLibrary(dirPath))

  ipcMain.handle('library:save', (_e, payload: { dirPath: string; doc: CavityLibrary }) => {
    if (!existsSync(join(payload.dirPath, 'library.sflib'))) {
      throw new Error(_t("目标库不存在（library.sflib 缺失）"))
    }
    return writeLibrary(payload.dirPath, payload.doc)
  })

  ipcMain.handle('library:create', (_e, doc: CavityLibrary) => createLibrary(paths(), doc))

  ipcMain.handle('library:import', (_e, src: ImportSource) => importLibrary(paths(), src))

  ipcMain.handle('library:pick-source', () => pickSource())

  ipcMain.handle('library:export', async (_e, payload: { dirPath: string; defaultName?: string }) => {
    const defaultName = (payload.defaultName || 'Library') + '.sfzip'
    const r = await dialog.showSaveDialog({
      title: _t("导出孔腔库"),
      defaultPath: defaultName,
      filters: [{ name: _t("库包 (.sfzip)"), extensions: ['sfzip'] }]
    })
    if (r.canceled || !r.filePath) return null
    await exportLibrary(payload.dirPath, r.filePath)
    return r.filePath
  })

  ipcMain.handle('library:rename', (_e, payload: { dirPath: string; newName: string }) =>
    renameLibrary(payload.dirPath, payload.newName)
  )

  ipcMain.handle('library:delete', (_e, dirPath: string) =>
    deleteLibrary(dirPath, (p) => shell.trashItem(p))
  )


  /* ---------- 在线孔腔库市场（PRD-FR-03-02） ---------- */

  ipcMain.handle('library:registry-list', async (_e, forceRefresh = false) => {
    const cacheDir = join(app.getPath('userData'), 'cache')
    const index = await fetchRegistryIndex(cacheDir, undefined, forceRefresh)
    const localSummaries = await listLibraries(paths())
    return matchOnlinePackages(index, localSummaries)
  })

  ipcMain.handle(
    'library:registry-install',
    async (event, payload: { packageId: string; version: string }) => {
      const cacheDir = join(app.getPath('userData'), 'cache')
      const index = await fetchRegistryIndex(cacheDir)
      const targetPkg = index.packages.find((p) => p.id === payload.packageId)
      if (!targetPkg) {
        throw new Error(`找不到包: ${payload.packageId}`)
      }

      return downloadAndInstallOnlinePackage(
        paths(),
        cacheDir,
        targetPkg,
        payload.version,
        (progress) => {
          event.sender.send('library:registry-progress', progress)
        }
      )
    }
  )
}
