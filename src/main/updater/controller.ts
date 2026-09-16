import type { UpdateState } from '../../shared/updater'

interface UpdateInfo {
  version: string
  releaseNotes?: string | { version: string; note: string | null }[] | null
}
interface Updater {
  autoDownload: boolean
  autoInstallOnAppQuit: boolean
  setFeedURL(options: { provider: 'generic'; url: string }): void
  on(event: string, listener: (...args: any[]) => void): unknown
  checkForUpdates(): Promise<{ downloadPromise?: Promise<unknown> | null } | null | undefined>
  quitAndInstall(): void
}

export function createUpdateController(updater: Updater, packaged: boolean, version: string,
  publish: (state: UpdateState) => void, manualUpdate = false) {
  let state: UpdateState = { status: packaged ? 'idle' : 'disabled', currentVersion: version, manualUpdate }
  let checking = false
  let installing = false
  const set = (patch: Partial<UpdateState>) => { state = { ...state, ...patch }; publish(state) }
  const fail = (error: unknown) => {
    console.error('[AutoUpdater]', error)
    set({ status: 'error', error: error instanceof Error ? error.message : String(error) })
  }
  const infoState = (info: UpdateInfo) => ({
    version: info.version,
    releaseNotes: typeof info.releaseNotes === 'string' ? info.releaseNotes :
      info.releaseNotes?.map((note) => `${note.version}\n${note.note ?? ''}`).join('\n\n')
  })
  if (packaged) {
    updater.setFeedURL({ provider: 'generic', url: 'https://sureflow-update.hy3d.space/' })
    updater.autoDownload = !manualUpdate
    updater.autoInstallOnAppQuit = !manualUpdate
    updater.on('checking-for-update', () => set({ status: 'checking', error: undefined }))
    updater.on('update-available', (info: UpdateInfo) => set({ ...infoState(info), status: manualUpdate ? 'manual' : 'downloading', percent: 0 }))
    updater.on('update-not-available', () => set({ status: 'up-to-date' }))
    updater.on('download-progress', (progress) => set({ status: 'downloading',
      percent: Math.min(100, Math.max(0, progress.percent)), transferred: progress.transferred,
      total: progress.total, bytesPerSecond: progress.bytesPerSecond }))
    updater.on('update-downloaded', (info: UpdateInfo) => set({ ...infoState(info), status: manualUpdate ? 'manual' : 'ready', percent: 100, error: undefined }))
    updater.on('error', fail)
  }
  return {
    getState: () => state,
    async check() {
      if (!packaged || checking || state.status === 'downloading' || state.status === 'ready') return state
      checking = true
      set({ status: 'checking', error: undefined, percent: undefined, version: undefined,
        releaseNotes: undefined, total: undefined, transferred: undefined, bytesPerSecond: undefined })
      try {
        const result = await updater.checkForUpdates()
        // Download continues after the check resolves; consume its rejection as well.
        if (result?.downloadPromise) void result.downloadPromise.catch(fail)
      } catch (error) { fail(error) }
      finally { checking = false }
      return state
    },
    install() {
      if (!packaged || manualUpdate || state.status !== 'ready' || installing) return false
      installing = true
      try { updater.quitAndInstall(); return true }
      catch (error) { installing = false; fail(error); return false }
    }
  }
}
