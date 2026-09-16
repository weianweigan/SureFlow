import { app, shell } from 'electron'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { join, resolve } from 'node:path'
import { ASSOCIATED_EXTENSIONS, type AssociatedExtension, type FileAssociationInfo, type AssociationStatus } from '../../shared/settings/fileAssociations'

const run = promisify(execFile)
const APP_ID = 'com.sureflow.app'
const helper = () => app.isPackaged ? join(process.resourcesPath, 'native', 'file-association') : join(app.getAppPath(), 'out/native/file-association')

async function registryValue(key: string, name?: string): Promise<string | null> {
  try {
    const { stdout } = await run('reg.exe', ['query', key, ...(name ? ['/v', name] : ['/ve'])], { windowsHide: true, timeout: 5000 })
    return stdout.match(/REG_SZ\s+([^\r\n]+)/)?.[1]?.trim() ?? null
  } catch { return null }
}
export async function queryFileAssociations(): Promise<FileAssociationInfo> {
  const entries = await Promise.all(ASSOCIATED_EXTENSIONS.map(async (extension): Promise<AssociationStatus> => {
    if (!app.isPackaged) return { extension, state: 'development' }
    try {
      let handler: string | null = null
      if (process.platform === 'darwin') {
        handler = (await run(helper(), ['query', extension], { timeout: 5000 })).stdout.trim()
        return { extension, state: handler ? handler === APP_ID ? 'default' : 'other' : 'unknown', handler }
      }
      if (process.platform === 'win32') {
        handler = await registryValue(`HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\FileExts\\.${extension}\\UserChoice`, 'ProgId') ?? await registryValue(`HKCR\\.${extension}`)
        if (!handler) return { extension, state: 'unknown' }
        const command = await registryValue(`HKCR\\${handler}\\shell\\open\\command`)
        const executable = command?.match(/^"([^"]+)"/)?.[1]
        const ours = executable && resolve(executable).toLowerCase() === resolve(process.execPath).toLowerCase()
        return { extension, state: ours ? 'default' : 'other', handler }
      }
      return { extension, state: 'unsupported' }
    } catch { return { extension, state: 'unknown' } }
  }))
  return { packaged: app.isPackaged, platform: process.platform, entries }
}
export async function configureFileAssociation(extension: AssociatedExtension): Promise<void> {
  if (!ASSOCIATED_EXTENSIONS.includes(extension)) throw new Error('Unsupported extension')
  if (!app.isPackaged) throw new Error('File associations require the installed application')
  if (process.platform === 'win32') {
    // UserChoice is protected by Windows. Let the system own consent and selection.
    await shell.openExternal('ms-settings:defaultapps')
  } else if (process.platform === 'darwin') {
    const bundlePath = resolve(process.execPath, '../../..')
    await run(helper(), ['set', extension, bundlePath], { timeout: 120000 })
  } else { throw new Error('Unsupported platform') }
}
