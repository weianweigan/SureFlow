/**
 * STEP 导出文件路径处理与持久化工具库
 *
 * 核心逻辑：
 * 1. 默认与当前 .sfb 工程同路径、同名称；
 * 2. 导出路径若与 .sfb 位于同级目录或子目录，则持久化存储为相对路径（如 ./block.step 或 ./cad/block.step）；
 * 3. 再次打开工程或在不同机器、不同绝对路径下打开时，基于当前 .sfb 路径动态还原，避免路径断链与重复选择；
 * 4. 多方案导出时自动在文件名后追加方案标识后缀。
 */

/**
 * 提取文件路径所在目录（保留原路径分隔符类型）
 */
export function getFileDirectory(filePath: string): string {
  if (!filePath) return ''
  const lastSlash = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'))
  return lastSlash !== -1 ? filePath.slice(0, lastSlash) : ''
}

/**
 * 提取文件纯名称（去除目录及扩展名）
 */
export function getFileBaseName(filePath: string): string {
  if (!filePath) return ''
  const lastSlash = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'))
  const fileName = lastSlash !== -1 ? filePath.slice(lastSlash + 1) : filePath
  const lastDot = fileName.lastIndexOf('.')
  return lastDot > 0 ? fileName.slice(0, lastDot) : fileName
}

/**
 * 提取文件名（包含扩展名）
 */
export function getFileNameWithExt(filePath: string): string {
  if (!filePath) return ''
  const lastSlash = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'))
  return lastSlash !== -1 ? filePath.slice(lastSlash + 1) : filePath
}

/**
 * 判断指定路径是否为相对路径
 */
export function isRelativePath(p: string): boolean {
  if (!p) return false
  const trimmed = p.trim()
  if (trimmed.startsWith('./') || trimmed.startsWith('.\\')) return true
  // Windows 绝对路径如 C:\ 或 c:/
  if (/^[a-zA-Z]:[/\\]/.test(trimmed)) return false
  // UNC 或 Unix 绝对路径
  if (trimmed.startsWith('/') || trimmed.startsWith('\\')) return false
  return true
}

/**
 * 获取默认的 STEP 导出文件完整路径
 * 规则：若有 sfbFilePath，默认在同目录同名；若无则回退到 ${projectName}.step
 */
export function getDefaultExportPath(sfbFilePath?: string, projectName?: string): string {
  if (sfbFilePath) {
    const dir = getFileDirectory(sfbFilePath)
    const baseName = getFileBaseName(sfbFilePath)
    const sep = sfbFilePath.includes('\\') ? '\\' : '/'
    return dir ? `${dir}${sep}${baseName}.step` : `${baseName}.step`
  }
  const cleanName = (projectName || '未命名工程').replace(/[\\/:*?"<>|]/g, '_')
  return `${cleanName}.step`
}

/**
 * 将持久化的相对路径或绝对路径解析还原为当前可用的绝对导出路径
 */
export function resolveExportPath(
  lastExportPath?: string,
  sfbFilePath?: string,
  projectName?: string
): string {
  if (!lastExportPath || !lastExportPath.trim()) {
    return getDefaultExportPath(sfbFilePath, projectName)
  }

  const trimmed = lastExportPath.trim()
  if (isRelativePath(trimmed)) {
    if (sfbFilePath) {
      const sfbDir = getFileDirectory(sfbFilePath)
      const sep = sfbFilePath.includes('\\') ? '\\' : '/'
      const cleanRel = trimmed.replace(/^\.[\\/]/, '')
      const normalizedRel = sep === '\\' ? cleanRel.replace(/\//g, '\\') : cleanRel.replace(/\\/g, '/')
      return sfbDir ? `${sfbDir}${sep}${normalizedRel}` : normalizedRel
    }
    return trimmed
  }

  // 已经是绝对路径，直接返回
  return trimmed
}

/**
 * 计算将要写入 .sfb 的持久化路径
 * 规则：若 exportPath 位于 sfbFilePath 相同目录，返回 `./${filename}`；若在子目录返回 `./sub/filename`；否则保持绝对路径
 */
export function toPersistedExportPath(exportPath: string, sfbFilePath?: string): string {
  if (!exportPath || !exportPath.trim()) return ''
  const trimmedExport = exportPath.trim()
  if (!sfbFilePath || !sfbFilePath.trim()) return trimmedExport

  // 统一用正斜杠进行归一化路径比对
  const normSfbDir = getFileDirectory(sfbFilePath).replace(/\\/g, '/').replace(/\/+$/, '')
  const normExport = trimmedExport.replace(/\\/g, '/')

  if (!normSfbDir) return trimmedExport

  const isWindows = /^[a-zA-Z]:\//.test(normSfbDir)
  const normSfbDirCmp = isWindows ? normSfbDir.toLowerCase() : normSfbDir
  const normExportCmp = isWindows ? normExport.toLowerCase() : normExport

  // 1. 同级目录文件匹配
  const exportDir = getFileDirectory(normExport)
  const exportDirCmp = isWindows ? exportDir.toLowerCase() : exportDir
  if (exportDirCmp === normSfbDirCmp) {
    const fileName = getFileNameWithExt(normExport)
    return `./${fileName}`
  }

  // 2. 子目录匹配
  const subPrefix = `${normSfbDirCmp}/`
  if (normExportCmp.startsWith(subPrefix)) {
    const relPart = normExport.slice(normSfbDir.length + 1)
    return `./${relPart}`
  }

  // 3. 跨目录或跨盘符，记录绝对路径
  return trimmedExport
}

/**
 * 多方案导出时计算每个方案的目标文件路径
 */
export function computeSchemeExportPath(
  baseExportPath: string,
  schemeName: string,
  isMultiScheme: boolean
): string {
  if (!isMultiScheme || !schemeName) {
    return baseExportPath
  }

  const cleanScheme = schemeName.replace(/[\\/:*?"<>|]/g, '_')
  const lastDot = baseExportPath.lastIndexOf('.')
  if (lastDot > 0) {
    const prefix = baseExportPath.slice(0, lastDot)
    const ext = baseExportPath.slice(lastDot)
    return `${prefix}_${cleanScheme}${ext}`
  }
  return `${baseExportPath}_${cleanScheme}.step`
}
