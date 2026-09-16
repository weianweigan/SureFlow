/**
 * 库文档操作纯函数（Model 层服务）
 *
 * 树遍历 / 模板定位 / 子孔引用解析等无副作用工具。
 * 所有组件与 store 均经由这些函数访问文档，不手写遍历。
 */

import { polarToCartesian } from '@shared/cavity/geometry'
import { isComboType } from '@shared/cavity/types'
import { convertGeometry } from '@shared/cavity/unitConversion'
import type {
  CavityLibrary,
  CavityTemplate,
  CategoryNode,
  Geometry,
  Hole,
  HoleRef
} from '@shared/cavity/types'

/* ---------- 深路径工具（供 UpdateCmd / 表单绑定） ---------- */

/** 按 'a.b.0.c' 取值；路径不存在返回 undefined */
export function getIn(obj: unknown, path: string): unknown {
  let cur: unknown = obj
  for (const seg of path.split('.')) {
    if (cur == null) return undefined
    cur = (cur as Record<string | number, unknown>)[seg]
  }
  return cur
}

/** 按 'a.b.0.c' 赋值（draft 上直接变更；中间容器缺失时创建对象） */
export function setIn(obj: Record<string, unknown>, path: string, value: unknown): void {
  const segs = path.split('.')
  let cur: Record<string, unknown> = obj
  for (let i = 0; i < segs.length - 1; i++) {
    const k = segs[i]
    const nxt = cur[k]
    if (nxt == null || typeof nxt !== 'object') {
      cur[k] = /^\d+$/.test(segs[i + 1]) ? [] : {}
    }
    cur = cur[k] as Record<string, unknown>
  }
  cur[segs[segs.length - 1]] = value
}

/* ---------- 分类树 ---------- */

export interface CategoryFlatNode {
  node: CategoryNode
  parentId: string | null
  depth: number
}

/** 深度优先铺平分类树（供左树渲染） */
export function flattenCategories(nodes: CategoryNode[], parentId: string | null = null, depth = 0): CategoryFlatNode[] {
  const out: CategoryFlatNode[] = []
  const sorted = [...nodes].sort((a, b) => a.sortOrder - b.sortOrder)
  for (const n of sorted) {
    out.push({ node: n, parentId, depth })
    out.push(...flattenCategories(n.children, n.id, depth + 1))
  }
  return out
}

export function findCategory(nodes: CategoryNode[], id: string): CategoryNode | null {
  for (const n of nodes) {
    if (n.id === id) return n
    const hit = findCategory(n.children, id)
    if (hit) return hit
  }
  return null
}

/** 收集分类及其全部后代 id（删除分类时级联处理模板用） */
export function collectCategoryIds(node: CategoryNode): string[] {
  return [node.id, ...node.children.flatMap(collectCategoryIds)]
}

/* ---------- 模板定位 ---------- */

export function findTemplate(lib: CavityLibrary | null, templateId: string | null): CavityTemplate | null {
  if (!lib || !templateId) return null
  return lib.templates.find((t) => t.id === templateId) ?? null
}

/** 模板在 doc.templates 中的下标（命令路径用） */
export function templateIndex(lib: CavityLibrary | null, templateId: string | null): number {
  if (!lib || !templateId) return -1
  return lib.templates.findIndex((t) => t.id === templateId)
}

/** 模板命令路径前缀：'doc.templates[i]'；找不到返回 null */
export function templatePath(lib: CavityLibrary | null, templateId: string | null): string | null {
  const i = templateIndex(lib, templateId)
  return i >= 0 ? `doc.templates.${i}` : null
}

export function templatesInCategory(lib: CavityLibrary, categoryId: string): CavityTemplate[] {
  return lib.templates.filter((t) => t.categoryId === categoryId && !t.meta.archived)
}

/* ---------- 子孔引用解析（§8.6.3） ---------- */

export interface RefResolveContext {
  /** 当前编辑中的库 */
  currentLib: CavityLibrary | null
  /** 已加载的其他库缓存（含当前库） */
  loadedLibs: Map<string, CavityLibrary>
  /** 父模板单位（用于跨单位引用子孔时自动将几何尺度折算为父模板单位，PRD-002 §7.1 R-U4） */
  parentUnit?: 'mm' | 'in'
}

export type ResolvedHole =
  | { ok: true; template: CavityTemplate; geometry: Geometry }
  | { ok: false; reason: string }

/**
 * 解析子孔几何：内联直接返回；引用按 ref 在已加载库集合中查找
 * （libraryId 缺省 = 当前库）。找不到 → 引用失效（V8）。
 * 若被引模板单位与父模板单位不一致，按 R-U4 自动折算为父模板单位。
 */
export function resolveHole(hole: Hole, ctx: RefResolveContext): ResolvedHole {
  if (hole.ref == null) {
    if (hole.geometry) return { ok: true, template: null as unknown as CavityTemplate, geometry: hole.geometry }
    return { ok: false, reason: '内联子孔缺少几何定义' }
  }
  const libId = hole.ref.libraryId ?? ctx.currentLib?.id ?? ''
  const lib =
    ctx.currentLib && (!hole.ref.libraryId || hole.ref.libraryId === ctx.currentLib.id)
      ? ctx.currentLib
      : ctx.loadedLibs.get(libId)
  if (!lib) return { ok: false, reason: `引用的库未加载（${libId}）` }
  const tpl = lib.templates.find((t) => t.id === hole.ref?.templateId)
  if (!tpl) return { ok: false, reason: '引用的模板不存在（引用失效）' }

  // 跨单位引用自动折算为父模板单位（R-U4）
  const geo =
    ctx.parentUnit && tpl.unit && ctx.parentUnit !== tpl.unit
      ? convertGeometry(tpl.geometry, tpl.unit, ctx.parentUnit)
      : tpl.geometry

  return { ok: true, template: tpl, geometry: geo }
}

/** 引用解析失败时仍需的 HoleRef（显示用） */
export function holeRefLabel(ref: HoleRef): string {
  return ref.libraryId ? `${ref.templateId.slice(0, 8)}@跨库` : ref.templateId.slice(0, 8)
}

/* ---------- 子孔坐标 ---------- */

export interface HolePlacement {
  name: string
  /** 安装面笛卡尔坐标（mm） */
  cx: number
  cy: number
  polar: boolean
  /** 原始输入（polar 时为 r/θ） */
  x: number
  y: number
  /** 子孔轴线倾斜角（度） */
  tiltAngle: number
  /** 倾斜方位角（度） */
  azimuth: number
  /** @deprecated 兼容保留 */
  rotation: number
}

/** holes[].x/y → 安装面笛卡尔坐标（polar 时换算，§8.4） */
export function holePlacement(hole: Hole, polar: boolean): HolePlacement {
  const c = polar ? polarToCartesian(hole.x, hole.y) : { cx: hole.x, cy: hole.y }
  return {
    name: hole.name,
    cx: c.cx,
    cy: c.cy,
    polar,
    x: hole.x,
    y: hole.y,
    tiltAngle: hole.tiltAngle ?? 0,
    azimuth: hole.azimuth ?? 0,
    rotation: hole.rotation ?? 0
  }
}

/** 是否为组合孔（决定预览用安装面图还是剖面图） */
export function templateIsCombo(t: CavityTemplate): boolean {
  return isComboType(t.cavityType)
}
