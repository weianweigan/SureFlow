/**
 * 规则注册表与元数据 (Rule Registry & Metadata)
 * 严格对齐 PRD-FR-04-15 §6
 */

import type { Severity } from './contracts'

export type RuleCategory =
  | 'clearance'
  | 'geometry'
  | 'flow'
  | 'machining'
  | 'component'
  | 'outline'

export interface RuleDefinition {
  id: string
  version: string
  title: string
  category: RuleCategory
  severity: Severity
  purpose: string
  scope: string
  evidenceDescription: string
  remediationTemplate: string
  defaultEnabled: boolean
}

export const RULE_DEFINITIONS: Record<string, RuleDefinition> = {
  'CLR-001': {
    id: 'CLR-001',
    version: '1.0.0',
    title: '孔间残余壁厚不足',
    category: 'clearance',
    severity: 'error',
    purpose: '检查孔腔与孔腔之间的残余材料厚度是否满足耐压与结构壁厚要求',
    scope: '未被抑制的有效孔腔实例对',
    evidenceDescription: '最近点对坐标、材料内壁厚线段、残余薄壁位置',
    remediationTemplate: '调整两孔间距、减小相关台阶直径或修改孔深',
    defaultEnabled: true
  },
  'CLR-002': {
    id: 'CLR-002',
    version: '1.0.0',
    title: '孔到外表面壁厚不足',
    category: 'clearance',
    severity: 'error',
    purpose: '检查孔腔与基体有限外表面之间的残余材料厚度是否满足耐压要求',
    scope: '未被抑制的有效孔腔与基体外表面（排除正常安装入口与已确认承接面）',
    evidenceDescription: '孔壁到外表面的最近点对及垂直距离',
    remediationTemplate: '调整孔在面上的布置位置 (U, V)、修改孔深或增大基体外形尺寸',
    defaultEnabled: true
  },
  'GEO-001': {
    id: 'GEO-001',
    version: '1.0.0',
    title: '无承接孔腔的异常穿破',
    category: 'geometry',
    severity: 'error',
    purpose: '检查孔腔是否异常钻透基体其他表面且无有效承接孔连通覆盖',
    scope: '所有盲孔与非预留贯穿孔',
    evidenceDescription: '穿出口轮廓、未被承接覆盖的残余穿出区域',
    remediationTemplate: '减小孔深、修正倾角或在穿出位置配置合法承接孔/堵头',
    defaultEnabled: true
  },
  'FLOW-001': {
    id: 'FLOW-001',
    version: '1.0.0',
    title: '孤立油口或流道孔',
    category: 'flow',
    severity: 'warning',
    purpose: '检测流道网络中未与任何其他流道孔连通的孤立油口或孔腔（排除结构紧固孔）',
    scope: '非结构用途的流道孔腔与侧油口',
    evidenceDescription: '孤立孔腔 ID 与油口区域',
    remediationTemplate: '布设工艺连通孔连接至目标油路，或确认该孔是否多余',
    defaultEnabled: true
  },
  'FLOW-002': {
    id: 'FLOW-002',
    version: '1.0.0',
    title: '局部交汇开口面积不足',
    category: 'flow',
    severity: 'error',
    purpose: '检查两孔相交处的过流开口有效截面积及其相对于流道参考截面的比例是否达标',
    scope: '物理相交连通的流道孔对交汇区域',
    evidenceDescription: '相交开口截面积、两侧参考流通截面积及比例',
    remediationTemplate: '增大交叉孔钻深以形成更充分重叠、增大孔径或调整交汇偏心距',
    defaultEnabled: true
  },
  'FLOW-003': {
    id: 'FLOW-003',
    version: '1.0.0',
    title: '分支段瓶颈截面不足',
    category: 'flow',
    severity: 'error',
    purpose: '检查流道分支沿程各段（台阶、细孔段）的最窄流通截面积是否满足要求',
    scope: '通道内部所有有效流动分支段',
    evidenceDescription: '分支内最窄截面位置、瓶颈面积及关联油口对',
    remediationTemplate: '增大该细孔段的直径，避免形成严重限流节点',
    defaultEnabled: true
  },
  'FLOW-004': {
    id: 'FLOW-004',
    version: '1.0.0',
    title: '油口对不存在截面达标通路',
    category: 'flow',
    severity: 'error',
    purpose: '针对通道内所有油口对，基于 Widest-Path 分析是否存在至少一条全程截面积达标的连通路径',
    scope: '同一连通通道内的全部油口对组合',
    evidenceDescription: '油口对最佳路线、该路线上的瓶颈边及瓶颈截面积',
    remediationTemplate: '打通或扩径关键受阻孔道，或增加辅助并联流道',
    defaultEnabled: true
  },
  'MFG-001': {
    id: 'MFG-001',
    version: '1.0.0',
    title: '进刀通路阻挡',
    category: 'machining',
    severity: 'warning',
    purpose: '预检从工件外沿孔轴向钻削进入时，是否存在基体凸起台阶等实体结构阻挡刀具行程',
    scope: '所有需要钻削加工的孔腔',
    evidenceDescription: '进刀轴线延长线、干涉阻挡实体位置与进刀包络',
    remediationTemplate: '调整孔位避开阻挡凸台，或调整基体几何特征',
    defaultEnabled: true
  },
  'MFG-002': {
    id: 'MFG-002',
    version: '1.0.0',
    title: '斜面或边缘钻入风险',
    category: 'machining',
    severity: 'warning',
    purpose: '预检孔口是否位于斜面上且夹角过大容易引偏，或孔口跨越不同面/基体棱边导致断续切削断刀',
    scope: '所有开孔入口',
    evidenceDescription: '入口孔口投影轮廓、跨越的棱边或非正交法向夹角',
    remediationTemplate: '先铣平局部引孔平台，或将孔位移出棱边区域',
    defaultEnabled: true
  },
  'MFG-003': {
    id: 'MFG-003',
    version: '1.0.0',
    title: '深径比超限',
    category: 'machining',
    severity: 'warning',
    purpose: '预检细长孔的累计到达深度与直径比值是否超过设定的深孔加工工艺上限',
    scope: '所有具有直线钻削台阶的孔腔',
    evidenceDescription: '钻孔有效到达深度 L、钻削直径 D、实测深径比 L/D 及允许上限',
    remediationTemplate: '加大孔径、缩减不必要深度，或分段从双向对打',
    defaultEnabled: true
  },
  'MFG-004': {
    id: 'MFG-004',
    version: '1.0.0',
    title: '交叉孔断续切削风险',
    category: 'machining',
    severity: 'warning',
    purpose: '预检交叉相交孔在钻入时遇到的断续切削冲击，提示工艺排程与进给控制',
    scope: '所有横向交叉相交的钻孔对',
    evidenceDescription: '两孔相交相贯区域及可能受冲击的进刀段',
    remediationTemplate: '选用高刚性钻头、优化排屑工艺或调整切削进给参数',
    defaultEnabled: true
  },
  'GEO-002': {
    id: 'GEO-002',
    version: '1.0.0',
    title: '重复孔',
    category: 'geometry',
    severity: 'warning',
    purpose: '检测模型中完全重合的重复孔腔定义，避免重复切削计算与出图冗余',
    scope: '全部有效孔腔',
    evidenceDescription: '重复的孔腔实例集合及重合坐标',
    remediationTemplate: '删除多余的重复孔腔实例',
    defaultEnabled: true
  },
  'GEO-003': {
    id: 'GEO-003',
    version: '1.0.0',
    title: '已确认无效设计几何',
    category: 'geometry',
    severity: 'error',
    purpose: '检测非有限坐标 (NaN/Infinity)、非正直径/深度、非法退化截面等异常几何',
    scope: '全部孔腔与基体参数',
    evidenceDescription: '具体非法参数字段及取值',
    remediationTemplate: '修复孔腔或基体属性中的非法数值',
    defaultEnabled: true
  },
  'CMP-001': {
    id: 'CMP-001',
    version: '1.0.0',
    title: '真实元件实体干涉',
    category: 'component',
    severity: 'error',
    purpose: '检测已绑定外部真实 3D 模型（STEP/STL/GLB）的元件与阀块剩余材料或其他元件之间的碰撞干涉',
    scope: '已开启“使用元件模型”且成功绑定的元件实例',
    evidenceDescription: '相交干涉区域、侵入体积或交线位置',
    remediationTemplate: '调整元件安装间距，或调整周围孔位与基体外壁',
    defaultEnabled: true
  },
  'CMP-002': {
    id: 'CMP-002',
    version: '1.0.0',
    title: '简化元件外形碰撞',
    category: 'component',
    severity: 'warning',
    purpose: '基于孔腔定义的简化外部包络（如圆柱体/长方体外形）预检安装碰撞风险',
    scope: '已开启元件检查但未绑定外部真实模型的孔腔',
    evidenceDescription: '简化包络相交区域及近似依据',
    remediationTemplate: '调整孔间距，或导入真实 3D 元件模型做高精度校验',
    defaultEnabled: true
  },
  'CMP-003': {
    id: 'CMP-003',
    version: '1.0.0',
    title: '三维元件净距不足',
    category: 'component',
    severity: 'warning',
    purpose: '检查两元件之间或元件与阀块非配合表面之间的 3D 净空间是否小于设定阈值',
    scope: '启用三维检查的元件与阀块外形',
    evidenceDescription: '最近点对及空间净距',
    remediationTemplate: '增大元件布局间距以预留操作与散热维修空间',
    defaultEnabled: true
  },
  'OUT-001': {
    id: 'OUT-001',
    version: '1.0.0',
    title: '二维安装轮廓重叠',
    category: 'outline',
    severity: 'error',
    purpose: '检查同一安装平面上不同元件/组合孔的二维安装安装法兰轮廓是否发生重叠',
    scope: '共面安装的孔腔或组合实例二维轮廓',
    evidenceDescription: '平面内轮廓重叠区域',
    remediationTemplate: '错开两孔在面上的安装坐标或旋转调整方向',
    defaultEnabled: true
  },
  'OUT-002': {
    id: 'OUT-002',
    version: '1.0.0',
    title: '二维安装轮廓净距不足',
    category: 'outline',
    severity: 'warning',
    purpose: '检查共面安装轮廓之间的二维边界最小间隙是否小于设定净距',
    scope: '共面安装的二维轮廓对',
    evidenceDescription: '平面内两轮廓最近点及二维净距',
    remediationTemplate: '微调平面安装位置以达到规定的安装边距',
    defaultEnabled: true
  }
}

export const RULE_CATEGORY_LABELS: Record<RuleCategory, string> = {
  clearance: '残余壁厚',
  geometry: '几何与穿破',
  flow: '流道与截面',
  machining: '加工预检',
  component: '元件干涉',
  outline: '二维轮廓'
}
