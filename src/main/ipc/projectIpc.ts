/**
 * 设计工程 IPC 通信（命名约定：'project:动作'）
 */

import { ipcMain } from 'electron'
import {
  openProjectDialog,
  saveProjectDialog,
  selectStepPathDialog,
  saveStepFile,
  saveStepDialog,
  readProject,
  readProjectMeta,
  writeProject,
  confirmCloseDialog,
  type OpenProjectResult,
  type SaveProjectPayload
} from '../services/projectService'

export function registerProjectIpc(): void {
  ipcMain.handle('project:open-dialog', (): Promise<OpenProjectResult | null> => {
    return openProjectDialog()
  })

  ipcMain.handle('project:save-dialog', (_e, defaultName?: string): Promise<string | null> => {
    return saveProjectDialog(defaultName)
  })

  ipcMain.handle('project:select-step-path', (_e, defaultPath?: string): Promise<string | null> => {
    return selectStepPathDialog(defaultPath)
  })

  ipcMain.handle('project:save-step-file', (_e, payload: { filePath: string; stepContent: string }): Promise<string> => {
    return saveStepFile(payload.filePath, payload.stepContent)
  })

  ipcMain.handle('project:save-step-dialog', (_e, payload: { defaultName?: string; stepContent: string; targetPath?: string }): Promise<string | null> => {
    return saveStepDialog(payload.defaultName, payload.stepContent, payload.targetPath)
  })

  ipcMain.handle('project:read', (_e, filePath: string): Promise<OpenProjectResult> => {
    return readProject(filePath)
  })

  ipcMain.handle('project:save', (_e, payload: SaveProjectPayload): Promise<string> => {
    return writeProject(payload)
  })

  ipcMain.handle('project:read-meta', (_e, filePath: string): Promise<import('../../shared/design/types').SfbProjectMeta | null> => {
    return readProjectMeta(filePath)
  })

  ipcMain.handle('project:confirm-close', (_e, projectName: string): Promise<'save' | 'dontsave' | 'cancel'> => {
    return confirmCloseDialog(projectName)
  })
}
