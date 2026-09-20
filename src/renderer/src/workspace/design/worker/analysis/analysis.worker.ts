/**
 * 独立设计检查与主动间隙分析 Web Worker
 * 严格对齐 PRD-FR-04-15 §11
 */

import Module from 'manifold-3d'
import wasmUrl from 'manifold-3d/manifold.wasm?url'
import { runDesignAnalysis } from '@shared/design/analysis/analysisEngine'
import { computeMultipleActiveClearances } from '@shared/design/analysis/geometry/activeClearance'
import {
  buildAnalyzedCavityGeometry,
  type CavityAnalyzedGeometry
} from '@shared/design/analysis/geometry/wallThickness'
import {
  validateMultipleActiveClearancesWithMinGap,
  validateIssuesWithMinGap
} from '@shared/design/analysis/geometry/minGapValidator'
import type {
  AnalysisRequest,
  AnalysisResponse,
  AnalysisStamp
} from '@shared/design/analysis/contracts'

let currentCancelledRequestId: string | null = null
let manifoldInstance: any = null
let manifoldInitPromise: Promise<any> | null = null

async function getManifold(): Promise<any> {
  if (manifoldInstance) return manifoldInstance
  if (!manifoldInitPromise) {
    manifoldInitPromise = (async () => {
      try {
        const mod = await (Module as any)({
          locateFile: () => wasmUrl
        })
        mod.setup()
        manifoldInstance = mod
        return mod
      } catch (err) {
        console.warn('[AnalysisWorker] Manifold WASM 初始化失败, 将回退至纯解析几何:', err)
        return null
      }
    })()
  }
  return manifoldInitPromise
}

self.onmessage = async (e: MessageEvent<AnalysisRequest>) => {
  const req = e.data

  if (req.type === 'cancel') {
    currentCancelledRequestId = req.requestId
    return
  }

  if (req.type === 'measure') {
    try {
      const stamp: AnalysisStamp = req.stamp
      const { dimensions, baseBody, cavities } = req.payload
      const analyzedCavities: CavityAnalyzedGeometry[] = (cavities || [])
        .filter((c: any) => !c.suppressed)
        .map((c: any) => buildAnalyzedCavityGeometry(c, dimensions, baseBody))

      const rawResults = computeMultipleActiveClearances(
        req.objects,
        analyzedCavities,
        dimensions,
        baseBody
      )

      // 双轨校验：使用 Manifold minGap 进行真值检验与防退化监控
      let results = rawResults
      try {
        const manifoldModule = await getManifold()
        if (manifoldModule) {
          results = validateMultipleActiveClearancesWithMinGap(
            manifoldModule,
            rawResults,
            cavities || [],
            dimensions,
            baseBody
          )
        }
      } catch (err) {
        console.warn('[AnalysisWorker] minGap 双轨主动间隙校验异常，降级使用解析结果:', err)
      }

      const resp: AnalysisResponse = {
        type: 'measure-result',
        stamp,
        result: results[0],
        results
      }
      self.postMessage(resp)
    } catch (err) {
      console.error('[AnalysisWorker] measure 执行异常:', err)
      const resp: AnalysisResponse = {
        type: 'measure-result',
        stamp: req.stamp,
        result: undefined,
        results: []
      }
      self.postMessage(resp)
    }
    return
  }

  if (req.type === 'run') {
    const stamp: AnalysisStamp = req.stamp
    const { dimensions, baseBody, cavities, config, componentBindings } = req.payload

    if (currentCancelledRequestId === stamp.requestId) {
      const resp: AnalysisResponse = { type: 'cancelled', stamp }
      self.postMessage(resp)
      return
    }

    try {
      let { issues, observations, evaluated, skipped, failed } = runDesignAnalysis(
        cavities || [],
        dimensions,
        baseBody,
        config,
        stamp,
        componentBindings
      )

      if (currentCancelledRequestId === stamp.requestId) {
        const resp: AnalysisResponse = { type: 'cancelled', stamp }
        self.postMessage(resp)
        return
      }

      // 双轨校验：对 CLR-001 (孔间壁厚) 与 CLR-002 (孔到外表面壁厚) 进行 minGap 真值复核与防退化监控
      try {
        const manifoldModule = await getManifold()
        if (manifoldModule) {
          const validated = validateIssuesWithMinGap(
            manifoldModule,
            issues,
            observations,
            cavities || [],
            dimensions,
            baseBody
          )
          issues = validated.issues
          observations = validated.observations
        }
      } catch (err) {
        console.warn('[AnalysisWorker] minGap 双轨规则校验异常，保留解析结果:', err)
      }

      if (currentCancelledRequestId === stamp.requestId) {
        const resp: AnalysisResponse = { type: 'cancelled', stamp }
        self.postMessage(resp)
        return
      }

      // 分批或整批提交结果
      const batchResp: AnalysisResponse = {
        type: 'batch',
        stamp,
        scopeKeys: ['*'],
        issues,
        observations
      }
      self.postMessage(batchResp)

      const finishedResp: AnalysisResponse = {
        type: 'finished',
        stamp,
        evaluated,
        skipped,
        failed
      }
      self.postMessage(finishedResp)
    } catch (err: any) {
      console.error('[AnalysisWorker] 检查执行异常:', err)
      const errResp: AnalysisResponse = {
        type: 'worker-failed',
        stamp,
        diagnosticCode: err?.message || 'UNKNOWN_ERROR'
      }
      self.postMessage(errResp)
    }
  }
}
