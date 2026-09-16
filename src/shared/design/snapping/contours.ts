import { add, sub, mul, dot, norm, unit, type Vec3 } from '../cavityGeometry'
import type { FaceBasis } from '../faceMath'

export interface CircleGeometry { kind: 'circle'; point: Vec3; direction: Vec3; radius: number }
export interface WallGeometry { kind: 'wall'; point: Vec3; direction: Vec3; length: number; radius: number; endRadius: number }
export type ContourGeometry = CircleGeometry | WallGeometry
const EPS = 1e-7

/** Stable quadratic roots, including tangency and a cone's linear degeneracy. */
function roots(a: number, b: number, c: number): number[] {
  if (Math.abs(a) < 1e-12) return Math.abs(b) < 1e-12 ? [] : [-c / b]
  const disc = b * b - 4 * a * c
  if (disc < -1e-10) return []
  if (disc <= 1e-10) return [-b / (2 * a)]
  const q = -0.5 * (b + (b < 0 ? -1 : 1) * Math.sqrt(disc))
  return [q / a, c / q].sort((x, y) => x - y)
}

/** Intersections with the finite surface, never its infinite extension. */
export function contourDepths(origin: Vec3, direction: Vec3, ref: ContourGeometry): number[] {
  const delta = sub(origin, ref.point)
  const z = dot(delta, ref.direction), dz = dot(direction, ref.direction)
  const radial = sub(delta, mul(ref.direction, z))
  const dr = sub(direction, mul(ref.direction, dz))
  if (ref.kind === 'circle') {
    if (Math.abs(dz) > EPS) {
      const t = -z / dz
      return Math.abs(norm(add(radial, mul(dr, t))) - ref.radius) < EPS ? [t] : []
    }
    if (Math.abs(z) > EPS) return []
    return roots(dot(dr, dr), 2 * dot(radial, dr), dot(radial, radial) - ref.radius ** 2)
  }
  if (ref.length <= EPS) return []
  const slope = (ref.endRadius - ref.radius) / ref.length
  const r = ref.radius + slope * z, rd = slope * dz
  return roots(dot(dr, dr) - rd * rd, 2 * (dot(radial, dr) - r * rd), dot(radial, radial) - r * r)
    .filter(t => z + dz * t >= -EPS && z + dz * t <= ref.length + EPS)
}

export interface ContourPoint { point: Vec3; axis: 'u' | 'v'; key: string }

const boundsCache = new WeakMap<ContourGeometry, Map<string, [number,number,number,number]>>()
/** Cache operation-plane extents for cheap broad-phase queries on pointer moves. */
export function contourBounds(ref: ContourGeometry, basis: FaceBasis, direction: Vec3, cacheKey?: string): [number,number,number,number] | null {
  const den=dot(direction,basis.w)
  if (Math.abs(den)<EPS) return null
  const key=cacheKey??`${basis.id}:${basis.origin.join(',')}:${direction.join(',')}`
  let cache=boundsCache.get(ref)
  if (!cache) {cache=new Map();boundsCache.set(ref,cache)}
  const cached=cache.get(key)
  if (cached) return cached
  const bounds:number[]=[]
  for(const axis of [basis.u,basis.v]) {
    const c=sub(axis,mul(basis.w,dot(axis,direction)/den))
    const radial=norm(sub(c,mul(ref.direction,dot(c,ref.direction))))
    const center=dot(sub(ref.point,basis.origin),c)
    let min=center-radial*ref.radius,max=center+radial*ref.radius
    if(ref.kind==='wall') {
      const end=center+dot(ref.direction,c)*ref.length
      min=Math.min(min,end-radial*ref.endRadius);max=Math.max(max,end+radial*ref.endRadius)
    }
    bounds.push(min,max)
  }
  const result=bounds as [number,number,number,number]
  if(cache.size>12)cache.clear()
  cache.set(key,result)
  return result
}

/** Continuous orthographic/oblique projection, defined by the operation, not the camera.
 * Circle extrema and fixed-coordinate intersections are analytic. Wall side lines
 * interpolate the true radii at the target axial station rather than max diameter.
 */
export function planarContourPoints(ref: ContourGeometry, basis: FaceBasis, direction: Vec3, u: number, v: number): ContourPoint[] {
  const den = dot(direction, basis.w)
  if (Math.abs(den) < EPS) return []
  const covector = (axis: Vec3) => sub(axis, mul(basis.w, dot(axis, direction) / den))
  const cu = covector(basis.u), cv = covector(basis.v)
  const coordinate = (p: Vec3, c: Vec3) => dot(sub(p, basis.origin), c)
  const radial = (c: Vec3) => sub(c, mul(ref.direction, dot(c, ref.direction)))
  const out: ContourPoint[] = []
  for (const axis of ['u', 'v'] as const) {
    const c = axis === 'u' ? cu : cv, other = axis === 'u' ? cv : cu
    const otherValue = axis === 'u' ? v : u
    const support = radial(c)
    if (norm(support) > EPS) for (const sign of [-1, 1]) {
      const radialDirection = mul(unit(support), sign)
      let p = add(ref.point, mul(radialDirection, ref.radius))
      if (ref.kind === 'wall') {
        const end = add(add(ref.point, mul(ref.direction, ref.length)), mul(radialDirection, ref.endRadius))
        const span = coordinate(end, other) - coordinate(p, other)
        if (Math.abs(span) > EPS) {
          const t = (otherValue - coordinate(p, other)) / span
          if (t < -EPS || t > 1 + EPS) continue
          p = add(p, mul(sub(end, p), Math.max(0, Math.min(1, t))))
        } else {
          // Axial projection collapses: use the nearest end's silhouette.
          if (Math.abs(coordinate(end, c) - (axis === 'u' ? u : v)) < Math.abs(coordinate(p, c) - (axis === 'u' ? u : v))) p = end
        }
      }
      out.push({ point: p, axis, key: `${axis}:side:${sign}` })
    }
    if (ref.kind !== 'circle' || ref.radius < EPS) continue
    // Intersect the projected circle with the unchanged coordinate of a 1D handle.
    const otherRadial = radial(other), magnitude = norm(otherRadial)
    if (magnitude < EPS) continue
    const height = (otherValue - coordinate(ref.point, other)) / magnitude
    if (Math.abs(height) > ref.radius + EPS) continue
    const n = unit(otherRadial)
    const tangent = unit([
      ref.direction[1] * n[2] - ref.direction[2] * n[1],
      ref.direction[2] * n[0] - ref.direction[0] * n[2],
      ref.direction[0] * n[1] - ref.direction[1] * n[0]
    ])
    const width = Math.sqrt(Math.max(0, ref.radius ** 2 - height ** 2))
    for (const sign of width < EPS ? [1] : [-1, 1]) {
      out.push({ point: add(ref.point, add(mul(n, height), mul(tangent, width * sign))), axis, key: `${axis}:edge:${sign}` })
    }
  }
  return out
}
