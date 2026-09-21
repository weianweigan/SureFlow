/**
 * CAD Solid Worker (@bitbybit-dev/occt)
 * 对齐 PRD-FR-04-07 §3 规范：
 * 负责复杂 CAD B-Rep 解析与高精度 STEP 实体导出流水线
 * 1. 初始化 OpenCASCADE (OCCT) WASM 内核；
 * 2. 调度 cadExportService 进行基体与孔腔实体切削；
 * 3. 实时向主线程推送阶段百分比与进度信息；
 * 4. 序列化生成 AP214 / AP203 / AP242 标准 STEP 文本。
 */

import type { Step, Port } from '@shared/cavity/types'
import { getOccInstance } from './occtLoader'
import { generateStepContent, parseBands, type CavityBand } from './cadExportService'

export { parseBands, type CavityBand }

export interface CadStepImportTask {
  type: 'CAD_STEP_IMPORT'
  taskId: number
  fileBuffer: ArrayBuffer
}

export interface CadStepExportTask {
  type: 'CAD_STEP_EXPORT'
  taskId: number
  exportConfig: {
    protocol: 'AP214' | 'AP203' | 'AP242'
    tolerance: number
    colorPorts: boolean
    transparentBaseBody?: boolean
    mountingFacesTransparent?: boolean
    transparency?: number
    stableTopology?: boolean
  }
  baseBody: {
    type?: 'template' | 'step'
    template?: 'box' | 'l-shape' | 't-shape'
    dimensions: [number, number, number]
    extraParams?: Record<string, number>
    stepContent?: Uint8Array | string
    color?: string
  }
  cavities: Array<{
    instanceId: string
    numericId: number
    worldMatrix: number[]
    steps: Step[]
    ports?: Port[]
    name?: string
    color?: string
    channelId?: string
    channelColor?: string
    channelName?: string
    templateId?: string
    templateName?: string
    libraryId?: string
    cavityType?: string
    faceId?: string
    u?: number
    v?: number
    threadSpec?: string
    portSemantic?: string
  }>
  channels?: Array<{
    id: string
    name: string
    color: string
    cavityIds: string[]
    regions?: Array<{ cavityId: string; portIndex?: number; minDepth: number; maxDepth: number }>
  }>
}

export type CadWorkerTask = CadStepImportTask | CadStepExportTask

export interface CadExportProgressMsg {
  type: 'CAD_STEP_EXPORT_PROGRESS'
  taskId: number
  progress: number
  stage: string
}

export interface CadExportSuccessMsg {
  type: 'CAD_STEP_EXPORT_SUCCESS'
  taskId: number
  stepContent: string
}

export interface CadExportErrorMsg {
  type: 'CAD_STEP_EXPORT_ERROR'
  taskId: number
  error: string
}

self.onmessage = async (e: MessageEvent<CadWorkerTask>) => {
  const data = e.data

  if (data.type === 'CAD_STEP_IMPORT') {
    self.postMessage({
      type: 'CAD_STEP_IMPORT_SUCCESS',
      taskId: data.taskId,
      faces: []
    })
    return
  }

  if (data.type === 'CAD_STEP_EXPORT') {
    const { taskId, exportConfig, baseBody, cavities, channels } = data

    try {
      // 1. 初始化 OCCT
      self.postMessage({
        type: 'CAD_STEP_EXPORT_PROGRESS',
        taskId,
        progress: 5,
        stage: '正在初始化 OCCT B-Rep 建模引擎...'
      } as CadExportProgressMsg)

      const occ = await getOccInstance()

      // 2. 调度 CAD STEP 导出核心流水线
      const stepContent = await generateStepContent(
        {
          taskId,
          exportConfig,
          baseBody,
          cavities,
          channels
        },
        occ,
        (progress, stage) => {
          self.postMessage({
            type: 'CAD_STEP_EXPORT_PROGRESS',
            taskId,
            progress,
            stage
          } as CadExportProgressMsg)
        }
      )

      self.postMessage({
        type: 'CAD_STEP_EXPORT_SUCCESS',
        taskId,
        stepContent
      } as CadExportSuccessMsg)
    } catch (err: any) {
      console.error('[CadWorker] STEP 导出异常:', err)
      self.postMessage({
        type: 'CAD_STEP_EXPORT_ERROR',
        taskId,
        error: err?.message || String(err)
      } as CadExportErrorMsg)
    }
  }
}
