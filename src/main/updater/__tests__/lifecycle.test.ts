import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({
  app: { isPackaged: true, getVersion: () => '1.0.0', once: vi.fn() },
  handle: vi.fn(), windows: vi.fn(() => [] as unknown[]),
  updater: { autoDownload: false, autoInstallOnAppQuit: false, setFeedURL: vi.fn(),
    on: vi.fn(), checkForUpdates: vi.fn(async () => null), quitAndInstall: vi.fn() }
}))
vi.mock('electron', () => ({ app: mocks.app, ipcMain: { handle: mocks.handle }, BrowserWindow: { getAllWindows: mocks.windows } }))
vi.mock('electron-updater', () => ({ autoUpdater: mocks.updater }))
import { initAutoUpdater } from '../index'
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks() })
describe('update lifecycle', () => {
  it('checks at startup, every four hours, and stops polling on quit', async () => {
    vi.useFakeTimers()
    const events = new EventEmitter()
    mocks.app.isPackaged = true
    mocks.updater.on.mockImplementation((event, handler) => events.on(event, handler))
    initAutoUpdater()
    expect(mocks.handle.mock.calls.map(([channel]) => channel)).toEqual(['updater:open-download', 'updater:get-state', 'updater:check', 'updater:install'])
    expect(mocks.updater.checkForUpdates).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(4 * 60 * 60 * 1000)
    expect(mocks.updater.checkForUpdates).toHaveBeenCalledTimes(2)
    const onQuit = mocks.app.once.mock.calls[0][1]
    onQuit()
    await vi.advanceTimersByTimeAsync(4 * 60 * 60 * 1000)
    expect(mocks.updater.checkForUpdates).toHaveBeenCalledTimes(2)
  })
  it('exposes disabled status but does not schedule checks in development', () => {
    vi.useFakeTimers()
    mocks.app.isPackaged = false
    initAutoUpdater()
    expect(mocks.updater.checkForUpdates).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
    expect(mocks.handle.mock.calls.find(([channel]) => channel === 'updater:get-state')![1]()).toMatchObject({ status: 'disabled' })
  })
})
