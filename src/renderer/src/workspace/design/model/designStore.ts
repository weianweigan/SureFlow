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
  type BaseBodyTemplate,
  type BaseFaceDefinition,
  type CavityInstance,
  type CavityGroup,
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

import { translateRigidSelection } from './selectionMath'
import { parseStepToThreeGeometry } from '../../tabs/viewer/stepLoader'

const UNDO_LIMIT = 50

export type FeatureSelectionItem = { type: 'cavity' | 'group'; id: string }

export type FeatureSelection =
  | { type: 'base'; id: 'base' }
  | { type: 'face'; id: string }
  | { type: 'cavity'; id: string; extraIds?: string[] }
  | { type: 'group'; id: string; extraIds?: string[] }
  | { type: 'features'; items: FeatureSelectionItem[] }
  | { type: 'scheme'; id: string }
  | { type: 'channel'; id: string; cavityIds: string[] }
  | { type: 'port'; cavityId: string; portIndex: number }
  | null

/** 获取当前选中的特征列表（统一抽象为孔腔特征：单孔或组合孔组） */
export function getSelectedFeatures(
  selection?: FeatureSelection
): Array<{ type: 'cavity' | 'group'; id: string }> {
  if (!selection) return []
  if (selection.type === 'cavity') {
    const list: Array<{ type: 'cavity' | 'group'; id: string }> = [{ type: 'cavity', id: selection.id }]
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
  if (selection.type === 'group') {
    const list: Array<{ type: 'cavity' | 'group'; id: string }> = [{ type: 'group', id: selection.id }]
    if (selection.extraIds) {
      for (const extra of selection.extraIds) {
        list.push({ type: 'group', id: extra })
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
export function getSelectedCavityIds(
  selection?: FeatureSelection,
  activeScheme?: { cavities: CavityInstance[]; groups?: CavityGroup[] }
): string[] {
  if (!selection) return []
  if (selection.type === 'port') {
    return [selection.cavityId]
  }
  const features = getSelectedFeatures(selection)
  if (features.length === 0) return []

  const cavityIdSet = new Set<string>()
  for (const f of features) {
    if (f.type === 'cavity') {
      cavityIdSet.add(f.id)
    } else if (f.type === 'group' && activeScheme?.groups) {
      const grp = activeScheme.groups.find((g) => g.id === f.id)
      if (grp) {
        for (const cid of grp.cavityIds) {
          cavityIdSet.add(cid)
        }
      }
      if (activeScheme.cavities) {
        for (const c of activeScheme.cavities) {
          if (c.groupId === f.id) {
            cavityIdSet.add(c.instanceId)
          }
        }
      }
    }
  }
  // 兼容直接选择 cavity 且无 activeScheme 传入时的旧逻辑
  if (cavityIdSet.size === 0 && selection.type === 'cavity') {
    return selection.extraIds && selection.extraIds.length > 0
      ? [selection.id, ...selection.extraIds]
      : [selection.id]
  }
  if (selection.type === 'channel') {
    return [...selection.cavityIds]
  }
  return Array.from(cavityIdSet)
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
}

export interface DesignState {
  projects: Record<string, DesignProjectSession>

  /** 初始化或激活工程 Tab 会话 */
  initProject: (
    projectId: string,
    initialDoc?: SfbProject,
    filePath?: string,
    initialCacheBuffer?: ArrayBuffer | null,
    initialGlbBuffer?: ArrayBuffer | null
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
  addCavities: (projectId: string, cavities: CavityInstance[], group?: CavityGroup) => void
  updateCavity: (projectId: string, instanceId: string, patch: Partial<CavityInstance>) => void
  updateCavityPosition: (projectId: string, instanceId: string, u: number, v: number, faceId?: string) => void
  updateCavityPositions: (
    projectId: string,
    updates: Array<{ id: string; u: number; v: number; faceId?: string }>
  ) => void
  duplicateCavity: (projectId: string, instanceId: string) => void
  deleteCavity: (projectId: string, instanceId: string) => void
  toggleCavitySuppressed: (projectId: string, instanceId: string) => void

  /** 成组管理 */
  createGroup: (projectId: string, name: string, cavityIds: string[], faceId?: string) => void
  createGroupFromSelection: (projectId: string, name?: string) => void
  moveRigidCavities: (projectId: string, ids: string[], du: number, dv: number) => void
  moveGroup: (projectId: string, groupId: string, deltaU: number, deltaV: number) => void
  rotateGroup: (projectId: string, groupId: string, deltaAngleDeg: number) => void
  rebindGroupFace: (projectId: string, groupId: string, newFaceId: string, mode: 'center' | 'project', targetOrigin?: { u: number; v: number }) => void
  disbandGroup: (projectId: string, groupId: string) => void
  deleteGroup: (projectId: string, groupId: string) => void
  toggleGroupSuppressed: (projectId: string, groupId: string) => void

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
  replaceGroup: (
    projectId: string,
    groupId: string,
    newGroupData: {
      name: string
      cavityType?: any
      cavities: Array<{
        templateId?: string
        name?: string
        depthOffset?: number
        steps?: any[]
        ports?: any[]
        cavityType?: any
        subHoleName?: string
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

  initProject: (projectId, initialDoc, filePath, initialCacheBuffer, initialGlbBuffer) => {
    set(
      produce((state: DesignState) => {
        if (!state.projects[projectId]) {
          const doc = initialDoc || createDefaultProject()
          state.projects[projectId] = {
            projectId,
            filePath,
            dirty: false,
            saving: false,
            doc,
            selected: { type: 'base', id: 'base' },
            undoStack: [],
            redoStack: [],
            initialCacheBuffer,
            initialGlbBuffer
          }
        }
      })
    )

    // 若当前工程为 step 基体，每次打开时需要从 stepContent 重建模型，并检测源文件是否存在
    const currentSession = get().projects[projectId]
    if (currentSession?.doc?.baseBody?.type === 'step') {
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
          p.doc.baseBody.type = 'template'
          p.doc.baseBody.template = template
          const newFaces = getFacesForTemplate(template, p.doc.baseBody.dimensions, p.doc.baseBody.extraParams)
          p.doc.baseBody.faces = newFaces

          // 悬空孔检测：遍历所有方案的孔腔，若 faceId 不在新模板面中则标记 dangling
          const validFaceIds = new Set(newFaces.map(f => f.id))
          for (const scheme of p.doc.schemes) {
            for (const cav of scheme.cavities) {
              if (!validFaceIds.has(cav.faceId)) {
                cav.dangling = true
              } else {
                // 如果之前是 dangling 现在面又存在了，恢复正常
                cav.dangling = false
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
          p.doc.baseBody.type = type
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
          p.doc.baseBody.type = 'step'
          p.doc.baseBody.stepContent = payload.stepContent
          p.doc.baseBody.stepFileName = payload.stepFileName
          if (payload.stepFilePath !== undefined) {
            p.doc.baseBody.stepFilePath = payload.stepFilePath
          }
          p.doc.baseBody.stepAssetRef = payload.stepAssetRef || payload.stepFilePath || payload.stepFileName
          p.doc.baseBody.dimensions = [...payload.dimensions]
          if (payload.faces && payload.faces.length > 0) {
            p.doc.baseBody.faces = payload.faces
          }
          if (payload.stepMesh) {
            p.doc.baseBody.stepMesh = payload.stepMesh
          }
          p.baseBodyError = null
        }
      })
    )
  },

  rebuildStepModel: async (projectId: string) => {
    const session = get().projects[projectId]
    if (!session || session.doc.baseBody.type !== 'step') return false

    const { baseBody } = session.doc
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
            if (p && p.doc.baseBody.type === 'step') {
              p.doc.baseBody.stepMesh = parsed.stepMesh
              if (parsed.dimensions) {
                p.doc.baseBody.dimensions = parsed.dimensions
              }
              if (parsed.faces && parsed.faces.length > 0 && (!p.doc.baseBody.faces || p.doc.baseBody.faces.length === 0)) {
                p.doc.baseBody.faces = parsed.faces
              }
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
          p.doc.baseBody.extraParams = {
            ...(p.doc.baseBody.extraParams || {}),
            ...params
          }
          if (p.doc.baseBody.type !== 'step') {
            p.doc.baseBody.faces = getFacesForTemplate(p.doc.baseBody.template, p.doc.baseBody.dimensions, p.doc.baseBody.extraParams)
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
          p.doc.baseBody.dimensions = [...dimensions]
          if (p.doc.baseBody.type !== 'step') {
            p.doc.baseBody.faces = getFacesForTemplate(p.doc.baseBody.template, dimensions, p.doc.baseBody.extraParams)
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

        const body = p.doc.baseBody
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
          for (const scheme of p.doc.schemes) {
            for (const cav of scheme.cavities) {
              if (cav.faceId === faceId) {
                cav.depthOffset = (cav.depthOffset || 0) + delta
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
          p.doc.baseBody.chamfer = chamfer
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
          p.doc.baseBody.materialConfig = { ...config }
          // 同步更新旧字段用于显示兼容
          const preset = MATERIAL_PRESETS[config.presetId]
          p.doc.baseBody.material = preset?.label || config.presetId
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
          if (!p.doc.baseBody.materialConfig) {
            const def = MATERIAL_PRESETS['45-steel']
            p.doc.baseBody.materialConfig = {
              presetId: def.presetId, color: def.color,
              metalness: def.metalness, roughness: def.roughness, opacity: def.opacity
            }
          }
          ;(p.doc.baseBody.materialConfig as any)[key] = value
          // 切换为自定义
          if (key !== 'presetId') {
            p.doc.baseBody.materialConfig.presetId = 'custom'
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
        const id = `scheme-${Date.now()}`
        p.doc.schemes.push({
          id,
          name: name || `方案 ${count}`,
          description: '',
          cavities: [],
          groups: []
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
        const id = `scheme-${Date.now()}`
        p.doc.schemes.push({
          ...JSON.parse(JSON.stringify(src)),
          id,
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
    set(
      produce((state: DesignState) => {
        const p = state.projects[projectId]
        if (p && p.doc.schemes.some((s) => s.id === schemeId)) {
          p.doc.activeSchemeId = schemeId
          p.selected = { type: 'scheme', id: schemeId }
        }
      })
    )
  },

  addCavity: (projectId, cavity) => {
    set(
      produce((state: DesignState) => {
        const p = state.projects[projectId]
        if (!p) return
        const scheme = p.doc.schemes.find((s) => s.id === p.doc.activeSchemeId)
        if (!scheme) return
        pushHistory(p)
        scheme.cavities.push(cavity)
        p.selected = { type: 'cavity', id: cavity.instanceId }
      })
    )
  },

  addCavities: (projectId, cavities, group) => {
    set(
      produce((state: DesignState) => {
        const p = state.projects[projectId]
        if (!p || cavities.length === 0) return
        const scheme = p.doc.schemes.find((s) => s.id === p.doc.activeSchemeId)
        if (!scheme) return
        pushHistory(p)
        scheme.cavities.push(...cavities)
        if (group) {
          if (!scheme.groups) scheme.groups = []
          scheme.groups.push(group)
        }
        const grp = group || (cavities[0].groupId ? scheme.groups?.find((g) => g.id === cavities[0].groupId) : undefined)
        p.selected = grp
          ? { type: 'group', id: grp.id }
          : { type: 'cavity', id: cavities[0].instanceId }
      })
    )
  },

  updateCavity: (projectId, instanceId, patch) => {
    set(
      produce((state: DesignState) => {
        const p = state.projects[projectId]
        if (!p) return
        const scheme = p.doc.schemes.find((s) => s.id === p.doc.activeSchemeId)
        if (!scheme) return
        const cav = scheme.cavities.find((c) => c.instanceId === instanceId)
        if (!cav) return
        pushHistory(p)
        Object.assign(cav, patch)
      })
    )
  },

  updateCavityPosition: (projectId, instanceId, u, v, faceId) => {
    set(
      produce((state: DesignState) => {
        const p = state.projects[projectId]
        if (!p) return
        const scheme = p.doc.schemes.find((s) => s.id === p.doc.activeSchemeId)
        if (!scheme) return
        const cav = scheme.cavities.find((c) => c.instanceId === instanceId)
        if (!cav) return
        pushHistory(p)
        cav.u = u
        cav.v = v
        if (faceId) cav.faceId = faceId
      })
    )
  },

  updateCavityPositions: (projectId, updates) => {
    set(
      produce((state: DesignState) => {
        const p = state.projects[projectId]
        if (!p || updates.length === 0) return
        const scheme = p.doc.schemes.find((s) => s.id === p.doc.activeSchemeId)
        if (!scheme) return
        pushHistory(p)
        for (const up of updates) {
          const cav = scheme.cavities.find((c) => c.instanceId === up.id)
          if (cav) {
            cav.u = up.u
            cav.v = up.v
            if (up.faceId) cav.faceId = up.faceId
          }
        }
      })
    )
  },

  duplicateCavity: (projectId, instanceId) => {
    set(
      produce((state: DesignState) => {
        const p = state.projects[projectId]
        if (!p) return
        const scheme = p.doc.schemes.find((s) => s.id === p.doc.activeSchemeId)
        if (!scheme) return
        const src = scheme.cavities.find((c) => c.instanceId === instanceId)
        if (!src) return
        pushHistory(p)
        const newId = `cav-${Date.now()}-${Math.floor(Math.random() * 1000)}`
        const clone: CavityInstance = {
          ...JSON.parse(JSON.stringify(src)),
          instanceId: newId,
          name: `${src.name} - 副本`,
          u: src.u + 10,
          v: src.v + 10
        }
        scheme.cavities.push(clone)
        p.selected = { type: 'cavity', id: newId }
      })
    )
  },

  deleteCavity: (projectId, instanceId) => {
    set(
      produce((state: DesignState) => {
        const p = state.projects[projectId]
        if (!p) return
        const scheme = p.doc.schemes.find((s) => s.id === p.doc.activeSchemeId)
        if (!scheme) return
        pushHistory(p)
        scheme.cavities = scheme.cavities.filter((c) => c.instanceId !== instanceId)
        // 清理 group 引用
        if (scheme.groups) {
          for (const g of scheme.groups) {
            g.cavityIds = g.cavityIds.filter((id) => id !== instanceId)
          }
        }
        const isSelected =
          p.selected &&
          ('id' in p.selected
            ? p.selected.id === instanceId
            : p.selected.type === 'features' && p.selected.items.some((it) => it.id === instanceId))
        if (isSelected) {
          p.selected = { type: 'base', id: 'base' }
        }
      })
    )
  },

  toggleCavitySuppressed: (projectId, instanceId) => {
    set(
      produce((state: DesignState) => {
        const p = state.projects[projectId]
        if (!p) return
        const scheme = p.doc.schemes.find((s) => s.id === p.doc.activeSchemeId)
        if (!scheme) return
        const cav = scheme.cavities.find((c) => c.instanceId === instanceId)
        if (!cav) return
        pushHistory(p)
        cav.suppressed = !cav.suppressed
      })
    )
  },

  createGroup: (projectId, name, cavityIds, faceId) => {
    set(
      produce((state: DesignState) => {
        const p = state.projects[projectId]
        if (!p) return
        const scheme = p.doc.schemes.find((s) => s.id === p.doc.activeSchemeId)
        if (!scheme) return
        pushHistory(p)
        if (!scheme.groups) scheme.groups = []
        const grpId = `grp-${Date.now()}`
        const memberCavities = scheme.cavities.filter((c) => cavityIds.includes(c.instanceId))
        const avgU = memberCavities.length > 0 ? memberCavities.reduce((acc, c) => acc + c.u, 0) / memberCavities.length : 0
        const avgV = memberCavities.length > 0 ? memberCavities.reduce((acc, c) => acc + c.v, 0) / memberCavities.length : 0
        const grp: CavityGroup = {
          id: grpId,
          name,
          faceId,
          cavityIds,
          u: Math.round(avgU * 10) / 10,
          v: Math.round(avgV * 10) / 10,
          rotation: 0
        }
        for (const c of scheme.cavities) {
          if (cavityIds.includes(c.instanceId)) {
            c.groupId = grpId
          }
        }
        scheme.groups.push(grp)
        p.selected = { type: 'group', id: grp.id }
      })
    )
  },

  createGroupFromSelection: (projectId, name) => {
    set(
      produce((state: DesignState) => {
        const p = state.projects[projectId]
        if (!p) return
        const cavityIds = getSelectedCavityIds(p.selected)
        if (cavityIds.length < 2) return
        const scheme = p.doc.schemes.find((s) => s.id === p.doc.activeSchemeId)
        if (!scheme) return
        pushHistory(p)
        if (!scheme.groups) scheme.groups = []

        const memberCavities = scheme.cavities.filter((c) => cavityIds.includes(c.instanceId))
        const firstFace = memberCavities[0]?.faceId
        const allSameFace = memberCavities.every((c) => c.faceId === firstFace)

        const grpId = `grp-${Date.now()}`
        const grpName = name || `孔组 ${(scheme.groups?.length || 0) + 1}`
        const avgU = memberCavities.length > 0 ? memberCavities.reduce((acc, c) => acc + c.u, 0) / memberCavities.length : 0
        const avgV = memberCavities.length > 0 ? memberCavities.reduce((acc, c) => acc + c.v, 0) / memberCavities.length : 0
        const grp: CavityGroup = {
          id: grpId,
          name: grpName,
          faceId: allSameFace ? firstFace : undefined,
          cavityIds,
          u: Math.round(avgU * 10) / 10,
          v: Math.round(avgV * 10) / 10,
          rotation: 0
        }
        for (const c of memberCavities) {
          c.groupId = grpId
        }
        scheme.groups.push(grp)
        p.selected = { type: 'group', id: grpId }
      })
    )
  },

  moveRigidCavities: (projectId, ids, du, dv) => {
    if (!ids.length || (!du && !dv) || !Number.isFinite(du) || !Number.isFinite(dv)) return
    set(produce((state: DesignState) => {
      const p = state.projects[projectId]
      const scheme = p?.doc.schemes.find(s => s.id === p.doc.activeSchemeId)
      if (!p || !scheme) return
      pushHistory(p)
      translateRigidSelection(scheme, ids, du, dv)
    }))
  },

  moveGroup: (projectId, groupId, deltaU, deltaV) => {
    set(
      produce((state: DesignState) => {
        const p = state.projects[projectId]
        if (!p) return
        const scheme = p.doc.schemes.find((s) => s.id === p.doc.activeSchemeId)
        if (!scheme || !scheme.groups) return
        const grp = scheme.groups.find((g) => g.id === groupId)
        if (!grp) return
        pushHistory(p)
        const members = scheme.cavities.filter(c => grp.cavityIds.includes(c.instanceId) || c.groupId === groupId)
        translateRigidSelection(scheme, members.map(c => c.instanceId), deltaU, deltaV)
      })
    )
  },

  rotateGroup: (projectId, groupId, deltaAngleDeg) => {
    set(
      produce((state: DesignState) => {
        const p = state.projects[projectId]
        if (!p) return
        const scheme = p.doc.schemes.find((s) => s.id === p.doc.activeSchemeId)
        if (!scheme || !scheme.groups) return
        const grp = scheme.groups.find((g) => g.id === groupId)
        if (!grp) return
        const memberIds = new Set(grp.cavityIds)
        const members = scheme.cavities.filter((c) => memberIds.has(c.instanceId) || c.groupId === groupId)
        if (members.length === 0) return

        pushHistory(p)
        // 关键：严格针对多孔特征本身的定位原点进行刚性同心旋转，与二维视口 X/Y 坐标系保持绝对同向
        const centerU = grp.u != null ? grp.u : (members.reduce((acc, c) => acc + c.u, 0) / members.length)
        const centerV = grp.v != null ? grp.v : (members.reduce((acc, c) => acc + c.v, 0) / members.length)
        grp.u = centerU
        grp.v = centerV
        grp.rotation = (((Math.round((grp.rotation || 0) + deltaAngleDeg) % 360) + 360) % 360)

        const rad = (deltaAngleDeg * Math.PI) / 180
        const cosA = Math.cos(rad)
        const sinA = Math.sin(rad)

        for (const c of members) {
          const du = c.u - centerU
          const dv = c.v - centerV
          // 刚性跟随基底旋转 (从 +X 轴向 +Y 轴正角旋转)
          const newDu = du * cosA - dv * sinA
          const newDv = du * sinA + dv * cosA
          c.u = Math.round((centerU + newDu) * 10) / 10
          c.v = Math.round((centerV + newDv) * 10) / 10
          c.rotation = (((Math.round((c.rotation || 0) + deltaAngleDeg) % 360) + 360) % 360)
        }
      })
    )
  },

  rebindGroupFace: (projectId, groupId, newFaceId, mode, targetOrigin) => {
    if (targetOrigin && !Number.isFinite(targetOrigin.u + targetOrigin.v)) return
    set(
      produce((state: DesignState) => {
        const p = state.projects[projectId]
        if (!p) return
        const scheme = p.doc.schemes.find((s) => s.id === p.doc.activeSchemeId)
        if (!scheme || !scheme.groups) return
        const grp = scheme.groups.find((g) => g.id === groupId)
        if (!grp || grp.faceId === newFaceId) return
        const memberIds = new Set(grp.cavityIds)
        const members = scheme.cavities.filter((c) => memberIds.has(c.instanceId) || c.groupId === groupId)
        if (members.length === 0) return

        pushHistory(p)
        const oldFaceId = grp.faceId || members[0].faceId
        const centerU = grp.u ?? (members.reduce((acc, c) => acc + c.u, 0) / members.length)
        const centerV = grp.v ?? (members.reduce((acc, c) => acc + c.v, 0) / members.length)

        let targetCenterU = 0
        let targetCenterV = 0

        if (mode === 'project') {
          const dims = p.doc.baseBody.dimensions
          const oldBasis = getBoxFaceBasis(oldFaceId, dims, p.doc.baseBody)
          const worldCenter = localToWorldPoint(oldBasis, centerU, centerV, 0)
          const newBasis = getBoxFaceBasis(newFaceId, dims, p.doc.baseBody)
          const newLocal = worldToLocalPoint(newBasis, worldCenter)
          targetCenterU = Math.round(newLocal.u * 10) / 10
          targetCenterV = Math.round(newLocal.v * 10) / 10
        }

        if (targetOrigin) {
          targetCenterU=targetOrigin.u
          targetCenterV=targetOrigin.v
        }
        const deltaU = targetCenterU - centerU
        const deltaV = targetCenterV - centerV

        grp.faceId = newFaceId
        grp.u = targetCenterU
        grp.v = targetCenterV

        for (const c of members) {
          c.faceId = newFaceId
          c.u = c.u + deltaU
          c.v = c.v + deltaV
        }
      })
    )
  },

  disbandGroup: (projectId, groupId) => {
    set(
      produce((state: DesignState) => {
        const p = state.projects[projectId]
        if (!p) return
        const scheme = p.doc.schemes.find((s) => s.id === p.doc.activeSchemeId)
        if (!scheme || !scheme.groups) return
        pushHistory(p)
        scheme.groups = scheme.groups.filter((g) => g.id !== groupId)
        for (const c of scheme.cavities) {
          if (c.groupId === groupId) {
            c.groupId = undefined
          }
        }
        const isDisbandSelected =
          p.selected &&
          ('id' in p.selected
            ? p.selected.id === groupId
            : p.selected.type === 'features' && p.selected.items.some((it) => it.id === groupId))
        if (isDisbandSelected) {
          p.selected = { type: 'base', id: 'base' }
        }
      })
    )
  },

  deleteGroup: (projectId, groupId) => {
    set(
      produce((state: DesignState) => {
        const p = state.projects[projectId]
        if (!p) return
        const scheme = p.doc.schemes.find((s) => s.id === p.doc.activeSchemeId)
        if (!scheme || !scheme.groups) return
        const targetGroup = scheme.groups.find((g) => g.id === groupId)
        if (!targetGroup) return
        pushHistory(p)
        const memberIds = new Set(targetGroup.cavityIds)
        // 删除该组包含的所有子孔腔
        scheme.cavities = scheme.cavities.filter((c) => !memberIds.has(c.instanceId) && c.groupId !== groupId)
        // 移除该组
        scheme.groups = scheme.groups.filter((g) => g.id !== groupId)

        const isDeleteSelected =
          p.selected &&
          (('id' in p.selected && (p.selected.id === groupId || memberIds.has(p.selected.id))) ||
            (p.selected.type === 'features' &&
              p.selected.items.some((it) => it.id === groupId || memberIds.has(it.id))))
        if (isDeleteSelected) {
          p.selected = { type: 'base', id: 'base' }
        }
      })
    )
  },

  toggleGroupSuppressed: (projectId, groupId) => {
    set(
      produce((state: DesignState) => {
        const p = state.projects[projectId]
        if (!p) return
        const scheme = p.doc.schemes.find((s) => s.id === p.doc.activeSchemeId)
        if (!scheme || !scheme.groups) return
        const targetGroup = scheme.groups.find((g) => g.id === groupId)
        if (!targetGroup) return
        const memberIds = new Set(targetGroup.cavityIds)
        const memberCavities = scheme.cavities.filter((c) => memberIds.has(c.instanceId) || c.groupId === groupId)
        if (memberCavities.length === 0) return
        pushHistory(p)
        // 若有任意一个未抑制，则全部抑制；若已全部抑制，则全部恢复
        const anyActive = memberCavities.some((c) => !c.suppressed)
        for (const c of memberCavities) {
          c.suppressed = anyActive
        }
      })
    )
  },

  rebindCavityFace: (projectId, cavityId, newFaceId, mode) => {
    set(
      produce((state: DesignState) => {
        const p = state.projects[projectId]
        if (!p) return
        const scheme = p.doc.schemes.find((s) => s.id === p.doc.activeSchemeId)
        if (!scheme) return
        const cav = scheme.cavities.find((c) => c.instanceId === cavityId)
        if (!cav || cav.faceId === newFaceId) return
        pushHistory(p)
        if (mode === 'center') {
          cav.faceId = newFaceId
          cav.u = 0
          cav.v = 0
        } else {
          const dims = p.doc.baseBody.dimensions
          const oldBasis = getBoxFaceBasis(cav.faceId, dims)
          const worldPoint = localToWorldPoint(oldBasis, cav.u, cav.v, 0)
          const newBasis = getBoxFaceBasis(newFaceId, dims)
          const newLocal = worldToLocalPoint(newBasis, worldPoint)
          cav.faceId = newFaceId
          cav.u = Math.round(newLocal.u * 10) / 10
          cav.v = Math.round(newLocal.v * 10) / 10
        }
      })
    )
  },

  applyAlignment: (projectId, cavityIds, type) => {
    set(
      produce((state: DesignState) => {
        const p = state.projects[projectId]
        if (!p || cavityIds.length < 2) return
        const scheme = p.doc.schemes.find((s) => s.id === p.doc.activeSchemeId)
        if (!scheme) return

        interface FeatureUnit {
          id: string
          type: 'group' | 'cavity'
          faceId: string
          u: number
          v: number
          cavities: CavityInstance[]
          group?: CavityGroup
        }

        const units: FeatureUnit[] = []
        const visitedGroupIds = new Set<string>()
        const visitedCavityIds = new Set<string>()

        for (const cid of cavityIds) {
          if (visitedCavityIds.has(cid)) continue
          const cav = scheme.cavities.find((c) => c.instanceId === cid)
          if (!cav) continue

          const grp = scheme.groups?.find((g) => g.id === cav.groupId || g.cavityIds.includes(cid))
          if (grp) {
            if (!visitedGroupIds.has(grp.id)) {
              visitedGroupIds.add(grp.id)
              const memberCavs = scheme.cavities.filter((c) => c.groupId === grp.id || grp.cavityIds.includes(c.instanceId))
              for (const mc of memberCavs) visitedCavityIds.add(mc.instanceId)
              const meanU = grp.u ?? (memberCavs.reduce((s, c) => s + c.u, 0) / memberCavs.length)
              const meanV = grp.v ?? (memberCavs.reduce((s, c) => s + c.v, 0) / memberCavs.length)
              units.push({
                id: grp.id,
                type: 'group',
                faceId: grp.faceId || memberCavs[0]?.faceId,
                u: meanU,
                v: meanV,
                cavities: memberCavs,
                group: grp
              })
            }
          } else {
            visitedCavityIds.add(cav.instanceId)
            units.push({
              id: cav.instanceId,
              type: 'cavity',
              faceId: cav.faceId,
              u: cav.u,
              v: cav.v,
              cavities: [cav]
            })
          }
        }

        if (units.length < 2) return
        pushHistory(p)

        const faceGroups = new Map<string, FeatureUnit[]>()
        for (const u of units) {
          const list = faceGroups.get(u.faceId) || []
          list.push(u)
          faceGroups.set(u.faceId, list)
        }

        for (const [, groupUnits] of faceGroups) {
          if (groupUnits.length < 2) continue
          let targetU = 0
          let targetV = 0
          switch (type) {
            case 'left':
              targetU = Math.min(...groupUnits.map((u) => u.u))
              for (const u of groupUnits) {
                const du = targetU - u.u
                for (const c of u.cavities) c.u = Math.round((c.u + du) * 10) / 10
                if (u.group && u.group.u != null) u.group.u = Math.round((u.group.u + du) * 10) / 10
              }
              break
            case 'right':
              targetU = Math.max(...groupUnits.map((u) => u.u))
              for (const u of groupUnits) {
                const du = targetU - u.u
                for (const c of u.cavities) c.u = Math.round((c.u + du) * 10) / 10
                if (u.group && u.group.u != null) u.group.u = Math.round((u.group.u + du) * 10) / 10
              }
              break
            case 'center-x': {
              const meanU = groupUnits.reduce((acc, u) => acc + u.u, 0) / groupUnits.length
              for (const u of groupUnits) {
                const du = meanU - u.u
                for (const c of u.cavities) c.u = Math.round((c.u + du) * 10) / 10
                if (u.group && u.group.u != null) u.group.u = Math.round((u.group.u + du) * 10) / 10
              }
              break
            }
            case 'bottom':
              targetV = Math.min(...groupUnits.map((u) => u.v))
              for (const u of groupUnits) {
                const dv = targetV - u.v
                for (const c of u.cavities) c.v = Math.round((c.v + dv) * 10) / 10
                if (u.group && u.group.v != null) u.group.v = Math.round((u.group.v + dv) * 10) / 10
              }
              break
            case 'top':
              targetV = Math.max(...groupUnits.map((u) => u.v))
              for (const u of groupUnits) {
                const dv = targetV - u.v
                for (const c of u.cavities) c.v = Math.round((c.v + dv) * 10) / 10
                if (u.group && u.group.v != null) u.group.v = Math.round((u.group.v + dv) * 10) / 10
              }
              break
            case 'center-y': {
              const meanV = groupUnits.reduce((acc, u) => acc + u.v, 0) / groupUnits.length
              for (const u of groupUnits) {
                const dv = meanV - u.v
                for (const c of u.cavities) c.v = Math.round((c.v + dv) * 10) / 10
                if (u.group && u.group.v != null) u.group.v = Math.round((u.group.v + dv) * 10) / 10
              }
              break
            }
          }
        }
      })
    )
  },

  applyDistribution: (projectId, cavityIds, axis) => {
    set(
      produce((state: DesignState) => {
        const p = state.projects[projectId]
        if (!p || cavityIds.length < 3) return
        const scheme = p.doc.schemes.find((s) => s.id === p.doc.activeSchemeId)
        if (!scheme) return

        interface FeatureUnit {
          id: string
          type: 'group' | 'cavity'
          faceId: string
          u: number
          v: number
          cavities: CavityInstance[]
          group?: CavityGroup
        }

        const units: FeatureUnit[] = []
        const visitedGroupIds = new Set<string>()
        const visitedCavityIds = new Set<string>()

        for (const cid of cavityIds) {
          if (visitedCavityIds.has(cid)) continue
          const cav = scheme.cavities.find((c) => c.instanceId === cid)
          if (!cav) continue

          const grp = scheme.groups?.find((g) => g.id === cav.groupId || g.cavityIds.includes(cid))
          if (grp) {
            if (!visitedGroupIds.has(grp.id)) {
              visitedGroupIds.add(grp.id)
              const memberCavs = scheme.cavities.filter((c) => c.groupId === grp.id || grp.cavityIds.includes(c.instanceId))
              for (const mc of memberCavs) visitedCavityIds.add(mc.instanceId)
              const meanU = grp.u ?? (memberCavs.reduce((s, c) => s + c.u, 0) / memberCavs.length)
              const meanV = grp.v ?? (memberCavs.reduce((s, c) => s + c.v, 0) / memberCavs.length)
              units.push({
                id: grp.id,
                type: 'group',
                faceId: grp.faceId || memberCavs[0]?.faceId,
                u: meanU,
                v: meanV,
                cavities: memberCavs,
                group: grp
              })
            }
          } else {
            visitedCavityIds.add(cav.instanceId)
            units.push({
              id: cav.instanceId,
              type: 'cavity',
              faceId: cav.faceId,
              u: cav.u,
              v: cav.v,
              cavities: [cav]
            })
          }
        }

        if (units.length < 3) return
        pushHistory(p)

        const faceGroups = new Map<string, FeatureUnit[]>()
        for (const u of units) {
          const list = faceGroups.get(u.faceId) || []
          list.push(u)
          faceGroups.set(u.faceId, list)
        }

        for (const [, groupUnits] of faceGroups) {
          if (groupUnits.length < 3) continue
          if (axis === 'horizontal') {
            groupUnits.sort((a, b) => a.u - b.u)
            const minU = groupUnits[0].u
            const maxU = groupUnits[groupUnits.length - 1].u
            const step = (maxU - minU) / (groupUnits.length - 1)
            for (let i = 1; i < groupUnits.length - 1; i++) {
              const targetU = Math.round((minU + i * step) * 10) / 10
              const du = targetU - groupUnits[i].u
              for (const c of groupUnits[i].cavities) c.u = Math.round((c.u + du) * 10) / 10
              const grp = groupUnits[i].group
              if (grp && grp.u != null) {
                grp.u = Math.round((grp.u + du) * 10) / 10
              }
            }
          } else {
            groupUnits.sort((a, b) => a.v - b.v)
            const minV = groupUnits[0].v
            const maxV = groupUnits[groupUnits.length - 1].v
            const step = (maxV - minV) / (groupUnits.length - 1)
            for (let i = 1; i < groupUnits.length - 1; i++) {
              const targetV = Math.round((minV + i * step) * 10) / 10
              const dv = targetV - groupUnits[i].v
              for (const c of groupUnits[i].cavities) c.v = Math.round((c.v + dv) * 10) / 10
              const grp = groupUnits[i].group
              if (grp && grp.v != null) {
                grp.v = Math.round((grp.v + dv) * 10) / 10
              }
            }
          }
        }
      })
    )
  },

  replaceCavity: (projectId, instanceId, newTemplate) => {
    set(
      produce((state: DesignState) => {
        const p = state.projects[projectId]
        if (!p) return
        const scheme = p.doc.schemes.find((s) => s.id === p.doc.activeSchemeId)
        if (!scheme) return
        const cav = scheme.cavities.find((c) => c.instanceId === instanceId)
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

  replaceGroup: (projectId, groupId, newGroupData) => {
    set(
      produce((state: DesignState) => {
        const p = state.projects[projectId]
        if (!p) return
        const scheme = p.doc.schemes.find((s) => s.id === p.doc.activeSchemeId)
        if (!scheme || !scheme.groups) return
        const group = scheme.groups.find((g) => g.id === groupId)
        if (!group) return
        pushHistory(p)
        // 移除原有的子孔
        const oldCavityIds = new Set(group.cavityIds)
        scheme.cavities = scheme.cavities.filter((c) => !oldCavityIds.has(c.instanceId) && c.groupId !== groupId)

        // 创建新子孔
        const centerU = group.u ?? 0
        const centerV = group.v ?? 0
        const faceId = group.faceId || 'F1'
        const newIds: string[] = []

        newGroupData.cavities.forEach((nc, idx) => {
          const newId = `cav-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 6)}`
          newIds.push(newId)
          scheme.cavities.push({
            instanceId: newId,
            libraryId: 'std',
            templateId: nc.templateId || `t-${idx}`,
            name: nc.name || `${newGroupData.name}_${nc.subHoleName || idx + 1}`,
            cavityType: nc.cavityType,
            subHoleName: nc.subHoleName,
            steps: nc.steps ? JSON.parse(JSON.stringify(nc.steps)) : undefined,
            ports: nc.ports ? JSON.parse(JSON.stringify(nc.ports)) : undefined,
            groupId,
            faceId,
            u: Math.round((centerU + (nc.offsetU || 0)) * 10) / 10,
            v: Math.round((centerV + (nc.offsetV || 0)) * 10) / 10,
            rotation: group.rotation || 0,
            depthOffset: nc.depthOffset || 0
          })
        })

        group.name = newGroupData.name
        if (newGroupData.cavityType) group.cavityType = newGroupData.cavityType
        group.cavityIds = newIds
      })
    )
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
          const cav = scheme.cavities.find((c) => c.instanceId === cid)
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
    set(
      produce((state: DesignState) => {
        const p = state.projects[projectId]
        if (!p || cavityIds.length < 2) return
        const scheme = p.doc.schemes.find((s) => s.id === p.doc.activeSchemeId)
        if (!scheme) return
        const dims = p.doc.baseBody.dimensions

        const cavInfos = cavityIds.map((cid) => {
          const c = scheme.cavities.find((item) => item.instanceId === cid)
          if (!c) return null
          const basis = getBoxFaceBasis(c.faceId, dims)
          const world = localToWorldPoint(basis, c.u, c.v, 0)
          return { cavity: c, basis, world }
        }).filter(Boolean) as Array<{ cavity: CavityInstance; basis: any; world: [number, number, number] }>

        if (cavInfos.length < 2) return
        pushHistory(p)

        const axisIdx = axis === 'x' ? 0 : axis === 'y' ? 1 : 2
        const targetCoord = cavInfos[0].world[axisIdx]

        for (let i = 1; i < cavInfos.length; i++) {
          const { cavity, basis, world } = cavInfos[i]
          const newWorld: [number, number, number] = [...world]
          newWorld[axisIdx] = targetCoord
          const newLocal = worldToLocalPoint(basis, newWorld)
          cavity.u = Math.round(newLocal.u * 10) / 10
          cavity.v = Math.round(newLocal.v * 10) / 10
        }
      })
    )
  },

  connectTwoCavities: (projectId, cavityIdA, cavityIdB, options) => {
    set(
      produce((state: DesignState) => {
        const p = state.projects[projectId]
        if (!p) return
        const scheme = p.doc.schemes.find((s) => s.id === p.doc.activeSchemeId)
        if (!scheme) return
        const cavA = scheme.cavities.find((c) => c.instanceId === cavityIdA)
        const cavB = scheme.cavities.find((c) => c.instanceId === cavityIdB)
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
    set(
      produce((state: DesignState) => {
        const p = state.projects[projectId]
        if (!p || cavityIds.length === 0) return
        const scheme = p.doc.schemes.find((s) => s.id === p.doc.activeSchemeId)
        if (!scheme) return
        const cavs = scheme.cavities.filter((c) => cavityIds.includes(c.instanceId))
        if (cavs.length === 0) return
        pushHistory(p)

        const newCavities: CavityInstance[] = []
        for (const src of cavs) {
          const targetU = axis === 'u-axis' ? -src.u : src.u
          const targetV = axis === 'v-axis' ? -src.v : src.v

          if (copy) {
            const newId = `cav-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
            const clone: CavityInstance = {
              ...JSON.parse(JSON.stringify(src)),
              instanceId: newId,
              name: `${src.name}_镜像`,
              u: Math.round(targetU * 10) / 10,
              v: Math.round(targetV * 10) / 10,
              groupId: undefined
            }
            newCavities.push(clone)
          } else {
            src.u = Math.round(targetU * 10) / 10
            src.v = Math.round(targetV * 10) / 10
          }
        }

        if (copy && newCavities.length > 0) {
          scheme.cavities.push(...newCavities)
          p.selected = {
            type: 'cavity',
            id: newCavities[0].instanceId,
            extraIds: newCavities.slice(1).map((c) => c.instanceId)
          }
        }
      })
    )
  },

  applyLinearPattern: (projectId, sourceCavityIds, config) => {
    set(
      produce((state: DesignState) => {
        const p = state.projects[projectId]
        if (!p || sourceCavityIds.length === 0) return
        const scheme = p.doc.schemes.find((s) => s.id === p.doc.activeSchemeId)
        if (!scheme) return
        const cavs = scheme.cavities.filter((c) => sourceCavityIds.includes(c.instanceId))
        if (cavs.length === 0) return

        const getDelta = (axis: '+u' | '-u' | '+v' | '-v', spacing: number) => {
          switch (axis) {
            case '+u': return { du: spacing, dv: 0 }
            case '-u': return { du: -spacing, dv: 0 }
            case '+v': return { du: 0, dv: spacing }
            case '-v': return { du: 0, dv: -spacing }
          }
        }

        const d1 = getDelta(config.direction1.axis, config.direction1.spacing)
        const count1 = Math.max(1, config.direction1.count)

        const count2 = config.direction2?.enabled ? Math.max(1, config.direction2.count) : 1
        const d2 = config.direction2?.enabled
          ? getDelta(config.direction2.axis, config.direction2.spacing)
          : { du: 0, dv: 0 }

        pushHistory(p)
        const newCavities: CavityInstance[] = []

        for (const src of cavs) {
          for (let i1 = 0; i1 < count1; i1++) {
            for (let i2 = 0; i2 < count2; i2++) {
              if (i1 === 0 && i2 === 0) continue
              const newId = `cav-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
              const nu = src.u + i1 * d1.du + i2 * d2.du
              const nv = src.v + i1 * d1.dv + i2 * d2.dv
              const suffix = count2 > 1 ? `_L_${i1 + 1}_${i2 + 1}` : `_L_${i1 + 1}`
              const clone: CavityInstance = {
                ...JSON.parse(JSON.stringify(src)),
                instanceId: newId,
                name: `${src.name}${suffix}`,
                u: Math.round(nu * 10) / 10,
                v: Math.round(nv * 10) / 10,
                groupId: undefined
              }
              newCavities.push(clone)
            }
          }
        }

        if (newCavities.length > 0) {
          scheme.cavities.push(...newCavities)
          p.selected = {
            type: 'cavity',
            id: newCavities[0].instanceId,
            extraIds: newCavities.slice(1).map((c) => c.instanceId)
          }
        }
      })
    )
  },

  applyCircularPattern: (projectId, sourceCavityIds, config) => {
    set(
      produce((state: DesignState) => {
        const p = state.projects[projectId]
        if (!p || sourceCavityIds.length === 0) return
        const scheme = p.doc.schemes.find((s) => s.id === p.doc.activeSchemeId)
        if (!scheme) return
        const cavs = scheme.cavities.filter((c) => sourceCavityIds.includes(c.instanceId))
        if (cavs.length === 0) return

        const count = Math.max(2, config.count)
        const totalAngle = config.mode === 'full' ? 360 : (config.totalAngle ?? 360)
        const stepAngleDeg = config.mode === 'full' ? 360 / count : totalAngle / (count - 1)
        const stepAngleRad = (stepAngleDeg * Math.PI) / 180

        pushHistory(p)
        const newCavities: CavityInstance[] = []

        for (const src of cavs) {
          const relU = src.u - config.centerU
          const relV = src.v - config.centerV
          const baseAngle = Math.atan2(relV, relU)
          const radius = Math.sqrt(relU * relU + relV * relV)

          for (let i = 1; i < count; i++) {
            const angle = baseAngle + i * stepAngleRad
            const nu = config.centerU + radius * Math.cos(angle)
            const nv = config.centerV + radius * Math.sin(angle)
            const newId = `cav-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
            const clone: CavityInstance = {
              ...JSON.parse(JSON.stringify(src)),
              instanceId: newId,
              name: `${src.name}_C_${i + 1}`,
              u: Math.round(nu * 10) / 10,
              v: Math.round(nv * 10) / 10,
              groupId: undefined
            }
            newCavities.push(clone)
          }
        }

        if (newCavities.length > 0) {
          scheme.cavities.push(...newCavities)
          p.selected = {
            type: 'cavity',
            id: newCavities[0].instanceId,
            extraIds: newCavities.slice(1).map((c) => c.instanceId)
          }
        }
      })
    )
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
