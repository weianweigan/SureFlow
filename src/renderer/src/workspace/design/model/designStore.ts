import { activeScheme, projectBody, physicalCavities, rootFeature, patchPhysicalCavity, selectedRoots, cloneFeature, normalizeProject } from '@shared/design/cavityTree'
/**
 * 设计工程全局状态 Store（Zustand + Immer）
 *
 * 核心架构：
 * - 多工程字典管理：`projects[projectId]` 隔离存储各 Tab 的独立工程数据
 * - 完整的撤销重做栈（≥ 50 步）
 * - 自动记录 dirty 标记与文件持久化（window.projectApi）
 */

import { create } from 'zustand'
import { produce } from 'immer'
import {
  createDefaultProject,
  getFacesForTemplate,
  type SfbProject,
  type SfbProjectMeta,
  type BaseBodyTemplate,
  type BaseFaceDefinition,
  type CavityInstance,
  type CompoundFrame,
  type CavityFeature,
  type CompoundCavity,
  type SubCavity,
  type SchemeDefinition,
  type MaterialConfig,
  type ChamferMode,
  MATERIAL_PRESETS
} from '@shared/design/types'

import {
  getBoxFaceBasis,
  localToWorldPoint,
  worldToLocalPoint
} from '@shared/design/faceMath'
import { useWorkspaceStore } from '@renderer/workspace/layout/layoutStore'
import { useRecentFilesStore } from '@renderer/workspace/registry/recentFilesStore'

import { parseStepToThreeGeometry } from '../../tabs/viewer/stepLoader'

const UNDO_LIMIT = 50
let cavityClipboard: CavityFeature[] = []

export type FeatureSelectionItem = { type: 'cavity' | 'compound'; id: string }

export type FeatureSelection =
  | { type: 'base'; id: 'base' }
  | { type: 'face'; id: string }
  | { type: 'cavity'; id: string; extraIds?: string[] }
  | { type: 'compound'; id: string; extraIds?: string[] }
  | { type: 'features'; items: FeatureSelectionItem[] }
  | { type: 'scheme'; id: string }
  | { type: 'channel'; id: string; cavityIds: string[] }
  | { type: 'port'; cavityId: string; portIndex: number }
  | null

/** 获取当前选中的特征列表（统一抽象为孔腔特征：单孔或组合孔组） */
export function getSelectedFeatures(
  selection?: FeatureSelection
): Array<{ type: 'cavity' | 'compound'; id: string }> {
  if (!selection) return []
  if (selection.type === 'cavity') {
    const list: Array<{ type: 'cavity' | 'compound'; id: string }> = [{ type: 'cavity', id: selection.id }]
    if (selection.extraIds) {
      for (const extra of selection.extraIds) {
        list.push({ type: 'cavity', id: extra })
      }
    }
    return list
  }
  if (selection.type === 'port') {
    return [{ type: 'cavity', id: selection.cavityId }]
  }
  if (selection.type === 'compound') {
    const list: Array<{ type: 'cavity' | 'compound'; id: string }> = [{ type: 'compound', id: selection.id }]
    if (selection.extraIds) {
      for (const extra of selection.extraIds) {
        list.push({ type: 'compound', id: extra })
      }
    }
    return list
  }
  if (selection.type === 'features') {
    return selection.items || []
  }
  if (selection.type === 'channel') {
    return (selection.cavityIds || []).map((id) => ({ type: 'cavity' as const, id }))
  }
  return []
}

/** 获取当前选中的所有孔腔 ID（单选、多选或组展开） */
export function getSelectedCavityIds(selection?: FeatureSelection, scheme?: { cavities: unknown[]; features?: CavityFeature[] }): string[] {
  if (!selection) return []
  if (selection.type === 'port') return [selection.cavityId]
  if (selection.type === 'channel') return selection.cavityIds
  const ids = getSelectedFeatures(selection).flatMap(f => {
    const root = scheme && rootFeature(scheme, f.id)
    return root?.kind === 'compound' && root.instanceId === f.id ? root.children.map(c => c.instanceId) : [f.id]
  })
  return [...new Set(ids)]
}

export interface LinearPatternConfig {
  direction1: {
    axis: '+u' | '-u' | '+v' | '-v'
    count: number
    spacing: number
  }
  direction2?: {
    enabled: boolean
    axis: '+u' | '-u' | '+v' | '-v'
    count: number
    spacing: number
  }
}

export interface CircularPatternConfig {
  centerU: number
  centerV: number
  count: number
  mode: 'full' | 'custom-angle'
  totalAngle?: number
}

export interface SectionConfig {
  enabled: boolean
  axis: 'x' | 'y' | 'z'
  offset: number
  flipped: boolean
}

export interface DesignProjectSession {
  projectId: string
  filePath?: string
  dirty: boolean
  saving: boolean
  doc: SfbProject
  selected: FeatureSelection
  undoStack: SfbProject[]
  redoStack: SfbProject[]
  sectionConfig?: SectionConfig
  isolatedChannelId?: string | null
  initialCacheBuffer?: ArrayBuffer | null
  initialGlbBuffer?: ArrayBuffer | null
  baseBodyError?: string | null
  cadIntegration?: import('@shared/cad/cadBridgeTypes').CadIntegrationSession
}

export interface DesignState {
  projects: Record<string, DesignProjectSession>

  /** 设置/更新 CAD 协同会话绑定 */
  setCadIntegration: (projectId: string, session: import('@shared/cad/cadBridgeTypes').CadIntegrationSession) => void
  /** 解除 CAD 协同会话绑定（如崩溃另存为后脱机独立） */
  detachCadIntegration: (projectId: string) => void

  /** 初始化或激活工程 Tab 会话 */
  initProject: (
    projectId: string,
    initialDoc?: SfbProject,
    filePath?: string,
    initialCacheBuffer?: ArrayBuffer | null,
    initialGlbBuffer?: ArrayBuffer | null,
    cadIntegration?: import('@shared/cad/cadBridgeTypes').CadIntegrationSession
  ) => void
  /** 关闭工程 Tab 会话 */
  removeProject: (projectId: string) => void

  /** 保存当前工程（若未关联文件路径则自动另存为，并配套保存 .cache 与缩略图） */
  saveProject: (
    projectId: string,
    extra?: {
      cacheBuffer?: ArrayBuffer | null
      glbBuffer?: ArrayBuffer | null
      previewImageBase64?: string | null
    }
  ) => Promise<boolean>
  /** 另存为工程 */
  saveAsProject: (
    projectId: string,
    extra?: {
      cacheBuffer?: ArrayBuffer | null
      glbBuffer?: ArrayBuffer | null
      previewImageBase64?: string | null
    }
  ) => Promise<boolean>
  /** 设置并记录上一次导出 STEP 实体模型的路径（可传相对路径） */
  setLastExportPath: (projectId: string, exportPath: string) => void
  /** 更新工程元数据（如工程名称、修改时间等） */
  updateMeta: (projectId: string, patch: Partial<SfbProjectMeta>) => void

  /** 选中特征（基体、面、孔腔、分组） */
  selectFeature: (projectId: string, selection: FeatureSelection) => void

  /** 修改基体模板形状 (box / l-shape / t-shape) */
  setBaseTemplate: (projectId: string, template: BaseBodyTemplate) => void
  /** 修改基体类型 (template / step) */
  setBaseType: (projectId: string, type: 'template' | 'step') => void
  /** 导入设置外部 STEP 基体模型 */
  setBaseStepModel: (
    projectId: string,
    payload: {
      stepContent: string
      stepFileName: string
      stepFilePath?: string
      stepAssetRef?: string
      dimensions: [number, number, number]
      faces?: BaseFaceDefinition[]
      stepMesh?: {
        positions: Float32Array | number[]
        indices: Uint32Array | number[]
        normals?: Float32Array | number[]
        edgePositions?: Float32Array | number[]
      }
    }
  ) => void
  /** 每次打开工程或主动请求时从内嵌 stepContent 强制重建实体几何与面 */
  rebuildStepModel: (projectId: string) => Promise<boolean>
  /** 修改基体额外参数 (如 L型/T型切除参数) */
  setBaseExtraParams: (projectId: string, params: Record<string, number>) => void
  /** 修改基体长方体尺寸 [Lx, Ly, Lz] */
  setBaseDimensions: (projectId: string, dimensions: [number, number, number]) => void
  /** 执行面厚度推拉 (沿法向增厚或减薄) */
  extrudeFace: (projectId: string, faceId: string, delta: number, cavitiesFollow?: boolean) => void
  /** 修改基体材质（完整配置） */
  setBaseMaterial: (projectId: string, config: MaterialConfig) => void
  /** 修改基体材质单属性 */
  setBaseMaterialProperty: (projectId: string, key: keyof MaterialConfig, value: string | number) => void
  /** 修改基体边缘倒角模式 */
  setBaseChamfer: (projectId: string, chamfer: ChamferMode) => void
  /** 设置或清除基体错误状态（如降级长方体显示告警） */
  setBaseBodyError: (projectId: string, error: string | null) => void

  /** 方案管理 */
  addScheme: (projectId: string, name?: string) => void
  cloneScheme: (projectId: string, schemeId: string) => void
  renameScheme: (projectId: string, schemeId: string, newName: string) => void
  deleteScheme: (projectId: string, schemeId: string) => void
  setActiveScheme: (projectId: string, schemeId: string) => void

  /** 孔腔管理 */
  addCavity: (projectId: string, cavity: CavityInstance) => void
  addCavities: (projectId: string, cavities: CavityInstance[], compound?: CompoundFrame) => void
  updateCavity: (projectId: string, instanceId: string, patch: Partial<CavityInstance>) => void
  updateCavityPosition: (projectId: string, instanceId: string, u: number, v: number, faceId?: string) => void
  updateCavityPositions: (
    projectId: string,
    updates: Array<{ id: string; u: number; v: number; faceId?: string }>
  ) => void
  copySelection: (projectId: string) => void
  pasteSelection: (projectId: string) => void
  deleteSelection: (projectId: string) => void
  updateSubCavity: (projectId: string, id: string, patch: Partial<SubCavity>) => void
  duplicateCavity: (projectId: string, instanceId: string) => void
  deleteCavity: (projectId: string, instanceId: string) => void
  reorderFeatures: (projectId: string, type: 'cavity' | 'compound', orderedIds: string[]) => void
  reorderChildren: (projectId: string, parentId: string, orderedIds: string[]) => void
  toggleCavitySuppressed: (projectId: string, instanceId: string) => void

  /** 组合孔操作 */
  moveRigidCavities: (projectId: string, ids: string[], du: number, dv: number) => void
  moveCompound: (projectId: string, parentId: string, deltaU: number, deltaV: number) => void
  rotateCompound: (projectId: string, parentId: string, deltaAngleDeg: number, pivot?: {u: number; v: number}) => void
  rebindCompoundFace: (projectId: string, parentId: string, newFaceId: string, mode: 'center' | 'project', targetOrigin?: { u: number; v: number }) => void
  deleteCompound: (projectId: string, parentId: string) => void
  toggleCompoundSuppressed: (projectId: string, parentId: string) => void

  /** 依附面重绑与对齐、分布、镜像、阵列 */
  rebindCavityFace: (projectId: string, cavityId: string, newFaceId: string, mode: 'center' | 'project', targetOrigin?: { u: number; v: number }) => void
  applyAlignment: (
    projectId: string,
    cavityIds: string[],
    type: 'left' | 'center-x' | 'right' | 'top' | 'center-y' | 'bottom'
  ) => void
  applyDistribution: (projectId: string, cavityIds: string[], axis: 'horizontal' | 'vertical') => void
  /** 替换单孔腔（就地继承面、坐标、朝向、偏置） */
  replaceCavity: (
    projectId: string,
    instanceId: string,
    newTemplate: {
      templateId?: string
      name?: string
      depthOffset?: number
      steps?: any[]
      ports?: any[]
      threadType?: string
      threadSpec?: string
      cavityType?: any
    }
  ) => void
  /** 替换组合孔组（继承组中心原点、朝向） */
  replaceCompound: (
    projectId: string,
    parentId: string,
    newGroupData: {
      name: string
      cavityType?: any
      templateId?: string
      outline?: CompoundCavity['outline']
      cavities: Array<{
        templateId?: string
        name?: string
        depthOffset?: number
        steps?: any[]
        ports?: any[]
        cavityType?: any
        subHoleName?: string
        rotation?: number
        tiltAngle?: number
        azimuth?: number
        offsetU: number
        offsetV: number
      }>
    }
  ) => void
  /** 批量调整孔深增量 */
  batchAdjustDepth: (projectId: string, cavityIds: string[], deltaDepth: number) => void
  /** 跨面空间剖面对齐 (共 X/Y/Z 剖面或轴线共面捕捉) */
  alignCavitiesCrossFace: (projectId: string, cavityIds: string[], axis: 'x' | 'y' | 'z') => void
  /** 双孔快捷相交连接（十字交叉穿透、T型触底、桥接孔） */
  connectTwoCavities: (
    projectId: string,
    cavityIdA: string,
    cavityIdB: string,
    options: {
      mode: 'cross' | 't-bottom' | 'bridge'
      overtravel?: number
      offset?: number
    }
  ) => void
  applyMirror: (projectId: string, cavityIds: string[], axis: 'u-axis' | 'v-axis', copy: boolean) => void
  applyLinearPattern: (projectId: string, sourceCavityIds: string[], config: LinearPatternConfig) => void
  applyCircularPattern: (projectId: string, sourceCavityIds: string[], config: CircularPatternConfig) => void

  /** 撤销 / 重做 */
  undo: (projectId: string) => void
  redo: (projectId: string) => void

  /** 剖切模式 */
  setSectionConfig: (projectId: string, config: Partial<SectionConfig>) => void
  toggleSection: (projectId: string) => void

  /** 通道管理 */
  setChannelColor: (projectId: string, bindingKey: string, color: string) => void
  renameChannel: (projectId: string, bindingKey: string, newName: string) => void
  toggleChannelHidden: (projectId: string, bindingKey: string) => void
  toggleChannelIsolated: (projectId: string, channelId: string | null) => void
}

function mutableHole(scheme: SchemeDefinition, id: string) {
  const root = rootFeature(scheme, id)
  return root?.kind === 'compound' ? root.children.find(c => c.instanceId === id) : root
}

/** 压入撤销历史纯辅助 */
function pushHistory(s: DesignProjectSession): void {
  s.undoStack.push(JSON.parse(JSON.stringify(s.doc)))
  if (s.undoStack.length > UNDO_LIMIT) {
    s.undoStack.shift()
  }
  s.redoStack = []
  s.dirty = true
}

export const useDesignStore = create<DesignState>((set, get) => ({
  projects: {},

  setCadIntegration: (projectId, session) => {
    set(
      produce((state: DesignState) => {
        if (!state.projects[projectId]) {
          state.projects[projectId] = {
            projectId,
            dirty: false,
            saving: false,
            doc: createDefaultProject(),
            selected: { type: 'base', id: 'base' },
            undoStack: [],
            redoStack: [],
            cadIntegration: session
          }
        } else {
          state.projects[projectId].cadIntegration = session
        }
      })
    )
  },

  detachCadIntegration: (projectId) => {
    set(
      produce((state: DesignState) => {
        if (state.projects[projectId]) {
          delete state.projects[projectId].cadIntegration
        }
      })
    )
  },

  initProject: (projectId, initialDoc, filePath, initialCacheBuffer, initialGlbBuffer, cadIntegration) => {
    set(
      produce((state: DesignState) => {
        if (!state.projects[projectId]) {
          const doc = normalizeProject(initialDoc || createDefaultProject())
          const migrated = Boolean(initialDoc && initialDoc.schemaVersion !== '2.0.0')
          state.projects[projectId] = {
            projectId,
            filePath,
            dirty: migrated,
            saving: false,
            doc,
            selected: { type: 'base', id: 'base' },
            undoStack: [],
            redoStack: [],
            initialCacheBuffer: initialDoc && initialDoc.schemaVersion !== '2.0.0' ? null : initialCacheBuffer,
            initialGlbBuffer: initialDoc && initialDoc.schemaVersion !== '2.0.0' ? null : initialGlbBuffer,
            cadIntegration
          }
        } else {
          if (cadIntegration) {
            state.projects[projectId].cadIntegration = cadIntegration
          }
          if (initialDoc) {
            const doc = normalizeProject(initialDoc)
            state.projects[projectId].doc = doc
            state.projects[projectId].dirty = initialDoc.schemaVersion !== '2.0.0'
          }
          if (filePath !== undefined) {
            state.projects[projectId].filePath = filePath
          }
        }
      })
    )

    // 若当前工程为 step 基体，每次打开时需要从 stepContent 重建模型，并检测源文件是否存在
    const currentSession = get().projects[projectId]
    if (projectBody(currentSession?.doc)?.type === 'step') {
      void get().rebuildStepModel(projectId)
    }
  },

  removeProject: (projectId) => {
    set(
      produce((state: DesignState) => {
        delete state.projects[projectId]
      })
    )
  },

  saveProject: async (projectId, extra) => {
    const session = get().projects[projectId]
    if (!session || session.saving) return false

    // 1. 若当前工程绑定了活跃的外部 CAD 协同会话 (SolidWorks / Creo / NX)，直接存盘并同步至 CAD 宿主
    if (session.cadIntegration?.connectionStatus === 'CONNECTED') {
      set(
        produce((state: DesignState) => {
          if (state.projects[projectId]) state.projects[projectId].saving = true
        })
      )

      try {
        const { saveAndSyncToCad } = await import('../services/cadIntegrationService')
        const ok = await saveAndSyncToCad(projectId)
        if (ok) {
          set(
            produce((state: DesignState) => {
              const p = state.projects[projectId]
              if (p) {
                if (extra?.previewImageBase64) p.doc.meta.previewImage = extra.previewImageBase64
                p.doc.meta.modifiedAt = new Date().toISOString()
                p.dirty = false
                p.saving = false
              }
            })
          )
          return true
        } else {
          set(
            produce((state: DesignState) => {
              if (state.projects[projectId]) state.projects[projectId].saving = false
            })
          )
          window.alert('同步保存至 CAD 宿主失败，请确认 CAD 软件中对应的工程文件处于打开状态。')
          return false
        }
      } catch (err) {
        console.error('[DesignStore] 同步至 CAD 宿主异常:', err)
        set(
          produce((state: DesignState) => {
            if (state.projects[projectId]) state.projects[projectId].saving = false
          })
        )
        window.alert(`保存至 CAD 失败: ${String(err)}`)
        return false
      }
    }

    // 若无 filePath 则弹出另存为
    if (!session.filePath) {
      return get().saveAsProject(projectId, extra)
    }

    set(
      produce((state: DesignState) => {
        if (state.projects[projectId]) state.projects[projectId].saving = true
      })
    )

    try {
      const modifiedAt = await window.projectApi.save({
        filePath: session.filePath,
        doc: session.doc,
        cacheBuffer: extra?.cacheBuffer,
        glbBuffer: extra?.glbBuffer,
        previewImageBase64: extra?.previewImageBase64
      })
      set(
        produce((state: DesignState) => {
          const p = state.projects[projectId]
          if (p) {
            if (extra?.previewImageBase64) p.doc.meta.previewImage = extra.previewImageBase64
            p.doc.meta.modifiedAt = modifiedAt
            p.dirty = false
            p.saving = false
          }
        })
      )
      const projectName =
        session.doc.meta.projectName ||
        session.filePath.split(/[\\/]/).pop()?.replace(/\.sfb$/i, '') ||
        '未命名工程'
      useRecentFilesStore.getState().addRecent(session.filePath, projectName)
      return true
    } catch (err) {
      console.error('[DesignStore] 保存失败:', err)
      set(
        produce((state: DesignState) => {
          if (state.projects[projectId]) state.projects[projectId].saving = false
        })
      )
      window.alert(`工程保存失败: ${String(err)}`)
      return false
    }
  },

  saveAsProject: async (projectId, extra) => {
    const session = get().projects[projectId]
    if (!session || session.saving) return false

    const defaultName = session.doc.meta.projectName || '未命名工程'
    const targetPath = await window.projectApi.saveDialog(defaultName)
    if (!targetPath) return false

    const newProjectName = targetPath.split(/[\\/]/).pop()?.replace(/\.sfb$/i, '') || defaultName

    set(
      produce((state: DesignState) => {
        if (state.projects[projectId]) state.projects[projectId].saving = true
      })
    )

    try {
      const updatedDoc = {
        ...session.doc,
        meta: {
          ...session.doc.meta,
          projectName: newProjectName,
          ...(extra?.previewImageBase64 ? { previewImage: extra.previewImageBase64 } : {})
        }
      }

      const modifiedAt = await window.projectApi.save({
        filePath: targetPath,
        doc: updatedDoc,
        cacheBuffer: extra?.cacheBuffer,
        glbBuffer: extra?.glbBuffer,
        previewImageBase64: extra?.previewImageBase64
      })
      set(
        produce((state: DesignState) => {
          const p = state.projects[projectId]
          if (p) {
            p.filePath = targetPath
            p.doc = updatedDoc
            p.doc.meta.modifiedAt = modifiedAt
            p.dirty = false
            p.saving = false
            if (p.cadIntegration) {
              delete p.cadIntegration
            }
          }
        })
      )

      // 同步更新 Dockview Tab 标题与参数
      try {
        const api = useWorkspaceStore.getState().api
        const panel = api?.getPanel(`design:${projectId}`)
        if (panel) {
          panel.api.setTitle(newProjectName)
          if (panel.params && typeof panel.params === 'object') {
            ;(panel.params as Record<string, unknown>).filePath = targetPath
            ;(panel.params as Record<string, unknown>).name = newProjectName
          }
        }
      } catch (err) {
        console.warn('[DesignStore] 更新 Tab 标题失败:', err)
      }

      // 记录至最近打开文件
      useRecentFilesStore.getState().addRecent(targetPath, newProjectName)

      return true
    } catch (err) {
      console.error('[DesignStore] 另存为失败:', err)
      set(
        produce((state: DesignState) => {
          if (state.projects[projectId]) state.projects[projectId].saving = false
        })
      )
      window.alert(`另存为失败: ${String(err)}`)
      return false
    }
  },

  setLastExportPath: (projectId, exportPath) => {
    set(
      produce((state: DesignState) => {
        const p = state.projects[projectId]
        if (p) {
          p.doc.meta.lastExportPath = exportPath
        }
      })
    )
  },

  updateMeta: (projectId, patch) => {
    set(
      produce((state: DesignState) => {
        const p = state.projects[projectId]
        if (p) {
          p.doc.meta = { ...p.doc.meta, ...patch }
        }
      })
    )
  },

  selectFeature: (projectId, selection) => {
    set(
      produce((state: DesignState) => {
        const p = state.projects[projectId]
        if (p) {
          p.selected = selection
        }
      })
    )
  },

  setBaseTemplate: (projectId, template) => {
    set(
      produce((state: DesignState) => {
        const p = state.projects[projectId]
        if (p) {
          pushHistory(p)
          projectBody(p.doc).type = 'template'
          projectBody(p.doc).template = template
          const newFaces = getFacesForTemplate(template, projectBody(p.doc).dimensions, projectBody(p.doc).extraParams)
          projectBody(p.doc).faces = newFaces

          // 悬空孔检测：遍历当前方案的孔腔，若 faceId 不在新模板面中则标记 dangling
          const validFaceIds = new Set(newFaces.map(f => f.id))
          for (const scheme of [activeScheme(p.doc)]) {
            for (const cav of physicalCavities(scheme)) {
              if (!validFaceIds.has(cav.faceId)) {
                patchPhysicalCavity(scheme, cav.instanceId, { dangling: true })
              } else {
                // 如果之前是 dangling 现在面又存在了，恢复正常
                patchPhysicalCavity(scheme, cav.instanceId, { dangling: false })
              }
            }
          }
        }
      })
    )
  },

  setBaseType: (projectId, type) => {
    set(
      produce((state: DesignState) => {
        const p = state.projects[projectId]
        if (p) {
          pushHistory(p)
          projectBody(p.doc).type = type
        }
      })
    )
  },

  setBaseStepModel: (projectId, payload) => {
    set(
      produce((state: DesignState) => {
        const p = state.projects[projectId]
        if (p) {
          pushHistory(p)
          projectBody(p.doc).type = 'step'
          projectBody(p.doc).stepContent = payload.stepContent
          projectBody(p.doc).stepFileName = payload.stepFileName
          if (payload.stepFilePath !== undefined) {
            projectBody(p.doc).stepFilePath = payload.stepFilePath
          }
          projectBody(p.doc).stepAssetRef = payload.stepAssetRef || payload.stepFilePath || payload.stepFileName
          projectBody(p.doc).dimensions = [...payload.dimensions]
          if (payload.faces && payload.faces.length > 0) {
            projectBody(p.doc).faces = payload.faces
          }
          if (payload.stepMesh) {
            projectBody(p.doc).stepMesh = payload.stepMesh
          }
          p.baseBodyError = null
        }
      })
    )
  },

  rebuildStepModel: async (projectId: string) => {
    const session = get().projects[projectId]
    if (!session || projectBody(session.doc).type !== 'step') return false

    const schemeId = activeScheme(session.doc).id
    const baseBody = projectBody(session.doc)
    const stepPath = baseBody.stepFilePath || baseBody.stepAssetRef

    // 1. 原始文件丢失检测与用户提醒
    if (stepPath && (stepPath.includes('/') || stepPath.includes('\\'))) {
      try {
        if (window.fileApi?.exists) {
          const exists = await window.fileApi.exists(stepPath)
          if (!exists) {
            get().setBaseBodyError(
              projectId,
              `原始 STEP 文件丢失或不可访问 (${stepPath})。已从工程内嵌 stepContent 重建模型。`
            )
          }
        }
      } catch (err) {
        console.warn('[DesignStore] 检查原始 STEP 文件路径失败:', err)
      }
    }

    // 2. 每次打开文件时从 stepContent 重建模型
    if (baseBody.stepContent) {
      try {
        const parsed = await parseStepToThreeGeometry(baseBody.stepContent)
        set(
          produce((state: DesignState) => {
            const p = state.projects[projectId]
            const body = p?.doc.schemes.find(s => s.id === schemeId)?.baseBody
            if (body?.type === 'step' && body.stepContent === baseBody.stepContent) {
              body.stepMesh = parsed.stepMesh
              if (parsed.dimensions) body.dimensions = parsed.dimensions
              if (parsed.faces?.length && !body.faces?.length) body.faces = parsed.faces
            }
          })
        )
        return true
      } catch (err: any) {
        console.error('[DesignStore] 从 stepContent 重建 STEP 模型失败:', err)
        get().setBaseBodyError(
          projectId,
          `从内嵌 STEP 数据重建实体失败: ${err?.message || String(err)}，已降级为长方体包围盒。`
        )
        return false
      }
    }
    return false
  },

  setBaseExtraParams: (projectId, params) => {
    set(
      produce((state: DesignState) => {
        const p = state.projects[projectId]
        if (p) {
          pushHistory(p)
          projectBody(p.doc).extraParams = {
            ...(projectBody(p.doc).extraParams || {}),
            ...params
          }
          if (projectBody(p.doc).type !== 'step') {
            projectBody(p.doc).faces = getFacesForTemplate(projectBody(p.doc).template, projectBody(p.doc).dimensions, projectBody(p.doc).extraParams)
          }
        }
      })
    )
  },

  setBaseDimensions: (projectId, dimensions) => {
    set(
      produce((state: DesignState) => {
        const p = state.projects[projectId]
        if (p) {
          pushHistory(p)
          projectBody(p.doc).dimensions = [...dimensions]
          if (projectBody(p.doc).type !== 'step') {
            projectBody(p.doc).faces = getFacesForTemplate(projectBody(p.doc).template, dimensions, projectBody(p.doc).extraParams)
          }
        }
      })
    )
  },

  extrudeFace: (projectId, faceId, delta, cavitiesFollow = true) => {
    if (delta === 0) return
    set(
      produce((state: DesignState) => {
        const p = state.projects[projectId]
        if (!p) return
        pushHistory(p)

        const body = projectBody(p.doc)
        const face = body.faces.find((f) => f.id === faceId)
        const binding = face?.paramBinding

        if (binding) {
          if (binding.param === 'dimensions') {
            const [sx, sy, sz] = body.dimensions
            let newSx = sx, newSy = sy, newSz = sz
            const step = delta * binding.sign
            if (binding.key === 'sx') newSx = Math.max(10, sx + step)
            else if (binding.key === 'sy') newSy = Math.max(10, sy + step)
            else if (binding.key === 'sz') newSz = Math.max(10, sz + step)
            body.dimensions = [newSx, newSy, newSz]
          } else if (binding.param === 'extraParams') {
            const extra = { ...(body.extraParams || {}) }
            const curVal = extra[binding.key] ?? (binding.key === 'cutX' ? body.dimensions[0] * 0.4 : body.dimensions[2] * 0.5)
            const step = delta * binding.sign
            extra[binding.key] = Math.max(5, curVal + step)
            body.extraParams = extra
          }
        } else if (face?.normal) {
          const normal = face.normal
          let [newSx, newSy, newSz] = body.dimensions
          if (Math.abs(normal[0]) > 0.8) newSx = Math.max(10, newSx + delta)
          else if (Math.abs(normal[1]) > 0.8) newSy = Math.max(10, newSy + delta)
          else if (Math.abs(normal[2]) > 0.8) newSz = Math.max(10, newSz + delta)
          body.dimensions = [newSx, newSy, newSz]
        }

        if (body.type !== 'step') {
          body.faces = getFacesForTemplate(body.template, body.dimensions, body.extraParams)
        }

        // 若取消勾选孔腔跟随移动，则调整孔腔的 depthOffset 保持其绝对世界坐标不变
        if (!cavitiesFollow) {
          for (const scheme of [activeScheme(p.doc)]) {
            for (const cav of physicalCavities(scheme)) {
              if (cav.faceId === faceId) {
                patchPhysicalCavity(scheme, cav.instanceId, { depthOffset: (cav.depthOffset || 0) + delta })
              }
            }
          }
        }
      })
    )
  },

  setBaseChamfer: (projectId, chamfer) => {
    set(
      produce((state: DesignState) => {
        const p = state.projects[projectId]
        if (p) {
          pushHistory(p)
          projectBody(p.doc).chamfer = chamfer
        }
      })
    )
  },

  setBaseBodyError: (projectId, error) => {
    set(
      produce((state: DesignState) => {
        const p = state.projects[projectId]
        if (p) {
          p.baseBodyError = error
        }
      })
    )
  },

  setBaseMaterial: (projectId, config) => {
    set(
      produce((state: DesignState) => {
        const p = state.projects[projectId]
        if (p) {
          pushHistory(p)
          projectBody(p.doc).materialConfig = { ...config }
          // 同步更新旧字段用于显示兼容
          const preset = MATERIAL_PRESETS[config.presetId]
          projectBody(p.doc).material = preset?.label || config.presetId
        }
      })
    )
  },

  setBaseMaterialProperty: (projectId, key, value) => {
    set(
      produce((state: DesignState) => {
        const p = state.projects[projectId]
        if (p) {
          pushHistory(p)
          if (!projectBody(p.doc).materialConfig) {
            const def = MATERIAL_PRESETS['45-steel']
            projectBody(p.doc).materialConfig = {
              presetId: def.presetId, color: def.color,
              metalness: def.metalness, roughness: def.roughness, opacity: def.opacity
            }
          }
          ;(projectBody(p.doc).materialConfig as any)[key] = value
          // 切换为自定义
          if (key !== 'presetId') {
            projectBody(p.doc).materialConfig!.presetId = 'custom'
          }
        }
      })
    )
  },

  addScheme: (projectId, name) => {
    set(
      produce((state: DesignState) => {
        const p = state.projects[projectId]
        if (!p) return
        pushHistory(p)
        const count = p.doc.schemes.length + 1
        const id = `scheme-${crypto.randomUUID()}`
        const baseBody = JSON.parse(JSON.stringify(projectBody(p.doc)))
        p.doc.schemes.push({
          id,
          name: name || `方案 ${count}`,
          description: '',
          baseBody,
          cavities: []
        })
        p.doc.activeSchemeId = id
      })
    )
  },

  cloneScheme: (projectId, schemeId) => {
    set(
      produce((state: DesignState) => {
        const p = state.projects[projectId]
        if (!p) return
        const src = p.doc.schemes.find((s) => s.id === schemeId)
        if (!src) return
        pushHistory(p)
        const id = `scheme-${crypto.randomUUID()}`
        p.doc.schemes.push({
          ...JSON.parse(JSON.stringify(src)),
          id,
          baseBody: JSON.parse(JSON.stringify(src.baseBody)),
          name: `${src.name} - 副本`
        })
        p.doc.activeSchemeId = id
      })
    )
  },

  renameScheme: (projectId, schemeId, newName) => {
    set(
      produce((state: DesignState) => {
        const p = state.projects[projectId]
        if (!p) return
        const s = p.doc.schemes.find((item) => item.id === schemeId)
        if (s && s.name !== newName) {
          pushHistory(p)
          s.name = newName.trim() || s.name
        }
      })
    )
  },

  deleteScheme: (projectId, schemeId) => {
    set(
      produce((state: DesignState) => {
        const p = state.projects[projectId]
        if (!p || p.doc.schemes.length <= 1) return
        pushHistory(p)
        p.doc.schemes = p.doc.schemes.filter((s) => s.id !== schemeId)
        if (p.doc.activeSchemeId === schemeId) {
          p.doc.activeSchemeId = p.doc.schemes[0].id
        }
      })
    )
  },

  setActiveScheme: (projectId, schemeId) => {
    set(produce((state: DesignState) => {
      const p = state.projects[projectId]
      if (p?.doc.schemes.some(s => s.id === schemeId)) {
        p.doc.activeSchemeId = schemeId
        p.selected = { type: 'scheme', id: schemeId }
      }
    }))
  },

  addCavity: (projectId, cavity) => {
    set(produce((state: DesignState) => {
      const p = state.projects[projectId]
      if (!p) return
      const scheme = activeScheme(p.doc)
      pushHistory(p)
      const {parentId: _parent, ...single} = cavity
      scheme.cavities.push({ ...single, kind: 'single' })
      p.selected = { type: 'cavity', id: cavity.instanceId }
    }))
  },

  addCavities: (projectId, cavities, compound) => {
    set(produce((state: DesignState) => {
      const p = state.projects[projectId]
      if (!p) return
      const scheme = activeScheme(p.doc)
      if (!cavities.length) return
      pushHistory(p)
      if (compound) {
        const feature: CompoundCavity = {
          kind: 'compound', instanceId: compound.id, name: compound.name,
          libraryId: cavities[0].libraryId, templateId: cavities[0].templateId,
          cavityType: compound.cavityType, faceId: compound.faceId || cavities[0].faceId,
          u: compound.u || 0, v: compound.v || 0, rotation: compound.rotation || 0,
          outline: compound.outline,
          children: cavities.map(({ faceId: _face, parentId: _parent, ...child }) => {
            const angle = (compound.rotation || 0) * Math.PI / 180
            const du = child.u - (compound.u || 0), dv = child.v - (compound.v || 0)
            return {...child, u: du * Math.cos(angle) + dv * Math.sin(angle), v: -du * Math.sin(angle) + dv * Math.cos(angle), rotation: child.rotation - (compound.rotation || 0), ...(child.azimuth !== undefined ? {azimuth: child.azimuth - (compound.rotation || 0)} : {})}
          })
        }
        scheme.cavities.push(feature)
        p.selected = { type: 'compound', id: feature.instanceId }
      } else {
        scheme.cavities.push(...cavities.map(({parentId: _parent, ...c}) => ({ ...c, kind: 'single' as const })))
        p.selected = { type: 'cavity', id: cavities[0].instanceId }
      }
    }))
  },

  updateCavity: (projectId, instanceId, patch) => {
    set(produce((state: DesignState) => {
      const p = state.projects[projectId]
      if (!p) return
      const scheme = activeScheme(p.doc)
      if (!rootFeature(scheme, instanceId)) return
      pushHistory(p)
      patchPhysicalCavity(scheme, instanceId, patch)
    }))
  },

  updateCavityPosition: (projectId, instanceId, u, v, faceId) => {
    set(produce((state: DesignState) => {
      const p = state.projects[projectId]
      if (!p) return
      const scheme = activeScheme(p.doc)
      if (!rootFeature(scheme, instanceId)) return
      pushHistory(p)
      patchPhysicalCavity(scheme, instanceId, { u, v, ...(faceId ? {faceId} : {}) })
    }))
  },

  updateCavityPositions: (projectId, updates) => {
    set(produce((state: DesignState) => {
      const p = state.projects[projectId]
      if (!p) return
      const scheme = activeScheme(p.doc)
      if (!updates.length) return
      pushHistory(p)
      const moved = new Set<string>()
      const holes = physicalCavities(scheme)
      updates.forEach(up => {
        const root = rootFeature(scheme, up.id)
        const hole = holes.find(c => c.instanceId === up.id)
        if (!root || !hole || moved.has(root.instanceId)) return
        moved.add(root.instanceId)
        root.u += up.u - hole.u; root.v += up.v - hole.v
        if (up.faceId) root.faceId = up.faceId
      })
    }))
  },

  copySelection: (projectId) => {
    const p = get().projects[projectId]
    if (!p) return
    const roots = selectedRoots(activeScheme(p.doc), getSelectedCavityIds(p.selected, activeScheme(p.doc)))
    if (roots.length) cavityClipboard = JSON.parse(JSON.stringify(roots))
  },
  pasteSelection: (projectId) => {
    if (!cavityClipboard.length) return
    set(produce((state: DesignState) => {
      const p = state.projects[projectId]
      if (!p) return
      pushHistory(p)
      const copies = cavityClipboard.map(f => { const c = cloneFeature(f); c.u += 10; c.v += 10; return c })
      activeScheme(p.doc).cavities.push(...copies)
      p.selected = copies.length === 1 ? {type: copies[0].kind === 'compound' ? 'compound' : 'cavity', id: copies[0].instanceId} : { type: 'features', items: copies.map(c => ({type: c.kind === 'compound' ? 'compound' : 'cavity', id: c.instanceId})) }
    }))
  },
  deleteSelection: (projectId) => {
    set(produce((state: DesignState) => {
      const p = state.projects[projectId]
      if (!p) return
      const scheme = activeScheme(p.doc)
      const ids = new Set(selectedRoots(scheme, getSelectedCavityIds(p.selected, scheme)).map(f => f.instanceId))
      if (!ids.size) return
      pushHistory(p)
      scheme.cavities = scheme.cavities.filter(f => !ids.has(f.instanceId))
      p.selected = { type: 'base', id: 'base' }
    }))
  },
  updateSubCavity: (projectId, id, patch) => {
    set(produce((state: DesignState) => {
      const p = state.projects[projectId]
      if (!p) return
      const root = rootFeature(activeScheme(p.doc), id)
      if (root?.kind !== 'compound') return
      const child = root.children.find(c => c.instanceId === id)
      if (!child) return
      pushHistory(p)
      Object.assign(child, patch)
    }))
  },

  duplicateCavity: (projectId, instanceId) => {
    set(produce((state: DesignState) => {
      const p = state.projects[projectId]
      if (!p) return
      const scheme = activeScheme(p.doc)
      const src = rootFeature(scheme, instanceId)
      if (!src) return
      pushHistory(p)
      const copy = cloneFeature(src)
      copy.name += ' - 副本'; copy.u += 10; copy.v += 10
      scheme.cavities.push(copy)
      p.selected = { type: copy.kind === 'compound' ? 'compound' : 'cavity', id: copy.instanceId }
    }))
  },

  deleteCavity: (projectId, instanceId) => {
    set(produce((state: DesignState) => {
      const p = state.projects[projectId]
      if (!p) return
      const scheme = activeScheme(p.doc)
      const root = rootFeature(scheme, instanceId)
      if (!root) return
      pushHistory(p)
      scheme.cavities = scheme.cavities.filter(f => f.instanceId !== root.instanceId)
      p.selected = { type: 'base', id: 'base' }
    }))
  },

  reorderFeatures: (projectId, _type, orderedIds) => {
    set(produce((state: DesignState) => {
      const p = state.projects[projectId]
      if (!p) return
      const scheme = activeScheme(p.doc)
      pushHistory(p)
      const list = scheme.cavities
      const rank = new Map(orderedIds.map((id, index) => [id, index]))
      list.sort((a, b) => (rank.get(a.instanceId) ?? orderedIds.length) - (rank.get(b.instanceId) ?? orderedIds.length))
    }))
  },

  reorderChildren: (projectId, parentId, ids) => {
    set(produce((state: DesignState) => {
      const p = state.projects[projectId]
      if (!p) return
      const root = rootFeature(activeScheme(p.doc), parentId)
      if (root?.kind !== 'compound') return
      pushHistory(p)
      const rank = new Map(ids.map((id, i) => [id, i]))
      root.children.sort((a, b) => (rank.get(a.instanceId) ?? ids.length) - (rank.get(b.instanceId) ?? ids.length))
    }))
  },
  toggleCavitySuppressed: (projectId, instanceId) => {
    set(produce((state: DesignState) => {
      const p = state.projects[projectId]
      if (!p) return
      const scheme = activeScheme(p.doc)
      const root = rootFeature(scheme, instanceId)
      if (!root) return
      pushHistory(p)
      const item = root.kind === 'compound' && root.instanceId !== instanceId ? root.children.find(c => c.instanceId === instanceId)! : root
      item.suppressed = !item.suppressed
    }))
  },

  moveRigidCavities: (projectId, ids, du, dv) => {
    set(produce((state: DesignState) => {
      const p = state.projects[projectId]
      if (!p) return
      const scheme = activeScheme(p.doc)
      if (!Number.isFinite(du + dv)) return
      pushHistory(p)
      selectedRoots(scheme, ids).forEach(f => { f.u += du; f.v += dv })
    }))
  },

  moveCompound: (projectId, parentId, deltaU, deltaV) => {
    set(produce((state: DesignState) => {
      const p = state.projects[projectId]
      if (!p) return
      const scheme = activeScheme(p.doc)
      const root = rootFeature(scheme, parentId)
      if (!root || !Number.isFinite(deltaU + deltaV)) return
      pushHistory(p)
      root.u += deltaU; root.v += deltaV
    }))
  },

  rotateCompound: (projectId, parentId, deltaAngleDeg, pivot) => {
    set(produce((state: DesignState) => {
      const p = state.projects[projectId]
      if (!p) return
      const scheme = activeScheme(p.doc)
      const root = rootFeature(scheme, parentId)
      if (!root) return
      pushHistory(p)
      if (pivot) {
        const angle = deltaAngleDeg * Math.PI / 180, du = root.u-pivot.u, dv = root.v-pivot.v
        root.u = pivot.u+du*Math.cos(angle)-dv*Math.sin(angle)
        root.v = pivot.v+du*Math.sin(angle)+dv*Math.cos(angle)
      }
      root.rotation = (root.rotation + deltaAngleDeg + 360) % 360
    }))
  },

  rebindCompoundFace: (projectId, parentId, newFaceId, mode, targetOrigin) => {
    set(produce((state: DesignState) => {
      const p = state.projects[projectId]
      if (!p) return
      const scheme = activeScheme(p.doc)
      const root = rootFeature(scheme, parentId)
      if (!root || root.faceId === newFaceId) return
      pushHistory(p)
      let origin = { u: 0, v: 0 }
      if (mode === 'project') {
        const body = scheme.baseBody
        const world = localToWorldPoint(getBoxFaceBasis(root.faceId, body.dimensions, body), root.u, root.v, 0)
        origin = worldToLocalPoint(getBoxFaceBasis(newFaceId, body.dimensions, body), world)
      }
      root.faceId = newFaceId; root.u = targetOrigin?.u ?? origin.u; root.v = targetOrigin?.v ?? origin.v
    }))
  },

  deleteCompound: (projectId, parentId) => get().deleteCavity(projectId, parentId),

  toggleCompoundSuppressed: (projectId, parentId) => get().toggleCavitySuppressed(projectId, parentId),

  rebindCavityFace: (projectId, cavityId, newFaceId, mode, targetOrigin) => get().rebindCompoundFace(projectId, cavityId, newFaceId, mode, targetOrigin),

  applyAlignment: (projectId, cavityIds, type) => {
    set(produce((state: DesignState) => {
      const p = state.projects[projectId]
      if (!p) return
      const scheme = activeScheme(p.doc)
      const roots = selectedRoots(scheme, cavityIds)
      if (roots.length < 2) return
      pushHistory(p)
      const coordinate = ['left', 'right', 'center-x'].includes(type) ? 'u' : 'v'
      for (const face of new Set(roots.map(f => f.faceId))) {
        const items = roots.filter(f => f.faceId === face)
        const values = items.map(f => f[coordinate])
        const target = ['left','bottom'].includes(type) ? Math.min(...values) : ['right','top'].includes(type) ? Math.max(...values) : values.reduce((a,b) => a+b,0)/values.length
        items.forEach(f => { f[coordinate] = target })
      }
    }))
  },

  applyDistribution: (projectId, cavityIds, axis) => {
    set(produce((state: DesignState) => {
      const p = state.projects[projectId]
      if (!p) return
      const scheme = activeScheme(p.doc)
      const roots = selectedRoots(scheme, cavityIds)
      if (roots.length < 3) return
      pushHistory(p)
      const coordinate = axis === 'horizontal' ? 'u' : 'v'
      for (const face of new Set(roots.map(f => f.faceId))) {
        const items = roots.filter(f => f.faceId === face).sort((a,b) => a[coordinate]-b[coordinate])
        if (items.length < 3) continue
        const first = items[0][coordinate], last = items[items.length-1][coordinate]
        items.forEach((f,i) => { f[coordinate] = first + (last-first)*i/(items.length-1) })
      }
    }))
  },

  replaceCavity: (projectId, instanceId, newTemplate) => {
    set(
      produce((state: DesignState) => {
        const p = state.projects[projectId]
        if (!p) return
        const scheme = p.doc.schemes.find((s) => s.id === p.doc.activeSchemeId)
        if (!scheme) return
        const cav = mutableHole(scheme, instanceId)
        if (!cav) return
        pushHistory(p)
        if (newTemplate.templateId) cav.templateId = newTemplate.templateId
        if (newTemplate.name) cav.name = newTemplate.name
        if (newTemplate.steps) cav.steps = JSON.parse(JSON.stringify(newTemplate.steps))
        if (newTemplate.ports) cav.ports = JSON.parse(JSON.stringify(newTemplate.ports))
        if (newTemplate.cavityType) cav.cavityType = newTemplate.cavityType
        if (newTemplate.depthOffset != null) cav.depthOffset = newTemplate.depthOffset
      })
    )
  },

  replaceCompound: (projectId, parentId, newGroupData) => {
    set(produce((state: DesignState) => {
      const p = state.projects[projectId]
      if (!p) return
      const scheme = activeScheme(p.doc)
      const root = rootFeature(scheme, parentId)
      if (root?.kind !== 'compound') return
      pushHistory(p)
      root.name = newGroupData.name; root.cavityType = newGroupData.cavityType || root.cavityType
      root.templateId = newGroupData.templateId || root.templateId
      root.outline = newGroupData.outline
      root.outlineMirrored = false
      root.children = newGroupData.cavities.map((c, i) => ({
        instanceId: crypto.randomUUID(), libraryId: root.libraryId, templateId: c.templateId || root.templateId,
        name: c.name || `${root.name}_${i+1}`, subHoleName: c.subHoleName, cavityType: c.cavityType,
        u: c.offsetU, v: c.offsetV, rotation: c.rotation || 0, tiltAngle: c.tiltAngle, azimuth: c.azimuth, depthOffset: c.depthOffset || 0,
        steps: c.steps ? JSON.parse(JSON.stringify(c.steps)) : undefined,
        ports: c.ports ? JSON.parse(JSON.stringify(c.ports)) : undefined
      }))
    }))
  },

  batchAdjustDepth: (projectId, cavityIds, deltaDepth) => {
    set(
      produce((state: DesignState) => {
        const p = state.projects[projectId]
        if (!p || cavityIds.length === 0) return
        const scheme = p.doc.schemes.find((s) => s.id === p.doc.activeSchemeId)
        if (!scheme) return
        pushHistory(p)
        for (const cid of cavityIds) {
          const cav = mutableHole(scheme, cid)
          if (!cav) continue
          if (cav.steps && cav.steps.length > 0) {
            const lastStep = cav.steps[cav.steps.length - 1]
            if (lastStep && lastStep.length != null) {
              lastStep.length = Math.max(1, Math.round((lastStep.length + deltaDepth) * 10) / 10)
            }
          } else {
            cav.depthOffset = Math.round((cav.depthOffset + deltaDepth) * 10) / 10
          }
        }
      })
    )
  },

  alignCavitiesCrossFace: (projectId, cavityIds, axis) => {
    set(produce((state: DesignState) => {
      const p = state.projects[projectId]
      if (!p) return
      const scheme = activeScheme(p.doc)
      const roots = selectedRoots(scheme, cavityIds)
      if (roots.length < 2) return
      pushHistory(p)
      const body = scheme.baseBody, index = axis === 'x' ? 0 : axis === 'y' ? 1 : 2
      const entries = roots.map(root => ({ root, basis: getBoxFaceBasis(root.faceId, body.dimensions, body) }))
      const worlds = entries.map(e => localToWorldPoint(e.basis, e.root.u, e.root.v, 0))
      const value = worlds.reduce((n,w) => n+w[index],0)/worlds.length
      entries.forEach((e,i) => { worlds[i][index] = value; const local = worldToLocalPoint(e.basis, worlds[i]); e.root.u = local.u; e.root.v = local.v })
    }))
  },

  connectTwoCavities: (projectId, cavityIdA, cavityIdB, options) => {
    set(
      produce((state: DesignState) => {
        const p = state.projects[projectId]
        if (!p) return
        const scheme = p.doc.schemes.find((s) => s.id === p.doc.activeSchemeId)
        if (!scheme) return
        const cavA = mutableHole(scheme, cavityIdA)
        const cavB = mutableHole(scheme, cavityIdB)
        if (!cavA || !cavB) return
        pushHistory(p)

        const overtravel = options.overtravel ?? 3
        if (options.mode === 'cross' || options.mode === 't-bottom') {
          if (cavA.steps && cavA.steps.length > 0) {
            const lastStepA = cavA.steps[cavA.steps.length - 1]
            if (lastStepA && lastStepA.length != null) {
              lastStepA.length = Math.round((lastStepA.length + overtravel) * 10) / 10
            }
          }
          if (cavB.steps && cavB.steps.length > 0) {
            const lastStepB = cavB.steps[cavB.steps.length - 1]
            if (lastStepB && lastStepB.length != null) {
              lastStepB.length = Math.round((lastStepB.length + overtravel) * 10) / 10
            }
          }
        }
      })
    )
  },

  applyMirror: (projectId, cavityIds, axis, copy) => {
    set(produce((state: DesignState) => {
      const p = state.projects[projectId]
      if (!p) return
      const scheme = activeScheme(p.doc)
      const roots = selectedRoots(scheme, cavityIds)
      if (!roots.length) return
      pushHistory(p)
      const results = roots.map(src => {
        const f = copy ? cloneFeature(src) : src
        if (axis === 'u-axis') { f.u = -f.u; f.rotation = 180-f.rotation } else { f.v = -f.v; f.rotation = -f.rotation }
        if (f.kind === 'compound') {
          f.outlineMirrored = !f.outlineMirrored
          f.children.forEach(c => { c.v = -c.v; c.rotation = -c.rotation; if(c.azimuth !== undefined) c.azimuth = -c.azimuth })
        }
        else if (f.azimuth !== undefined) f.azimuth = axis === 'u-axis' ? 180-f.azimuth : -f.azimuth
        return f
      })
      if (copy) scheme.cavities.push(...results)
      p.selected = results.length === 1 ? {type: results[0].kind === 'compound' ? 'compound' : 'cavity', id:results[0].instanceId} : { type: 'features', items: results.map(f => ({ type: f.kind === 'compound' ? 'compound' : 'cavity', id: f.instanceId })) }
    }))
  },

  applyLinearPattern: (projectId, sourceCavityIds, config) => {
    set(produce((state: DesignState) => {
      const p = state.projects[projectId]
      if (!p) return
      const scheme = activeScheme(p.doc)
      const roots = selectedRoots(scheme, sourceCavityIds)
      if (!roots.length) return
      pushHistory(p)
      const delta = (axis: string, spacing: number) => ({ u: axis === '+u' ? spacing : axis === '-u' ? -spacing : 0, v: axis === '+v' ? spacing : axis === '-v' ? -spacing : 0 })
      const d1 = delta(config.direction1.axis, config.direction1.spacing)
      const d2 = config.direction2?.enabled ? delta(config.direction2.axis, config.direction2.spacing) : { u: 0, v: 0 }
      const results: CavityFeature[] = []
      for (let i=0; i<config.direction1.count; i++) for(let j=0; j<(config.direction2?.enabled ? config.direction2.count : 1); j++) {
        if (!i && !j) continue
        for (const src of roots) { const f = cloneFeature(src); f.u += i*d1.u+j*d2.u; f.v += i*d1.v+j*d2.v; results.push(f) }
      }
      scheme.cavities.push(...results)
      p.selected = results.length === 1 ? {type: results[0].kind === 'compound' ? 'compound' : 'cavity', id:results[0].instanceId} : { type: 'features', items: results.map(f => ({ type: f.kind === 'compound' ? 'compound' : 'cavity', id: f.instanceId })) }
    }))
  },

  applyCircularPattern: (projectId, sourceCavityIds, config) => {
    set(produce((state: DesignState) => {
      const p = state.projects[projectId]
      if (!p) return
      const scheme = activeScheme(p.doc)
      const roots = selectedRoots(scheme, sourceCavityIds)
      if (!roots.length) return
      pushHistory(p)
      const results: CavityFeature[] = []
      const count = Math.max(2, config.count), angle = (config.mode === 'full' ? 360/count : (config.totalAngle ?? 360)/(count-1))
      for (let i=1; i<count; i++) for(const src of roots) {
        const f = cloneFeature(src), radians = i*angle*Math.PI/180, u=src.u-config.centerU, v=src.v-config.centerV
        f.u = config.centerU+u*Math.cos(radians)-v*Math.sin(radians); f.v = config.centerV+u*Math.sin(radians)+v*Math.cos(radians); f.rotation += i*angle
        if (f.kind === 'single' && f.azimuth !== undefined) f.azimuth += i*angle
        results.push(f)
      }
      scheme.cavities.push(...results)
      p.selected = results.length === 1 ? {type: results[0].kind === 'compound' ? 'compound' : 'cavity', id:results[0].instanceId} : { type: 'features', items: results.map(f => ({ type: f.kind === 'compound' ? 'compound' : 'cavity', id: f.instanceId })) }
    }))
  },

  undo: (projectId) => {
    set(
      produce((state: DesignState) => {
        const p = state.projects[projectId]
        if (!p || p.undoStack.length === 0) return
        const prev = p.undoStack.pop()!
        p.redoStack.push(JSON.parse(JSON.stringify(p.doc)))
        p.doc = prev
        p.dirty = true
      })
    )
  },

  redo: (projectId) => {
    set(
      produce((state: DesignState) => {
        const p = state.projects[projectId]
        if (!p || p.redoStack.length === 0) return
        const next = p.redoStack.pop()!
        p.undoStack.push(JSON.parse(JSON.stringify(p.doc)))
        p.doc = next
        p.dirty = true
      })
    )
  },

  setSectionConfig: (projectId, config) => {
    set(
      produce((state: DesignState) => {
        const p = state.projects[projectId]
        if (!p) return
        if (!p.sectionConfig) {
          p.sectionConfig = { enabled: true, axis: 'x', offset: 0, flipped: false }
        }
        Object.assign(p.sectionConfig, config)
      })
    )
  },

  toggleSection: (projectId) => {
    set(
      produce((state: DesignState) => {
        const p = state.projects[projectId]
        if (!p) return
        if (!p.sectionConfig) {
          p.sectionConfig = { enabled: true, axis: 'x', offset: 0, flipped: false }
        } else {
          p.sectionConfig.enabled = !p.sectionConfig.enabled
        }
      })
    )
  },

  setChannelColor: (projectId, bindingKey, color) => {
    set(
      produce((state: DesignState) => {
        const p = state.projects[projectId]
        if (!p) return
        const scheme = p.doc.schemes.find((s) => s.id === p.doc.activeSchemeId) || p.doc.schemes[0]
        if (!scheme) return
        pushHistory(p)
        if (!scheme.channelConfigs) scheme.channelConfigs = {}
        if (!scheme.channelConfigs[bindingKey]) {
          scheme.channelConfigs[bindingKey] = { bindingKey }
        }
        scheme.channelConfigs[bindingKey].customColor = color
      })
    )
  },

  renameChannel: (projectId, bindingKey, newName) => {
    set(
      produce((state: DesignState) => {
        const p = state.projects[projectId]
        if (!p) return
        const scheme = p.doc.schemes.find((s) => s.id === p.doc.activeSchemeId) || p.doc.schemes[0]
        if (!scheme) return
        pushHistory(p)
        if (!scheme.channelConfigs) scheme.channelConfigs = {}
        if (!scheme.channelConfigs[bindingKey]) {
          scheme.channelConfigs[bindingKey] = { bindingKey }
        }
        scheme.channelConfigs[bindingKey].customName = newName.trim()
      })
    )
  },

  toggleChannelHidden: (projectId, bindingKey) => {
    set(
      produce((state: DesignState) => {
        const p = state.projects[projectId]
        if (!p) return
        const scheme = p.doc.schemes.find((s) => s.id === p.doc.activeSchemeId) || p.doc.schemes[0]
        if (!scheme) return
        pushHistory(p)
        if (!scheme.channelConfigs) scheme.channelConfigs = {}
        if (!scheme.channelConfigs[bindingKey]) {
          scheme.channelConfigs[bindingKey] = { bindingKey }
        }
        scheme.channelConfigs[bindingKey].hidden = !scheme.channelConfigs[bindingKey].hidden
      })
    )
  },

  toggleChannelIsolated: (projectId, channelId) => {
    set(
      produce((state: DesignState) => {
        const p = state.projects[projectId]
        if (!p) return
        p.isolatedChannelId = p.isolatedChannelId === channelId ? null : channelId
      })
    )
  }
}))
