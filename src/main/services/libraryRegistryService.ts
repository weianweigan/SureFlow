/**
 * 在线孔腔库注册表服务（PRD-FR-03-02）
 * 
 * 提供：
 * 1. 远端全量索引 registry-index.json 拉取与离线缓存
 * 2. 本地已安装库与远端市场库智能版本比对（未安装/可更新/已最新）
 * 3. 官方 .sfzip 流式下载、SHA-256 强校验与安全解压入库
 */

import { existsSync, createWriteStream, createReadStream, rmSync } from 'node:fs'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import https from 'node:https'
import http from 'node:http'
import crypto from 'node:crypto'
import type {
  RegistryIndex,
  RegistryPackage,
  OnlinePackageItem,
  InstallProgressEvent,
  PackageSourceInfo
} from '../../shared/cavity/registryTypes'
import type { LibrarySummary } from '../../shared/cavity/types'
import { importLibrary, readLibrary, type LibraryPaths } from './libraryService'

export const DEFAULT_REGISTRY_URL = 'https://sureflow-library.hy3d.space/library/'
export const PACKAGE_SOURCE_FILE = 'package-source.json'

/** SemVer 简单比较：a > b 返回 1，a < b 返回 -1，相等返回 0 */
export function compareSemver(a: string, b: string): number {
  const pa = a.split('.').map((x) => parseInt(x, 10) || 0)
  const pb = b.split('.').map((x) => parseInt(x, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] ?? 0
    const nb = pb[i] ?? 0
    if (na > nb) return 1
    if (na < nb) return -1
  }
  return 0
}

/** 获取全局包索引（带本地文件缓存降级） */
export async function fetchRegistryIndex(
  cacheDir: string,
  baseUrl = DEFAULT_REGISTRY_URL,
  forceRefresh = false
): Promise<RegistryIndex> {
  const indexUrl = new URL('registry-index.json', baseUrl).toString()
  const localCachePath = join(cacheDir, 'registry-index-cache.json')

  if (!forceRefresh && existsSync(localCachePath)) {
    try {
      const stat = await import('node:fs/promises').then((m) => m.stat(localCachePath))
      // 5 分钟内缓存有效
      if (Date.now() - stat.mtimeMs < 5 * 60 * 1000) {
        const raw = await readFile(localCachePath, 'utf-8')
        return JSON.parse(raw) as RegistryIndex
      }
    } catch {
      // 忽略缓存读取错误
    }
  }

  try {
    const raw = await httpGetText(indexUrl, 8000)
    const index = JSON.parse(raw) as RegistryIndex
    if (!index || !Array.isArray(index.packages)) {
      throw new Error('远端返回的 registry-index.json 格式非法')
    }
    // 写入本地缓存
    await mkdir(cacheDir, { recursive: true })
    await writeFile(localCachePath, raw, 'utf-8')
    return index
  } catch (netErr) {
    // 离线降级：读取过往本地缓存
    if (existsSync(localCachePath)) {
      try {
        const raw = await readFile(localCachePath, 'utf-8')
        return JSON.parse(raw) as RegistryIndex
      } catch {
        // 继续抛错
      }
    }
    throw new Error(`无法连接在线孔腔库: ${(netErr as Error).message}`)
  }
}

/** 比对本地库与远端市场库状态 */
export async function matchOnlinePackages(
  index: RegistryIndex,
  localSummaries: LibrarySummary[]
): Promise<OnlinePackageItem[]> {
  // 建立本地库映射：packageId -> { summary, version }
  const localMap = new Map<string, { summary: LibrarySummary; version: string }>()

  for (const sum of localSummaries) {
    let pkgId = ''
    let version = ''

    // 1. 尝试从 package-source.json 读取
    const sourcePath = join(sum.dirPath, PACKAGE_SOURCE_FILE)
    if (existsSync(sourcePath)) {
      try {
        const sourceData = JSON.parse(await readFile(sourcePath, 'utf-8')) as PackageSourceInfo
        pkgId = sourceData.packageId
        version = sourceData.installedVersion
      } catch {
        // ignore
      }
    }

    // 2. 尝试从 package.json 读取
    if (!pkgId) {
      const pkgJsonPath = join(sum.dirPath, 'package.json')
      if (existsSync(pkgJsonPath)) {
        try {
          const pkgData = JSON.parse(await readFile(pkgJsonPath, 'utf-8'))
          pkgId = pkgData.id
          version = pkgData.version
        } catch {
          // ignore
        }
      }
    }

    // 3. 兜底回退：根据目录名或库名推断（标准库适配）
    if (!pkgId) {
      const dirBase = sum.dirPath.toLowerCase()
      if (dirBase.includes('sureflow-standard-library') || sum.name.includes('标准孔腔库')) {
        pkgId = 'sureflow-standard-library'
        try {
          const lib = await readLibrary(sum.dirPath)
          version = lib.meta?.version || '1.0.0'
        } catch {
          version = '1.0.0'
        }
      }
    }

    if (pkgId) {
      localMap.set(pkgId, { summary: sum, version: version || '1.0.0' })
    }
  }

  const items: OnlinePackageItem[] = []

  for (const pkg of index.packages) {
    const local = localMap.get(pkg.id)
    if (!local) {
      items.push({
        pkg,
        status: 'not-installed'
      })
    } else {
      const cmp = compareSemver(pkg.latestVersion, local.version)
      items.push({
        pkg,
        status: cmp > 0 ? 'updatable' : 'up-to-date',
        localVersion: local.version,
        localDirPath: local.summary.dirPath
      })
    }
  }

  return items
}

/** 下载并安装在线孔腔包 */
export async function downloadAndInstallOnlinePackage(
  paths: LibraryPaths,
  cacheDir: string,
  pkg: RegistryPackage,
  targetVersion: string,
  onProgress?: (event: InstallProgressEvent) => void
): Promise<LibrarySummary> {
  const versionInfo = pkg.versions[targetVersion]
  if (!versionInfo) {
    throw new Error(`未找到包 ${pkg.id} 的版本 ${targetVersion}`)
  }

  const tempDir = join(cacheDir, '.download-temp')
  await mkdir(tempDir, { recursive: true })
  const tempZipPath = join(tempDir, `${pkg.id}-${targetVersion}-${Date.now()}.sfzip`)

  try {
    // 1. 下载
    onProgress?.({
      packageId: pkg.id,
      version: targetVersion,
      step: 'downloading',
      percent: 0,
      transferredBytes: 0,
      totalBytes: versionInfo.fileSize
    })

    await downloadFileWithProgress(versionInfo.downloadUrl, tempZipPath, (p) => {
      onProgress?.({
        packageId: pkg.id,
        version: targetVersion,
        step: 'downloading',
        percent: p.percent,
        transferredBytes: p.transferred,
        totalBytes: p.total,
        speedText: p.speedText
      })
    })

    // 2. SHA-256 强校验
    onProgress?.({
      packageId: pkg.id,
      version: targetVersion,
      step: 'verifying',
      percent: 100,
      transferredBytes: versionInfo.fileSize,
      totalBytes: versionInfo.fileSize
    })

    const hash = await computeFileSha256(tempZipPath)
    if (versionInfo.sha256 && hash.toLowerCase() !== versionInfo.sha256.toLowerCase()) {
      throw new Error(`安装包完整性校验失败 (SHA-256 不匹配)。预期: ${versionInfo.sha256}，实际: ${hash}`)
    }

    // 3. 解压安装
    onProgress?.({
      packageId: pkg.id,
      version: targetVersion,
      step: 'extracting',
      percent: 100,
      transferredBytes: versionInfo.fileSize,
      totalBytes: versionInfo.fileSize
    })

    const summary = await importLibrary(paths, { kind: 'sfzip', zipPath: tempZipPath })

    // 4. 写入 package-source.json 溯源标记
    const sourceInfo: PackageSourceInfo = {
      packageId: pkg.id,
      installedVersion: targetVersion,
      registryUrl: versionInfo.downloadUrl,
      installedAt: new Date().toISOString(),
      sha256: hash
    }
    await writeFile(join(summary.dirPath, PACKAGE_SOURCE_FILE), JSON.stringify(sourceInfo, null, 2), 'utf-8')

    onProgress?.({
      packageId: pkg.id,
      version: targetVersion,
      step: 'completed',
      percent: 100,
      transferredBytes: versionInfo.fileSize,
      totalBytes: versionInfo.fileSize
    })

    return summary
  } catch (err) {
    onProgress?.({
      packageId: pkg.id,
      version: targetVersion,
      step: 'failed',
      percent: 0,
      transferredBytes: 0,
      totalBytes: versionInfo.fileSize,
      error: (err as Error).message
    })
    throw err
  } finally {
    if (existsSync(tempZipPath)) {
      try {
        rmSync(tempZipPath, { force: true })
      } catch {
        // ignore
      }
    }
  }
}

/* ---------- 内部网络与哈希辅助工具 ---------- */

function httpGetText(urlStr: string, timeoutMs = 8000): Promise<string> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(urlStr)
    const client = parsed.protocol === 'https:' ? https : http

    const req = client.get(urlStr, { timeout: timeoutMs }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return httpGetText(res.headers.location, timeoutMs).then(resolve).catch(reject)
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode} ${res.statusMessage || ''}`))
      }
      const chunks: Buffer[] = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')))
    })

    req.on('timeout', () => {
      req.destroy()
      reject(new Error('请求超时'))
    })
    req.on('error', reject)
  })
}

function downloadFileWithProgress(
  urlStr: string,
  destPath: string,
  onProgress: (p: { percent: number; transferred: number; total: number; speedText: string }) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(urlStr)
    const client = parsed.protocol === 'https:' ? https : http

    const req = client.get(urlStr, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return downloadFileWithProgress(res.headers.location, destPath, onProgress).then(resolve).catch(reject)
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`下载失败: HTTP ${res.statusCode}`))
      }

      const total = parseInt(res.headers['content-length'] || '0', 10)
      let transferred = 0
      let lastTime = Date.now()
      let lastTransferred = 0

      const fileStream = createWriteStream(destPath)

      res.on('data', (chunk) => {
        transferred += chunk.length
        const now = Date.now()
        const elapsed = (now - lastTime) / 1000
        let speedText = ''
        if (elapsed >= 0.5) {
          const bytesPerSec = (transferred - lastTransferred) / elapsed
          speedText = `${(bytesPerSec / 1024 / 1024).toFixed(1)} MB/s`
          lastTime = now
          lastTransferred = transferred
        }

        const percent = total > 0 ? Math.min(100, Math.round((transferred / total) * 100)) : 0
        onProgress({ percent, transferred, total, speedText })
      })

      res.pipe(fileStream)

      fileStream.on('finish', () => {
        fileStream.close(() => resolve())
      })

      fileStream.on('error', (err) => {
        rmSync(destPath, { force: true })
        reject(err)
      })
    })

    req.on('error', (err) => {
      rmSync(destPath, { force: true })
      reject(err)
    })
  })
}

function computeFileSha256(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256')
    const s = createReadStream(filePath)
    s.on('data', (d) => hash.update(d))
    s.on('end', () => resolve(hash.digest('hex')))
    s.on('error', reject)
  })
}
