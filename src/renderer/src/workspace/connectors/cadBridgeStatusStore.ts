import { create } from 'zustand'
import type { CadBridgeStatus } from '@shared/cad/cadBridgeTypes'

interface CadBridgeStoreState {
  status: CadBridgeStatus
  initialized: boolean
  setStatus: (status: CadBridgeStatus) => void
  fetchStatus: () => Promise<void>
}

const DEFAULT_STATUS: CadBridgeStatus = {
  connected: false,
  port: 19828,
  activeProjects: 0,
  connectedClientsCount: 0
}

export const useCadBridgeStore = create<CadBridgeStoreState>((set) => ({
  status: DEFAULT_STATUS,
  initialized: false,
  setStatus: (status) => set({ status, initialized: true }),
  fetchStatus: async () => {
    if (window.cadBridgeApi?.getStatus) {
      try {
        const status = await window.cadBridgeApi.getStatus()
        set({ status, initialized: true })
      } catch (err) {
        console.warn('[CadBridgeStore] 获取连接状态失败:', err)
      }
    }
  }
}))

let hasSubscribed = false

/** 启动 CAD 状态全局监听（幂等单例） */
export function initCadStatusWatcher(): () => void {
  if (hasSubscribed) return () => {}
  hasSubscribed = true

  // 立即初次拉取
  void useCadBridgeStore.getState().fetchStatus()

  // 监听来自主进程的主动广播
  let unsubChanged: (() => void) | undefined
  if (window.cadBridgeApi?.onStatusChanged) {
    unsubChanged = window.cadBridgeApi.onStatusChanged((status) => {
      useCadBridgeStore.getState().setStatus(status)
    })
  }

  // 兜底心跳轮询（3秒）
  const timer = setInterval(() => {
    void useCadBridgeStore.getState().fetchStatus()
  }, 3000)

  return () => {
    hasSubscribed = false
    clearInterval(timer)
    unsubChanged?.()
  }
}
