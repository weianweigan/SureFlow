import type { CavityTemplate, CavityType, Step, Port } from '@shared/cavity/types'
import type { CavityLibrary } from '@shared/cavity/types'
import type { PortSemantic } from '@shared/design/types'
import { getLoadedLibs } from '../../library/viewmodel/libraryStore'
import { holePlacement } from '../../library/model/documentOps'

export interface ResolvedTemplateHole {
  name: string
  cavityType: CavityType
  uOffset: number
  vOffset: number
  rotation: number
  steps: Step[]
  ports: Port[]
  tiltAngle?: number
  azimuth?: number
  portSemantic?: PortSemantic
}

/** 针对不同孔类型的兜底台阶序列 */
export function fallbackStepsForType(type?: CavityType): Step[] {
  if (type === 'bolt-hole') {
    return [
      { type: 'straight', diameter: 17.5, length: 10.5 },
      { type: 'straight', diameter: 11, length: 25 },
      { type: 'tapered', diameter: 11, length: null, angle: 118 }
    ]
  }
  if (type === 'locating-pin-hole') {
    return [
      { type: 'straight', diameter: 6, length: 12 },
      { type: 'tapered', diameter: 6, length: null, angle: 118 }
    ]
  }
  return [
    { type: 'straight', diameter: 18, length: 8 },
    { type: 'straight', diameter: 10, length: 20 },
    { type: 'tapered', diameter: 10, length: null, angle: 118 }
  ]
}

/** 根据子孔名称推断默认油口语义 */
export function inferPortSemantic(name: string): PortSemantic | undefined {
  const upper = name.trim().toUpperCase()
  if (upper === 'P' || upper.startsWith('P-') || upper.startsWith('P_')) {
    return { label: 'P', color: '#dc2626' }
  }
  if (upper === 'T' || upper.startsWith('T-') || upper.startsWith('T_')) {
    return { label: 'T', color: '#2563eb' }
  }
  if (upper === 'A' || upper.startsWith('A-') || upper.startsWith('A_')) {
    return { label: 'A', color: '#ca8a04' }
  }
  if (upper === 'B' || upper.startsWith('B-') || upper.startsWith('B_')) {
    return { label: 'B', color: '#16a34a' }
  }
  if (upper === 'X' || upper.startsWith('X-') || upper.startsWith('X_')) {
    return { label: 'X', color: '#ea580c' }
  }
  if (upper === 'Y' || upper.startsWith('Y-') || upper.startsWith('Y_')) {
    return { label: 'Y', color: '#9333ea' }
  }
  return undefined
}

/**
 * 解析孔腔模板内的全部子孔（同时支持单孔与多孔/组合孔类型）
 */
export function resolveAllTemplateHoles(
  template: CavityTemplate,
  libraryDoc?: CavityLibrary | null
): ResolvedTemplateHole[] {
  // 1. 如果包含子孔列表（多孔/组合孔类型）
  if (template.holes && template.holes.length > 0) {
    const isPolar = Boolean(template.geometry?.layout?.polar)
    const result: ResolvedTemplateHole[] = []

    for (let i = 0; i < template.holes.length; i++) {
      const h = template.holes[i]
      const placement = holePlacement(h, isPolar)

      const refLibrary = h.ref?.libraryId ? (h.ref.libraryId === libraryDoc?.id ? libraryDoc : getLoadedLibs().get(h.ref.libraryId)) : libraryDoc
      const referenced = h.ref ? refLibrary?.templates.find(t => t.id === h.ref?.templateId) : undefined
      // 解析子孔台阶序列
      let steps: Step[] = []
      if (h.geometry?.steps && h.geometry.steps.length > 0) {
        steps = h.geometry.steps
      } else if (h.ref && libraryDoc?.templates) {
        const refTpl = referenced
        if (refTpl?.geometry?.steps && refTpl.geometry.steps.length > 0) {
          steps = refTpl.geometry.steps
        } else {
          steps = fallbackStepsForType(h.cavityType)
        }
      } else {
        steps = fallbackStepsForType(h.cavityType)
      }

      const portSemantic = inferPortSemantic(h.name)

      result.push({
        name: h.name || `H${i + 1}`,
        cavityType: h.cavityType || referenced?.cavityType || 'drill-hole',
        uOffset: placement.cx,
        vOffset: placement.cy,
        rotation: h.rotation || 0,
        steps,
        ports: h.geometry?.ports ?? referenced?.geometry.ports ?? [],
        tiltAngle: h.tiltAngle,
        azimuth: h.azimuth,
        portSemantic
      })
    }

    return result
  }

  // 2. 单孔类型
  const steps =
    template.geometry?.steps && template.geometry.steps.length > 0
      ? template.geometry.steps
      : fallbackStepsForType(template.cavityType)

  const portSemantic =
    template.cavityType === 'port-cavity'
      ? { label: 'P', color: '#dc2626' }
      : inferPortSemantic(template.name)

  return [
    {
      name: template.name,
      cavityType: template.cavityType,
      uOffset: 0,
      vOffset: 0,
      rotation: 0,
      steps,
      ports: template.geometry.ports ?? [],
      portSemantic
    }
  ]
}

/** Legacy instances resolve ports from their original library; an explicit [] clears ports. */
export function getCavityPorts(cavity: { ports?: Port[]; libraryId?: string; templateId?: string; subHoleName?: string }, current?: CavityLibrary | null): Port[] {
  if (cavity.ports !== undefined) return cavity.ports
  const library = cavity.libraryId && cavity.libraryId !== current?.id ? getLoadedLibs().get(cavity.libraryId) : current
  const template = library?.templates.find(t => t.id === cavity.templateId)
  if (!template) return []
  if (template.holes?.length) return resolveAllTemplateHoles(template, library).find(h => h.name === cavity.subHoleName)?.ports ?? []
  return template.geometry.ports ?? []
}
