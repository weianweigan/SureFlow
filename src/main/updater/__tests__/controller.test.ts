import { EventEmitter } from 'node:events'
import { describe, it, expect, vi } from 'vitest'
import { createUpdateController } from '../controller'

class FakeUpdater extends EventEmitter {
  autoDownload = false
  autoInstallOnAppQuit = false
  setFeedURL = vi.fn()
  checkForUpdates = vi.fn<() => Promise<{ downloadPromise?: Promise<unknown> } | undefined>>(async () => undefined)
  quitAndInstall = vi.fn()
}
function setup(packaged = true) {
  const updater = new FakeUpdater()
  const publish = vi.fn()
  const controller = createUpdateController(updater, packaged, '1.0.0', publish)
  return { updater, controller, publish }
}
describe('silent update controller', () => {
  it('never configures, checks or installs in development', async () => {
    const { updater, controller } = setup(false)
    await controller.check()
    expect(controller.getState().status).toBe('disabled')
    expect(controller.install()).toBe(false)
    expect(updater.setFeedURL).not.toHaveBeenCalled()
    expect(updater.checkForUpdates).not.toHaveBeenCalled()
    expect(updater.eventNames()).toEqual([])
  })
  it('downloads silently, publishes progress and notes, and installs only when ready', async () => {
    const { updater, controller, publish } = setup()
    expect(updater.setFeedURL).toHaveBeenCalledWith({ provider: 'generic', url: 'https://sureflow-update.hy3d.space/' })
    expect(updater.autoDownload).toBe(true)
    expect(updater.autoInstallOnAppQuit).toBe(true)
    expect(controller.install()).toBe(false)
    await controller.check()
    updater.emit('update-available', { version: '1.1.0', releaseNotes: [{ version: '1.1.0', note: 'Fixes' }] })
    updater.emit('download-progress', { percent: 50, total: 200, transferred: 100, bytesPerSecond: 20 })
    expect(controller.getState()).toMatchObject({ status: 'downloading', percent: 50, releaseNotes: '1.1.0\nFixes' })
    await controller.check()
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1)
    updater.emit('update-downloaded', { version: '1.1.0', releaseNotes: 'Fixes' })
    expect(publish).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'ready', releaseNotes: 'Fixes' }))
    // Deferring does not install now; quit-install remains enabled, polling preserves ready state.
    await controller.check()
    expect(updater.quitAndInstall).not.toHaveBeenCalled()
    expect(updater.autoInstallOnAppQuit).toBe(true)
    expect(controller.install()).toBe(true)
    expect(controller.install()).toBe(false)
    expect(updater.quitAndInstall).toHaveBeenCalledTimes(1)
  })
  it('coalesces concurrent checks', async () => {
    const { updater, controller } = setup()
    let resolve!: () => void
    updater.checkForUpdates.mockImplementation(() => new Promise<undefined>(r => { resolve = () => r(undefined) }))
    const first = controller.check()
    await controller.check()
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1)
    resolve()
    await first
  })
  it('reports a rejected check and supports retry without stale errors', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { updater, controller } = setup()
    updater.checkForUpdates.mockRejectedValueOnce(new Error('Offline'))
    await controller.check()
    expect(controller.getState()).toMatchObject({ status: 'error', error: 'Offline' })
    await controller.check()
    updater.emit('update-not-available')
    expect(controller.getState()).toMatchObject({ status: 'up-to-date', error: undefined })
    log.mockRestore()
  })
  it('handles asynchronous download promise rejections', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { updater, controller } = setup()
    updater.checkForUpdates.mockResolvedValueOnce({ downloadPromise: Promise.reject(new Error('Download disconnected')) })
    await controller.check()
    await Promise.resolve()
    expect(controller.getState()).toMatchObject({ status: 'error', error: 'Download disconnected' })
    log.mockRestore()
  })
  it('exposes download and install failures without unhandled exceptions', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { updater, controller } = setup()
    updater.emit('error', new Error('Checksum mismatch'))
    expect(controller.getState().error).toBe('Checksum mismatch')
    updater.emit('update-downloaded', { version: '1.1.0' })
    updater.quitAndInstall.mockImplementation(() => { throw new Error('Installer failed') })
    expect(controller.install()).toBe(false)
    expect(controller.getState().error).toBe('Installer failed')
    log.mockRestore()
  })
})

it('checks unsigned macOS releases without downloading or installing', async () => {
  const updater = new FakeUpdater()
  const controller = createUpdateController(updater, true, '1.0.0', vi.fn(), true)
  expect(updater.autoDownload).toBe(false)
  expect(updater.autoInstallOnAppQuit).toBe(false)
  await controller.check()
  updater.emit('update-available', { version: '1.1.0', releaseNotes: 'New release' })
  expect(controller.getState()).toMatchObject({ status: 'manual', manualUpdate: true, version: '1.1.0', releaseNotes: 'New release' })
  expect(controller.install()).toBe(false)
  updater.emit('update-downloaded', { version: '1.1.0' })
  expect(controller.getState().status).toBe('manual')
  expect(controller.install()).toBe(false)
  expect(updater.quitAndInstall).not.toHaveBeenCalled()
})
