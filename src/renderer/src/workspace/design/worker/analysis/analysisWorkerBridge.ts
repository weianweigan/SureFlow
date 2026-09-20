/**
 * Analysis Worker 桥接器与调度器
 * 严格对齐 PRD-FR-04-15 §11
 *
 * 管理 Web Worker 生命周期、500ms 交互防抖、旧任务取消与版本隔离 (AnalysisStamp)
 */

import type {
  AnalysisRequest,
  AnalysisResponse,
  AnalysisStamp,
  CheckConfig,
  CheckIssue,
  CheckObservation,
  EntityRef,
  ActiveClearanceResult
} from '@shared/design/analysis/contracts'

export type AnalysisListener = (payload: {
  stamp: AnalysisStamp
  issues: CheckIssue[]
  observations: CheckObservation[]
  isFinished: boolean
}) => void

export type MeasureListener = (results: ActiveClearanceResult[], singleResult?: ActiveClearanceResult) => void

class AnalysisWorkerBridge {
  private worker: Worker | null = null
  private sessionId = `session-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
  private currentAnalysisRequestId = 0
  private currentMeasureRequestId = 0
  private debounceTimer: ReturnType<typeof setTimeout> | null = null
  private measureTimeoutTimer: ReturnType<typeof setTimeout> | null = null
  private isTerminated = false

  private analysisListeners = new Set<AnalysisListener>()
  private measureListeners = new Set<MeasureListener>()

  private currentBatchIssues: CheckIssue[] = []
  private currentBatchObservations: CheckObservation[] = []

  private initWorker(): Worker {
    if (!this.worker || this.isTerminated) {
      this.isTerminated = false
      this.worker = new Worker(new URL('./analysis.worker.ts', import.meta.url), {
        type: 'module'
      })

      this.worker.onmessage = (e: MessageEvent<AnalysisResponse>) => {
        const data = e.data
        if (!data.stamp) return

        if (data.type === 'measure-result') {
          // 独立主动测量版本校验：隔离常规规则检查快照
          if (
            data.stamp.sessionId !== this.sessionId ||
            data.stamp.requestId !== String(this.currentMeasureRequestId)
          ) {
            return
          }
          if (this.measureTimeoutTimer) {
            clearTimeout(this.measureTimeoutTimer)
            this.measureTimeoutTimer = null
          }
          const results = data.results || (data.result ? [data.result] : [])
          const single = data.result || results[0]
          for (const listener of this.measureListeners) {
            listener(results, single)
          }
          return
        }

        // 常规设计检查快照隔离：丢弃过期分析请求的响应
        if (
          data.stamp.sessionId !== this.sessionId ||
          data.stamp.requestId !== String(this.currentAnalysisRequestId)
        ) {
          return
        }

        if (data.type === 'batch') {
          this.currentBatchIssues = data.issues
          this.currentBatchObservations = data.observations
          for (const listener of this.analysisListeners) {
            listener({
              stamp: data.stamp,
              issues: this.currentBatchIssues,
              observations: this.currentBatchObservations,
              isFinished: false
            })
          }
        } else if (data.type === 'finished') {
          for (const listener of this.analysisListeners) {
            listener({
              stamp: data.stamp,
              issues: this.currentBatchIssues,
              observations: this.currentBatchObservations,
              isFinished: true
            })
          }
        }
      }

      this.worker.onerror = (err) => {
        console.error('[AnalysisWorkerBridge] Worker 未捕获异常:', err)
        if (this.measureTimeoutTimer) {
          clearTimeout(this.measureTimeoutTimer)
          this.measureTimeoutTimer = null
        }
        for (const listener of this.measureListeners) {
          listener([])
        }
      }
    }
    return this.worker!
  }

  public subscribeAnalysis(listener: AnalysisListener): () => void {
    this.analysisListeners.add(listener)
    return () => this.analysisListeners.delete(listener)
  }

  public subscribeMeasure(listener: MeasureListener): () => void {
    this.measureListeners.add(listener)
    return () => this.measureListeners.delete(listener)
  }

  /**
   * 触发设计检查（支持 500ms 防抖或立即触发）
   */
  public scheduleAnalysis(
    payload: {
      projectId: string
      schemeId: string
      dimensions: [number, number, number]
      baseBody: any
      cavities: any[]
      config: CheckConfig
      modelRevision?: number
      configRevision?: number
    },
    immediate: boolean = false
  ): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer)
      this.debounceTimer = null
    }

    const trigger = () => {
      const worker = this.initWorker()
      this.currentAnalysisRequestId++
      const reqIdStr = String(this.currentAnalysisRequestId)

      const stamp: AnalysisStamp = {
        sessionId: this.sessionId,
        requestId: reqIdStr,
        projectId: payload.projectId,
        schemeId: payload.schemeId,
        modelRevision: payload.modelRevision ?? Date.now(),
        configRevision: payload.configRevision ?? 1,
        resourceRevision: 1,
        ruleSetVersion: '1.0.0',
        geometryPolicyVersion: '1.0.0'
      }

      const req: AnalysisRequest = {
        type: 'run',
        stamp,
        mode: 'full',
        payload: {
          dimensions: payload.dimensions,
          baseBody: payload.baseBody,
          cavities: payload.cavities,
          config: payload.config
        }
      }

      worker.postMessage(req)
    }

    if (immediate) {
      trigger()
    } else {
      this.debounceTimer = setTimeout(trigger, 500)
    }
  }

  /**
   * 触发主动间隙测量（立即高优先级执行）
   */
  public measureClearance(
    objects: EntityRef[],
    payload: {
      dimensions: [number, number, number]
      baseBody: any
      cavities: any[]
    }
  ): void {
    const worker = this.initWorker()
    this.currentMeasureRequestId++
    const reqIdStr = String(this.currentMeasureRequestId)

    const stamp: AnalysisStamp = {
      sessionId: this.sessionId,
      requestId: reqIdStr,
      projectId: 'active-measure',
      schemeId: 'active-measure',
      modelRevision: Date.now(),
      configRevision: 1,
      resourceRevision: 1,
      ruleSetVersion: '1.0.0',
      geometryPolicyVersion: '1.0.0'
    }

    const req: AnalysisRequest = {
      type: 'measure',
      stamp,
      objects,
      payload
    }

    if (this.measureTimeoutTimer) {
      clearTimeout(this.measureTimeoutTimer)
    }
    this.measureTimeoutTimer = setTimeout(() => {
      console.warn('[AnalysisWorkerBridge] 间隙测量响应超时，重置测量状态')
      for (const listener of this.measureListeners) {
        listener([])
      }
    }, 10000)

    worker.postMessage(req)
  }

  /**
   * 取消当前运行中的任务
   */
  public cancelCurrentTask(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer)
      this.debounceTimer = null
    }
    if (this.worker) {
      const req: AnalysisRequest = {
        type: 'cancel',
        sessionId: this.sessionId,
        requestId: String(this.currentAnalysisRequestId)
      }
      this.worker.postMessage(req)
    }
  }

  /**
   * 销毁 Worker
   */
  public terminate(): void {
    this.isTerminated = true
    this.cancelCurrentTask()
    if (this.measureTimeoutTimer) {
      clearTimeout(this.measureTimeoutTimer)
      this.measureTimeoutTimer = null
    }
    if (this.worker) {
      this.worker.terminate()
      this.worker = null
    }
  }
}

export const analysisBridge = new AnalysisWorkerBridge()
