import { t as _t, msg as _msg } from '@shared/i18n'
/**
 * 库编辑器 ViewModel（MVVM 核心）
 *
 * 唯一业务 store：持有当前库文档、选中态、展开态与撤销/重做栈。
 * - 视图组件只读订阅 state，写操作一律经 execute(command)
 * - 撤销/重做通过逆命令回放，界面与数据严格一致
 * - 文档持久化经 window.libraryApi（主进程 fs）
 */

import { create } from 'zustand'
import { produce } from 'immer'
import {
  CompositeCmd,
  InsertCmd,
  RemoveCmd,
  ReorganizeDocCmd,
  SelectionCmd,
  UpdateCmd,
  type Command
} from './commands'
import { findCategory, findTemplate } from '../model/documentOps'
import {
  defaultCategory,
  defaultLibrary,
  defaultTemplate,
  isComboType,
  newId,
  nowIso,
  type CavityLibrary,
  type CavityTemplate,
  type CavityType,
  type CategoryNode,
  type LibrarySummary
} from '@shared/cavity/types'
import { validateLibrary, hasErrors, type ValidationIssue } from '@shared/cavity/validation'

/** 左树选中态（库由 activeLibraryId 表达） */
export interface Selection {
  categoryId: string | null
  templateId: string | null
  holeId: string | null
}

export const NULL_SELECTION: Selection = { categoryId: null, templateId: null, holeId: null }

/**
 * 全局选项：是否允许编辑「内置/内部库」(source === 'builtin')。
 *
 * 默认关闭 → 内置库保持只读（与主进程 builtin 目录 readonly 一致）。
 * 开发阶段需实测内置库的数据流时，临时改为 `true` 即可解锁：打开内置库后不再
 * 视为只读，可新增/删除分类、模板并「保存」写回其自身目录（开发环境的
 * resources/builtin-libraries 可写）。整库删除仍受主进程 builtin 只读保护。
 */
export const ALLOW_EDIT_BUILTIN = true

let initialization: Promise<void> | null = null
const UNDO_LIMIT = 100
/** 同 mergeKey 命令的合并窗口（ms）：窗口内连续同路径编辑合并为一步 */
const MERGE_WINDOW = 600

export interface LibraryState {
  /* ---- 库列表 ---- */
  libraries: LibrarySummary[]
  activeLibraryId: string | null
  activeDirPath: string | null
  readonly: boolean

  /* ---- 当前文档 ---- */
  doc: CavityLibrary | null

  /* ---- UI 态 ---- */
  selection: Selection
  expanded: Record<string, boolean>
  search: string
  /** 当前选中的台阶索引（与 2D 预览图形 SectionView 双向联动） */
  selectedStepIndex: number | null
  /** 当前选中的侧油口索引（与 2D 预览图形 SectionView 双向联动） */
  selectedPortIndex: number | null
  /** 当前选中的子孔索引（与 2D 预览图形 FaceView / SubHolePanel 双向联动） */
  selectedHoleIndex: number | null
  editingCatId: string | null
  editingTplId: string | null

  /* ---- 历史 ---- */
  undoStack: Command[]
  redoStack: Command[]
  dirty: boolean
  saving: boolean
  /** 跨库引用缓存版本号（加载新库后自增，驱动预览刷新） */
  libCacheVersion: number

  /* ---- actions ---- */
  init(): Promise<void>
  refreshList(): Promise<void>
  openLibrary(id: string): Promise<void>
  execute(cmd: Command): void
  undo(): void
  redo(): void
  select(sel: Selection): void
  selectAndReveal(sel: Selection): void
  toggleExpand(id: string): void
  toggleExpandAll(): void
  setSearch(s: string): void
  setSelectedStepIndex(idx: number | null): void
  setSelectedPortIndex(idx: number | null): void
  setSelectedHoleIndex(idx: number | null): void
  setEditingCatId(id: string | null): void
  setEditingTplId(id: string | null): void

  createTemplate(type: CavityType, targetCategoryId?: string): string | null
  duplicateTemplate(templateId: string): string | null
  renameTemplate(templateId: string, newName: string): void
  deleteTemplate(templateId: string): void
  addCategory(parentId: string | null, name?: string): string | null
  renameCategory(id: string, name: string): void
  deleteCategory(id: string): void
  moveCategory(sourceId: string, targetId: string, position: 'before' | 'after' | 'inside'): void
  moveTemplate(sourceTemplateId: string, targetId: string, position: 'before' | 'after' | 'insideCategory'): void

  save(): Promise<{ ok: boolean; issues: ValidationIssue[] }>
  createLibrary(name?: string): Promise<string>
  renameLibrary(id: string, newName: string): Promise<void>
  exportLibrary(id: string): Promise<void>
  importFromDialog(): Promise<void>
  removeLibrary(id: string): Promise<void>
}

/* ---------- 模块级辅助（非响应式） ---------- */

/** 引用解析用的已加载库缓存（子孔跨库引用） */
const loadedLibs = new Map<string, CavityLibrary>()
/** 上次命令时间戳（merge 窗口判定） */
let lastCmdAt = 0

export function getLoadedLibs(): Map<string, CavityLibrary> {
  return loadedLibs
}

/** 按需加载一个库进缓存（子孔跨库引用解析用） */
export async function ensureLibLoaded(summary: LibrarySummary): Promise<void> {
  if (loadedLibs.has(summary.id)) return
  try {
    const lib = await window.libraryApi.read(summary.dirPath)
    loadedLibs.set(lib.id, lib)
    useLibraryStore.setState((s) => ({ libCacheVersion: s.libCacheVersion + 1 }))
  } catch {
    /* 加载失败保持缺失，引用按失效处理 */
  }
}

/** 在分类树中定位目标分类所在数组的路径与下标 */
export function locateCategory(
  nodes: CategoryNode[],
  targetId: string,
  prefix: string
): { arrayPath: string; index: number } | null {
  for (let i = 0; i < nodes.length; i++) {
    if (nodes[i].id === targetId) return { arrayPath: prefix, index: i }
    const hit = locateCategory(nodes[i].children, targetId, `${prefix}.${i}.children`)
    if (hit) return hit
  }
  return null
}

/* ---------- store ---------- */

export const useLibraryStore = create<LibraryState>((set, get) => ({
  libraries: [],
  activeLibraryId: null,
  activeDirPath: null,
  readonly: false,
  doc: null,
  selection: NULL_SELECTION,
  expanded: {},
  search: '',
  selectedStepIndex: null,
  selectedPortIndex: null,
  selectedHoleIndex: null,
  editingCatId: null,
  editingTplId: null,
  undoStack: [],
  redoStack: [],
  dirty: false,
  saving: false,
  libCacheVersion: 0,

  init: () => {
    if (!initialization) initialization = (async () => {
      await get().refreshList()
      if (get().activeLibraryId) return
      const first = get().libraries.find((l) => l.source === 'user') ?? get().libraries[0]
      if (first) await get().openLibrary(first.id)
    })().catch(error => { initialization = null; throw error })
    return initialization
  },

  refreshList: async () => {
    const libraries = await window.libraryApi.list()
    set({ libraries })
  },

  openLibrary: async (id) => {
    const s = get()
    if (s.dirty && !window.confirm(_t("当前库有未保存的修改，切换将丢失，确定继续？"))) return
    const summary = s.libraries.find((l) => l.id === id)
    if (!summary) return
    const doc = await window.libraryApi.read(summary.dirPath)
    loadedLibs.set(doc.id, doc)
    // 默认折叠所有分类（PRD 体验改进：打开时默认折叠）
    const expanded: Record<string, boolean> = {}
    set({
      activeLibraryId: id,
      activeDirPath: summary.dirPath,
      // 内置库仅读数受全局选项控制（开启即可在内置库上编辑并写回）
      readonly: summary.source === 'builtin' ? !ALLOW_EDIT_BUILTIN : summary.readonly,
      doc,
      selection: NULL_SELECTION,
      expanded,
      search: '',
      selectedStepIndex: null,
      selectedPortIndex: null,
      selectedHoleIndex: null,
      editingCatId: null,
      editingTplId: null,
      undoStack: [],
      redoStack: [],
      dirty: false
    })
  },

  execute: (cmd) => {
    const s = get()
    const target = produce(
      { doc: s.doc, selection: s.selection },
      (d: { doc: CavityLibrary | null; selection: Selection }) => cmd.apply(d)
    )

    // 合并：窗口期内同 mergeKey 的 Update/Selection 命令替换栈顶（保最早 prev、取最新 next）
    const now = Date.now()
    const top = s.undoStack[s.undoStack.length - 1]
    let undoStack: Command[]
    if (
      top &&
      cmd.mergeKey != null &&
      top.mergeKey === cmd.mergeKey &&
      top instanceof UpdateCmd &&
      cmd instanceof UpdateCmd &&
      now - lastCmdAt < MERGE_WINDOW
    ) {
      undoStack = [...s.undoStack.slice(0, -1), top.mergeWith(cmd)]
    } else if (
      top &&
      cmd.mergeKey === 'selection' &&
      top instanceof SelectionCmd &&
      cmd instanceof SelectionCmd &&
      now - lastCmdAt < MERGE_WINDOW
    ) {
      undoStack = [...s.undoStack.slice(0, -1), top.mergeWith(cmd)]
    } else {
      undoStack = [...s.undoStack, cmd].slice(-UNDO_LIMIT)
    }
    lastCmdAt = now

    set({
      doc: target.doc as CavityLibrary | null,
      selection: target.selection as Selection,
      undoStack,
      redoStack: [],
      dirty: s.dirty || cmd.affectsDoc
    })
  },

  undo: () => {
    const s = get()
    const cmd = s.undoStack[s.undoStack.length - 1]
    if (!cmd) return
    const inverse = cmd.invert()
    const target = produce(
      { doc: s.doc, selection: s.selection },
      (d: { doc: CavityLibrary | null; selection: Selection }) => inverse.apply(d)
    )
    lastCmdAt = 0 // undo 后禁止与后续输入合并
    set({
      doc: target.doc as CavityLibrary | null,
      selection: target.selection as Selection,
      undoStack: s.undoStack.slice(0, -1),
      redoStack: [...s.redoStack, cmd],
      dirty: s.dirty || cmd.affectsDoc
    })
  },

  redo: () => {
    const s = get()
    const cmd = s.redoStack[s.redoStack.length - 1]
    if (!cmd) return
    const target = produce(
      { doc: s.doc, selection: s.selection },
      (d: { doc: CavityLibrary | null; selection: Selection }) => cmd.apply(d)
    )
    lastCmdAt = 0
    set({
      doc: target.doc as CavityLibrary | null,
      selection: target.selection as Selection,
      undoStack: [...s.undoStack, cmd].slice(-UNDO_LIMIT),
      redoStack: s.redoStack.slice(0, -1),
      dirty: s.dirty || cmd.affectsDoc
    })
  },

  select: (sel) => {
    if (sel.templateId !== get().selection.templateId) {
      set({ selectedStepIndex: null, selectedPortIndex: null, selectedHoleIndex: null })
    }
    get().execute(new SelectionCmd(get().selection, sel))
  },

  /** 选中模板并确保其所在分类链全部展开（校验跳转等场景） */
  selectAndReveal: (sel) => {
    if (sel.templateId !== get().selection.templateId) {
      set({ selectedStepIndex: null, selectedPortIndex: null, selectedHoleIndex: null })
    }
    get().select(sel)
    if (!sel.categoryId) return
    const s = get()
    if (!s.doc) return
    const chain: string[] = []
    const walk = (nodes: CategoryNode[], target: string, trail: string[]): boolean => {
      for (const n of nodes) {
        const next = [...trail, n.id]
        if (n.id === target) {
          chain.push(...next)
          return true
        }
        if (walk(n.children, target, next)) return true
      }
      return false
    }
    walk(s.doc.categories, sel.categoryId, [])
    if (chain.length === 0) return
    set((st) => {
      const expanded = { ...st.expanded }
      for (const id of chain) expanded[id] = true
      return { expanded }
    })
  },

  toggleExpand: (id) => {
    set((s) => ({ expanded: { ...s.expanded, [id]: !s.expanded[id] } }))
  },

  toggleExpandAll: () => {
    const s = get()
    if (!s.doc) return
    const firstLevelIds = s.doc.categories.map((c) => c.id)
    if (firstLevelIds.length === 0) return
    const anyExpanded = firstLevelIds.some((id) => !!s.expanded[id])
    if (anyExpanded) {
      set({ expanded: {} })
    } else {
      const expanded: Record<string, boolean> = { ...s.expanded }
      for (const id of firstLevelIds) expanded[id] = true
      set({ expanded })
    }
  },

  setSearch: (search) => set({ search }),

  setSelectedStepIndex: (selectedStepIndex) =>
    set({ selectedStepIndex, selectedPortIndex: null }),

  setSelectedPortIndex: (selectedPortIndex) =>
    set({ selectedPortIndex, selectedStepIndex: null }),

  setSelectedHoleIndex: (selectedHoleIndex) => set({ selectedHoleIndex }),

  setEditingCatId: (editingCatId) => set({ editingCatId }),

  setEditingTplId: (editingTplId) => set({ editingTplId }),

  createTemplate: (type, targetCategoryId) => {
    const s = get()
    if (!s.doc || s.readonly) return null
    set({ selectedStepIndex: null, selectedPortIndex: null, selectedHoleIndex: null })
    // 目标分类：显式传入 -> 当前选中分类 -> 选中模板所属分类 -> 第一个分类
    const fromTemplate = findTemplate(s.doc, s.selection.templateId)?.categoryId ?? null
    const candidate = targetCategoryId ?? s.selection.categoryId ?? fromTemplate
    const catId =
      candidate && findCategory(s.doc.categories, candidate)
        ? candidate
        : (s.doc.categories[0]?.id ?? null)
    if (!catId) return null
    // 同分类下名称唯一（V4）
    const existing = new Set(
      s.doc.templates.filter((t) => t.categoryId === catId).map((t) => t.name)
    )
    let name = _t("新孔腔")
    let i = 2
    while (existing.has(name)) name = _msg`新孔腔${i++}`
    const tpl = defaultTemplate(type, catId, name)

    // 就近插入：若当前选中的模板属于目标分类，则插入其后；否则插在目标分类最后一个模板之后
    let insertIdx = s.doc.templates.length
    if (s.selection.templateId) {
      const selIdx = s.doc.templates.findIndex(
        (t) => t.id === s.selection.templateId && t.categoryId === catId
      )
      if (selIdx >= 0) insertIdx = selIdx + 1
    }
    if (insertIdx === s.doc.templates.length) {
      let lastInCat = -1
      for (let idx = s.doc.templates.length - 1; idx >= 0; idx--) {
        if (s.doc.templates[idx].categoryId === catId) {
          lastInCat = idx
          break
        }
      }
      if (lastInCat >= 0) insertIdx = lastInCat + 1
    }

    get().execute(
      new CompositeCmd(_msg`新建孔腔「${name}」`, [
        new InsertCmd('doc.templates', insertIdx, tpl, _msg`新建孔腔「${name}」`),
        new SelectionCmd(s.selection, { categoryId: catId, templateId: tpl.id, holeId: null })
      ])
    )
    set((st) => ({ expanded: { ...st.expanded, [catId]: true } }))
    return tpl.id
  },

  duplicateTemplate: (templateId) => {
    const s = get()
    if (!s.doc || s.readonly) return null
    const srcIdx = s.doc.templates.findIndex((t) => t.id === templateId)
    if (srcIdx < 0) return null
    const tpl = s.doc.templates[srcIdx]
    const catId = tpl.categoryId
    const existing = new Set(
      s.doc.templates.filter((t) => t.categoryId === catId).map((t) => t.name)
    )
    let name = _msg`${tpl.name} 副本`
    let i = 2
    while (existing.has(name)) name = _msg`${tpl.name} 副本 ${i++}`
    const copy: CavityTemplate = {
      ...JSON.parse(JSON.stringify(tpl)),
      id: newId(),
      name,
      meta: { ...tpl.meta, createdAt: nowIso(), updatedAt: nowIso() }
    }
    get().execute(
      new CompositeCmd(_msg`复制孔腔「${name}」`, [
        new InsertCmd('doc.templates', srcIdx + 1, copy, _msg`复制孔腔「${name}」`),
        new SelectionCmd(s.selection, { categoryId: catId, templateId: copy.id, holeId: null })
      ])
    )
    set((st) => ({ expanded: { ...st.expanded, [catId]: true } }))
    return copy.id
  },

  renameTemplate: (templateId, newName) => {
    const s = get()
    if (!s.doc || s.readonly) return
    const trimmed = newName.trim()
    if (!trimmed) return
    const idx = s.doc.templates.findIndex((t) => t.id === templateId)
    if (idx < 0) return
    const tpl = s.doc.templates[idx]
    if (tpl.name === trimmed) return
    get().execute(
      new UpdateCmd(`doc.templates.${idx}.name`, trimmed, tpl.name, _msg`重命名孔腔「${trimmed}」`)
    )
  },

  deleteTemplate: (templateId) => {
    const s = get()
    if (!s.doc || s.readonly) return
    const idx = s.doc.templates.findIndex((t) => t.id === templateId)
    if (idx < 0) return
    const item = s.doc.templates[idx]
    if (!window.confirm(_msg`确定删除孔腔「${item.name}」？此操作可撤销。`)) return
    get().execute(
      new CompositeCmd(_msg`删除孔腔「${item.name}」`, [
        new RemoveCmd('doc.templates', idx, item, _msg`删除孔腔「${item.name}」`),
        new SelectionCmd(s.selection, { categoryId: item.categoryId, templateId: null, holeId: null })
      ])
    )
    set({ selectedStepIndex: null, selectedHoleIndex: null })
  },

  addCategory: (parentId, name) => {
    const s = get()
    if (!s.doc || s.readonly) return null
    const trimmed = name?.trim() || _t("新分类")
    const prevDoc = s.doc
    let newIdCreated = ''

    const nextDoc = produce(s.doc, (draft) => {
      if (parentId == null) {
        // 就近插入：若当前选中有分类，找其根级祖先分类，插入其后
        let targetIdx = draft.categories.length
        if (s.selection.categoryId) {
          const findTopAncestor = (nodes: CategoryNode[], target: string): string | null => {
            for (const n of nodes) {
              if (n.id === target) return n.id
              const has = (cur: CategoryNode): boolean => {
                if (cur.id === target) return true
                return cur.children.some(has)
              }
              if (has(n)) return n.id
            }
            return null
          }
          const topId = findTopAncestor(draft.categories, s.selection.categoryId)
          if (topId) {
            const idx = draft.categories.findIndex((c) => c.id === topId)
            if (idx >= 0) targetIdx = idx + 1
          }
        }
        const node = defaultCategory(trimmed, targetIdx)
        newIdCreated = node.id
        draft.categories.splice(targetIdx, 0, node)
        draft.categories.forEach((c, i) => (c.sortOrder = i))
      } else {
        const parent = findCategory(draft.categories, parentId)
        if (!parent) return
        let childIdx = parent.children.length
        if (s.selection.categoryId) {
          const idx = parent.children.findIndex((c) => c.id === s.selection.categoryId)
          if (idx >= 0) childIdx = idx + 1
        }
        const node = defaultCategory(trimmed, childIdx)
        newIdCreated = node.id
        parent.children.splice(childIdx, 0, node)
        parent.children.forEach((c, i) => (c.sortOrder = i))
      }
    })

    if (!newIdCreated) return null
    get().execute(new ReorganizeDocCmd(prevDoc, nextDoc, _t("新建分类")))
    if (parentId == null) {
      set((st) => ({ expanded: { ...st.expanded, [newIdCreated]: true } }))
    } else {
      set((st) => ({ expanded: { ...st.expanded, [parentId]: true, [newIdCreated]: true } }))
    }
    return newIdCreated
  },

  moveCategory: (sourceId, targetId, position) => {
    const s = get()
    if (!s.doc || s.readonly || sourceId === targetId) return
    const prevDoc = s.doc
    const nextDoc = produce(s.doc, (draft) => {
      // 检查 targetId 是否在 sourceId 的子树中（防止自己移入自己）
      const isDescendant = (node: CategoryNode, tid: string): boolean => {
        if (node.id === tid) return true
        return (node.children || []).some((c) => isDescendant(c, tid))
      }
      const sourceObj = findCategory(draft.categories, sourceId)
      if (!sourceObj || isDescendant(sourceObj, targetId)) return

      // 从原父级数组中移除 sourceNode
      const findAndRemove = (nodes: CategoryNode[]): CategoryNode | null => {
        const idx = nodes.findIndex((n) => n.id === sourceId)
        if (idx >= 0) {
          const [removed] = nodes.splice(idx, 1)
          return removed
        }
        for (const n of nodes) {
          const res = findAndRemove(n.children)
          if (res) return res
        }
        return null
      }

      const removed = findAndRemove(draft.categories)
      if (!removed) return

      if (position === 'inside') {
        const targetNode = findCategory(draft.categories, targetId)
        if (!targetNode) return
        targetNode.children.push(removed)
        targetNode.children.forEach((c, i) => (c.sortOrder = i))
      } else {
        // 在 target 所在的数组中插入 before 或 after
        const insertSibling = (nodes: CategoryNode[]): boolean => {
          const idx = nodes.findIndex((n) => n.id === targetId)
          if (idx >= 0) {
            const insertAt = position === 'before' ? idx : idx + 1
            nodes.splice(insertAt, 0, removed)
            nodes.forEach((c, i) => (c.sortOrder = i))
            return true
          }
          for (const n of nodes) {
            if (insertSibling(n.children)) return true
          }
          return false
        }
        insertSibling(draft.categories)
      }
    })

    if (nextDoc !== prevDoc) {
      get().execute(new ReorganizeDocCmd(prevDoc, nextDoc, _t("移动分类")))
      if (position === 'inside') {
        set((st) => ({ expanded: { ...st.expanded, [targetId]: true } }))
      }
    }
  },

  moveTemplate: (sourceTemplateId, targetId, position) => {
    const s = get()
    if (!s.doc || s.readonly) return
    const prevDoc = s.doc
    const nextDoc = produce(s.doc, (draft) => {
      const srcIdx = draft.templates.findIndex((t) => t.id === sourceTemplateId)
      if (srcIdx < 0) return
      const [srcTpl] = draft.templates.splice(srcIdx, 1)

      if (position === 'insideCategory') {
        srcTpl.categoryId = targetId
        // 插入到该分类的最后一个模板之后
        let lastInCat = -1
        for (let idx = draft.templates.length - 1; idx >= 0; idx--) {
          if (draft.templates[idx].categoryId === targetId) {
            lastInCat = idx
            break
          }
        }
        if (lastInCat >= 0) {
          draft.templates.splice(lastInCat + 1, 0, srcTpl)
        } else {
          draft.templates.push(srcTpl)
        }
      } else {
        // targetId 为另一个模板
        const targetIdx = draft.templates.findIndex((t) => t.id === targetId)
        if (targetIdx < 0) return
        const targetTpl = draft.templates[targetIdx]
        srcTpl.categoryId = targetTpl.categoryId
        const insertAt = position === 'before' ? targetIdx : targetIdx + 1
        draft.templates.splice(insertAt, 0, srcTpl)
      }
    })

    if (nextDoc !== prevDoc) {
      get().execute(new ReorganizeDocCmd(prevDoc, nextDoc, _t("移动孔腔")))
      const tpl = nextDoc.templates.find((t) => t.id === sourceTemplateId)
      if (tpl) {
        set((st) => ({ expanded: { ...st.expanded, [tpl.categoryId]: true } }))
        get().select({ categoryId: tpl.categoryId, templateId: tpl.id, holeId: null })
      }
    }
  },

  renameCategory: (id, name) => {
    const s = get()
    if (!s.doc || s.readonly || !name.trim()) return
    const loc = locateCategory(s.doc.categories, id, 'doc.categories')
    if (!loc) return
    const node = findCategory(s.doc.categories, id)
    if (!node) return
    get().execute(
      new UpdateCmd(`${loc.arrayPath}.${loc.index}.name`, name.trim(), node.name, _t("重命名分类"))
    )
  },

  deleteCategory: (id) => {
    const s = get()
    if (!s.doc || s.readonly) return
    const node = findCategory(s.doc.categories, id)
    if (!node) return
    const loc = locateCategory(s.doc.categories, id, 'doc.categories')
    if (!loc) return
    const doomedIds = new Set<string>()
    const collect = (n: CategoryNode): void => {
      doomedIds.add(n.id)
      n.children.forEach(collect)
    }
    collect(node)
    const removedTemplates = s.doc.templates.filter((t) => doomedIds.has(t.categoryId))
    const confirmMsg =
      removedTemplates.length > 0
        ? _msg`分类「${node.name}」下有 ${removedTemplates.length} 个孔腔，删除分类将一并删除（可撤销）。继续？`
        : _msg`确定删除分类「${node.name}」？（可撤销）`
    if (!window.confirm(confirmMsg)) return

    const cmds: Command[] = [
      new RemoveCmd(`${loc.arrayPath}`, loc.index, node, _msg`删除分类「${node.name}」`)
    ]
    if (removedTemplates.length > 0) {
      // 级联移除其下模板：逐个 Remove（保持索引正确——从后往前删）
      const doomed = s.doc.templates
        .map((t, i) => ({ t, i }))
        .filter(({ t }) => doomedIds.has(t.categoryId))
        .sort((a, b) => b.i - a.i)
      for (const { t, i } of doomed) {
        cmds.push(new RemoveCmd('doc.templates', i, t, _msg`移除孔腔「${t.name}」`))
      }
      cmds.push(new SelectionCmd(s.selection, NULL_SELECTION))
    }
    get().execute(new CompositeCmd(_msg`删除分类「${node.name}」`, cmds))
  },

  save: async () => {
    const s = get()
    if (!s.doc || !s.activeDirPath) return { ok: false, issues: [] }

    // 自动清理非组合孔模板上的 holes 残留字段（对齐 PRD-002 V7）
    for (const tpl of s.doc.templates) {
      if (!isComboType(tpl.cavityType) && 'holes' in tpl) {
        delete (tpl as any).holes
      }
    }

    const issues = validateLibrary(s.doc)
    if (hasErrors(issues)) return { ok: false, issues }
    set({ saving: true })
    try {
      const doc: CavityLibrary = {
        ...s.doc,
        meta: { ...s.doc.meta, updatedAt: nowIso() }
      }
      await window.libraryApi.save(s.activeDirPath, doc)
      loadedLibs.set(doc.id, doc)
      set({ doc, dirty: false })
      return { ok: true, issues }
    } finally {
      set({ saving: false })
    }
  },

  createLibrary: async (name) => {
    const defaultName = name?.trim() || _t("新孔腔库")
    const lib = defaultLibrary(defaultName, 'user')
    const summary = await window.libraryApi.create(lib)
    loadedLibs.set(lib.id, lib)
    await get().refreshList()
    await get().openLibrary(summary.id)
    return summary.id
  },

  renameLibrary: async (id, newName) => {
    const trimmed = newName.trim()
    if (!trimmed) return
    const s = get()
    const summary = s.libraries.find((l) => l.id === id)
    if (!summary || summary.readonly) return
    const updated = await window.libraryApi.rename(summary.dirPath, trimmed)
    await get().refreshList()
    if (s.activeLibraryId === id && s.doc) {
      set({ doc: { ...s.doc, name: updated.name } })
    }
  },

  exportLibrary: async (id) => {
    const s = get()
    const summary = s.libraries.find((l) => l.id === id)
    if (!summary) return
    await window.libraryApi.export(summary.dirPath, summary.name)
  },

  importFromDialog: async () => {
    const src = await window.libraryApi.pickSource()
    if (!src) return
    const summary = await window.libraryApi.import(src)
    await get().refreshList()
    await get().openLibrary(summary.id)
  },

  removeLibrary: async (id) => {
    const s = get()
    const summary = s.libraries.find((l) => l.id === id)
    if (!summary) return
    if (summary.readonly) {
      window.alert(_t("内置库只读，不可删除"))
      return
    }
    if (s.dirty && s.activeLibraryId === id) {
      if (!window.confirm(_t("当前库有未保存修改，删除前请确认（修改将丢失）。继续删除？"))) return
    } else if (!window.confirm(_msg`确定删除库「${summary.name}」？库文件夹将移入系统回收站。`)) {
      return
    }
    await window.libraryApi.delete(summary.dirPath)
    loadedLibs.delete(id)
    await get().refreshList()
    if (s.activeLibraryId === id) {
      set({
        activeLibraryId: null,
        activeDirPath: null,
        doc: null,
        selection: NULL_SELECTION,
        undoStack: [],
        redoStack: [],
        dirty: false
      })
    }
  }
}))
