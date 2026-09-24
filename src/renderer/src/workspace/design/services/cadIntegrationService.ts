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
  CadBridgeResponse,
  CadIntegrationSession,
  CadSoftwareType,
  SyncCameraViewParams,
  SyncCameraViewResult
} from '@shared/cad/cadBridgeTypes'
import { cadBridge } from '../worker/cad/cadWorkerBridge'
import { getBoxFaceBasis, getCavityWorldMatrix } from '@shared/design/faceMath'
import { getCavitySteps } from '../geometry/cavityProfileBuilder'
import { extractCavityThreadSpec } from '../worker/cad/cadExportService'
import { solveChannelTopology } from '@shared/design/topology/channelSolver'
import { useLibraryStore } from '../../library/viewmodel/libraryStore'
import { t } from '@shared/i18n'
import { findCadProjectEntry } from '@shared/cad/cadProjectLookup'

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
    if (!targetProjectId && params.docGuid) {
      const entry = findCadProjectEntry(allProjects, params.docGuid)
      if (entry) {
        targetProjectId = entry[0]
      }
    }

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
      message: `已成功将 ${params.cadType || '外部 CAD'} 的 STEP 模型导入至工程`,
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

      const baseTemplate: 'box' | 'l-shape' | 't-shape' =
        doc.baseBody.template === 'l-shape' || doc.baseBody.template === 't-shape'
          ? doc.baseBody.template
          : 'box'

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
          type: doc.baseBody.type,
          template: baseTemplate,
          dimensions: doc.baseBody.dimensions,
          stepContent: doc.baseBody.stepContent,
          extraParams: doc.baseBody.extraParams
        },
        cavities: cavitiesInput,
        channels: channelList
      })
    } else {
      // 仅导出基体
      if (doc.baseBody.type === 'step' && doc.baseBody.stepContent) {
        stepContent = doc.baseBody.stepContent
      } else {
        const baseTemplate: 'box' | 'l-shape' | 't-shape' =
          doc.baseBody.template === 'l-shape' || doc.baseBody.template === 't-shape'
            ? doc.baseBody.template
            : 'box'

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
            type: doc.baseBody.type,
            template: baseTemplate,
            dimensions: doc.baseBody.dimensions,
            stepContent: doc.baseBody.stepContent,
            extraParams: doc.baseBody.extraParams
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
 * 保存并同步当前工程至关联的外部 CAD 软件 (SolidWorks, Creo, UG/NX)
 */
export async function saveAndSyncToCad(projectId: string): Promise<boolean> {
  const session = useDesignStore.getState().projects[projectId]
  if (!session || !session.cadIntegration) return false

  const { docGuid } = session.cadIntegration
  // 1. 导出 STEP 几何模型
  const exportRes = await exportStepToCad({ projectId, includeCavities: true })
  if (!exportRes.success || !exportRes.data?.stepContent) {
    throw new Error(exportRes.message || '导出几何模型失败')
  }

  // 2. 序列化 .sfb 为 Base64
  const sfbJson = JSON.stringify(session.doc)
  const sfbBytes = new TextEncoder().encode(sfbJson)
  let binary = ''
  for (let i = 0; i < sfbBytes.length; i++) {
    binary += String.fromCharCode(sfbBytes[i])
  }
  const sfbBase64 = btoa(binary)

  const stepBytes = new TextEncoder().encode(exportRes.data.stepContent)
  let stepBin = ''
  for (let i = 0; i < stepBytes.length; i++) {
    stepBin += String.fromCharCode(stepBytes[i])
  }
  const stepBase64 = btoa(stepBin)

  const activeScheme = session.doc.schemes.find((s) => s.id === session.doc.activeSchemeId) || session.doc.schemes[0]

  const res = await window.cadBridgeApi.pushSaveToCad(docGuid, {
    docGuid,
    sfbBase64,
    geometry: {
      format: 'STEP_AP214',
      dataBase64: stepBase64
    },
    statistics: {
      cavityCount: activeScheme?.cavities?.length || 0,
      channelCount: activeScheme?.channelConfigs ? Object.keys(activeScheme.channelConfigs).length : 0,
      blockDimensions: session.doc.baseBody.dimensions
    }
  })

  return res.success
}

/**
 * 主动将 SureFlow 当前摄像机视角同步至绑定的外部 CAD (如 SolidWorks)
 */
export async function syncCameraToCad(
  docGuid: string | undefined,
  params: SyncCameraViewParams
): Promise<SyncCameraViewResult> {
  if (!window.cadBridgeApi?.syncCameraToCad) {
    return { success: false, message: 'CAD 通信桥接服务未就绪' }
  }
  return window.cadBridgeApi.syncCameraToCad(docGuid, params)
}

/**
 * 初始化 CAD WebSocket 自动监听系统（在应用主布局或窗口启动时调用）
 */
export function initCadBridgeListener(): () => void {
  if (!window.cadBridgeApi) return () => {}

  // 1. 外部旧版单步 STEP 导入监听
  const unbindImport = window.cadBridgeApi.onImportStep((params) => {
    console.log('[CadIntegrationService] 收到来自外部 CAD 的 STEP 导入请求:', params)
    void importStepFromCad(params)
  })

  // 2. 外部 STEP 导出请求
  const unbindExport = window.cadBridgeApi.onExportStepRequest(async (params) => {
    console.log('[CadIntegrationService] 收到来自外部 CAD 的 STEP 导出请求:', params)
    return exportStepToCad(params)
  })

  // 3. 外部 CAD 触发【新建阀块工程】(DOC_NEW_PROJECT)
  const unbindNew = window.cadBridgeApi.onNewProjectRequest(async (params) => {
    console.log('[CadIntegrationService] 收到外部 CAD 新建阀块请求:', params)
    const allProjects = useDesignStore.getState().projects

    // 检查是否已存在对应 docGuid 的工程
    const existingEntry = findCadProjectEntry(allProjects, params.docGuid)
    if (existingEntry) {
      openDesignTab({ projectId: existingEntry[0], name: existingEntry[1].doc.meta.projectName })
      return { projectId: existingEntry[0], status: 'ALREADY_EXISTS' }
    }

    const projectId = `cad-${params.docGuid.slice(0, 8)}-${Date.now()}`
    const displayName = params.docName || (params.docPath ? params.docPath.split(/[\\/]/).pop()?.replace(/\.[^.]+$/, '') : undefined) || '未命名阀块'
    const isCustomBody = Boolean(params.isCustomBaseBody || params.stepContent || params.stepBase64)
    const cadIntegration: CadIntegrationSession = {
      cadType: (params.cadType?.toUpperCase() as CadSoftwareType) || 'SOLIDWORKS',
      processId: params.pid,
      docGuid: params.docGuid,
      docName: displayName,
      docPath: params.docPath,
      isCustomBaseBody: isCustomBody,
      baseBodyName: params.baseBodyName,
      connectionStatus: 'CONNECTED'
    }

    // 1. 先初始化工程并原子绑定 CAD 协同会话
    useDesignStore.getState().initProject(
      projectId,
      undefined,
      undefined,
      undefined,
      undefined,
      cadIntegration
    )

    // 同步 projectName 与 CAD 零件名称一致
    useDesignStore.getState().updateMeta(projectId, { projectName: displayName })

    // 2. 检查是否有由已有 SolidWorks IBody2 实体导出的 STEP 几何模型
    let customStepContent = params.stepContent
    if (!customStepContent && params.stepBase64) {
      try {
        const binStr = atob(params.stepBase64)
        const bytes = new Uint8Array(binStr.length)
        for (let i = 0; i < binStr.length; i++) {
          bytes[i] = binStr.charCodeAt(i)
        }
        customStepContent = new TextDecoder('utf-8').decode(bytes)
      } catch (decodeErr) {
        console.warn('[CadIntegrationService] 解码 stepBase64 失败:', decodeErr)
      }
    }

    if (customStepContent && customStepContent.trim().length > 0) {
      const dimensions: [number, number, number] = [160, 120, 90]
      const stepFileName = `${params.baseBodyName || params.docName || 'SolidWorks_Body'}.step`
      useDesignStore.getState().setBaseStepModel(projectId, {
        stepContent: customStepContent,
        stepFileName,
        dimensions
      })
      void useDesignStore.getState().rebuildStepModel(projectId)
    }

    // 3. 打开设计 Tab
    openDesignTab({
      projectId,
      name: displayName,
      filePath: undefined
    })

    return { projectId, status: 'OPENED' }
  })

  // 4. 外部 CAD 触发【打开/编辑已有阀块工程】(DOC_OPEN_PROJECT)
  const unbindOpen = window.cadBridgeApi.onOpenProjectRequest(async (params) => {
    console.log('[CadIntegrationService] 收到外部 CAD 打开阀块请求:', params)
    const allProjects = useDesignStore.getState().projects

    const existingEntry = findCadProjectEntry(allProjects, params.docGuid)
    if (existingEntry) {
      openDesignTab({ projectId: existingEntry[0], name: existingEntry[1].doc.meta.projectName })
      return { projectId: existingEntry[0], status: 'FOCUSED' }
    }

    try {
      // Base64 反序列化 .sfb
      const binaryString = atob(params.sfbBase64)
      const bytes = new Uint8Array(binaryString.length)
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i)
      }
      const sfbText = new TextDecoder('utf-8').decode(bytes)
      const sfbDoc = JSON.parse(sfbText)

      const projectId = `cad-${params.docGuid.slice(0, 8)}-${Date.now()}`
      const docName = params.docName || (params.docPath ? params.docPath.split(/[\\/]/).pop()?.replace(/\.[^.]+$/, '') : undefined) || sfbDoc.meta?.projectName || '阀块工程'
      const cadIntegration: CadIntegrationSession = {
        cadType: (params.cadType?.toUpperCase() as CadSoftwareType) || 'SOLIDWORKS',
        processId: params.pid,
        docGuid: params.docGuid,
        docName,
        docPath: params.docPath,
        connectionStatus: 'CONNECTED'
      }

      // 1. 初始化工程数据并原子绑定 CAD 协同会话
      useDesignStore.getState().initProject(
        projectId,
        sfbDoc,
        undefined,
        undefined,
        undefined,
        cadIntegration
      )

      useDesignStore.getState().updateMeta(projectId, { projectName: docName })

      // 2. 打开设计 Tab
      openDesignTab({
        projectId,
        name: docName,
        filePath: undefined
      })

      return { projectId, status: 'RESTORED' }
    } catch (err: any) {
      console.error('[CadIntegrationService] 打开 CAD 工程失败:', err)
      throw err
    }
  })

  // 5. 仅激活已存在的 CAD 设计工程，不隐式创建重复 Tab。
  const unbindActivate = window.cadBridgeApi.onActivateProjectRequest(async (params) => {
    const projects = useDesignStore.getState().projects
    const entry = findCadProjectEntry(projects, params.docGuid, params.projectId)
    if (!entry) return { status: 'NOT_FOUND' as const }
    const docName = params.docName || entry[1].cadIntegration?.docName || entry[1].doc.meta.projectName
    if (params.docName && entry[1].cadIntegration) {
      entry[1].cadIntegration.docName = params.docName
      useDesignStore.getState().updateMeta(entry[0], { projectName: params.docName })
    }
    openDesignTab({ projectId: entry[0], name: docName })
    return { projectId: entry[0], status: 'FOCUSED' as const }
  })

  // 6. 监听 CAD 客户端异常断开/崩溃
  const unbindDisconnect = window.cadBridgeApi.onCadDisconnected((event) => {
    console.warn('[CadIntegrationService] 检测到外部 CAD 异常断开:', event)
    const allProjects = useDesignStore.getState().projects

    for (const [pId, p] of Object.entries(allProjects)) {
      if (
        (event.docGuid && p.cadIntegration?.docGuid === event.docGuid) ||
        (!event.docGuid && p.cadIntegration?.processId === event.pid)
      ) {
        useDesignStore.getState().setCadIntegration(pId, {
          ...p.cadIntegration!,
          connectionStatus: 'DISCONNECTED'
        })
      }
    }

    // 触发全局崩溃告警事件，唤起模态弹窗
    window.dispatchEvent(new CustomEvent('sureflow:cad-crash-alert', { detail: event }))
  })

  // 7. 外部 CAD 触发【同步视角至 SureFlow】(SYNC_CAMERA_VIEW)
  const unbindSyncCamera = window.cadBridgeApi.onSyncCameraFromCad?.((params) => {
    console.log('[CadIntegrationService] 收到外部 CAD 摄像机视角同步请求:', params)
    window.dispatchEvent(new CustomEvent('sureflow:sync-camera-from-cad', { detail: params }))
  })

  return () => {
    unbindImport()
    unbindExport()
    unbindNew()
    unbindOpen()
    unbindActivate()
    unbindDisconnect()
    unbindSyncCamera?.()
  }
}
