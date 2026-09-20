/**
 * 自动检查与结果同步 Hook (useAnalysisAutoTrigger)
 * 严格对齐 PRD-FR-04-15 §11
 */

import { useEffect, useRef } from 'react'
import { useDesignStore } from './designStore'
import { useAnalysisStore } from './analysisStore'
import { analysisBridge } from '../worker/analysis/analysisWorkerBridge'
import { DEFAULT_CHECK_CONFIG } from '@shared/design/analysis/contracts'

export function useAnalysisAutoTrigger(projectId: string): {
  recheck: () => void
} {
  const session = useDesignStore((s) => s.projects[projectId])
  const doc = session?.doc
  const activeScheme = doc?.schemes.find((s) => s.id === doc.activeSchemeId) || doc?.schemes[0]
  const schemeId = activeScheme?.id || 'default'

  const updateResults = useAnalysisStore((s) => s.updateResults)
  const setComputing = useAnalysisStore((s) => s.setComputing)
  const setClearanceResults = useAnalysisStore((s) => s.setClearanceResults)
  const clearanceObjects = useAnalysisStore((s) => s.clearanceObjects)

  const config = activeScheme?.checkConfig || DEFAULT_CHECK_CONFIG
  const cavities = activeScheme?.cavities || []
  const baseBody = doc?.baseBody
  const dimensions = baseBody?.dimensions || [100, 100, 100]

  // 1. 订阅 Analysis Worker 结果
  useEffect(() => {
    const unsubAnalysis = analysisBridge.subscribeAnalysis(({ stamp, issues, observations }) => {
      if (stamp.schemeId === schemeId) {
        updateResults(schemeId, issues, observations, stamp)
      }
    })

    const unsubMeasure = analysisBridge.subscribeMeasure((results) => {
      setClearanceResults(results)
    })

    return () => {
      unsubAnalysis()
      unsubMeasure()
    }
  }, [schemeId, updateResults, setClearanceResults])

  // 2. 主动间隙测量响应：当选中的实体数量 >= 2 时立即发起测量
  useEffect(() => {
    if (clearanceObjects.length >= 2 && baseBody) {
      analysisBridge.measureClearance(clearanceObjects, {
        dimensions,
        baseBody,
        cavities
      })
    }
  }, [clearanceObjects, dimensions, baseBody, cavities])

  // 3. 自动检查触发 (500ms 防抖)
  const lastStateRef = useRef<string>('')
  useEffect(() => {
    if (!activeScheme || !baseBody) return
    if (config.autoEnabled === false) return

    // 轻量特征指纹比较，避免无意义重算
    const stateFingerprint = JSON.stringify({
      schemeId,
      cavitiesCount: cavities.length,
      cavities: cavities.map((c) => ({
        id: c.instanceId,
        u: c.u,
        v: c.v,
        faceId: c.faceId,
        steps: c.steps?.length,
        suppressed: c.suppressed
      })),
      baseBodyDim: dimensions,
      configRev: config.ruleEnabled
    })

    if (stateFingerprint !== lastStateRef.current) {
      lastStateRef.current = stateFingerprint
      setComputing(schemeId, true)
      analysisBridge.scheduleAnalysis(
        {
          projectId,
          schemeId,
          dimensions,
          baseBody,
          cavities,
          config
        },
        false // 500ms 防抖
      )
    }
  }, [activeScheme, baseBody, cavities, config, dimensions, projectId, schemeId, setComputing])

  // 4. 手动立即检查
  const recheck = () => {
    if (!activeScheme || !baseBody) return
    setComputing(schemeId, true)
    analysisBridge.scheduleAnalysis(
      {
        projectId,
        schemeId,
        dimensions,
        baseBody,
        cavities,
        config
      },
      true // 立即全量提交
    )
  }

  return { recheck }
}
