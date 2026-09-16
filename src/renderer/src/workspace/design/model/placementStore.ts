import { create } from 'zustand'
import type { CavityTemplate } from '@shared/cavity/types'

export interface PlacementState {
  /** 是否处于布孔流程中 */
  isPlacing: boolean
  /** 当前布孔交互模式：拖拽放置 或 点选瞄准 */
  mode: 'drag' | 'click' | null
  /** 待放置的孔腔模板定义 */
  template: CavityTemplate | null
  /** 所属孔腔库 ID */
  libraryId: string | null
  /** 目标设计工程 ID */
  targetProjectId: string | null

  // 瞬时瞄准位置与宿主面
  currentFaceId: string | null
  u: number
  v: number
  worldPoint: [number, number, number] | null
  isValid: boolean

  // 动作
  startPlacement: (
    mode: 'drag' | 'click',
    template: CavityTemplate,
    libraryId: string,
    projectId: string
  ) => void
  updatePlacement: (
    faceId: string,
    u: number,
    v: number,
    worldPoint: [number, number, number],
    isValid?: boolean
  ) => void
  clearHoverPosition: () => void
  cancelPlacement: () => void
}

export const usePlacementStore = create<PlacementState>((set) => ({
  isPlacing: false,
  mode: null,
  template: null,
  libraryId: null,
  targetProjectId: null,
  currentFaceId: null,
  u: 0,
  v: 0,
  worldPoint: null,
  isValid: false,

  startPlacement: (mode, template, libraryId, projectId) =>
    set({
      isPlacing: true,
      mode,
      template,
      libraryId,
      targetProjectId: projectId,
      currentFaceId: null,
      u: 0,
      v: 0,
      worldPoint: null,
      isValid: false
    }),

  updatePlacement: (faceId, u, v, worldPoint, isValid = true) =>
    set({
      currentFaceId: faceId,
      u,
      v,
      worldPoint,
      isValid
    }),

  clearHoverPosition: () =>
    set({
      currentFaceId: null,
      u: 0,
      v: 0,
      worldPoint: null,
      isValid: false
    }),

  cancelPlacement: () =>
    set({
      isPlacing: false,
      mode: null,
      template: null,
      libraryId: null,
      targetProjectId: null,
      currentFaceId: null,
      u: 0,
      v: 0,
      worldPoint: null,
      isValid: false
    })
}))
