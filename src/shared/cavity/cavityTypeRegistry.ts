/**
 * 孔腔类型注册表（PRD-002 §6.2 字段矩阵 → 代码化）
 *
 * NFR-13「新增类型不改核心代码」的落点：新增类型 = 在 TYPE_REGISTRY 登记
 * 一行矩阵 + 表单分段配置；校验器与表单引擎读取注册表自动适配。
 *
 * 该注册表同时驱动：
 * 1. 校验（V6/V7：模板不得包含类型不允许的子结构）
 * 2. 右侧属性表单分段渲染（schema 驱动）
 * 3. 预览视图选择（剖面图 vs 安装面图）
 */

import type { CavityType } from './types'

/** §6.2 类型 × 几何子结构矩阵 */
export interface AllowedStructures {
  steps: boolean
  thread: boolean
  ports: boolean
  layout: boolean
  outline: boolean
  holes: boolean
  plug: boolean
  locatingShoulder: boolean
}

/* ---------- 表单 schema 描述符 ---------- */

export type WidgetKind = 'number' | 'text' | 'select' | 'toggle'

export interface FieldDef {
  /** 相对模板根的对象路径（用于 UpdateCmd 深路径） */
  key: string
  label: string
  widget: WidgetKind
  options?: { value: string; label: string }[]
  min?: number
  max?: number
  step?: number
  /** 显示单位后缀 */
  unitSuffix?: string
  placeholder?: string
  /** 仅整数字段 */
  integer?: boolean
}

/** 专用编辑器段落（steps/ports/holes 等动态数组，由专用组件渲染） */
export type CustomSectionKey =
  | 'steps'
  | 'ports'
  | 'holes'
  | 'layout'
  | 'outline'
  | 'componentBoxes'
  | 'references'
  | 'model3d'
  | 'annotation'

export interface FormSection {
  key: string
  label: string
  /** 标量字段组（schema 驱动渲染） */
  fields?: FieldDef[]
  /** 动态数组专用编辑器 */
  custom?: CustomSectionKey
}

export interface TypeSchema {
  type: CavityType
  label: string
  /** 组合孔（纯容器：无 steps/thread/ports，几何全在 holes） */
  isCombo: boolean
  allowed: AllowedStructures
  formSections: FormSection[]
}

/* ---------- 公共段落 ---------- */

const SECTION_BASIC: FormSection = {
  key: 'basic',
  label: '基本信息',
  fields: [
    { key: 'name', label: '名称', widget: 'text', placeholder: '如 ECBGM-03' },
    {
      key: 'cavityType',
      label: '类型',
      widget: 'select',
      options: [
        { value: 'drill-hole', label: '钻孔' },
        { value: 'bolt-hole', label: '螺栓孔' },
        { value: 'port-cavity', label: '油口' },
        { value: 'cartridge-valve', label: '螺纹插装阀孔' },
        { value: 'locating-pin-hole', label: '定位销孔' },
        { value: 'flange', label: '法兰油口' },
        { value: 'pattern-valve', label: '板式阀安装面' },
        { value: 'two-way-cartridge-valve', label: '二通插装阀孔' },
        { value: 'foot-print', label: '安装轮廓' }
      ]
    },
    {
      key: 'unit',
      label: '单位',
      widget: 'select',
      options: [
        { value: 'mm', label: 'mm' },
        { value: 'in', label: 'in' }
      ]
    }
  ]
}

const SECTION_META: FormSection = {
  key: 'meta',
  label: '备注信息',
  fields: [
    { key: 'meta.supplier', label: '供应商', widget: 'text', placeholder: '如 SUN' },
    { key: 'meta.remark', label: '备注', widget: 'text', placeholder: '如 GB 825-1988' },
    { key: 'meta.standards.0', label: '标准', widget: 'text', placeholder: '如 GB/T 2878' }
  ]
}

const SECTION_STEPS: FormSection = { key: 'steps', label: '台阶序列', custom: 'steps' }
const SECTION_PORTS: FormSection = { key: 'ports', label: '侧油口', custom: 'ports' }
const SECTION_HOLES: FormSection = { key: 'holes', label: '子孔', custom: 'holes' }
const SECTION_LAYOUT: FormSection = { key: 'layout', label: '布局', custom: 'layout' }
const SECTION_OUTLINE: FormSection = { key: 'outline', label: '安装轮廓', custom: 'outline' }
const SECTION_COMPONENT_BOXES: FormSection = { key: 'componentBoxes', label: '元件包围盒', custom: 'componentBoxes' }
const SECTION_ANNOTATION: FormSection = { key: 'annotation', label: '标注信息', custom: 'annotation' }
const SECTION_MODEL3D: FormSection = { key: 'model3d', label: '3D 预览模型', custom: 'model3d' }
const SECTION_REFERENCES: FormSection = { key: 'references', label: '参考文档', custom: 'references' }

const SECTION_PLUG: FormSection = {
  key: 'plug',
  label: '螺堵',
  fields: [
    { key: 'geometry.plug.headHeight', label: '头部高度', widget: 'number', min: 0, unitSuffix: 'mm' },
    { key: 'geometry.plug.insertionDepth', label: '旋入深度', widget: 'number', min: 0, unitSuffix: 'mm' }
  ]
}

const SECTION_SHOULDER: FormSection = {
  key: 'locatingShoulder',
  label: '定位肩',
  fields: [
    { key: 'geometry.locatingShoulder.stepRef', label: '所在台阶', widget: 'number', min: 0, integer: true },
    { key: 'geometry.locatingShoulder.minDepth', label: '最小深度', widget: 'number', min: 0, unitSuffix: 'mm' }
  ]
}

/* ---------- §6.2 矩阵落码 ---------- */

const M = (
  steps: boolean,
  thread: boolean,
  ports: boolean,
  layout: boolean,
  outline: boolean,
  holes: boolean,
  plug: boolean,
  locatingShoulder: boolean
): AllowedStructures => ({
  steps,
  thread,
  ports,
  layout,
  outline,
  holes,
  plug,
  locatingShoulder
})

function schema(
  type: CavityType,
  label: string,
  allowed: AllowedStructures
): TypeSchema {
  const isCombo = allowed.holes
  const sections: FormSection[] = [SECTION_BASIC]
  if (allowed.steps) sections.push(SECTION_STEPS)
  if (allowed.ports) sections.push(SECTION_PORTS)
  if (allowed.plug) sections.push(SECTION_PLUG)
  if (allowed.locatingShoulder) sections.push(SECTION_SHOULDER)
  if (allowed.layout) sections.push(SECTION_LAYOUT)
  if (allowed.outline) sections.push(SECTION_OUTLINE)
  if (allowed.holes) sections.push(SECTION_HOLES)
  sections.push(SECTION_COMPONENT_BOXES)
  sections.push(SECTION_ANNOTATION)
  sections.push(SECTION_MODEL3D)
  sections.push(SECTION_REFERENCES)
  sections.push(SECTION_META)
  return { type, label, isCombo, allowed, formSections: sections }
}

export const TYPE_REGISTRY: Record<CavityType, TypeSchema> = {
  'drill-hole': schema('drill-hole', '钻孔', M(true, false, false, false, false, false, false, false)),
  'bolt-hole': schema('bolt-hole', '螺栓孔', M(true, true, false, false, false, false, false, false)),
  'port-cavity': schema(
    'port-cavity',
    '油口',
    M(true, true, true, false, false, false, true, false)
  ),
  'cartridge-valve': schema(
    'cartridge-valve',
    '螺纹插装阀孔',
    M(true, true, true, false, false, false, false, true)
  ),
  'locating-pin-hole': schema(
    'locating-pin-hole',
    '定位销孔',
    M(true, false, false, false, false, false, false, false)
  ),
  flange: schema('flange', '法兰油口', M(false, false, false, true, true, true, false, false)),
  'pattern-valve': schema(
    'pattern-valve',
    '板式阀安装面',
    M(false, false, false, true, true, true, false, false)
  ),
  'two-way-cartridge-valve': schema(
    'two-way-cartridge-valve',
    '二通插装阀孔',
    M(false, false, false, true, true, true, false, false)
  ),
  'foot-print': schema('foot-print', '安装轮廓', M(false, false, false, true, true, true, false, false))
}

export const ALL_CAVITY_TYPES: CavityType[] = Object.keys(TYPE_REGISTRY) as CavityType[]

export function typeLabel(t: CavityType): string {
  return TYPE_REGISTRY[t].label
}

export const THREAD_FAMILIES: { value: string; label: string }[] = [
  { value: 'METRIC', label: 'METRIC（公制 M）' },
  { value: 'UN', label: 'UN（英制统一螺纹）' },
  { value: 'NPT', label: 'NPT（锥管螺纹）' },
  { value: 'BSPP', label: 'BSPP / G（平行管螺纹）' },
  { value: 'BSPT', label: 'BSPT / PT·Rc（锥管密封）' }
]
