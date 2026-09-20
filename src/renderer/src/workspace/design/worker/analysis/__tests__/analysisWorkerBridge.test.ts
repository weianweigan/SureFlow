import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { analysisBridge } from '../analysisWorkerBridge'
import { DEFAULT_CHECK_CONFIG } from '@shared/design/analysis/contracts'

class MockWorker {
  static instances: MockWorker[] = []
  public onmessage: ((e: MessageEvent) => void) | null = null
  public onerror: ((e: any) => void) | null = null
  public postMessage = vi.fn()
  public terminate = vi.fn()

  constructor() {
    MockWorker.instances.push(this)
  }
}

describe('AnalysisWorkerBridge (FR-04-15-062 & §11)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    MockWorker.instances = []
    // @ts-ignore
    globalThis.Worker = MockWorker
  })

  afterEach(() => {
    analysisBridge.terminate()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('debounces rapid scheduleAnalysis calls by 500ms', () => {
    const payload = {
      projectId: 'proj-1',
      schemeId: 'scheme-1',
      dimensions: [100, 100, 100] as [number, number, number],
      baseBody: { template: 'box' },
      cavities: [],
      config: DEFAULT_CHECK_CONFIG
    }

    // 连续触发 5 次
    analysisBridge.scheduleAnalysis(payload, false)
    analysisBridge.scheduleAnalysis(payload, false)
    analysisBridge.scheduleAnalysis(payload, false)
    analysisBridge.scheduleAnalysis(payload, false)
    analysisBridge.scheduleAnalysis(payload, false)

    // 此时 Worker 尚未发送消息
    expect(MockWorker.instances.length).toBe(0)

    // 快进 499ms
    vi.advanceTimersByTime(499)
    expect(MockWorker.instances.length).toBe(0)

    // 达到 500ms
    vi.advanceTimersByTime(1)
    expect(MockWorker.instances.length).toBe(1)
    const worker = MockWorker.instances[0]
    expect(worker.postMessage).toHaveBeenCalledTimes(1)

    const postCall = worker.postMessage.mock.calls[0][0]
    expect(postCall.type).toBe('run')
    expect(postCall.stamp.schemeId).toBe('scheme-1')
  })

  it('triggers immediately when immediate: true is passed', () => {
    const payload = {
      projectId: 'proj-1',
      schemeId: 'scheme-1',
      dimensions: [100, 100, 100] as [number, number, number],
      baseBody: { template: 'box' },
      cavities: [],
      config: DEFAULT_CHECK_CONFIG
    }

    analysisBridge.scheduleAnalysis(payload, true)
    expect(MockWorker.instances.length).toBe(1)
    const worker = MockWorker.instances[0]
    expect(worker.postMessage).toHaveBeenCalledTimes(1)
  })

  it('filters out stale responses from old request IDs', () => {
    const payload = {
      projectId: 'proj-1',
      schemeId: 'scheme-1',
      dimensions: [100, 100, 100] as [number, number, number],
      baseBody: { template: 'box' },
      cavities: [],
      config: DEFAULT_CHECK_CONFIG
    }

    const listener = vi.fn()
    analysisBridge.subscribeAnalysis(listener)

    // 触发请求 1
    analysisBridge.scheduleAnalysis(payload, true)
    const worker = MockWorker.instances[0]
    const req1Stamp = worker.postMessage.mock.calls[0][0].stamp

    // 触发请求 2 (将当前 currentRequestId 推进)
    analysisBridge.scheduleAnalysis(payload, true)
    const req2Stamp = worker.postMessage.mock.calls[1][0].stamp

    // 模拟 Worker 返回请求 1 的过期响应
    worker.onmessage?.({
      data: {
        type: 'batch',
        stamp: req1Stamp,
        issues: [],
        observations: []
      }
    } as any)

    // 监听器不应被调用 (因为这是过期请求)
    expect(listener).not.toHaveBeenCalled()

    // 模拟 Worker 返回请求 2 的当前响应
    worker.onmessage?.({
      data: {
        type: 'batch',
        stamp: req2Stamp,
        issues: [],
        observations: []
      }
    } as any)

    // 监听器被正确触发
    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener.mock.calls[0][0].stamp.requestId).toBe(req2Stamp.requestId)
  })
})
