import { exec } from 'child_process'
import fs from 'fs'
import path from 'path'
import type { DetectedCadSoftware, CadDetectionResponse } from '../../shared/cad/cadBridgeTypes'

let cachedDetection: CadDetectionResponse | null = null
let lastDetectionTime = 0
const CACHE_TTL_MS = 15000 // 15秒缓存

/**
 * 清理与标准化软件显示名称
 */
function cleanDisplayName(name: string): string {
  // 去除可能的 null 字节或 Windows 异常字符
  return name.replace(/\0/g, '').trim()
}

/**
 * 执行 PowerShell 扫描注册表中的已安装 CAD 软件
 */
async function queryInstalledCadViaPowerShell(): Promise<DetectedCadSoftware[]> {
  return new Promise((resolve) => {
    // 针对 Windows 注册表 Uninstall 键进行快速过滤查询
    const psCmd = `Get-ItemProperty 'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*', 'HKLM:\\Software\\Wow6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*', 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*' -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -and ($_.DisplayName -match 'SOLIDWORKS 20|Siemens NX|Creo Parametric|AutoCAD 20|Autodesk Inventor') } | Select-Object DisplayName, DisplayVersion, InstallLocation | ConvertTo-Json -Compress`

    exec(
      `powershell -NoProfile -ExecutionPolicy Bypass -Command "${psCmd}"`,
      { maxBuffer: 10 * 1024 * 1024, timeout: 8000 },
      (error, stdout) => {
        if (error || !stdout.trim()) {
          resolve([])
          return
        }

        try {
          const raw = JSON.parse(stdout.trim())
          const items: Array<{ DisplayName?: string; DisplayVersion?: string; InstallLocation?: string }> =
            Array.isArray(raw) ? raw : [raw]

          const results: DetectedCadSoftware[] = []
          const seenIds = new Set<string>()

          for (const item of items) {
            const rawName = cleanDisplayName(item.DisplayName || '')
            const version = cleanDisplayName(item.DisplayVersion || '')
            const location = item.InstallLocation ? cleanDisplayName(item.InstallLocation) : undefined

            if (!rawName) continue

            // 过滤语言包、SDK、资源包、查看器等辅助项，只保留主程序
            if (
              /Language|Resource|Chinese|API SDK|Document Manager|Marketplace|CEF for|Login Manager|Exchange for/i.test(
                rawName
              )
            ) {
              continue
            }

            // 1. SOLIDWORKS 主程序
            if (/^SOLIDWORKS 20\d\d/i.test(rawName)) {
              const swMatch = rawName.match(/SOLIDWORKS (20\d\d( SP\d+(\.\d+)?)?)/i)
              const swVerStr = swMatch ? swMatch[1] : version
              const uniqueKey = `solidworks-${swVerStr}`
              if (!seenIds.has(uniqueKey)) {
                seenIds.add(uniqueKey)
                results.push({
                  id: 'solidworks',
                  cadType: 'SOLIDWORKS',
                  name: `SolidWorks ${swVerStr}`,
                  version: version || swVerStr,
                  installed: true,
                  installLocation: location,
                  connectorSupported: true
                })
              }
            }
            // 2. Siemens NX
            else if (/Siemens NX/i.test(rawName)) {
              const nxMatch = rawName.match(/Siemens NX\s*([\d\.]+)/i)
              const nxVerStr = nxMatch ? nxMatch[1] : version
              const uniqueKey = `nx-${nxVerStr}`
              if (!seenIds.has(uniqueKey)) {
                seenIds.add(uniqueKey)
                results.push({
                  id: 'nx',
                  cadType: 'NX',
                  name: `Siemens NX ${nxVerStr}`,
                  version: version || nxVerStr,
                  installed: true,
                  installLocation: location,
                  connectorSupported: false
                })
              }
            }
            // 3. PTC Creo
            else if (/Creo Parametric/i.test(rawName)) {
              const creoMatch = rawName.match(/Creo Parametric\s*([\d\.]+)/i)
              const creoVerStr = creoMatch ? creoMatch[1] : version
              const uniqueKey = `creo-${creoVerStr}`
              if (!seenIds.has(uniqueKey)) {
                seenIds.add(uniqueKey)
                results.push({
                  id: 'creo',
                  cadType: 'CREO',
                  name: `PTC Creo Parametric ${creoVerStr}`,
                  version: version || creoVerStr,
                  installed: true,
                  installLocation: location,
                  connectorSupported: false
                })
              }
            }
            // 4. Autodesk AutoCAD
            else if (/AutoCAD 20\d\d/i.test(rawName)) {
              if (/Update/i.test(rawName)) continue
              const acadMatch = rawName.match(/AutoCAD (20\d\d)/i)
              const acadVerStr = acadMatch ? acadMatch[1] : version
              const uniqueKey = `autocad-${acadVerStr}`
              if (!seenIds.has(uniqueKey)) {
                seenIds.add(uniqueKey)
                results.push({
                  id: 'autocad',
                  cadType: 'AUTOCAD',
                  name: `Autodesk AutoCAD ${acadVerStr}`,
                  version: version || acadVerStr,
                  installed: true,
                  installLocation: location,
                  connectorSupported: false
                })
              }
            }
            // 5. Autodesk Inventor
            else if (/Autodesk Inventor/i.test(rawName)) {
              const invMatch = rawName.match(/Inventor\s*(?:Professional\s*)?(20\d\d)/i)
              const invVerStr = invMatch ? invMatch[1] : version
              const uniqueKey = `inventor-${invVerStr}`
              if (!seenIds.has(uniqueKey)) {
                seenIds.add(uniqueKey)
                results.push({
                  id: 'inventor',
                  cadType: 'INVENTOR',
                  name: `Autodesk Inventor ${invVerStr}`,
                  version: version || invVerStr,
                  installed: true,
                  installLocation: location,
                  connectorSupported: false
                })
              }
            }
          }

          resolve(results)
        } catch {
          resolve([])
        }
      }
    )
  })
}

/**
 * 本地常用安装目录回退探测
 */
function probeFallbackCadDirectories(): DetectedCadSoftware[] {
  const fallbacks: DetectedCadSoftware[] = []
  if (process.platform !== 'win32') return fallbacks

  // 1. SolidWorks 默认路径探测
  const swPaths = [
    'C:\\Program Files\\SOLIDWORKS Corp\\SOLIDWORKS\\SLDWORKS.exe',
    'C:\\Program Files\\Dassault Systemes\\SOLIDWORKS\\SLDWORKS.exe'
  ]
  for (const p of swPaths) {
    if (fs.existsSync(p)) {
      fallbacks.push({
        id: 'solidworks',
        cadType: 'SOLIDWORKS',
        name: 'SolidWorks (本地已安装)',
        version: '已检测到可执行程序',
        installed: true,
        installLocation: path.dirname(p),
        connectorSupported: true
      })
      break
    }
  }

  // 2. Siemens NX 默认路径探测
  const nxPaths = [
    'C:\\Program Files\\Siemens\\NX\\UGII\\ugraf.exe',
    'C:\\UG12.0\\UGII\\ugraf.exe'
  ]
  for (const p of nxPaths) {
    if (fs.existsSync(p)) {
      fallbacks.push({
        id: 'nx',
        cadType: 'NX',
        name: 'Siemens NX',
        version: '已检测到可执行程序',
        installed: true,
        installLocation: path.dirname(p),
        connectorSupported: false
      })
      break
    }
  }

  return fallbacks
}

/**
 * 探测 SureFlow 官方连接器本身是否已在本地安装
 */
async function probeInstalledConnectors(): Promise<Record<string, boolean>> {
  return new Promise((resolve) => {
    // 扫描注册表是否有 SureFlow Connector
    const psCmd = `Get-ItemProperty 'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*', 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*' -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -match 'SureFlow.*Connector' } | Select-Object DisplayName | ConvertTo-Json -Compress`

    exec(
      `powershell -NoProfile -ExecutionPolicy Bypass -Command "${psCmd}"`,
      { timeout: 4000 },
      (error, stdout) => {
        const connectorInstalledMap: Record<string, boolean> = {
          solidworks: false,
          creo: false,
          nx: false
        }

        if (!error && stdout.trim()) {
          try {
            const raw = JSON.parse(stdout.trim())
            const items = Array.isArray(raw) ? raw : [raw]
            for (const item of items) {
              const name = (item.DisplayName || '').toLowerCase()
              if (name.includes('solidworks')) connectorInstalledMap.solidworks = true
              if (name.includes('creo')) connectorInstalledMap.creo = true
              if (name.includes('nx')) connectorInstalledMap.nx = true
            }
          } catch {}
        }

        // 进一步探测 SolidWorks AddIns 注册表
        if (!connectorInstalledMap.solidworks) {
          try {
            const swAddinReg = `reg query "HKLM\\SOFTWARE\\SolidWorks\\AddIns" /s /f "SureFlow" 2>nul`
            exec(swAddinReg, (err, regOut) => {
              if (!err && regOut && regOut.includes('SureFlow')) {
                connectorInstalledMap.solidworks = true
              }
              resolve(connectorInstalledMap)
            })
            return
          } catch {}
        }

        resolve(connectorInstalledMap)
      }
    )
  })
}

/**
 * 汇总检测本地安装的 CAD 软件及官方连接器就绪状态
 */
export async function detectInstalledCad(forceRefresh = false): Promise<CadDetectionResponse> {
  const now = Date.now()
  if (!forceRefresh && cachedDetection && now - lastDetectionTime < CACHE_TTL_MS) {
    return cachedDetection
  }

  let installedList = await queryInstalledCadViaPowerShell()

  // 如果注册表没有查到，使用文件系统回退探测
  if (installedList.length === 0) {
    installedList = probeFallbackCadDirectories()
  }

  const connectorInstalledMap = await probeInstalledConnectors()

  const detectedMap: Record<string, { installed: boolean; version?: string; connectorInstalled?: boolean }> = {
    solidworks: {
      installed: false,
      connectorInstalled: connectorInstalledMap.solidworks
    },
    creo: {
      installed: false,
      connectorInstalled: connectorInstalledMap.creo
    },
    nx: {
      installed: false,
      connectorInstalled: connectorInstalledMap.nx
    }
  }

  for (const cad of installedList) {
    if (cad.id === 'solidworks') {
      detectedMap.solidworks = {
        installed: true,
        version: cad.version || cad.name,
        connectorInstalled: connectorInstalledMap.solidworks
      }
      cad.connectorInstalled = connectorInstalledMap.solidworks
    } else if (cad.id === 'creo') {
      detectedMap.creo = {
        installed: true,
        version: cad.version || cad.name,
        connectorInstalled: connectorInstalledMap.creo
      }
      cad.connectorInstalled = connectorInstalledMap.creo
    } else if (cad.id === 'nx') {
      detectedMap.nx = {
        installed: true,
        version: cad.version || cad.name,
        connectorInstalled: connectorInstalledMap.nx
      }
      cad.connectorInstalled = connectorInstalledMap.nx
    }
  }

  const result: CadDetectionResponse = {
    detectedMap,
    installedList
  }

  cachedDetection = result
  lastDetectionTime = now
  return result
}
