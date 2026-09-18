/**
 * 孔腔数据模型类型定义（PRD-002 v0.8 已冻结架构）
 *
 * 严格对齐 prd/PRD-002-孔腔数据模型.md：
 * - §3 库顶层结构 / §4 分类节点 / §5 模板定义
 * - §6 类型体系（9 种 cavityType + 字段矩阵）
 * - §8 几何子结构（steps/thread/ports/layout/outline/holes/plug/locatingShoulder）
 *
 * 三端（main / preload / renderer）共享；仅类型与纯常量，无环境依赖。
 */

/* ---------- §6.1 类型体系 ---------- */

export type CavityType =
  | 'drill-hole'
  | 'bolt-hole'
  | 'port-cavity'
  | 'cartridge-valve'
  | 'locating-pin-hole'
  | 'flange'
  | 'pattern-valve'
  | 'two-way-cartridge-valve'
  | 'foot-print'

/** 组合孔类型（§6.2：纯容器，几何全部由 holes 子孔承载） */
export const COMBO_TYPES: ReadonlySet<CavityType> = new Set([
  'flange',
  'pattern-valve',
  'two-way-cartridge-valve',
  'foot-print'
])

export function isComboType(t: CavityType): boolean {
  return COMBO_TYPES.has(t)
}

/* ---------- §8.2 螺纹 ---------- */

export type ThreadFamily = 'METRIC' | 'UN' | 'NPT' | 'BSPP' | 'BSPT'

export interface ThreadSpec {
  family: ThreadFamily
  /** 完整螺纹标记（如 M10x1.5-6H），自由文本，唯一权威字段（Q3/Q3b） */
  designation: string
  /** 螺纹有效深度（旋合长度）；null = 贯通整个台阶 */
  depth?: number | null
  hand?: 'right' | 'left'
}

/* ---------- §8.1 台阶序列 ---------- */

export type StepType = 'straight' | 'tapered'

export interface Step {
  type: StepType
  /** mm；tapered 时为大端直径（与上一台阶交叉处）。> 0 */
  diameter: number
  /** 本台阶自身长度（段长）。null = 锥角收尖自动求解，仅允许出现在最后一段（R-S3） */
  length: number | null
  /** 锥角，全角（度）。tapered 必填；0 < angle < 180 */
  angle?: number
  /** 内嵌螺纹；null / 缺省 = 无螺纹 */
  thread?: ThreadSpec | null
}

/* ---------- §8.3 侧油口 ---------- */

export interface Port {
  /** 自定义端口名称（如 P, T, A, B 等） */
  name?: string
  /** 深度位置（mm，沿 Y 轴孔深方向浮动）：非通底表示中心轴线；通底表示起始线（直通孔底最深处） */
  depth: number
  /** mm；非通底表示上下开孔范围（> 0）；通底时不需要直径（可为 null/undefined） */
  diameter?: number | null
  /** 是否通底：true 表示自 depth 起始线通至孔底（不需要直径）；false 表示非通底（以 depth 为轴线，以 diameter 为上下范围） */
  isBottomPort?: boolean
  /** @deprecated 兼容保留：通底已统一由 isBottomPort 承载 */
  through?: boolean
}

/* ---------- §8.4 组合孔布局 ---------- */

export interface Layout {
  /** true = holes[].x/y 存极坐标 (r, θ°)；false = 笛卡尔（原点 = 组合孔中心） */
  polar: boolean
  centerPosition: boolean
}

/* ---------- §8.5 安装轮廓 ---------- */

export type OutlineType = 'none' | 'rect' | 'circle' | 'flange' | 'custom'

export interface Outline {
  /** 轮廓生成类型：none(无轮廓) | rect(矩形) | circle(圆形) | flange(SAE法兰) | custom(自定义) */
  type?: OutlineType
  format: 'svg-path' | 'rect' | string
  /** SVG path 数据，安装面局部笛卡尔坐标（不受 polar 影响），原点 = 组合孔中心，单位 mm；type='none' 时为空字符串 */
  data: string
  /** 兼容保留别名 */
  shapeType?: OutlineType
  /** 形状特定驱动参数（供编辑器持久化各形态尺寸与配置） */
  params?: Record<string, unknown>
}

/* ---------- §8.6 子孔（组合孔专用，内联 / 引用混合模式） ---------- */

export interface HoleRef {
  /** 跨库引用必填；同库引用可省略 */
  libraryId?: string
  templateId: string
}

export interface Hole {
  /** 子孔名（P/T/A/B/X/LP/BH…） */
  name: string
  /** 坐标，语义由父模板 layout.polar 决定（polar 时 x=半径 r，y=角度 θ°） */
  x: number
  y: number
  /** 子孔轴线相对安装面法线的倾斜角（度，0° = 垂直法线正交孔，>0° = 倾斜孔） */
  tiltAngle?: number
  /** 倾斜方位角（度，安装面局部坐标系中自 +X 轴起算逆时针方向，决定偏斜方向） */
  azimuth?: number
  /** @deprecated 兼容保留：单一旋转角，已升级为 (tiltAngle, azimuth) 空间姿态表达 */
  rotation?: number
  /* ---- 内联模式（ref 为 null/缺省）---- */
  cavityType?: CavityType
  geometry?: Geometry | null
  /* ---- 引用模式（ref 非 null）---- */
  ref?: HoleRef | null
}

/* ---------- §8.7 / §8.8 专用子结构 ---------- */

export interface Plug {
  /** 螺堵头部高度 mm */
  headHeight: number
  /** 螺堵旋入深度 mm */
  insertionDepth: number
}

export interface LocatingShoulder {
  /** 定位肩所在台阶下标 */
  stepRef: number
  /** 最小定位肩深度（自安装面起算的累计深度） */
  minDepth: number
}

/* ---------- L4 几何 ---------- */

export interface Geometry {
  steps?: Step[]
  ports?: Port[]
  /** 仅组合孔 */
  layout?: Layout
  /** 仅部分类型 */
  outline?: Outline
  /** 仅 port-cavity */
  plug?: Plug
  /** 仅 cartridge-valve / two-way-cartridge-valve */
  locatingShoulder?: LocatingShoulder
}

/* ---------- §8.10 参考文档 ---------- */

export interface Reference {
  kind: 'pdf' | 'url'
  title: string
  /** pdf：相对库包根目录路径 */
  path?: string | null
  url?: string | null
  pageStart?: number | null
  pageEnd?: number | null
  checksum?: string | null
  note?: string | null
}

/* ---------- §8.12 元件包围盒 ---------- */

export type ComponentBox =
  | {
      name: string
      shape: 'box'
      offsetX?: number
      offsetY?: number
      rotationZ?: number
      size: { x: number; y: number; z: number }
    }
  | {
      name: string
      shape: 'cylinder'
      offsetX?: number
      offsetY?: number
      diameter: number
      height: number
    }

/* ---------- §8.9 标注模板 ---------- */

export interface Annotation {
  template: string
  variables?: Record<string, unknown>
}

/* ---------- §5 模板（L3） ---------- */

export interface CustomProperty {
  name: string
  value: string
}

export interface TemplateMeta {
  properties?: CustomProperty[]
  createdAt: string
  updatedAt: string
  revision: number
  /** 软删除标记 */
  archived?: boolean
  legacyId?: string | null
  standards?: string[]
  supplier?: string
}

export interface CavityTemplate {
  id: string
  name: string
  cavityType: CavityType
  /** 模板级单位（§7.1）：'mm' | 'in' */
  unit: 'mm' | 'in'
  categoryId: string
  geometry: Geometry
  /** 仅组合孔类型存在该字段（非组合孔不出现该 key，V7） */
  holes?: Hole[]
  annotation?: Annotation
  references?: Reference[]
  /** 3D 模型相对路径（可选），如 "models/valve.glb"，支持多个 */
  model3ds?: string[]
  componentBoxes?: ComponentBox[]
  meta: TemplateMeta
}

/* ---------- §4 分类节点（L2） ---------- */

export interface CategoryNode {
  id: string
  name: string
  children: CategoryNode[]
  sortOrder: number
}

/* ---------- §3 库顶层（L1，library.sflib） ---------- */

export type LibrarySource = 'builtin' | 'user' | 'team'

export interface LibraryMeta {
  version: string
  createdAt: string
  updatedAt: string
  locale?: string
  origin?: {
    fromLegacy: boolean
    legacyFile?: string
    legacyId?: string
  } | null
}

export interface CavityLibrary {
  schemaVersion: 1
  kind: 'cavity-library'
  id: string
  name: string
  source: LibrarySource
  meta: LibraryMeta
  categories: CategoryNode[]
  templates: CavityTemplate[]
}

/** 库摘要（列表态，不含模板几何负载） */
export interface LibrarySummary {
  id: string
  name: string
  source: LibrarySource
  /** 库文件夹绝对路径 */
  dirPath: string
  templateCount: number
  readonly: boolean
}

/* ---------- 工厂：新建默认对象 ---------- */

export function nowIso(): string {
  return new Date().toISOString()
}

export function newId(): string {
  return crypto.randomUUID()
}

export function defaultTemplateMeta(): TemplateMeta {
  const t = nowIso()
  return { createdAt: t, updatedAt: t, revision: 1, archived: false }
}

export function defaultCategory(name = '新分类', sortOrder = 0): CategoryNode {
  return { id: newId(), name, children: [], sortOrder }
}

export function defaultTemplate(
  cavityType: CavityType,
  categoryId: string,
  name: string
): CavityTemplate {
  const combo = isComboType(cavityType)
  const allowPorts = cavityType === 'port-cavity' || cavityType === 'cartridge-valve'
  return {
    id: newId(),
    name,
    cavityType,
    unit: 'mm',
    categoryId,
    geometry: combo
      ? { layout: { polar: false, centerPosition: false }, outline: { format: 'svg-path', data: '' } }
      : {
          steps: [{ type: 'straight', diameter: 10, length: 20, thread: null }],
          ...(allowPorts ? { ports: [] as Port[] } : {})
        },
    ...(combo ? { holes: [] as Hole[] } : {}),
    annotation: { template: '<MOD-DIAM><D_end> <HOLE-DEPTH><H_end>' },
    references: [],
    componentBoxes: [],
    meta: defaultTemplateMeta()
  }
}

export function defaultLibrary(name: string, source: LibrarySource = 'user'): CavityLibrary {
  const t = nowIso()
  return {
    schemaVersion: 1,
    kind: 'cavity-library',
    id: newId(),
    name,
    source,
    meta: { version: '1.0.0', createdAt: t, updatedAt: t, locale: 'zh-CN', origin: null },
    categories: [defaultCategory('默认分类', 0)],
    templates: []
  }
}

export type ImportSource = { kind: 'sfzip'; zipPath: string } | { kind: 'folder'; folderPath: string }
