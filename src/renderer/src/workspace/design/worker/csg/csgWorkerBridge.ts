/**
 * CSG Worker 主线程通信桥梁与调度器
 * 对齐 PRD-FR-04-02 §1.1：
 * 管理 Web Worker 生命周期、任务分配、防抖丢弃与 Promise 请求-响应解耦
 */

import type {
  CsgBooleanTaskMessage,
  CsgCavityInput,
  CsgSuccessResponse,
  CsgErrorResponse
} from './csg.worker'

export type CsgResult = CsgSuccessResponse

class CsgWorkerBridge {
  private worker: Worker | null = null
  private currentTaskId = 0
  private pendingResolver: ((res: CsgResult | null) => void) | null = null
  private isTerminated = false

  private initWorker(): Worker {
    if (!this.worker && !this.isTerminated) {
      this.worker = new Worker(new URL('./csg.worker.ts', import.meta.url), {
        type: 'module'
      })

      this.worker.onmessage = (e: MessageEvent<CsgSuccessResponse | CsgErrorResponse>) => {
        const data = e.data
        if (data.type === 'CSG_SUCCESS') {
          if (data.taskId === this.currentTaskId) {
            if (this.pendingResolver) {
              this.pendingResolver(data)
              this.pendingResolver = null
            }
          }
        } else if (data.type === 'CSG_ERROR') {
          if (data.taskId === this.currentTaskId) {
            console.error('[CsgWorkerBridge] 布尔计算错误:', data.error)
            if (this.pendingResolver) {
              this.pendingResolver(null)
              this.pendingResolver = null
            }
          }
        }
      }

      this.worker.onerror = (err) => {
        console.error('[CsgWorkerBridge] Worker 内部未捕获异常:', err)
        if (this.pendingResolver) {
          this.pendingResolver(null)
          this.pendingResolver = null
        }
      }
    }
    return this.worker!
  }

  /**
   * 发起一次布尔计算请求（自带自增 taskId 与防抖丢弃）
   */
  public computeDifference(
    baseBody: {
      type?: 'template' | 'step'
      template?: string
      dimensions: [number, number, number]
      extraParams?: Record<string, number>
      stepMesh?: {
        positions: Float32Array
        indices: Uint32Array
        normals?: Float32Array
        edgePositions?: Float32Array
      }
    },
    cavities: CsgCavityInput[],
    segments: number = 32
  ): Promise<CsgResult | null> {
    const worker = this.initWorker()
    this.currentTaskId++
    const taskId = this.currentTaskId

    // 若此前已有未完成的请求，让其 resolve 为 null 并被新任务覆盖
    if (this.pendingResolver) {
      this.pendingResolver(null)
      this.pendingResolver = null
    }

    return new Promise<CsgResult | null>((resolve) => {
      this.pendingResolver = resolve

      const msg: CsgBooleanTaskMessage = {
        type: 'CSG_BOOLEAN_TASK',
        taskId,
        baseBody,
        cavities,
        segments
      }

      worker.postMessage(msg)
    })
  }

  public terminate(): void {
    this.isTerminated = true
    if (this.worker) {
      this.worker.terminate()
      this.worker = null
    }
    if (this.pendingResolver) {
      this.pendingResolver(null)
      this.pendingResolver = null
    }
  }
}

export const csgBridge = new CsgWorkerBridge()
