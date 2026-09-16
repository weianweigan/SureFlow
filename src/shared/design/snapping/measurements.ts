import { add, mul, sub, dot, type Vec3 } from '../cavityGeometry'
import { localToWorldPoint } from '../faceMath'
import { snapPlanar, snapDepth, type PlanarSnapInput, type SnapMatch, type SnapOptions } from './solver'

export interface ProximityDimension {
  id: string
  axis: 'u' | 'v' | 'depth'
  start: Vec3
  end: Vec3
  target: Vec3
  value: number
  projection: boolean
}
const dimension = (match: SnapMatch, axis: ProximityDimension['axis'], start: Vec3, end: Vec3, value: number): ProximityDimension => ({
  id:match.id, axis, start, end, target:match.point, value,
  projection:match.label.includes('投影')
})

/** Read-only query: its wider threshold must never be used to commit a transform. */
export function measurePlanar(input: PlanarSnapInput, matches: SnapMatch[], previous: string[] = []): ProximityDimension[] {
  const start = localToWorldPoint(input.basis,input.u,input.v)
  const result: ProximityDimension[] = []
  for (const axis of input.dof === 'uv' ? ['u','v'] as const : [input.dof]) {
    const locked = matches.find(m => m.locks?.includes(axis))
    // A zero dimension is already represented by the snap guide.
    if (locked) continue
    const nearby = snapPlanar({...input,dof:axis,geometry:true,bypass:false,grid:false,cycle:0,previous,searchRadius:80})
    const match = nearby.matches.find(m => m.locks?.includes(axis))
    if (!match) continue
    const value = axis === 'u' ? nearby.u-input.u : nearby.v-input.v
    if (Math.abs(value) < 1e-7) continue
    const end = add(start,mul(axis === 'u' ? input.basis.u : input.basis.v,value))
    result.push(dimension(match,axis,start,end,value))
  }
  return result
}

export function measureDepth(input: SnapOptions & { mouth: Vec3; direction: Vec3; depth: number; minDepth: number }, matches: SnapMatch[], previous: string[] = []): ProximityDimension[] {
  if (matches.length) return []
  const nearby = snapDepth({...input,geometry:true,bypass:false,grid:false,cycle:0,previous,searchRadius:80})
  if (!nearby.matches.length || Math.abs(nearby.depth-input.depth) < 1e-7) return []
  const start = add(input.mouth,mul(input.direction,input.depth))
  const end = add(input.mouth,mul(input.direction,nearby.depth))
  return [dimension(nearby.matches[0],'depth',start,end,dot(sub(end,start),input.direction))]
}
