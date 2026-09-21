/**
 * CAD 外部软件（SolidWorks 等）与 SureFlow 协同集成服务
 * 提供：
 * 1. 自动引入外部 CAD 生成的 STEP 实体模型
 * 2. 导出当前阀块的 STEP 实体模型
 * 3. 监听通过 Socket/IPC 派发进来的 STEP 导入与导出请求
 */

import { useDesignStore } from '../model/designStore'
import { parseStepToThreeGeometry } from '../../tabs/viewer/stepLoader'
import { STANDARD_BOX_FACES } from '@shared/design/types'
import { openDesignTab } from '../../registry/panelActions'
import type {
  CadImportStepParams,
  CadExportStepParams,
  CadBridgeResponse
} from '@shared/cad/cadBridgeTypes'
import { cadBridge } from '../worker/cad/cadWorkerBridge'
import { getBoxFaceBasis, getCavityWorldMatrix } from '@shared/design/faceMath'
import { getCavitySteps } from '../geometry/cavityProfileBuilder'
import { extractCavityThreadSpec } from '../worker/cad/cadExportService'
import { solveChannelTopology } from '@shared/design/topology/channelSolver'
import { useLibraryStore } from '../../library/viewmodel/libraryStore'
import { t } from '@shared/i18n'

/**
 * 自动引入外部 CAD (如 SolidWorks) 生成的 STEP 模型
 */
export async function importStepFromCad(
  params: CadImportStepParams
): Promise<CadBridgeResponse<{ projectId: string; dimensions: [number, number, number] }>> {
  try {
    let buffer: ArrayBuffer
    let stepText = params.stepContent || ''
    const fileName = params.stepFileName || params.stepFilePath?.split(/[\\/]/).pop() || 'cad_model.step'

    if (params.stepFilePath && window.fileApi?.readBinary) {
      buffer = await window.fileApi.readBinary(params.stepFilePath)
      stepText = new TextDecoder().decode(buffer)
    } else if (params.stepBase64) {
      const binaryString = atob(params.stepBase64)
      const bytes = new Uint8Array(binaryString.length)
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i)
      }
      buffer = bytes.buffer
      stepText = new TextDecoder().decode(buffer)
    } else if (params.stepContent) {
      buffer = new TextEncoder().encode(params.stepContent).buffer
    } else {
      return { success: false, message: '未提供有效的 STEP 数据或文件路径' }
    }

    const { faces, dimensions, stepMesh } = await parseStepToThreeGeometry(buffer)

    // 确定目标工程：若指定 projectId 则更新该工程，否则获取当前活跃工程或新建
    let targetProjectId = params.projectId
    const allProjects = useDesignStore.getState().projects
    if (!targetProjectId) {
      const projectIds = Object.keys(allProjects)
      if (projectIds.length > 0) {
        targetProjectId = projectIds[0]
      }
    }

    if (!targetProjectId || !allProjects[targetProjectId]) {
      // 自动新建一个设计工程 Tab
      targetProjectId = `cad-project-${Date.now()}`
      openDesignTab({
        projectId: targetProjectId,
        name: fileName.replace(/\.step$/i, ''),
        filePath: undefined
      })
    }

    useDesignStore.getState().setBaseStepModel(targetProjectId, {
      stepContent: stepText,
      stepFileName: fileName,
      stepFilePath: params.stepFilePath,
      stepAssetRef: params.stepFilePath || fileName,
      dimensions,
      faces: faces && faces.length > 0 ? faces : [...STANDARD_BOX_FACES],
      stepMesh
    })

    if (params.autoFitView !== false) {
      window.dispatchEvent(new CustomEvent('sureflow:fit-view'))
    }

    return {
      success: true,
      message: `已成功将 ${params.cadSoftware || '外部 CAD'} 的 STEP 模型导入至工程`,
      data: {
        projectId: targetProjectId,
        dimensions
      }
    }
  } catch (err: any) {
    console.error('[CadIntegrationService] 导入外部 STEP 失败:', err)
    return {
      success: false,
      message: t('导入外部 STEP 失败: ') + (err?.message || String(err))
    }
  }
}

/**
 * 导出当前工程的 STEP 实体模型
 */
export async function exportStepToCad(
  params: CadExportStepParams
): Promise<CadBridgeResponse<{ stepContent: string; filePath?: string }>> {
  try {
    let targetProjectId = params.projectId
    const allProjects = useDesignStore.getState().projects
    if (!targetProjectId) {
      const projectIds = Object.keys(allProjects)
      if (projectIds.length === 0) {
        return { success: false, message: '当前没有已打开的设计工程' }
      }
      targetProjectId = projectIds[0]
    }

    const session = allProjects[targetProjectId]
    if (!session) {
      return { success: false, message: `未找到工程 ID: ${targetProjectId}` }
    }

    const { doc } = session
    let stepContent = ''

    if (params.includeCavities !== false) {
      // 包含所有孔腔的完整实体切削导出
      const activeScheme = doc.schemes.find((s) => s.id === doc.activeSchemeId) || doc.schemes[0]
      const cavities = activeScheme?.cavities.filter((c) => !c.suppressed) || []
      const libraryDoc = useLibraryStore.getState().doc

      const cavitiesWithSteps = cavities.map((cav) => ({
        ...cav,
        steps: cav.steps && cav.steps.length > 0 ? cav.steps : getCavitySteps(cav, libraryDoc)
      }))
      const channelTopology = solveChannelTopology(cavitiesWithSteps, doc.baseBody.dimensions, activeScheme?.channelConfigs)
      const channelList = channelTopology.channels.map((ch) => ({
        id: ch.id,
        name: ch.name,
        color: ch.color,
        cavityIds: ch.cavityIds,
        regions: ch.regions
      }))

      const cavitiesInput = cavitiesWithSteps.map((cav, idx) => {
        const basis = getBoxFaceBasis(cav.faceId, doc.baseBody.dimensions, doc.baseBody)
        const worldMatrix = Array.from(
          getCavityWorldMatrix(
            basis,
            cav.u,
            cav.v,
            cav.depthOffset,
            cav.rotation,
            cav.tiltAngle || 0,
            cav.azimuth ?? cav.rotation ?? 0
          )
        )
        const matchedCh = channelList.find((ch) => ch.cavityIds.includes(cav.instanceId))
        const template = libraryDoc?.templates?.find((t) => t.id === cav.templateId)
        const threadSpec = extractCavityThreadSpec(cav.steps)
        return {
          instanceId: cav.instanceId,
          numericId: idx + 1,
          steps: cav.steps,
          ports: cav.ports,
          worldMatrix,
          name: cav.subHoleName || cav.name,
          color: cav.portSemantic?.color,
          channelId: matchedCh?.id,
          channelColor: matchedCh?.color,
          channelName: matchedCh?.name,
          templateId: cav.templateId,
          templateName: template?.name || cav.name,
          libraryId: cav.libraryId,
          cavityType: cav.cavityType || template?.cavityType,
          faceId: cav.faceId,
          u: cav.u,
          v: cav.v,
          threadSpec,
          portSemantic: cav.portSemantic?.label
        }
      })

      stepContent = await cadBridge.exportStep({
        exportConfig: {
          protocol: 'AP214',
          tolerance: 0.01,
          colorPorts: true,
          transparentBaseBody: true,
          mountingFacesTransparent: true,
          transparency: 0.7,
          stableTopology: true
        },
        baseBody: {
          dimensions: doc.baseBody.dimensions
        },
        cavities: cavitiesInput,
        channels: channelList
      })
    } else {
      // 仅导出基体
      if (doc.baseBody.type === 'step' && doc.baseBody.stepContent) {
        stepContent = doc.baseBody.stepContent
      } else {
        stepContent = await cadBridge.exportStep({
          exportConfig: {
            protocol: 'AP214',
            tolerance: 0.01,
            colorPorts: false,
            transparentBaseBody: true,
            mountingFacesTransparent: true,
            transparency: 0.7,
            stableTopology: true
          },
          baseBody: {
            dimensions: doc.baseBody.dimensions
          },
          cavities: []
        })
      }
    }

    if (params.targetFilePath) {
      if (window.projectApi?.saveStepDialog) {
        await window.projectApi.saveStepDialog({
          defaultName: params.targetFilePath,
          stepContent
        })
      }
    }

    return {
      success: true,
      message: 'STEP 导出成功',
      data: {
        stepContent,
        filePath: params.targetFilePath
      }
    }
  } catch (err: any) {
    console.error('[CadIntegrationService] 导出 STEP 失败:', err)
    return {
      success: false,
      message: t('导出 STEP 失败: ') + (err?.message || String(err))
    }
  }
}

/**
 * 初始化 CAD Socket 自动监听系统（在应用主布局或窗口启动时调用）
 */
export function initCadBridgeListener(): () => void {
  if (!window.cadBridgeApi) return () => {}

  const unbindImport = window.cadBridgeApi.onImportStep((params) => {
    console.log('[CadIntegrationService] 收到来自外部 CAD Socket 的 STEP 导入请求:', params)
    void importStepFromCad(params)
  })

  const unbindExport = window.cadBridgeApi.onExportStepRequest(async (params) => {
    console.log('[CadIntegrationService] 收到来自外部 CAD Socket 的 STEP 导出请求:', params)
    return exportStepToCad(params)
  })

  return () => {
    unbindImport()
    unbindExport()
  }
}
