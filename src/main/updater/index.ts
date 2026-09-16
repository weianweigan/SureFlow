import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { autoUpdater } from 'electron-updater'
import { createUpdateController } from './controller'

export function initAutoUpdater(): void {
  let manualUpdate = process.platform === 'darwin'
  if (app.isPackaged && manualUpdate) {
    try {
      const metadata = JSON.parse(readFileSync(join(app.getAppPath(), 'package.json'), 'utf8'))
      manualUpdate = metadata.sureflowMacAutoUpdate !== true
    } catch { /* Older/local packages default to manual updates on macOS. */ }
  }
  const controller = createUpdateController(autoUpdater, app.isPackaged, app.getVersion(), (state) => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.webContents.isDestroyed()) window.webContents.send('updater:state', state)
    }
  }, manualUpdate)
  ipcMain.handle('updater:open-download', () => shell.openExternal('https://github.com/weianweigan/SureFlow/releases/latest'))
  ipcMain.handle('updater:get-state', () => controller.getState())
  ipcMain.handle('updater:check', () => controller.check())
  ipcMain.handle('updater:install', () => controller.install())
  if (!app.isPackaged) return
  void controller.check()
  const timer = setInterval(() => void controller.check(), 4 * 60 * 60 * 1000)
  timer.unref()
  app.once('before-quit', () => clearInterval(timer))
}
