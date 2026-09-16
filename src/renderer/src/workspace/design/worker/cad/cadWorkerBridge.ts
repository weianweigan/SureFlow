/**
 * CAD Worker 主线程通信桥梁与调度器
 * 对齐 PRD-FR-04-07 §3 规范：
 * 负责任务派发、取消、进度实时回调与 Promise 结果封装
 */

import type {
  CadStepExportTask,
  CadExportProgressMsg,
  CadExportSuccessMsg,
  CadExportErrorMsg
} from './cad.worker'

class CadWorkerBridge {
  private worker: Worker | null = null
  private nextTaskId = 1

  private getWorker(): Worker {
    if (!this.worker) {
      this.worker = new Worker(new URL('./cad.worker.ts', import.meta.url), {
        type: 'module'
      })
    }
    return this.worker
  }

  /**
   * 启动 STEP 导出任务，支持实时百分比进度回调
   */
  public exportStep(
    task: Omit<CadStepExportTask, 'type' | 'taskId'>,
    onProgress?: (progress: number, stage: string) => void
  ): Promise<string> {
    const worker = this.getWorker()
    const taskId = this.nextTaskId++

    return new Promise<string>((resolve, reject) => {
      const handler = (e: MessageEvent) => {
        const data = e.data
        if (!data || data.taskId !== taskId) return

        if (data.type === 'CAD_STEP_EXPORT_PROGRESS') {
          const msg = data as CadExportProgressMsg
          onProgress?.(msg.progress, msg.stage)
        } else if (data.type === 'CAD_STEP_EXPORT_SUCCESS') {
          const msg = data as CadExportSuccessMsg
          worker.removeEventListener('message', handler)
          resolve(msg.stepContent)
        } else if (data.type === 'CAD_STEP_EXPORT_ERROR') {
          const msg = data as CadExportErrorMsg
          worker.removeEventListener('message', handler)
          reject(new Error(msg.error))
        }
      }

      worker.addEventListener('message', handler)

      const fullTask: CadStepExportTask = {
        type: 'CAD_STEP_EXPORT',
        taskId,
        ...task
      }

      worker.postMessage(fullTask)
    })
  }

  public terminate(): void {
    if (this.worker) {
      this.worker.terminate()
      this.worker = null
    }
  }
}

export const cadBridge = new CadWorkerBridge()
