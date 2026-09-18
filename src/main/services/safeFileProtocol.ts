import { existsSync } from 'node:fs'

/**
 * 解析 sf-file:// 协议 URL 并还原为本地文件系统绝对路径。
 *
 * 解决跨平台（特别是在 macOS / Linux 下）的 URL 解析差异：
 * 1. 当 URL 格式为 sf-file://local/Volumes/... 时，url.host 为 'local'，url.pathname 即为完整路径。
 * 2. 当 URL 未带固定 host（如 sf-file:///Volumes/...）时，Chromium 标准 scheme 解析器会将首级目录（如 volumes）当作 host。
 *    此时通过 /${url.host}${filePath} 进行路径还原。
 * 3. macOS 下外接存储挂载卷（/Volumes/xxx）若前缀丢失，通过 existsSync('/Volumes' + path) 进行安全回退。
 * 4. Windows 下去除开头的 / 并保留盘符（如 /C:/... -> C:/...）。
 */
export function resolveSfFilePath(rawUrl: string): string {
  const url = new URL(rawUrl)
  let filePath = decodeURIComponent(url.pathname)

  if (url.host && url.host !== 'local' && url.host !== 'localhost') {
    if (process.platform === 'win32' && /^[a-zA-Z]$/.test(url.host)) {
      filePath = `${url.host.toUpperCase()}:${filePath}`
    } else {
      filePath = `/${url.host}${filePath}`
    }
  }

  if (process.platform === 'win32' && /^\/[a-zA-Z]:/.test(filePath)) {
    filePath = filePath.slice(1)
  }

  if (process.platform === 'darwin' && !existsSync(filePath) && existsSync(`/Volumes${filePath}`)) {
    filePath = `/Volumes${filePath}`
  }

  return filePath
}
