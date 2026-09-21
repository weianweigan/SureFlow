/**
 * 阀块三维设计工程数据模型与类型定义（.sfb）
 *
 * 严格对齐 PRD-FR-04-01、PRD-FR-04-07 规范：
 * - 顶层工程元数据与单基体定义
 * - 多布局方案（变体）集合，共享基体，独立维护孔腔实例列表
 * - 标准 6 主面定义与世界原点投影面坐标系
 */

import type { Step, Port, Outline, CavityType } from '../cavity/types'

export interface FaceParamBinding {
  param: 'dimensions' | 'extraParams'
  key: string
  sign: 1 | -1
  description?: string
}

export interface BaseFaceDefinition {
  id: string
  name: string
  type: 'plane' | 'cylinder'
  normal: [number, number, number]
  origin?: [number, number, number]
  u?: [number, number, number]
  v?: [number, number, number]
  centerPoint?: [number, number, number]
  area?: number
  bounds?: { minX?: number; maxX?: number; minY?: number; maxY?: number; minZ?: number; maxZ?: number }
  paramBinding?: FaceParamBinding
}

export type BaseBodyTemplate = 'box' | 'l-shape' | 't-shape' | 'cross-shape'

/** 材质渲染配置 */
export interface MaterialConfig {
  /** 材料预设 ID */
  presetId: string
  /** 显示颜色 (hex) */
  color: string
  /** 金属度 0~1 */
  metalness: number
  /** 粗糙度 0~1 */
  roughness: number
  /** 不透明度 0~1 (1 = 完全不透明，0.9 = 90% 不透明) */
  opacity: number
  /** 材料密度 (g/cm³)，用户可修改 */
  density?: number
}

/** 常用工程材料预设 */
export const MATERIAL_PRESETS: Record<string, MaterialConfig & { label: string; density: number }> = {
  '45-steel': {
    label: '45# 优质碳素结构钢',
    presetId: '45-steel',
    color: '#a0a4a8',
    metalness: 0.55,
    roughness: 0.35,
    opacity: 0.0,
    density: 7.85
  },
  '40cr': {
    label: '40Cr 合金结构钢',
    presetId: '40cr',
    color: '#94989d',
    metalness: 0.60,
    roughness: 0.30,
    opacity: 0.0,
    density: 7.87
  },
  '6061-t6': {
    label: '6061-T6 铝合金',
    presetId: '6061-t6',
    color: '#c4c8cc',
    metalness: 0.50,
    roughness: 0.25,
    opacity: 0.0,
    density: 2.70
  },
  '7075-t6': {
    label: '7075-T6 超硬铝合金',
    presetId: '7075-t6',
    color: '#ccd0d4',
    metalness: 0.52,
    roughness: 0.22,
    opacity: 0.0,
    density: 2.81
  },
  'qt500': {
    label: 'QT500-7 球墨铸铁',
    presetId: 'qt500',
    color: '#707478',
    metalness: 0.35,
    roughness: 0.55,
    opacity: 0.0,
    density: 7.10
  },
  '304-ss': {
    label: '304 不锈钢',
    presetId: '304-ss',
    color: '#b8bcc0',
    metalness: 0.65,
    roughness: 0.30,
    opacity: 0.0,
    density: 7.93
  },
  'custom': {
    label: '自定义材质',
    presetId: 'custom',
    color: '#a8a8a4',
    metalness: 0.35,
    roughness: 0.45,
    opacity: 0.0,
    density: 7.85
  }
}

/** 根据材料字符串或预设 ID 获取 MaterialConfig（向后兼容） */
export function resolveMaterialConfig(material?: string, config?: MaterialConfig): MaterialConfig {
  if (config) {
    if (config.density === undefined) {
      const p = MATERIAL_PRESETS[config.presetId]
      return { ...config, density: p?.density ?? 7.85 }
    }
    return config
  }
  // 尝试匹配预设
  if (material) {
    for (const [key, preset] of Object.entries(MATERIAL_PRESETS)) {
      if (key === material || preset.label === material) {
        return {
          presetId: preset.presetId,
          color: preset.color,
          metalness: preset.metalness,
          roughness: preset.roughness,
          opacity: preset.opacity,
          density: preset.density
        }
      }
    }
  }
  // 默认回退 45# 钢
  const def = MATERIAL_PRESETS['45-steel']
  return {
    presetId: def.presetId,
    color: def.color,
    metalness: def.metalness,
    roughness: def.roughness,
    opacity: def.opacity,
    density: def.density
  }
}

/** 基体边缘处理模式 */
export type ChamferMode = 'sharp' | 'chamfer-1mm'

export interface BaseBodyConfig {
  type: 'template' | 'step'
  template?: BaseBodyTemplate
  /** 尺寸 [Lx, Ly, Lz] (mm) */
  dimensions: [number, number, number]
  /** @deprecated 请使用 materialConfig，此字段仅保留向后兼容 */
  material?: string
  /** 详细材质渲染配置 */
  materialConfig?: MaterialConfig
  /** 边缘处理：锐边 / 1mm×45° 微倒角 */
  chamfer?: ChamferMode
  stepAssetRef?: string | null
  /** 导入的 STEP 文本或二进制数据 */
  stepContent?: string
  /** 导入的 STEP 原始文件名 */
  stepFileName?: string
  /** 导入的 STEP 原始文件绝对路径（供快速从源文件更新） */
  stepFilePath?: string
  /** 导入的 STEP 几何网格缓存 */
  stepMesh?: {
    positions: Float32Array | number[]
    indices: Uint32Array | number[]
    normals?: Float32Array | number[]
    edgePositions?: Float32Array | number[]
  }
  faces: BaseFaceDefinition[]
  /** 额外几何参数（例如 L 型台阶、T 型凸台、十字形切口） */
  extraParams?: Record<string, number>
}

export interface PortSemantic {
  label: string
  color: string
}

export interface CavityInstance {
  instanceId: string
  name: string
  libraryId: string
  templateId: string
  /** 孔腔类型（9 种类型之一，用于图标渲染与语义匹配） */
  cavityType?: CavityType
  /** 子孔名称（多孔/组合孔类型中的标识，如 P/T/A/B/BH1） */
  subHoleName?: string
  /** 显式台阶定义（用于内联子孔或自定义孔） */
  steps?: Step[]
  /** 侧油口轴向开口范围快照；不表示独立径向钻孔。 */
  ports?: Port[]
  /** 所属组合/分组 ID */
  groupId?: string
  faceId: string
  /** 面坐标系横向偏移 (mm) */
  u: number
  /** 面坐标系纵向偏移 (mm) */
  v: number
  /** 绕法线旋转角 (度) */
  rotation: number
  /** 倾斜角（度，0° = 垂直法线正交孔，>0° = 倾斜孔） */
  tiltAngle?: number
  /** 倾斜方位角（度，安装面局部坐标系中自 +X(U) 轴起算逆时针，决定偏斜朝向） */
  azimuth?: number
  /** 深度偏置 (mm) */
  depthOffset: number
  /** 油口语义标注（P/T/A/B 等） */
  portSemantic?: PortSemantic
  /** 是否临时抑制该特征 */
  suppressed?: boolean
  /** 悬空孔标记：宿主面在模板切换后不存在 */
  dangling?: boolean
}

export interface CavityGroup {
  id: string
  name: string
  /** 组合孔腔类型（如 flange, pattern-valve 等） */
  cavityType?: CavityType
  faceId?: string
  cavityIds: string[]
  /** 组合安装轮廓（SVG path 或标准矩形/法兰） */
  outline?: Outline
  /** 组合中心在宿主面上的 U 坐标 */
  u?: number
  /** 组合中心在宿主面上的 V 坐标 */
  v?: number
  /** 组合特征整体旋转角度（度） */
  rotation?: number
}

/** 通道节点数据模型（由几何相交拓扑计算派生） */
export interface FlowChannel {
  /** 通道唯一标识（如 "channel-port-p" 或 uuid/hash） */
  id: string
  /** 通道持久化绑定键（用于关联用户配置，如 "port:P" 或排序后的成员哈希） */
  bindingKey: string
  /** 通道显示名称（如 "主油路 P"、"通道 1"） */
  name: string
  /** 是否为用户手动重命名 */
  isCustomName?: boolean
  /** 通道分配的渲染颜色（HEX 格式，如 "#EF4444"） */
  color: string
  /** 该通道包含的所有孔腔 instanceId */
  cavityIds: string[]
  /** 精确到侧油口轴向区域的通道成员。 */
  regions?: { cavityId: string; portIndex?: number; minDepth: number; maxDepth: number }[]
  /** 识别出的主油口语义（若存在） */
  primarySemantic?: string
  /** 是否在 3D 视口中隐藏 */
  hidden?: boolean
}

/** 方案级别的通道拓扑快照 */
export interface ChannelTopologyState {
  /** 已连通通道列表 */
  channels: FlowChannel[]
  unconnectedPorts?: { cavityId: string; portIndex: number }[]
  /** 未连通的孤立孔腔 instanceId 集合（排除紧固螺栓孔/定位孔等结构孔） */
  unconnectedCavityIds: string[]
  /** 结构孔（螺栓孔/定位孔等非流道孔列表） */
  structuralCavityIds: string[]
  /** 拓扑计算时间戳 */
  computedAt: number
}

/** 用户对通道个性化配置的持久化映射 */
export interface ChannelUserConfig {
  /** 绑定的特征指纹或主油口名称（如 "port:P"） */
  bindingKey: string
  /** 用户自定义通道名 */
  customName?: string
  /** 用户自定义指定颜色 */
  customColor?: string
  /** 用户设置的显隐状态 */
  hidden?: boolean
}

export interface SchemeDefinition {
  id: string
  name: string
  description?: string
  cavities: CavityInstance[]
  groups?: CavityGroup[]
  /** 用户对通道个性化配置的持久化映射 (key 为 bindingKey) */
  channelConfigs?: Record<string, ChannelUserConfig>
  /** 设计检查配置 (PRD-FR-04-15) */
  checkConfig?: import('./analysis/contracts').CheckConfig
  /** 外部元件模型实例绑定 (PRD-FR-04-15) */
  componentModels?: import('./analysis/contracts').ComponentModelBinding[]
}


export interface SfbProjectMeta {
  projectName: string
  version?: string
  createdAt: string
  modifiedAt: string
  author?: string
  previewImage?: string
  /** 上一次导出 STEP 实体模型的路径（若与 .sfb 同级目录则保存相对路径如 ./block.step） */
  lastExportPath?: string
}

export interface SfbProject {
  $schema?: string
  schemaVersion: string
  meta: SfbProjectMeta
  baseBody: BaseBodyConfig
  activeSchemeId: string
  schemes: SchemeDefinition[]
}

/** 长方体 6 个标准面生成 */
export const STANDARD_BOX_FACES: BaseFaceDefinition[] = [
  { id: 'top', name: '顶面 (Top)', type: 'plane', normal: [0, 0, 1], paramBinding: { param: 'dimensions', key: 'sz', sign: 1, description: '调整基体高度 Lz' } },
  { id: 'bottom', name: '底面 (Bottom)', type: 'plane', normal: [0, 0, -1], paramBinding: { param: 'dimensions', key: 'sz', sign: -1, description: '调整基体高度 Lz' } },
  { id: 'front', name: '前面 (Front)', type: 'plane', normal: [0, -1, 0], paramBinding: { param: 'dimensions', key: 'sy', sign: -1, description: '调整基体宽度 Ly' } },
  { id: 'back', name: '后面 (Back)', type: 'plane', normal: [0, 1, 0], paramBinding: { param: 'dimensions', key: 'sy', sign: 1, description: '调整基体宽度 Ly' } },
  { id: 'left', name: '左面 (Left)', type: 'plane', normal: [-1, 0, 0], paramBinding: { param: 'dimensions', key: 'sx', sign: -1, description: '调整基体长度 Lx' } },
  { id: 'right', name: '右面 (Right)', type: 'plane', normal: [1, 0, 0], paramBinding: { param: 'dimensions', key: 'sx', sign: 1, description: '调整基体长度 Lx' } }
]

/** L型基体标准 8 个面 */
export const L_SHAPE_FACES: BaseFaceDefinition[] = [
  { id: 'top-main', name: '顶主面 (Top Main)', type: 'plane', normal: [0, 0, 1], paramBinding: { param: 'dimensions', key: 'sz', sign: 1, description: '调整基体高度 Lz' } },
  { id: 'top-step', name: '台阶顶面 (Top Step)', type: 'plane', normal: [0, 0, 1], paramBinding: { param: 'extraParams', key: 'cutZ', sign: -1, description: '调整台阶深度 cutZ' } },
  { id: 'bottom', name: '底面 (Bottom)', type: 'plane', normal: [0, 0, -1], paramBinding: { param: 'dimensions', key: 'sz', sign: -1, description: '调整基体高度 Lz' } },
  { id: 'front-main', name: '前主面 (Front Main)', type: 'plane', normal: [0, -1, 0], paramBinding: { param: 'dimensions', key: 'sy', sign: -1, description: '调整基体宽度 Ly' } },
  { id: 'step-wall', name: '阶梯竖面 (Step Wall)', type: 'plane', normal: [1, 0, 0], paramBinding: { param: 'extraParams', key: 'cutX', sign: -1, description: '调整台阶切除 cutX' } },
  { id: 'back', name: '后面 (Back)', type: 'plane', normal: [0, 1, 0], paramBinding: { param: 'dimensions', key: 'sy', sign: 1, description: '调整基体宽度 Ly' } },
  { id: 'left', name: '左面 (Left)', type: 'plane', normal: [-1, 0, 0], paramBinding: { param: 'dimensions', key: 'sx', sign: -1, description: '调整基体长度 Lx' } },
  { id: 'right', name: '右面 (Right)', type: 'plane', normal: [1, 0, 0], paramBinding: { param: 'dimensions', key: 'sx', sign: 1, description: '调整基体长度 Lx' } }
]

/** T型基体标准 10 个面 */
export const T_SHAPE_FACES: BaseFaceDefinition[] = [
  { id: 'top-flange', name: '翼缘顶面 (Top Flange)', type: 'plane', normal: [0, 0, 1], paramBinding: { param: 'dimensions', key: 'sz', sign: 1, description: '调整基体高度 Lz' } },
  { id: 'flange-bottom-left', name: '翼缘左底面 (Flange Bot Left)', type: 'plane', normal: [0, 0, -1], paramBinding: { param: 'extraParams', key: 'cutZ', sign: 1, description: '调整翼缘深度 cutZ' } },
  { id: 'flange-bottom-right', name: '翼缘右底面 (Flange Bot Right)', type: 'plane', normal: [0, 0, -1], paramBinding: { param: 'extraParams', key: 'cutZ', sign: 1, description: '调整翼缘深度 cutZ' } },
  { id: 'bottom-web', name: '腹板底面 (Bottom Web)', type: 'plane', normal: [0, 0, -1], paramBinding: { param: 'dimensions', key: 'sz', sign: -1, description: '调整基体高度 Lz' } },
  { id: 'front', name: '前面 (Front)', type: 'plane', normal: [0, -1, 0], paramBinding: { param: 'dimensions', key: 'sy', sign: -1, description: '调整基体宽度 Ly' } },
  { id: 'back', name: '后面 (Back)', type: 'plane', normal: [0, 1, 0], paramBinding: { param: 'dimensions', key: 'sy', sign: 1, description: '调整基体宽度 Ly' } },
  { id: 'left-flange', name: '翼缘左面 (Left Flange)', type: 'plane', normal: [-1, 0, 0], paramBinding: { param: 'dimensions', key: 'sx', sign: -1, description: '调整基体长度 Lx' } },
  { id: 'right-flange', name: '翼缘右面 (Right Flange)', type: 'plane', normal: [1, 0, 0], paramBinding: { param: 'dimensions', key: 'sx', sign: 1, description: '调整基体长度 Lx' } },
  { id: 'left-web', name: '腹板左面 (Left Web)', type: 'plane', normal: [-1, 0, 0], paramBinding: { param: 'extraParams', key: 'cutX', sign: -1, description: '调整腹板宽度 cutX' } },
  { id: 'right-web', name: '腹板右面 (Right Web)', type: 'plane', normal: [1, 0, 0], paramBinding: { param: 'extraParams', key: 'cutX', sign: -1, description: '调整腹板宽度 cutX' } }
]

/** 十字型基体标准 14 个面 */
export const CROSS_SHAPE_FACES: BaseFaceDefinition[] = [
  { id: 'top-center', name: '顶部中心面 (Top Center)', type: 'plane', normal: [0, 0, 1], paramBinding: { param: 'dimensions', key: 'sz', sign: 1, description: '调整基体高度 Lz' } },
  { id: 'bottom-center', name: '底部中心面 (Bottom Center)', type: 'plane', normal: [0, 0, -1], paramBinding: { param: 'dimensions', key: 'sz', sign: -1, description: '调整基体高度 Lz' } },
  { id: 'left-center', name: '左侧中心面 (Left Center)', type: 'plane', normal: [-1, 0, 0], paramBinding: { param: 'dimensions', key: 'sx', sign: -1, description: '调整基体长度 Lx' } },
  { id: 'right-center', name: '右侧中心面 (Right Center)', type: 'plane', normal: [1, 0, 0], paramBinding: { param: 'dimensions', key: 'sx', sign: 1, description: '调整基体长度 Lx' } },
  { id: 'front', name: '前面 (Front)', type: 'plane', normal: [0, -1, 0], paramBinding: { param: 'dimensions', key: 'sy', sign: -1, description: '调整基体宽度 Ly' } },
  { id: 'back', name: '后面 (Back)', type: 'plane', normal: [0, 1, 0], paramBinding: { param: 'dimensions', key: 'sy', sign: 1, description: '调整基体宽度 Ly' } },
  { id: 'top-left-down', name: '左上凹槽底面 (Top Left Down)', type: 'plane', normal: [0, 0, -1], paramBinding: { param: 'extraParams', key: 'cutZ', sign: 1, description: '调整切口深度 cutZ' } },
  { id: 'top-left-wall', name: '左上凹槽竖面 (Top Left Wall)', type: 'plane', normal: [1, 0, 0], paramBinding: { param: 'extraParams', key: 'cutX', sign: -1, description: '调整切口宽度 cutX' } },
  { id: 'top-right-down', name: '右上凹槽底面 (Top Right Down)', type: 'plane', normal: [0, 0, -1], paramBinding: { param: 'extraParams', key: 'cutZ', sign: 1, description: '调整切口深度 cutZ' } },
  { id: 'top-right-wall', name: '右上凹槽竖面 (Top Right Wall)', type: 'plane', normal: [-1, 0, 0], paramBinding: { param: 'extraParams', key: 'cutX', sign: 1, description: '调整切口宽度 cutX' } },
  { id: 'bot-left-up', name: '左下凹槽顶面 (Bot Left Up)', type: 'plane', normal: [0, 0, 1], paramBinding: { param: 'extraParams', key: 'cutZ', sign: 1, description: '调整切口深度 cutZ' } },
  { id: 'bot-left-wall', name: '左下凹槽竖面 (Bot Left Wall)', type: 'plane', normal: [1, 0, 0], paramBinding: { param: 'extraParams', key: 'cutX', sign: -1, description: '调整切口宽度 cutX' } },
  { id: 'bot-right-up', name: '右下凹槽顶面 (Bot Right Up)', type: 'plane', normal: [0, 0, 1], paramBinding: { param: 'extraParams', key: 'cutZ', sign: 1, description: '调整切口深度 cutZ' } },
  { id: 'bot-right-wall', name: '右下凹槽竖面 (Bot Right Wall)', type: 'plane', normal: [-1, 0, 0], paramBinding: { param: 'extraParams', key: 'cutX', sign: 1, description: '调整切口宽度 cutX' } }
]

export function computeTemplateFaces(
  template: BaseBodyTemplate = 'box',
  dimensions: [number, number, number] = [120, 100, 80],
  extraParams: Record<string, number> = {}
): BaseFaceDefinition[] {
  const [sx, sy, sz] = dimensions
  if (template === 'l-shape') {
    const cutX = extraParams.cutX ?? sx * 0.4
    const cutZ = extraParams.cutZ ?? sz * 0.5
    return [
      { id: 'top-main', name: '顶主面 (Top Main)', type: 'plane', normal: [0, 0, 1], origin: [0, 0, sz], u: [1, 0, 0], v: [0, 1, 0], centerPoint: [(sx - cutX) / 2, sy / 2, sz], paramBinding: { param: 'dimensions', key: 'sz', sign: 1, description: '调整基体高度 Lz' } },
      { id: 'top-step', name: '台阶顶面 (Top Step)', type: 'plane', normal: [0, 0, 1], origin: [0, 0, sz - cutZ], u: [1, 0, 0], v: [0, 1, 0], centerPoint: [sx - cutX / 2, sy / 2, sz - cutZ], paramBinding: { param: 'extraParams', key: 'cutZ', sign: -1, description: '调整台阶深度 cutZ' } },
      { id: 'bottom', name: '底面 (Bottom)', type: 'plane', normal: [0, 0, -1], origin: [0, 0, 0], u: [1, 0, 0], v: [0, -1, 0], centerPoint: [sx / 2, sy / 2, 0], paramBinding: { param: 'dimensions', key: 'sz', sign: -1, description: '调整基体高度 Lz' } },
      { id: 'front-main', name: '前主面 (Front Main)', type: 'plane', normal: [0, -1, 0], origin: [0, 0, 0], u: [1, 0, 0], v: [0, 0, 1], centerPoint: [sx / 2, 0, sz / 2], paramBinding: { param: 'dimensions', key: 'sy', sign: -1, description: '调整基体宽度 Ly' } },
      { id: 'step-wall', name: '阶梯竖面 (Step Wall)', type: 'plane', normal: [1, 0, 0], origin: [sx - cutX, 0, 0], u: [0, 1, 0], v: [0, 0, 1], centerPoint: [sx - cutX, sy / 2, sz - cutZ / 2], paramBinding: { param: 'extraParams', key: 'cutX', sign: -1, description: '调整台阶切除 cutX' } },
      { id: 'back', name: '后面 (Back)', type: 'plane', normal: [0, 1, 0], origin: [0, sy, 0], u: [-1, 0, 0], v: [0, 0, 1], centerPoint: [sx / 2, sy, sz / 2], paramBinding: { param: 'dimensions', key: 'sy', sign: 1, description: '调整基体宽度 Ly' } },
      { id: 'left', name: '左面 (Left)', type: 'plane', normal: [-1, 0, 0], origin: [0, 0, 0], u: [0, -1, 0], v: [0, 0, 1], centerPoint: [0, sy / 2, sz / 2], paramBinding: { param: 'dimensions', key: 'sx', sign: -1, description: '调整基体长度 Lx' } },
      { id: 'right', name: '右面 (Right)', type: 'plane', normal: [1, 0, 0], origin: [sx, 0, 0], u: [0, 1, 0], v: [0, 0, 1], centerPoint: [sx, sy / 2, (sz - cutZ) / 2], paramBinding: { param: 'dimensions', key: 'sx', sign: 1, description: '调整基体长度 Lx' } }
    ]
  }

  if (template === 't-shape') {
    const cutX = extraParams.cutX ?? sx * 0.25
    const cutZ = extraParams.cutZ ?? sz * 0.5
    return [
      { id: 'top-flange', name: '翼缘顶面 (Top Flange)', type: 'plane', normal: [0, 0, 1], origin: [0, 0, sz], u: [1, 0, 0], v: [0, 1, 0], centerPoint: [sx / 2, sy / 2, sz], paramBinding: { param: 'dimensions', key: 'sz', sign: 1, description: '调整基体高度 Lz' } },
      { id: 'flange-bottom-left', name: '翼缘左底面 (Flange Bot Left)', type: 'plane', normal: [0, 0, -1], origin: [0, 0, cutZ], u: [1, 0, 0], v: [0, -1, 0], centerPoint: [cutX / 2, sy / 2, cutZ], paramBinding: { param: 'extraParams', key: 'cutZ', sign: 1, description: '调整翼缘深度 cutZ' } },
      { id: 'flange-bottom-right', name: '翼缘右底面 (Flange Bot Right)', type: 'plane', normal: [0, 0, -1], origin: [0, 0, cutZ], u: [1, 0, 0], v: [0, -1, 0], centerPoint: [sx - cutX / 2, sy / 2, cutZ], paramBinding: { param: 'extraParams', key: 'cutZ', sign: 1, description: '调整翼缘深度 cutZ' } },
      { id: 'bottom-web', name: '腹板底面 (Bottom Web)', type: 'plane', normal: [0, 0, -1], origin: [0, 0, 0], u: [1, 0, 0], v: [0, -1, 0], centerPoint: [sx / 2, sy / 2, 0], paramBinding: { param: 'dimensions', key: 'sz', sign: -1, description: '调整基体高度 Lz' } },
      { id: 'front', name: '前面 (Front)', type: 'plane', normal: [0, -1, 0], origin: [0, 0, 0], u: [1, 0, 0], v: [0, 0, 1], centerPoint: [sx / 2, 0, sz / 2], paramBinding: { param: 'dimensions', key: 'sy', sign: -1, description: '调整基体宽度 Ly' } },
      { id: 'back', name: '后面 (Back)', type: 'plane', normal: [0, 1, 0], origin: [0, sy, 0], u: [-1, 0, 0], v: [0, 0, 1], centerPoint: [sx / 2, sy, sz / 2], paramBinding: { param: 'dimensions', key: 'sy', sign: 1, description: '调整基体宽度 Ly' } },
      { id: 'left-flange', name: '翼缘左面 (Left Flange)', type: 'plane', normal: [-1, 0, 0], origin: [0, 0, 0], u: [0, -1, 0], v: [0, 0, 1], centerPoint: [0, sy / 2, sz - (sz - cutZ) / 2], paramBinding: { param: 'dimensions', key: 'sx', sign: -1, description: '调整基体长度 Lx' } },
      { id: 'right-flange', name: '翼缘右面 (Right Flange)', type: 'plane', normal: [1, 0, 0], origin: [sx, 0, 0], u: [0, 1, 0], v: [0, 0, 1], centerPoint: [sx, sy / 2, sz - (sz - cutZ) / 2], paramBinding: { param: 'dimensions', key: 'sx', sign: 1, description: '调整基体长度 Lx' } },
      { id: 'left-web', name: '腹板左面 (Left Web)', type: 'plane', normal: [-1, 0, 0], origin: [cutX, 0, 0], u: [0, -1, 0], v: [0, 0, 1], centerPoint: [cutX, sy / 2, cutZ / 2], paramBinding: { param: 'extraParams', key: 'cutX', sign: -1, description: '调整腹板宽度 cutX' } },
      { id: 'right-web', name: '腹板右面 (Right Web)', type: 'plane', normal: [1, 0, 0], origin: [sx - cutX, 0, 0], u: [0, 1, 0], v: [0, 0, 1], centerPoint: [sx - cutX, sy / 2, cutZ / 2], paramBinding: { param: 'extraParams', key: 'cutX', sign: -1, description: '调整腹板宽度 cutX' } }
    ]
  }

  if (template === 'cross-shape') {
    const cutX = extraParams.cutX ?? sx * 0.25
    const cutZ = extraParams.cutZ ?? sz * 0.25
    return [
      { id: 'top-center', name: '顶部中心面 (Top Center)', type: 'plane', normal: [0, 0, 1], origin: [0, 0, sz], u: [1, 0, 0], v: [0, 1, 0], centerPoint: [sx / 2, sy / 2, sz], paramBinding: { param: 'dimensions', key: 'sz', sign: 1, description: '调整基体高度 Lz' } },
      { id: 'bottom-center', name: '底部中心面 (Bottom Center)', type: 'plane', normal: [0, 0, -1], origin: [0, 0, 0], u: [1, 0, 0], v: [0, -1, 0], centerPoint: [sx / 2, sy / 2, 0], paramBinding: { param: 'dimensions', key: 'sz', sign: -1, description: '调整基体高度 Lz' } },
      { id: 'left-center', name: '左侧中心面 (Left Center)', type: 'plane', normal: [-1, 0, 0], origin: [0, 0, 0], u: [0, -1, 0], v: [0, 0, 1], centerPoint: [0, sy / 2, sz / 2], paramBinding: { param: 'dimensions', key: 'sx', sign: -1, description: '调整基体长度 Lx' } },
      { id: 'right-center', name: '右侧中心面 (Right Center)', type: 'plane', normal: [1, 0, 0], origin: [sx, 0, 0], u: [0, 1, 0], v: [0, 0, 1], centerPoint: [sx, sy / 2, sz / 2], paramBinding: { param: 'dimensions', key: 'sx', sign: 1, description: '调整基体长度 Lx' } },
      { id: 'front', name: '前面 (Front)', type: 'plane', normal: [0, -1, 0], origin: [0, 0, 0], u: [1, 0, 0], v: [0, 0, 1], centerPoint: [sx / 2, 0, sz / 2], paramBinding: { param: 'dimensions', key: 'sy', sign: -1, description: '调整基体宽度 Ly' } },
      { id: 'back', name: '后面 (Back)', type: 'plane', normal: [0, 1, 0], origin: [0, sy, 0], u: [-1, 0, 0], v: [0, 0, 1], centerPoint: [sx / 2, sy, sz / 2], paramBinding: { param: 'dimensions', key: 'sy', sign: 1, description: '调整基体宽度 Ly' } },
      { id: 'top-left-down', name: '左上凹槽底面 (Top Left Down)', type: 'plane', normal: [0, 0, -1], origin: [0, 0, sz - cutZ], u: [1, 0, 0], v: [0, -1, 0], centerPoint: [cutX / 2, sy / 2, sz - cutZ], paramBinding: { param: 'extraParams', key: 'cutZ', sign: 1, description: '调整切口深度 cutZ' } },
      { id: 'top-left-wall', name: '左上凹槽竖面 (Top Left Wall)', type: 'plane', normal: [1, 0, 0], origin: [cutX, 0, 0], u: [0, 1, 0], v: [0, 0, 1], centerPoint: [cutX, sy / 2, sz - cutZ / 2], paramBinding: { param: 'extraParams', key: 'cutX', sign: -1, description: '调整切口宽度 cutX' } },
      { id: 'top-right-down', name: '右上凹槽底面 (Top Right Down)', type: 'plane', normal: [0, 0, -1], origin: [0, 0, sz - cutZ], u: [1, 0, 0], v: [0, -1, 0], centerPoint: [sx - cutX / 2, sy / 2, sz - cutZ], paramBinding: { param: 'extraParams', key: 'cutZ', sign: 1, description: '调整切口深度 cutZ' } },
      { id: 'top-right-wall', name: '右上凹槽竖面 (Top Right Wall)', type: 'plane', normal: [-1, 0, 0], origin: [sx - cutX, 0, 0], u: [0, -1, 0], v: [0, 0, 1], centerPoint: [sx - cutX, sy / 2, sz - cutZ / 2], paramBinding: { param: 'extraParams', key: 'cutX', sign: 1, description: '调整切口宽度 cutX' } },
      { id: 'bot-left-up', name: '左下凹槽顶面 (Bot Left Up)', type: 'plane', normal: [0, 0, 1], origin: [0, 0, cutZ], u: [1, 0, 0], v: [0, 1, 0], centerPoint: [cutX / 2, sy / 2, cutZ], paramBinding: { param: 'extraParams', key: 'cutZ', sign: 1, description: '调整切口深度 cutZ' } },
      { id: 'bot-left-wall', name: '左下凹槽竖面 (Bot Left Wall)', type: 'plane', normal: [1, 0, 0], origin: [cutX, 0, 0], u: [0, 1, 0], v: [0, 0, 1], centerPoint: [cutX, sy / 2, cutZ / 2], paramBinding: { param: 'extraParams', key: 'cutX', sign: -1, description: '调整切口宽度 cutX' } },
      { id: 'bot-right-up', name: '右下凹槽顶面 (Bot Right Up)', type: 'plane', normal: [0, 0, 1], origin: [sx - cutX, 0, cutZ], u: [1, 0, 0], v: [0, 1, 0], centerPoint: [sx - cutX / 2, sy / 2, cutZ], paramBinding: { param: 'extraParams', key: 'cutZ', sign: 1, description: '调整切口深度 cutZ' } },
      { id: 'bot-right-wall', name: '右下凹槽竖面 (Bot Right Wall)', type: 'plane', normal: [-1, 0, 0], origin: [sx - cutX, 0, 0], u: [0, -1, 0], v: [0, 0, 1], centerPoint: [sx - cutX, sy / 2, cutZ / 2], paramBinding: { param: 'extraParams', key: 'cutX', sign: 1, description: '调整切口宽度 cutX' } }
    ]
  }

  return [
    { id: 'top', name: '顶面 (Top)', type: 'plane', normal: [0, 0, 1], origin: [0, 0, sz], u: [1, 0, 0], v: [0, 1, 0], centerPoint: [sx / 2, sy / 2, sz], paramBinding: { param: 'dimensions', key: 'sz', sign: 1, description: '调整基体高度 Lz' } },
    { id: 'bottom', name: '底面 (Bottom)', type: 'plane', normal: [0, 0, -1], origin: [0, 0, 0], u: [1, 0, 0], v: [0, -1, 0], centerPoint: [sx / 2, sy / 2, 0], paramBinding: { param: 'dimensions', key: 'sz', sign: -1, description: '调整基体高度 Lz' } },
    { id: 'front', name: '前面 (Front)', type: 'plane', normal: [0, -1, 0], origin: [0, 0, 0], u: [1, 0, 0], v: [0, 0, 1], centerPoint: [sx / 2, 0, sz / 2], paramBinding: { param: 'dimensions', key: 'sy', sign: -1, description: '调整基体宽度 Ly' } },
    { id: 'back', name: '后面 (Back)', type: 'plane', normal: [0, 1, 0], origin: [0, sy, 0], u: [-1, 0, 0], v: [0, 0, 1], centerPoint: [sx / 2, sy, sz / 2], paramBinding: { param: 'dimensions', key: 'sy', sign: 1, description: '调整基体宽度 Ly' } },
    { id: 'left', name: '左面 (Left)', type: 'plane', normal: [-1, 0, 0], origin: [0, 0, 0], u: [0, -1, 0], v: [0, 0, 1], centerPoint: [0, sy / 2, sz / 2], paramBinding: { param: 'dimensions', key: 'sx', sign: -1, description: '调整基体长度 Lx' } },
    { id: 'right', name: '右面 (Right)', type: 'plane', normal: [1, 0, 0], origin: [sx, 0, 0], u: [0, 1, 0], v: [0, 0, 1], centerPoint: [sx, sy / 2, sz / 2], paramBinding: { param: 'dimensions', key: 'sx', sign: 1, description: '调整基体长度 Lx' } }
  ]
}

export function getFacesForTemplate(
  template?: BaseBodyTemplate,
  dimensions?: [number, number, number],
  extraParams?: Record<string, number>
): BaseFaceDefinition[] {
  return computeTemplateFaces(template || 'box', dimensions, extraParams)
}

export function getBaseBodyIcon(body: BaseBodyConfig): string {
  if (body.type === 'step') return 'ImportStep.svg'
  switch (body.template) {
    case 'l-shape':
      return 'LBlock.svg'
    case 't-shape':
      return 'TBlock.svg'
    case 'cross-shape':
      return 'CrossBlock.svg'
    case 'box':
    default:
      return 'Block.svg'
  }
}

/**
 * 创建新工程的默认初始状态（访谈决策：120×100×80mm 长方体 + 方案 1）
 */
export function createDefaultProject(projectName: string = '未命名工程'): SfbProject {
  const now = new Date().toISOString()
  const defaultSchemeId = 'scheme-01'

  return {
    $schema: 'https://sureflow.dev/schemas/sfb-v1.json',
    schemaVersion: '1.0.0',
    meta: {
      projectName,
      version: '1.0.0',
      createdAt: now,
      modifiedAt: now,
      author: 'SureFlow User'
    },
    baseBody: {
      type: 'template',
      template: 'box',
      dimensions: [120, 100, 80],
      material: '45# 优质碳素结构钢',
      materialConfig: {
        presetId: '45-steel',
        color: '#a0a4a8',
        metalness: 0.55,
        roughness: 0.35,
        opacity: 0.0,
        density: 7.85
      },
      stepAssetRef: null,
      faces: computeTemplateFaces('box', [120, 100, 80])
    },
    activeSchemeId: defaultSchemeId,
    schemes: [
      {
        id: defaultSchemeId,
        name: '方案 1 (默认)',
        description: '初始空布局方案',
        cavities: [],
        groups: []
      }
    ]
  }
}
