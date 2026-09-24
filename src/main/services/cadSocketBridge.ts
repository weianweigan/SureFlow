/**
 * CAD WebSocket 通信桥接服务 (主进程)
 * 基于 WebSocket (RFC 6455) 与 JSON-RPC 2.0 协议
 * 支持 SolidWorks (xCAD)、Creo、UG/NX 双向工程联动、心跳保活与异常崩溃检测
 */

import { WebSocketServer, WebSocket } from 'ws'
import { BrowserWindow, ipcMain, app } from 'electron'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { detectInstalledCad } from './cadDetector'
import type {
  JsonRpcRequest,
  JsonRpcResponse,
  ClientHelloParams,
  ClientHelloResult,
  DocNewProjectParams,
  DocNewProjectResult,
  DocOpenProjectParams,
  DocOpenProjectResult,
  DocActivateProjectParams,
  DocActivateProjectResult,
  DocSaveProjectParams,
  DocSaveProjectResult,
  CadDisconnectedEvent,
  CadBridgeStatus,
  CadBridgeResponse,
  CadSoftwareType,
  CadImportStepParams,
  SyncCameraViewParams,
  SyncCameraViewResult
} from '../../shared/cad/cadBridgeTypes'

const DEFAULT_CAD_PORT = 19828
let wss: WebSocketServer | null = null
let currentPort = DEFAULT_CAD_PORT

interface ClientSession {
  socket: WebSocket
  pid?: number
  cadType?: CadSoftwareType
  cadVersion?: string
  pluginVersion?: string
  docGuids: Set<string>
  lastHeartbeat: number
}

const clientSessions = new Map<WebSocket, ClientSession>()
const docGuidToSocket = new Map<string, WebSocket>()
let heartbeatTimer: NodeJS.Timeout | null = null

export function normalizeCadType(cadType?: string | null): CadSoftwareType {
  if (!cadType) return 'SOLIDWORKS'
  const upper = cadType.trim().toUpperCase()
  if (
    upper === 'SOLIDWORKS' ||
    upper === 'CREO' ||
    upper === 'NX' ||
    upper === 'INVENTOR' ||
    upper === 'CATIA' ||
    upper === 'AUTOCAD'
  ) {
    return upper as CadSoftwareType
  }
  return 'SOLIDWORKS'
}

export function getCadSocketBridgeStatus(): CadBridgeStatus {
  const activeDocCount = docGuidToSocket.size
  const firstSession = clientSessions.values().next().value as ClientSession | undefined
  const currentCadType = firstSession?.cadType || (clientSessions.size > 0 ? 'SOLIDWORKS' : undefined)
  return {
    connected: clientSessions.size > 0,
    port: currentPort,
    activeProjects: activeDocCount,
    currentCadType,
    connectedClientsCount: clientSessions.size
  }
}

/** 启动 CAD WebSocket 监听服务 */
export function startCadSocketBridge(port: number = DEFAULT_CAD_PORT): Promise<number> {
  return new Promise((resolve, reject) => {
    if (wss) {
      resolve(currentPort)
      return
    }

    currentPort = port
    try {
      const server = new WebSocketServer({ port, host: '127.0.0.1' }, () => {
        console.log(`[CAD WebSocket Bridge] WebSocket 服务已就绪: ws://127.0.0.1:${port}`)
        startHeartbeatWatchdog()
        resolve(port)
      })

      wss = server

      server.on('connection', (socket: WebSocket) => {
        const session: ClientSession = {
          socket,
          docGuids: new Set<string>(),
          lastHeartbeat: Date.now()
        }
        clientSessions.set(socket, session)
        console.log(`[CAD WebSocket Bridge] CAD 客户端已连接 (当前连接数: ${clientSessions.size})`)
        broadcastCadBridgeStatus()

        socket.on('message', async (data: Buffer | string) => {
          session.lastHeartbeat = Date.now()
          const text = data.toString('utf-8').trim()
          if (!text) return

          try {
            const rawMsg = JSON.parse(text)
            // 兼容 JSON-RPC 2.0 与旧版简单指令
            if (rawMsg.jsonrpc === '2.0' && rawMsg.method) {
              const req = rawMsg as JsonRpcRequest
              const response = await handleJsonRpcMessage(req, session)
              if (response) {
                socket.send(JSON.stringify(response))
              }
            } else if (rawMsg.type) {
              // 兼容历史消息格式
              const response = await handleLegacyMessage(rawMsg)
              socket.send(JSON.stringify(response))
            }
          } catch (err: any) {
            console.error('[CAD WebSocket Bridge] 解析消息失败:', err)
            const errRes = {
              jsonrpc: '2.0',
              id: null,
              error: { code: -32700, message: `Parse error: ${err?.message || String(err)}` }
            }
            socket.send(JSON.stringify(errRes))
          }
        })

        socket.on('pong', () => {
          session.lastHeartbeat = Date.now()
        })

        socket.on('close', () => {
          handleClientDisconnect(socket, 'SOCKET_CLOSED')
        })

        socket.on('error', (err) => {
          console.warn('[CAD WebSocket Bridge] 客户端连接错误:', err)
          handleClientDisconnect(socket, 'SOCKET_CLOSED')
        })
      })

      server.on('error', (err: any) => {
        console.warn(`[CAD WebSocket Bridge] 端口 ${port} 启动失败:`, err?.message || err)
        if (err.code === 'EADDRINUSE') {
          server.close()
          wss = null
          startCadSocketBridge(port + 1).then(resolve).catch(reject)
        } else {
          reject(err)
        }
      })
    } catch (err) {
      reject(err)
    }
  })
}

/** 停止 CAD WebSocket 监听服务 */
export function stopCadSocketBridge(): Promise<void> {
  return new Promise((resolve) => {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer)
      heartbeatTimer = null
    }

    for (const [socket] of clientSessions) {
      socket.terminate()
    }
    clientSessions.clear()
    docGuidToSocket.clear()

    if (wss) {
      wss.close(() => {
        wss = null
        resolve()
      })
    } else {
      resolve()
    }
  })
}

/** 启动心跳看门狗（每 5 秒发送 ping，超时 30 秒判定断开） */
function startHeartbeatWatchdog(): void {
  if (heartbeatTimer) clearInterval(heartbeatTimer)

  heartbeatTimer = setInterval(() => {
    const now = Date.now()
    for (const [socket, session] of clientSessions) {
      if (socket.readyState === WebSocket.OPEN) {
        try {
          socket.ping()
        } catch {}
      }

      if (now - session.lastHeartbeat > 30000) {
        console.warn(`[CAD WebSocket Bridge] 客户端 PID=${session.pid || '未知'} 心跳超时 (超30秒未响应)，主动关闭连接`)
        handleClientDisconnect(socket, 'HEARTBEAT_TIMEOUT')
        socket.terminate()
      }
    }
  }, 5000)
}

/** 处理客户端断开连接，向前端派发崩溃/脱机事件 */
function handleClientDisconnect(
  socket: WebSocket,
  reason: CadDisconnectedEvent['reason']
): void {
  const session = clientSessions.get(socket)
  if (!session) return

  clientSessions.delete(socket)
  for (const docGuid of session.docGuids) {
    docGuidToSocket.delete(docGuid)
  }

  const win = getMainWindow()
  if (win && session.cadType && session.pid) {
    const eventPayload: CadDisconnectedEvent = {
      cadType: session.cadType,
      pid: session.pid,
      reason,
      timestamp: Date.now()
    }
    // 派发给所有与该 session 绑定的 docGuid
    if (session.docGuids.size > 0) {
      for (const docGuid of session.docGuids) {
        win.webContents.send('cad:client-disconnected', {
          ...eventPayload,
          docGuid
        })
      }
    } else {
      win.webContents.send('cad:client-disconnected', eventPayload)
    }
  }

  broadcastCadBridgeStatus()
}

/** 主进程主动将工程保存回 CAD 插件 */
export async function pushProjectSaveToCad(
  docGuid: string,
  params: DocSaveProjectParams
): Promise<DocSaveProjectResult> {
  let socket = docGuidToSocket.get(docGuid)
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    // 关键回退：当 docGuid 映射未直接命中或重连时，在活跃 CAD 会话中回退检索 (单 CAD 客户端或匹配会话)
    for (const [s, session] of clientSessions) {
      if (s.readyState === WebSocket.OPEN) {
        if (session.docGuids.has(docGuid) || clientSessions.size === 1) {
          socket = s
          docGuidToSocket.set(docGuid, s)
          session.docGuids.add(docGuid)
          break
        }
      }
    }
  }

  if (!socket || socket.readyState !== WebSocket.OPEN) {
    console.warn(`[CAD WebSocket Bridge] 未找到 docGuid=${docGuid} 的活跃 CAD 连接 (当前活跃会话数: ${clientSessions.size})`)
    return { success: false, message: '未找到该工程关联的活跃 CAD 连接' }
  }

  console.log(`[CAD WebSocket Bridge] 正在向 CAD 客户端推送 DOC_SAVE_PROJECT 请求: docGuid=${docGuid}`)
  const reqId = `save-${Date.now()}`
  const request: JsonRpcRequest<DocSaveProjectParams> = {
    jsonrpc: '2.0',
    id: reqId,
    method: 'DOC_SAVE_PROJECT',
    params
  }

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      resolve({ success: false, message: 'CAD 插件保存响应超时' })
    }, 30000)

    const handler = (data: Buffer | string) => {
      try {
        const res = JSON.parse(data.toString('utf-8')) as JsonRpcResponse<DocSaveProjectResult>
        if (res.id === reqId) {
          clearTimeout(timeout)
          socket.off('message', handler)
          if (res.result) {
            resolve(res.result)
          } else {
            resolve({ success: false, message: res.error?.message || '保存失败' })
          }
        }
      } catch {}
    }

    socket.on('message', handler)
    socket.send(JSON.stringify(request))
  })
}

/** 主进程主动将摄像机视角同步至 CAD 插件 */
export async function pushCameraSyncToCad(
  docGuid: string | undefined,
  params: SyncCameraViewParams
): Promise<SyncCameraViewResult> {
  let socket: WebSocket | undefined
  if (docGuid) {
    socket = docGuidToSocket.get(docGuid)
  }
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    for (const [s, session] of clientSessions) {
      if (s.readyState === WebSocket.OPEN) {
        if ((docGuid && session.docGuids.has(docGuid)) || clientSessions.size === 1) {
          socket = s
          if (docGuid) {
            docGuidToSocket.set(docGuid, s)
            session.docGuids.add(docGuid)
          }
          break
        }
      }
    }
  }

  // 若仍未找到且存在任何活跃连接，则回退选取首个活跃会话
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    for (const [s] of clientSessions) {
      if (s.readyState === WebSocket.OPEN) {
        socket = s
        break
      }
    }
  }

  if (!socket || socket.readyState !== WebSocket.OPEN) {
    console.warn('[CAD WebSocket Bridge] 未找到活跃的 CAD 连接以同步视角')
    return { success: false, message: '未找到活跃的 CAD 连接' }
  }

  const reqId = `cam-${Date.now()}`
  const request: JsonRpcRequest<SyncCameraViewParams> = {
    jsonrpc: '2.0',
    id: reqId,
    method: 'SYNC_CAMERA_VIEW',
    params
  }

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      resolve({ success: false, message: 'CAD 客户端同步视角响应超时' })
    }, 10000)

    const handler = (data: Buffer | string) => {
      try {
        const res = JSON.parse(data.toString('utf-8')) as JsonRpcResponse<SyncCameraViewResult>
        if (res.id === reqId) {
          clearTimeout(timeout)
          socket!.off('message', handler)
          if (res.result) {
            resolve(res.result)
          } else {
            resolve({ success: false, message: res.error?.message || '同步视角失败' })
          }
        }
      } catch {}
    }

    socket.on('message', handler)
    socket.send(JSON.stringify(request))
  })
}

/** 处理 JSON-RPC 2.0 消息 */
async function handleJsonRpcMessage(
  req: JsonRpcRequest,
  session: ClientSession
): Promise<JsonRpcResponse | null> {
  const win = getMainWindow()

  switch (req.method) {
    case 'PING': {
      return {
        jsonrpc: '2.0',
        id: req.id,
        result: { pong: true, timestamp: Date.now() }
      }
    }

    case 'CLIENT_HELLO': {
      const params = (req.params || {}) as ClientHelloParams
      session.cadType = normalizeCadType(params.cadType)
      session.cadVersion = params.cadVersion
      session.pluginVersion = params.pluginVersion
      session.pid = params.pid

      if (params.activeDocuments) {
        for (const doc of params.activeDocuments) {
          session.docGuids.add(doc.docGuid)
          docGuidToSocket.set(doc.docGuid, session.socket)
        }
      }

      const result: ClientHelloResult = {
        status: 'ACCEPTED',
        serverVersion: '1.2.0',
        supportedFormats: ['STEP_AP214', 'STEP_AP242', 'PARASOLID_X_T']
      }
      broadcastCadBridgeStatus()
      return { jsonrpc: '2.0', id: req.id, result }
    }

    case 'DOC_NEW_PROJECT': {
      if (!win) {
        return {
          jsonrpc: '2.0',
          id: req.id,
          error: { code: -32000, message: 'SureFlow 无可用渲染窗口' }
        }
      }

      const params = (req.params || {}) as DocNewProjectParams
      if (params.cadType) {
        params.cadType = normalizeCadType(params.cadType)
      }
      focusSureFlowWindow(win)
      session.docGuids.add(params.docGuid)
      docGuidToSocket.set(params.docGuid, session.socket)

      // 异步通知渲染端创建新 Tab
      return new Promise((resolve) => {
        const replyChannel = `cad:new-project-reply:${params.docGuid}`
        let replyHandler: ((_e: Electron.IpcMainEvent, reply: DocNewProjectResult) => void) | null = null

        const timeout = setTimeout(() => {
          if (replyHandler) ipcMain.removeListener(replyChannel, replyHandler)
          resolve({
            jsonrpc: '2.0',
            id: req.id,
            error: { code: -32001, message: '新建工程超时' }
          })
        }, 30000)

        replyHandler = (_e, reply: DocNewProjectResult) => {
          clearTimeout(timeout)
          if (replyHandler) ipcMain.removeListener(replyChannel, replyHandler)
          resolve({ jsonrpc: '2.0', id: req.id, result: reply })
        }

        ipcMain.once(replyChannel, replyHandler)
        win.webContents.send('cad:new-project-request', params)
      })
    }

    case 'DOC_OPEN_PROJECT': {
      if (!win) {
        return {
          jsonrpc: '2.0',
          id: req.id,
          error: { code: -32000, message: 'SureFlow 无可用渲染窗口' }
        }
      }

      const params = (req.params || {}) as DocOpenProjectParams
      if (params.cadType) {
        params.cadType = normalizeCadType(params.cadType)
      }
      focusSureFlowWindow(win)
      session.docGuids.add(params.docGuid)
      docGuidToSocket.set(params.docGuid, session.socket)

      return new Promise((resolve) => {
        const replyChannel = `cad:open-project-reply:${params.docGuid}`
        let replyHandler: ((_e: Electron.IpcMainEvent, reply: DocOpenProjectResult) => void) | null = null

        const timeout = setTimeout(() => {
          if (replyHandler) ipcMain.removeListener(replyChannel, replyHandler)
          resolve({
            jsonrpc: '2.0',
            id: req.id,
            error: { code: -32001, message: '打开工程超时' }
          })
        }, 30000)

        replyHandler = (_e, reply: DocOpenProjectResult) => {
          clearTimeout(timeout)
          if (replyHandler) ipcMain.removeListener(replyChannel, replyHandler)
          resolve({ jsonrpc: '2.0', id: req.id, result: reply })
        }

        ipcMain.once(replyChannel, replyHandler)
        win.webContents.send('cad:open-project-request', params)
      })
    }

    case 'DOC_ACTIVATE_PROJECT': {
      if (!win) {
        return { jsonrpc: '2.0', id: req.id, error: { code: -32000, message: 'SureFlow 无可用渲染窗口' } }
      }
      const params = (req.params || {}) as DocActivateProjectParams
      if (params.cadType) {
        params.cadType = normalizeCadType(params.cadType)
      }
      session.docGuids.add(params.docGuid)
      docGuidToSocket.set(params.docGuid, session.socket)
      focusSureFlowWindow(win)

      return new Promise((resolve) => {
        const replyChannel = `cad:activate-project-reply:${params.docGuid}`
        let replyHandler: ((_e: Electron.IpcMainEvent, reply: DocActivateProjectResult) => void) | null = null
        const timeout = setTimeout(() => {
          if (replyHandler) ipcMain.removeListener(replyChannel, replyHandler)
          resolve({ jsonrpc: '2.0', id: req.id, error: { code: -32001, message: '激活设计工程超时' } })
        }, 30000)
        replyHandler = (_e, reply) => {
          clearTimeout(timeout)
          if (replyHandler) ipcMain.removeListener(replyChannel, replyHandler)
          resolve({ jsonrpc: '2.0', id: req.id, result: reply })
        }
        ipcMain.once(replyChannel, replyHandler)
        win.webContents.send('cad:activate-project-request', params)
      })
    }

    case 'EXPORT_STEP': {
      if (!win) {
        return {
          jsonrpc: '2.0',
          id: req.id,
          error: { code: -32000, message: 'SureFlow 无可用渲染窗口' }
        }
      }

      return new Promise((resolve) => {
        let replyHandler: ((_e: Electron.IpcMainEvent, reply: any) => void) | null = null

        const timeout = setTimeout(() => {
          if (replyHandler) ipcMain.removeListener('cad:export-step-reply', replyHandler)
          resolve({
            jsonrpc: '2.0',
            id: req.id,
            error: { code: -32001, message: '导出 STEP 几何模型超时' }
          })
        }, 30000)

        replyHandler = (_e, reply: any) => {
          clearTimeout(timeout)
          if (replyHandler) ipcMain.removeListener('cad:export-step-reply', replyHandler)
          resolve({ jsonrpc: '2.0', id: req.id, result: reply })
        }

        ipcMain.once('cad:export-step-reply', replyHandler)
        win.webContents.send('cad:export-step-request', req.params || {})
      })
    }

    case 'IMPORT_STEP': {
      if (!win) {
        return {
          jsonrpc: '2.0',
          id: req.id,
          error: { code: -32000, message: 'SureFlow 无可用渲染窗口' }
        }
      }

      const params = (req.params || {}) as CadImportStepParams
      if (params.cadType) {
        params.cadType = normalizeCadType(params.cadType)
      }

      focusSureFlowWindow(win)
      win.webContents.send('cad:import-step-event', params)
      return {
        jsonrpc: '2.0',
        id: req.id,
        result: { success: true, message: '已成功派发 STEP 模型' }
      }
    }

    case 'SYNC_CAMERA_VIEW': {
      if (!win) {
        return {
          jsonrpc: '2.0',
          id: req.id,
          error: { code: -32000, message: 'SureFlow 无可用渲染窗口' }
        }
      }

      const params = (req.params || {}) as SyncCameraViewParams
      if (params.docGuid) {
        session.docGuids.add(params.docGuid)
        docGuidToSocket.set(params.docGuid, session.socket)
      }

      focusSureFlowWindow(win)
      win.webContents.send('cad:sync-camera-from-cad', params)

      return {
        jsonrpc: '2.0',
        id: req.id,
        result: { success: true, message: '视角已同步至 SureFlow' }
      }
    }

    default:
      return {
        jsonrpc: '2.0',
        id: req.id,
        error: { code: -32601, message: `Method not found: ${req.method}` }
      }
  }
}

/** 兼容历史旧版命令 */
async function handleLegacyMessage(msg: any): Promise<CadBridgeResponse> {
  const win = getMainWindow()

  switch (msg.type) {
    case 'PING':
      return { success: true, message: 'PONG', data: { timestamp: Date.now() } }

    case 'GET_STATUS':
      return { success: true, data: getCadSocketBridgeStatus() }

    case 'IMPORT_STEP': {
      if (!win) return { success: false, message: 'SureFlow 无可用渲染窗口' }
      const payload = (msg.payload || {}) as CadImportStepParams
      if (payload.cadType) {
        payload.cadType = normalizeCadType(payload.cadType)
      }
      win.webContents.send('cad:import-step-event', payload)
      return { success: true, message: '已成功派发 STEP 模型' }
    }

    case 'EXPORT_STEP': {
      if (!win) return { success: false, message: 'SureFlow 无可用渲染窗口' }
      return new Promise((resolve) => {
        let replyHandler: ((_e: Electron.IpcMainEvent, reply: CadBridgeResponse) => void) | null = null

        const timeout = setTimeout(() => {
          if (replyHandler) ipcMain.removeListener('cad:export-step-reply', replyHandler)
          resolve({ success: false, message: '导出 STEP 超时' })
        }, 30000)

        replyHandler = (_e, reply: CadBridgeResponse) => {
          clearTimeout(timeout)
          if (replyHandler) ipcMain.removeListener('cad:export-step-reply', replyHandler)
          resolve(reply)
        }

        ipcMain.once('cad:export-step-reply', replyHandler)
        win.webContents.send('cad:export-step-request', msg.payload || {})
      })
    }

    default:
      return { success: false, message: `未知的指令类型: ${msg.type}` }
  }
}

function getMainWindow(): BrowserWindow | null {
  return BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0] || null
}

function focusSureFlowWindow(window: BrowserWindow): void {
  if (window.isDestroyed()) return
  if (window.isMinimized()) window.restore()
  window.show()
  // Windows 跨进程防任务栏闪烁前台激活：临时置顶并聚焦后立即撤销置顶
  window.setAlwaysOnTop(true)
  window.moveTop()
  window.focus()
  window.setAlwaysOnTop(false)
}

// ==========================================
// MSI 安装执行器与 CAD 检测
// ==========================================

export function broadcastCadBridgeStatus(): void {
  const win = getMainWindow()
  if (win && !win.webContents.isDestroyed()) {
    win.webContents.send('cad:status-changed', getCadSocketBridgeStatus())
  }
}

export async function runMsiInstaller(msiPath: string): Promise<{ success: boolean; message?: string }> {
  let targetMsi = msiPath
  // 如果是相对路径或 http 地址，则先下载到系统临时目录
  if (
    msiPath.startsWith('http://') ||
    msiPath.startsWith('https://') ||
    msiPath.startsWith('packages/') ||
    !path.isAbsolute(msiPath)
  ) {
    const downloadUrl = msiPath.startsWith('http')
      ? msiPath
      : `https://sureflow-library.hy3d.space/connectors/${msiPath.replace(/^\/+/, '')}`
    const fileName = path.basename(downloadUrl)
    const tempDir = path.join(app.getPath('temp'), 'sureflow-connectors')
    fs.mkdirSync(tempDir, { recursive: true })
    targetMsi = path.join(tempDir, fileName)

    console.log(`[CAD Installer] 正在从对象存储下载安装包: ${downloadUrl} -> ${targetMsi}`)
    try {
      const response = await fetch(downloadUrl)
      if (!response.ok) {
        return { success: false, message: `下载安装包失败: HTTP ${response.status} ${response.statusText}` }
      }
      const arrayBuffer = await response.arrayBuffer()
      fs.writeFileSync(targetMsi, Buffer.from(arrayBuffer))
      console.log(`[CAD Installer] 安装包下载完成 (${(arrayBuffer.byteLength / 1024 / 1024).toFixed(2)} MB)`)
    } catch (fetchErr: any) {
      return { success: false, message: `下载连接器失败: ${fetchErr?.message || String(fetchErr)}` }
    }
  }

  return new Promise((resolve) => {
    console.log(`[CAD Installer] 准备执行 MSI 静默安装: ${targetMsi}`)
    const child = spawn('msiexec.exe', ['/i', targetMsi, '/qb', '/norestart'], {
      windowsHide: false,
      detached: false
    })

    child.on('close', (code) => {
      if (code === 0 || code === 3010) {
        resolve({ success: true, message: '安装成功！已自动完成 SolidWorks AddIn 注册。' })
      } else {
        resolve({ success: false, message: `msiexec 安装退出代码: ${code}` })
      }
    })

    child.on('error', (err) => {
      resolve({ success: false, message: `无法启动 msiexec: ${err.message}` })
    })
  })
}

/** 注册 IPC 处理程序 */
export function registerCadSocketIpc(): void {
  ipcMain.handle('cad:push-save-to-cad', async (_e, { docGuid, params }) => {
    return pushProjectSaveToCad(docGuid, params)
  })

  ipcMain.handle('cad:push-sync-camera-to-cad', async (_e, { docGuid, params }) => {
    return pushCameraSyncToCad(docGuid, params)
  })

  ipcMain.handle('connector:install-msi', async (_e, msiPath: string) => {
    return runMsiInstaller(msiPath)
  })

  ipcMain.handle('connector:get-cad-detection', async () => {
    return detectInstalledCad()
  })
}
