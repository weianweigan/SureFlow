/**
 * 设计检查与主动间隙分析状态 Store (Zustand)
 * 严格对齐 PRD-FR-04-15 §4 与 §9
 */

import { create } from 'zustand'
import type {
  CheckIssue,
  CheckObservation,
  AnalysisStamp,
  EntityRef,
  ActiveClearanceResult
} from '@shared/design/analysis/contracts'
import type { RuleCategory } from '@shared/design/analysis/ruleRegistry'

export interface SchemeAnalysisData {
  issues: CheckIssue[]
  observations: CheckObservation[]
  isComputing: boolean
  stamp?: AnalysisStamp
}

export interface AnalysisState {
  // 面板显示与尺寸控制 (PRD §4)
  isOpen: boolean
  panelHeight: number
  lastValidHeight: number
  activeTab: 'issues' | 'observations'
  severityFilter: 'all' | 'error' | 'warning'
  categoryFilter: 'all' | RuleCategory
  searchText: string
  selectedIssueId: string | null
  isRuleSettingsOpen: boolean

  // 主动间隙分析 (PRD §9)
  isActiveClearanceOpen: boolean
  clearanceObjects: EntityRef[]
  activeClearanceResults: ActiveClearanceResult[]
  badgeOffsets: Record<string, [number, number, number]>
  objectA: EntityRef | null
  objectB: EntityRef | null
  activeClearanceResult: ActiveClearanceResult | null
  isMeasuring: boolean

  // 各方案检查结果
  resultsByScheme: Record<string, SchemeAnalysisData>

  // Actions
  togglePanel: (open?: boolean) => void
  setPanelHeight: (height: number) => void
  setActiveTab: (tab: 'issues' | 'observations') => void
  setSeverityFilter: (filter: 'all' | 'error' | 'warning') => void
  setCategoryFilter: (filter: 'all' | RuleCategory) => void
  setSearchText: (text: string) => void
  selectIssue: (id: string | null) => void
  setRuleSettingsOpen: (open: boolean) => void

  // 主动间隙动作
  setActiveClearanceOpen: (open: boolean) => void
  pickClearanceObject: (ref: EntityRef) => void
  removeClearanceObject: (ref: EntityRef) => void
  setClearanceObjects: (refs: EntityRef[]) => void
  setClearanceResults: (results: ActiveClearanceResult[]) => void
  setClearanceResult: (res: ActiveClearanceResult | null) => void
  resetActiveClearance: () => void
  setBadgeOffset: (id: string, offset: [number, number, number]) => void
  resetBadgeOffsets: () => void
  setMeasuring: (isMeasuring: boolean) => void

  // 结果更新
  setComputing: (schemeId: string, isComputing: boolean) => void
  updateResults: (
    schemeId: string,
    issues: CheckIssue[],
    observations: CheckObservation[],
    stamp?: AnalysisStamp
  ) => void
}

const STORAGE_KEY_PANEL_HEIGHT = 'sureflow:design:checks-panel-height'
const INITIAL_DEFAULT_HEIGHT = 260
const MIN_PANEL_HEIGHT = 160
const HIDE_THRESHOLD = 40

function isSameRef(a: EntityRef, b: EntityRef): boolean {
  if (a.kind !== b.kind) return false
  if (a.kind === 'cavity' && b.kind === 'cavity') return a.instanceId === b.instanceId
  if (a.kind === 'base-face' && b.kind === 'base-face') return a.faceId === b.faceId
  return false
}

export const useAnalysisStore = create<AnalysisState>((set, get) => ({
  isOpen: false, // 首次默认隐藏，自动检查仍开启
  panelHeight: (() => {
    if (typeof localStorage === 'undefined') return INITIAL_DEFAULT_HEIGHT
    const saved = localStorage.getItem(STORAGE_KEY_PANEL_HEIGHT)
    return saved ? parseInt(saved, 10) : INITIAL_DEFAULT_HEIGHT
  })(),
  lastValidHeight: (() => {
    if (typeof localStorage === 'undefined') return INITIAL_DEFAULT_HEIGHT
    const saved = localStorage.getItem(STORAGE_KEY_PANEL_HEIGHT)
    return saved ? parseInt(saved, 10) : INITIAL_DEFAULT_HEIGHT
  })(),
  activeTab: 'issues',
  severityFilter: 'error',
  categoryFilter: 'all',
  searchText: '',
  selectedIssueId: null,
  isRuleSettingsOpen: false,

  isActiveClearanceOpen: false,
  clearanceObjects: [],
  activeClearanceResults: [],
  badgeOffsets: {},
  objectA: null,
  objectB: null,
  activeClearanceResult: null,
  isMeasuring: false,

  resultsByScheme: {},

  togglePanel: (open) => {
    set((state) => {
      const nextOpen = open !== undefined ? open : !state.isOpen
      if (nextOpen && state.panelHeight < MIN_PANEL_HEIGHT) {
        return { isOpen: true, panelHeight: state.lastValidHeight }
      }
      return { isOpen: nextOpen }
    })
  },

  setPanelHeight: (height) => {
    // 释放时高度小于 40 px 则隐藏，否则限制到最小 160 px (PRD §4 FR-04-15-057)
    if (height < HIDE_THRESHOLD) {
      set({ isOpen: false })
      return
    }
    const clamped = Math.max(MIN_PANEL_HEIGHT, height)
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEY_PANEL_HEIGHT, String(clamped))
    }
    set({
      panelHeight: clamped,
      lastValidHeight: clamped,
      isOpen: true
    })
  },

  setActiveTab: (tab) => set({ activeTab: tab }),
  setSeverityFilter: (filter) => set({ severityFilter: filter }),
  setCategoryFilter: (filter) => set({ categoryFilter: filter }),
  setSearchText: (text) => set({ searchText: text }),
  selectIssue: (id) => set({ selectedIssueId: id }),
  setRuleSettingsOpen: (open) => set({ isRuleSettingsOpen: open }),

  setActiveClearanceOpen: (open) => {
    set({
      isActiveClearanceOpen: open,
      clearanceObjects: [],
      activeClearanceResults: [],
      badgeOffsets: {},
      objectA: null,
      objectB: null,
      activeClearanceResult: null,
      isMeasuring: false
    })
  },

  pickClearanceObject: (ref) => {
    const state = get()
    const exists = state.clearanceObjects.some((o) => isSameRef(o, ref))
    const nextObjects = exists
      ? state.clearanceObjects.filter((o) => !isSameRef(o, ref))
      : [...state.clearanceObjects, ref]

    set({
      clearanceObjects: nextObjects,
      objectA: nextObjects[0] || null,
      objectB: nextObjects[1] || null,
      activeClearanceResults: nextObjects.length < 2 ? [] : state.activeClearanceResults,
      activeClearanceResult: nextObjects.length < 2 ? null : state.activeClearanceResults[0] || null,
      isMeasuring: nextObjects.length >= 2
    })
  },

  removeClearanceObject: (ref) => {
    const state = get()
    const nextObjects = state.clearanceObjects.filter((o) => !isSameRef(o, ref))
    set({
      clearanceObjects: nextObjects,
      objectA: nextObjects[0] || null,
      objectB: nextObjects[1] || null,
      activeClearanceResults: nextObjects.length < 2 ? [] : state.activeClearanceResults,
      activeClearanceResult: nextObjects.length < 2 ? null : state.activeClearanceResults[0] || null,
      isMeasuring: nextObjects.length >= 2
    })
  },

  setClearanceObjects: (refs) => {
    set({
      clearanceObjects: refs,
      objectA: refs[0] || null,
      objectB: refs[1] || null,
      activeClearanceResults: refs.length < 2 ? [] : get().activeClearanceResults,
      activeClearanceResult: refs.length < 2 ? null : get().activeClearanceResults[0] || null,
      isMeasuring: refs.length >= 2
    })
  },

  setClearanceResults: (results) => {
    set({
      activeClearanceResults: results,
      activeClearanceResult: results[0] || null,
      isMeasuring: false
    })
  },

  setClearanceResult: (res) => {
    set({
      activeClearanceResult: res,
      activeClearanceResults: res ? [res] : [],
      isMeasuring: false
    })
  },

  resetActiveClearance: () => {
    set({
      clearanceObjects: [],
      objectA: null,
      objectB: null,
      activeClearanceResult: null,
      activeClearanceResults: [],
      badgeOffsets: {},
      isMeasuring: false
    })
  },

  setBadgeOffset: (id, offset) => {
    set((state) => ({
      badgeOffsets: {
        ...state.badgeOffsets,
        [id]: offset
      }
    }))
  },

  resetBadgeOffsets: () => {
    set({ badgeOffsets: {} })
  },

  setMeasuring: (isMeasuring) => set({ isMeasuring }),

  setComputing: (schemeId, isComputing) => {
    set((state) => ({
      resultsByScheme: {
        ...state.resultsByScheme,
        [schemeId]: {
          ...(state.resultsByScheme[schemeId] || { issues: [], observations: [] }),
          isComputing
        }
      }
    }))
  },

  updateResults: (schemeId, issues, _observations, stamp) => {
    set((state) => ({
      resultsByScheme: {
        ...state.resultsByScheme,
        [schemeId]: {
          issues,
          observations: [],
          isComputing: false,
          stamp
        }
      }
    }))
  }
}))
