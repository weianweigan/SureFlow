import type { CavityGroup, CavityInstance } from '@shared/design/types'
import type { FeatureSelectionItem } from './designStore'

type Scheme = { cavities: CavityInstance[]; groups?: CavityGroup[] }

/** Additive selection treats every assembly as one rigid unit. */
export function promoteFeatures(items: FeatureSelectionItem[], scheme?: Scheme): FeatureSelectionItem[] {
  const unique = new Map<string, FeatureSelectionItem>()
  for (const item of items) {
    const cavity = item.type === 'cavity' ? scheme?.cavities.find(c => c.instanceId === item.id) : undefined
    const group = item.type === 'cavity'
      ? scheme?.groups?.find(g => g.id === cavity?.groupId || g.cavityIds.includes(item.id)) : undefined
    const promoted: FeatureSelectionItem = group ? { type: 'group', id: group.id } : item
    unique.set(`${promoted.type}:${promoted.id}`, promoted)
  }
  return [...unique.values()]
}

export interface ScreenBounds { minX: number; minY: number; maxX: number; maxY: number }
export function matchesMarquee(bounds: ScreenBounds, rect: ScreenBounds, crossing: boolean): boolean {
  return crossing
    ? bounds.maxX >= rect.minX && bounds.minX <= rect.maxX && bounds.maxY >= rect.minY && bounds.minY <= rect.maxY
    : bounds.minX >= rect.minX && bounds.maxX <= rect.maxX && bounds.minY >= rect.minY && bounds.maxY <= rect.maxY
}

/** Apply one delta to each selected rigid body exactly once, including its datum. */
export function translateRigidSelection(scheme: Scheme, ids: string[], du: number, dv: number): void {
  const selected = new Set(ids)
  for (const group of scheme.groups ?? []) {
    const members = scheme.cavities.filter(c => c.groupId === group.id || group.cavityIds.includes(c.instanceId))
    if (!members.some(c => selected.has(c.instanceId))) continue
    group.u = (group.u ?? members.reduce((n, c) => n + c.u, 0) / members.length) + du
    group.v = (group.v ?? members.reduce((n, c) => n + c.v, 0) / members.length) + dv
    members.forEach(c => selected.add(c.instanceId))
  }
  for (const cavity of scheme.cavities) {
    if (!selected.has(cavity.instanceId)) continue
    cavity.u += du
    cavity.v += dv
  }
}
