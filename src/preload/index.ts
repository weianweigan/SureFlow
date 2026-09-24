import type { UpdateState } from '../shared/updater'
import type { AssociatedExtension, FileAssociationInfo } from '../shared/settings/fileAssociations'
import { contextBridge, ipcRenderer } from 'electron'
import type { CavityLibrary, LibrarySummary, ImportSource } from '../shared/cavity/types'
import type { SfbProject } from '../shared/design/types'

/**
 * 通过 contextBridge 安全暴露给渲染进程的 API。
 * 后续的文件读写、工程管理、导出等能力都应在这里按需扩展，
 * 并通过 ipcRenderer.invoke 与主进程通信。
 */
const api = {
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node
  },
  openExternal: (url: string): Promise<void> => ipcRenderer.invoke('app:open-external', url),
  showItemInFolder: (fullPath: string): Promise<boolean> => ipcRenderer.invoke('shell:show-item-in-folder', fullPath)
} as const

/**
 * 自定义窗口控制（无边框窗口）：最小化 / 最大化还原 / 关闭。
 * 主进程对应 channel 见 src/main/index.ts。
 */
const windowControls = {
  minimize: (): void => ipcRenderer.send('window:minimize'),
  toggleMaximize: (): void => ipcRenderer.send('window:toggle-maximize'),
  close: (): void => ipcRenderer.send('window:close'),
  toggleDevTools: (): void => ipcRenderer.send('window:toggle-devtools'),
  isMaximized: (): Promise<boolean> => ipcRenderer.invoke('window:is-maximized'),
  /** 订阅最大化状态变化，返回取消订阅函数 */
  onMaximizedChange: (cb: (maximized: boolean) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, maximized: boolean): void => cb(maximized)
    ipcRenderer.on('window:maximized-changed', listener)
    return () => {
      ipcRenderer.removeListener('window:maximized-changed', listener)
    }
  }
} as const

/**
 * 库管理（孔腔库编辑器）：与 src/main/ipc/libraryIpc.ts 的 channel 一一对应。
 */
const libraryApi = {
  list: (): Promise<LibrarySummary[]> => ipcRenderer.invoke('library:list'),
  read: (dirPath: string): Promise<CavityLibrary> => ipcRenderer.invoke('library:read', dirPath),
  save: (dirPath: string, doc: CavityLibrary): Promise<void> =>
    ipcRenderer.invoke('library:save', { dirPath, doc }),
  create: (doc: CavityLibrary): Promise<LibrarySummary> =>
    ipcRenderer.invoke('library:create', doc),
  import: (src: ImportSource): Promise<LibrarySummary> =>
    ipcRenderer.invoke('library:import', src),
  pickSource: (): Promise<ImportSource | null> => ipcRenderer.invoke('library:pick-source'),
  export: (dirPath: string, defaultName?: string): Promise<string | null> =>
    ipcRenderer.invoke('library:export', { dirPath, defaultName }),
  rename: (dirPath: string, newName: string): Promise<LibrarySummary> =>
    ipcRenderer.invoke('library:rename', { dirPath, newName }),
  delete: (dirPath: string): Promise<void> => ipcRenderer.invoke('library:delete', dirPath),
  listAssets: (dirPath: string, subDir: 'docs' | 'models'): Promise<string[]> =>
    ipcRenderer.invoke('library:list-assets', { dirPath, subDir }),
  addAsset: (dirPath: string, subDir: 'docs' | 'models'): Promise<string | null> =>
    ipcRenderer.invoke('library:add-asset', { dirPath, subDir }),
  registryList: (forceRefresh?: boolean): Promise<import('../shared/cavity/registryTypes').OnlinePackageItem[]> =>
    ipcRenderer.invoke('library:registry-list', forceRefresh),
  registryInstall: (payload: { packageId: string; version: string }): Promise<LibrarySummary> =>
    ipcRenderer.invoke('library:registry-install', payload),
  onRegistryProgress: (listener: (event: import('../shared/cavity/registryTypes').InstallProgressEvent) => void) => {
    const wrapped = (_e: unknown, data: import('../shared/cavity/registryTypes').InstallProgressEvent) => listener(data)
    ipcRenderer.on('library:registry-progress', wrapped)
    return () => {
      ipcRenderer.removeListener('library:registry-progress', wrapped)
    }
  }
} as const

/**
 * 设计工程管理（.sfb 读写与系统文件对话框）：与 src/main/ipc/projectIpc.ts 的 channel 一一对应。
 */
const projectApi = {
  openDialog: (): Promise<{ filePath: string; doc: SfbProject; cacheBuffer?: ArrayBuffer | null; glbBuffer?: ArrayBuffer | null } | null> =>
    ipcRenderer.invoke('project:open-dialog'),
  saveDialog: (defaultName?: string): Promise<string | null> =>
    ipcRenderer.invoke('project:save-dialog', defaultName),
  selectStepPath: (defaultPath?: string): Promise<string | null> =>
    ipcRenderer.invoke('project:select-step-path', defaultPath),
  saveStepFile: (payload: { filePath: string; stepContent: string }): Promise<string> =>
    ipcRenderer.invoke('project:save-step-file', payload),
  saveStepDialog: (payload: { defaultName?: string; stepContent: string; targetPath?: string }): Promise<string | null> =>
    ipcRenderer.invoke('project:save-step-dialog', payload),
  read: (filePath: string): Promise<{ filePath: string; doc: SfbProject; cacheBuffer?: ArrayBuffer | null; glbBuffer?: ArrayBuffer | null }> =>
    ipcRenderer.invoke('project:read', filePath),
  readMeta: (filePath: string): Promise<import('../shared/design/types').SfbProjectMeta | null> =>
    ipcRenderer.invoke('project:read-meta', filePath),
  save: (payload: {
    filePath: string
    doc: SfbProject
    cacheBuffer?: ArrayBuffer | Uint8Array | null
    glbBuffer?: ArrayBuffer | Uint8Array | null
    previewImageBase64?: string | null
  }): Promise<string> =>
    ipcRenderer.invoke('project:save', payload),
  confirmClose: (projectName: string): Promise<'save' | 'dontsave' | 'cancel'> =>
    ipcRenderer.invoke('project:confirm-close', projectName)
} as const

const fileApi = {
  readBinary: (filePath: string): Promise<ArrayBuffer> =>
    ipcRenderer.invoke('file:read-binary', filePath),
  exists: (filePath: string): Promise<boolean> =>
    ipcRenderer.invoke('file:exists', filePath),
  toSafeFileUrl: (filePath: string): string => {
    if (filePath.startsWith('sf-file://')) return filePath
    const normalized = filePath.replace(/\\/g, '/')
    const encoded = encodeURI(normalized).replace(/#/g, '%23').replace(/\?/g, '%3F')
    return `sf-file://local${encoded.startsWith('/') ? '' : '/'}${encoded}`
  }
} as const

const settingsApi = {
  setLocale: (locale: 'zh-CN' | 'en-US'): Promise<void> => ipcRenderer.invoke('app:locale', locale),
  associations: (): Promise<FileAssociationInfo> => ipcRenderer.invoke('associations:query'),
  configureAssociation: (extension: AssociatedExtension): Promise<void> => ipcRenderer.invoke('associations:configure', extension),
  drainFiles: (): Promise<string[]> => ipcRenderer.invoke('files:drain'),
  onFilesPending: (callback: () => void): (() => void) => {
    const listener = () => callback()
    ipcRenderer.on('files:pending', listener)
    return () => ipcRenderer.removeListener('files:pending', listener)
  },
  onNavigateHome: (callback: () => void): (() => void) => {
    const listener = () => callback()
    ipcRenderer.on('workspace:navigate-home', listener)
    return () => ipcRenderer.removeListener('workspace:navigate-home', listener)
  }
}
contextBridge.exposeInMainWorld('settingsApi', settingsApi)
export type SettingsApi = typeof settingsApi

contextBridge.exposeInMainWorld('api', api)
contextBridge.exposeInMainWorld('windowControls', windowControls)
contextBridge.exposeInMainWorld('libraryApi', libraryApi)
contextBridge.exposeInMainWorld('projectApi', projectApi)
contextBridge.exposeInMainWorld('fileApi', fileApi)

const cadBridgeApi = {
  getStatus: (): Promise<import('../shared/cad/cadBridgeTypes').CadBridgeStatus> =>
    ipcRenderer.invoke('cad:get-status'),
  startServer: (port?: number): Promise<number> =>
    ipcRenderer.invoke('cad:start-server', port),
  stopServer: (): Promise<void> =>
    ipcRenderer.invoke('cad:stop-server'),
  onImportStep: (callback: (params: import('../shared/cad/cadBridgeTypes').CadImportStepParams) => void): (() => void) => {
    const listener = (_e: Electron.IpcRendererEvent, params: import('../shared/cad/cadBridgeTypes').CadImportStepParams) => callback(params)
    ipcRenderer.on('cad:import-step-event', listener)
    return () => ipcRenderer.removeListener('cad:import-step-event', listener)
  },
  onExportStepRequest: (callback: (params: import('../shared/cad/cadBridgeTypes').CadExportStepParams) => Promise<import('../shared/cad/cadBridgeTypes').CadBridgeResponse>): (() => void) => {
    const listener = async (_e: Electron.IpcRendererEvent, params: import('../shared/cad/cadBridgeTypes').CadExportStepParams) => {
      const res = await callback(params)
      ipcRenderer.send('cad:export-step-reply', res)
    }
    ipcRenderer.on('cad:export-step-request', listener)
    return () => ipcRenderer.removeListener('cad:export-step-request', listener)
  },
  onNewProjectRequest: (callback: (params: import('../shared/cad/cadBridgeTypes').DocNewProjectParams) => Promise<import('../shared/cad/cadBridgeTypes').DocNewProjectResult>): (() => void) => {
    const listener = async (_e: Electron.IpcRendererEvent, params: import('../shared/cad/cadBridgeTypes').DocNewProjectParams) => {
      const res = await callback(params)
      ipcRenderer.send(`cad:new-project-reply:${params.docGuid}`, res)
    }
    ipcRenderer.on('cad:new-project-request', listener)
    return () => ipcRenderer.removeListener('cad:new-project-request', listener)
  },
  onOpenProjectRequest: (callback: (params: import('../shared/cad/cadBridgeTypes').DocOpenProjectParams) => Promise<import('../shared/cad/cadBridgeTypes').DocOpenProjectResult>): (() => void) => {
    const listener = async (_e: Electron.IpcRendererEvent, params: import('../shared/cad/cadBridgeTypes').DocOpenProjectParams) => {
      const res = await callback(params)
      ipcRenderer.send(`cad:open-project-reply:${params.docGuid}`, res)
    }
    ipcRenderer.on('cad:open-project-request', listener)
    return () => ipcRenderer.removeListener('cad:open-project-request', listener)
  },
  onActivateProjectRequest: (callback: (params: import('../shared/cad/cadBridgeTypes').DocActivateProjectParams) => Promise<import('../shared/cad/cadBridgeTypes').DocActivateProjectResult>): (() => void) => {
    const listener = async (_e: Electron.IpcRendererEvent, params: import('../shared/cad/cadBridgeTypes').DocActivateProjectParams) => {
      const res = await callback(params)
      ipcRenderer.send(`cad:activate-project-reply:${params.docGuid}`, res)
    }
    ipcRenderer.on('cad:activate-project-request', listener)
    return () => ipcRenderer.removeListener('cad:activate-project-request', listener)
  },
  onCadDisconnected: (callback: (event: import('../shared/cad/cadBridgeTypes').CadDisconnectedEvent) => void): (() => void) => {
    const listener = (_e: Electron.IpcRendererEvent, event: import('../shared/cad/cadBridgeTypes').CadDisconnectedEvent) => callback(event)
    ipcRenderer.on('cad:client-disconnected', listener)
    return () => ipcRenderer.removeListener('cad:client-disconnected', listener)
  },
  pushSaveToCad: (docGuid: string, params: import('../shared/cad/cadBridgeTypes').DocSaveProjectParams): Promise<import('../shared/cad/cadBridgeTypes').DocSaveProjectResult> =>
    ipcRenderer.invoke('cad:push-save-to-cad', { docGuid, params }),
  syncCameraToCad: (docGuid: string | undefined, params: import('../shared/cad/cadBridgeTypes').SyncCameraViewParams): Promise<import('../shared/cad/cadBridgeTypes').SyncCameraViewResult> =>
    ipcRenderer.invoke('cad:push-sync-camera-to-cad', { docGuid, params }),
  onSyncCameraFromCad: (callback: (params: import('../shared/cad/cadBridgeTypes').SyncCameraViewParams) => void): (() => void) => {
    const listener = (_e: Electron.IpcRendererEvent, params: import('../shared/cad/cadBridgeTypes').SyncCameraViewParams) => callback(params)
    ipcRenderer.on('cad:sync-camera-from-cad', listener)
    return () => ipcRenderer.removeListener('cad:sync-camera-from-cad', listener)
  },
  onStatusChanged: (callback: (status: import('../shared/cad/cadBridgeTypes').CadBridgeStatus) => void): (() => void) => {
    const listener = (_e: Electron.IpcRendererEvent, status: import('../shared/cad/cadBridgeTypes').CadBridgeStatus) => callback(status)
    ipcRenderer.on('cad:status-changed', listener)
    return () => ipcRenderer.removeListener('cad:status-changed', listener)
  }
}
contextBridge.exposeInMainWorld('cadBridgeApi', cadBridgeApi)

const connectorApi = {
  installMsi: (msiPath: string): Promise<{ success: boolean; message?: string }> =>
    ipcRenderer.invoke('connector:install-msi', msiPath),
  detectCad: (): Promise<import('../shared/cad/cadBridgeTypes').CadDetectionResponse> =>
    ipcRenderer.invoke('connector:get-cad-detection')
}
contextBridge.exposeInMainWorld('connectorApi', connectorApi)

export type Api = typeof api
export type WindowControls = typeof windowControls
export type LibraryApi = typeof libraryApi
export type ProjectApi = typeof projectApi
export type FileApi = typeof fileApi
export type CadBridgeApi = typeof cadBridgeApi
export type ConnectorApi = typeof connectorApi


const updaterApi = {
  openDownload: (): Promise<void> => ipcRenderer.invoke('updater:open-download'),
  getState: (): Promise<UpdateState> => ipcRenderer.invoke('updater:get-state'),
  check: (): Promise<UpdateState> => ipcRenderer.invoke('updater:check'),
  install: (): Promise<boolean> => ipcRenderer.invoke('updater:install'),
  onState: (callback: (state: UpdateState) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, state: UpdateState): void => callback(state)
    ipcRenderer.on('updater:state', listener)
    return () => ipcRenderer.removeListener('updater:state', listener)
  }
}
contextBridge.exposeInMainWorld('updaterApi', updaterApi)
export type UpdaterApi = typeof updaterApi
