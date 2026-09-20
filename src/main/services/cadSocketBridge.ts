/**
 * CAD Socket 通信桥接服务 (主进程)
 * 允许 SolidWorks、Inventor 等外部 CAD 软件或宏脚本通过 TCP Socket 自动传入/导出 STEP 模型
 */

import { createServer, Server, Socket } from 'node:net'
import { BrowserWindow, ipcMain } from 'electron'
import type {
  CadSocketMessage,
  CadImportStepParams,
  CadExportStepParams,
  CadBridgeStatus,
  CadBridgeResponse
} from '../../shared/cad/cadBridgeTypes'

const DEFAULT_CAD_PORT = 19828
let server: Server | null = null
let currentPort = DEFAULT_CAD_PORT
const connectedSockets = new Set<Socket>()

export function getCadSocketBridgeStatus(): CadBridgeStatus {
  return {
    connected: connectedSockets.size > 0,
    port: currentPort,
    activeProjects: 0
  }
}

/** 启动 CAD TCP Socket 监听服务 */
export function startCadSocketBridge(port: number = DEFAULT_CAD_PORT): Promise<number> {
  return new Promise((resolve, reject) => {
    if (server) {
      resolve(currentPort)
      return
    }

    currentPort = port
    server = createServer((socket: Socket) => {
      connectedSockets.add(socket)
      let buffer = ''

      socket.on('data', async (chunk: Buffer) => {
        buffer += chunk.toString('utf-8')
        // 以换行符作为 JSON 消息分帧定界符
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed) continue

          try {
            const msg = JSON.parse(trimmed) as CadSocketMessage
            const response = await handleCadMessage(msg)
            socket.write(JSON.stringify(response) + '\n')
          } catch (err: any) {
            const errRes: CadBridgeResponse = {
              success: false,
              message: `[CAD Bridge Error] 解析消息失败: ${err?.message || String(err)}`
            }
            socket.write(JSON.stringify(errRes) + '\n')
          }
        }
      })

      socket.on('close', () => {
        connectedSockets.delete(socket)
      })

      socket.on('error', (err) => {
        console.warn('[CAD Socket Bridge] 客户端连接异常:', err)
        connectedSockets.delete(socket)
      })
    })

    server.on('error', (err: any) => {
      console.warn(`[CAD Socket Bridge] 端口 ${port} 启动失败:`, err?.message || err)
      // 若端口被占用，尝试自增端口
      if (err.code === 'EADDRINUSE') {
        server?.close()
        server = null
        startCadSocketBridge(port + 1).then(resolve).catch(reject)
      } else {
        reject(err)
      }
    })

    server.listen(port, '127.0.0.1', () => {
      console.log(`[CAD Socket Bridge] 监听已就绪，端口: 127.0.0.1:${port}`)
      resolve(port)
    })
  })
}

/** 停止 CAD Socket 监听服务 */
export function stopCadSocketBridge(): Promise<void> {
  return new Promise((resolve) => {
    for (const socket of connectedSockets) {
      socket.destroy()
    }
    connectedSockets.clear()

    if (server) {
      server.close(() => {
        server = null
        resolve()
      })
    } else {
      resolve()
    }
  })
}

/** 处理来自外部 CAD 的 Socket 请求 */
async function handleCadMessage(msg: CadSocketMessage): Promise<CadBridgeResponse> {
  switch (msg.type) {
    case 'PING':
      return { success: true, message: 'PONG', data: { timestamp: Date.now() } }

    case 'GET_STATUS':
      return {
        success: true,
        data: getCadSocketBridgeStatus()
      }

    case 'IMPORT_STEP': {
      const payload = (msg.payload || {}) as CadImportStepParams
      const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0]
      if (!win) {
        return { success: false, message: 'SureFlow 无可用渲染窗口' }
      }

      // 将 STEP 导入事件转发给前端渲染进程
      win.webContents.send('cad:import-step-event', payload)
      return {
        success: true,
        message: `已成功将 STEP 模型派发至 SureFlow 视口进行自动构建`
      }
    }

    case 'EXPORT_STEP': {
      const payload = (msg.payload || {}) as CadExportStepParams
      const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0]
      if (!win) {
        return { success: false, message: 'SureFlow 无可用渲染窗口' }
      }

      // 请求渲染进程导出 STEP
      return new Promise((resolve) => {
        const timeout = setTimeout(() => {
          ipcMain.removeHandler('cad:export-step-reply')
          resolve({ success: false, message: '导出 STEP 超时' })
        }, 30000)

        ipcMain.handleOnce('cad:export-step-reply', (_e, reply: CadBridgeResponse) => {
          clearTimeout(timeout)
          resolve(reply)
        })

        win.webContents.send('cad:export-step-request', payload)
      })
    }

    default:
      return {
        success: false,
        message: `未知的 CAD 指令类型: ${(msg as any).type}`
      }
  }
}
