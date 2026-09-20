/**
 * 设计检查与主动间隙分析数据契约 (Design Checks & Clearance Analysis Contracts)
 * 严格对齐 PRD-FR-04-15 §13
 */

export type Severity = 'error' | 'warning'
export type LengthUnit = 'mm' | 'cm' | 'm' | 'in'
export type AreaUnit = 'mm2' | 'cm2' | 'm2' | 'in2'

export interface LengthValue {
  value: number
  unit: LengthUnit
}

export interface AreaValue {
  value: number
  unit: AreaUnit
}

export type EntityRef =
  | { kind: 'cavity'; instanceId: string }
  | { kind: 'port'; instanceId: string; portId: string }
  | { kind: 'base-face'; faceId: string; geometryFingerprint?: string }
  | { kind: 'component'; ownerKind: 'cavity' | 'group'; ownerId: string }
  | { kind: 'outline'; ownerKind: 'cavity' | 'group'; ownerId: string }

export interface AreaLimits {
  absolute: AreaValue | null
  ratio: number | null // 0..1；null 表示未启用
}

export interface RuleOverride {
  id: string
  ruleId: string
  scope:
    | { kind: 'entity'; entity: EntityRef }
    | { kind: 'pair'; entities: [EntityRef, EntityRef] }
    | { kind: 'connection'; connectionKey: string; entities: EntityRef[] }
  values: {
    minDistance?: LengthValue
    absolute?: AreaValue | null
    ratio?: number | null
  }
}

export interface CheckConfig {
  schemaVersion: 1
  autoEnabled: boolean
  ruleEnabled: Record<string, boolean>
  minHoleWall: LengthValue
  minOuterWall: LengthValue
  localOpeningLimits: AreaLimits
  pathBottleneckLimits: AreaLimits
  minOutlineClearance: LengthValue
  minComponentClearance: LengthValue
  maxDepthDiameterRatio: number | null
  overrides: RuleOverride[]
}

export interface ComponentModelBinding {
  ownerKind: 'cavity' | 'group'
  ownerId: string
  enabled: boolean
  external?: {
    format: 'step' | 'stl' | 'glb'
    path: string
    pathMode: 'project-relative' | 'absolute'
    originalAbsolutePath?: string
    stlSourceUnit?: LengthUnit
    importPolicyVersion: string
  }
}

export interface AnalysisStamp {
  sessionId: string
  requestId: string
  projectId: string
  schemeId: string
  modelRevision: number
  configRevision: number
  resourceRevision: number
  ruleSetVersion: string
  geometryPolicyVersion: string
}

export type Precision = 'brep' | 'validated-mesh' | 'mixed' | 'simplified'
export type Vec3 = [number, number, number]

export interface Measure {
  name: string
  value: number
  unit: 'mm' | 'mm2' | 'mm3' | 'ratio' | 'deg'
  lowerBound?: number
  upperBound?: number
}

export interface GeometryEvidence {
  refs: EntityRef[]
  points?: Vec3[]
  lines?: [Vec3, Vec3][]
  regionHandle?: string
  sectionHandles?: string[]
  pathEdgeIds?: string[]
  focusBounds?: { min: Vec3; max: Vec3 }
}

export interface CheckIssue {
  id: string
  stableKey: string
  ruleId: string
  ruleVersion: string
  stamp: AnalysisStamp
  severity: Severity
  messageKey: string
  messageArgs: Record<string, string | number>
  measurements: Measure[]
  requirements: Measure[]
  precision: Precision
  evidence: GeometryEvidence
  remediation?: string
}

export interface CheckObservation {
  id: string
  stamp: AnalysisStamp
  ruleId: string
  refs: EntityRef[]
  measurements: Measure[]
  evidence?: GeometryEvidence
}

export type AnalysisRequest =
  | {
      type: 'run'
      stamp: AnalysisStamp
      mode: 'full' | 'incremental'
      payload: {
        dimensions: [number, number, number]
        baseBody: any
        cavities: any[]
        config: CheckConfig
        componentBindings?: ComponentModelBinding[]
      }
    }
  | {
      type: 'measure'
      stamp: AnalysisStamp
      objects: EntityRef[]
      payload: {
        dimensions: [number, number, number]
        baseBody: any
        cavities: any[]
      }
    }
  | {
      type: 'cancel'
      sessionId: string
      requestId: string
    }

export type ActiveClearanceRelation = 'separated' | 'contacting' | 'intersecting' | 'containing'

export interface ActiveClearanceResult {
  dist: number
  relation: ActiveClearanceRelation
  pointA?: Vec3
  pointB?: Vec3
  objectA: EntityRef
  objectB: EntityRef
  objectAName?: string
  objectBName?: string
  unit: 'mm'
  /** Manifold-3D minGap 实体实测基准真值 (双轨校验) */
  minGap?: number
  /** 是否已通过 Manifold minGap 双轨基准校验 */
  verifiedByMinGap?: boolean
  /** 解析计算与 Manifold minGap 之间的偏差 (mm) */
  gapDiscrepancy?: number
}

export type AnalysisResponse =
  | { type: 'started'; stamp: AnalysisStamp }
  | { type: 'progress'; stamp: AnalysisStamp; done: number; total?: number }
  | {
      type: 'batch'
      stamp: AnalysisStamp
      scopeKeys: string[]
      issues: CheckIssue[]
      observations: CheckObservation[]
    }
  | {
      type: 'finished'
      stamp: AnalysisStamp
      evaluated: number
      skipped: number
      failed: number
    }
  | { type: 'cancelled'; stamp: AnalysisStamp }
  | { type: 'worker-failed'; stamp: AnalysisStamp; diagnosticCode: string }
  | {
      type: 'measure-result'
      stamp: AnalysisStamp
      result?: ActiveClearanceResult
      results: ActiveClearanceResult[]
    }

/** 默认检查配置 (PRD §5) */
export const DEFAULT_CHECK_CONFIG: CheckConfig = {
  schemaVersion: 1,
  autoEnabled: true,
  ruleEnabled: {
    'CLR-001': true,
    'CLR-002': true,
    'GEO-001': true,
    'FLOW-001': true,
    'FLOW-002': true,
    'FLOW-003': true,
    'FLOW-004': true,
    'MFG-001': true,
    'MFG-002': true,
    'MFG-003': true,
    'MFG-004': true,
    'GEO-002': true,
    'GEO-003': true,
    'CMP-001': true,
    'CMP-002': true,
    'CMP-003': true,
    'OUT-001': true,
    'OUT-002': true
  },
  minHoleWall: { value: 5, unit: 'mm' },
  minOuterWall: { value: 5, unit: 'mm' },
  localOpeningLimits: { absolute: null, ratio: null },
  pathBottleneckLimits: { absolute: null, ratio: null },
  minOutlineClearance: { value: 0, unit: 'mm' },
  minComponentClearance: { value: 0, unit: 'mm' },
  maxDepthDiameterRatio: null,
  overrides: []
}

/** 长度转换为 mm */
export function lengthToMm(len?: LengthValue | null): number | null {
  if (!len || !Number.isFinite(len.value)) return null
  switch (len.unit) {
    case 'mm':
      return len.value
    case 'cm':
      return len.value * 10
    case 'm':
      return len.value * 1000
    case 'in':
      return len.value * 25.4
    default:
      return len.value
  }
}

/** 面积转换为 mm² */
export function areaToMm2(area?: AreaValue | null): number | null {
  if (!area || !Number.isFinite(area.value)) return null
  switch (area.unit) {
    case 'mm2':
      return area.value
    case 'cm2':
      return area.value * 100
    case 'm2':
      return area.value * 1000000
    case 'in2':
      return area.value * 645.16
    default:
      return area.value
  }
}

/**
 * 解析特定实体的有效壁厚阈值（考虑覆盖关系）
 */
export function resolveWallThicknessThreshold(
  ruleId: 'CLR-001' | 'CLR-002',
  refA: EntityRef,
  refB: EntityRef | null,
  config: CheckConfig
): number {
  const defaultMm =
    ruleId === 'CLR-001'
      ? lengthToMm(config.minHoleWall) ?? 5
      : lengthToMm(config.minOuterWall) ?? 5

  if (!config.overrides || config.overrides.length === 0) {
    return defaultMm
  }

  // 1. 最高优先级：对覆盖 (Pair override)
  if (refB) {
    for (const ov of config.overrides) {
      if (ov.ruleId === ruleId && ov.scope.kind === 'pair') {
        const [e1, e2] = ov.scope.entities
        if (
          (matchesEntity(e1, refA) && matchesEntity(e2, refB)) ||
          (matchesEntity(e1, refB) && matchesEntity(e2, refA))
        ) {
          if (ov.values.minDistance) {
            const v = lengthToMm(ov.values.minDistance)
            if (v !== null) return v
          }
        }
      }
    }
  }

  // 2. 次优先级：单对象覆盖 (Entity override)
  let foundA: number | null = null
  let foundB: number | null = null

  for (const ov of config.overrides) {
    if (ov.ruleId === ruleId && ov.scope.kind === 'entity') {
      if (matchesEntity(ov.scope.entity, refA)) {
        if (ov.values.minDistance) {
          foundA = lengthToMm(ov.values.minDistance)
        }
      }
      if (refB && matchesEntity(ov.scope.entity, refB)) {
        if (ov.values.minDistance) {
          foundB = lengthToMm(ov.values.minDistance)
        }
      }
    }
  }

  if (foundA !== null && foundB !== null) {
    // 取两者中更严格的（较大值）
    return Math.max(foundA, foundB)
  }
  if (foundA !== null) return foundA
  if (foundB !== null) return foundB

  return defaultMm
}

/** 实体匹配辅助函数 */
export function matchesEntity(a: EntityRef, b: EntityRef): boolean {
  if (a.kind !== b.kind) return false
  if (a.kind === 'cavity' && b.kind === 'cavity') {
    return a.instanceId === b.instanceId
  }
  if (a.kind === 'port' && b.kind === 'port') {
    return a.instanceId === b.instanceId && a.portId === b.portId
  }
  if (a.kind === 'base-face' && b.kind === 'base-face') {
    return a.faceId === b.faceId
  }
  if (a.kind === 'component' && b.kind === 'component') {
    return a.ownerKind === b.ownerKind && a.ownerId === b.ownerId
  }
  if (a.kind === 'outline' && b.kind === 'outline') {
    return a.ownerKind === b.ownerKind && a.ownerId === b.ownerId
  }
  return false
}

/** 生成实体的稳定字符串标识 */
export function entityRefKey(ref: EntityRef): string {
  switch (ref.kind) {
    case 'cavity':
      return `cavity:${ref.instanceId}`
    case 'port':
      return `port:${ref.instanceId}/${ref.portId}`
    case 'base-face':
      return `face:${ref.faceId}`
    case 'component':
      return `component:${ref.ownerKind}:${ref.ownerId}`
    case 'outline':
      return `outline:${ref.ownerKind}:${ref.ownerId}`
  }
}
