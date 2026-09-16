import type { Step, Port } from '../cavity/types'
import type { CavityInstance } from './types'
import { stepEffectiveLength, taperedEndRadius } from '../cavity/geometry'
import { getBoxFaceBasis, localToWorldPoint } from './faceMath'

export type Vec3 = [number, number, number]
export const add = (a: Vec3, b: Vec3): Vec3 => [a[0]+b[0], a[1]+b[1], a[2]+b[2]]
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0]-b[0], a[1]-b[1], a[2]-b[2]]
export const mul = (a: Vec3, t: number): Vec3 => [a[0]*t, a[1]*t, a[2]*t]
export const dot = (a: Vec3, b: Vec3) => a[0]*b[0]+a[1]*b[1]+a[2]*b[2]
export const cross = (a: Vec3, b: Vec3): Vec3 => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]]
export const norm = (a: Vec3) => Math.sqrt(dot(a,a))
export const unit = (a: Vec3): Vec3 => mul(a, 1 / (norm(a) || 1))
export interface ProfileBand { index: number; z0: number; z1: number; r0: number; r1: number; length: number }
export function profileBands(steps: Step[]): ProfileBand[] {
  let z = 0
  return steps.map((step, index) => {
    const length = stepEffectiveLength(step)
    const band = { index, z0: z, z1: z + length, r0: step.diameter / 2,
      r1: step.type === 'tapered' ? step.length == null ? 0 : taperedEndRadius(step.diameter, step.length, step.angle ?? 118) : step.diameter / 2, length }
    z += length
    return band
  })
}
export function cavityAxis(cavity: CavityInstance, dimensions: Vec3) {
  const basis = getBoxFaceBasis(cavity.faceId, dimensions)
  const tilt = (cavity.tiltAngle ?? 0) * Math.PI / 180
  const az = (cavity.azimuth ?? cavity.rotation ?? 0) * Math.PI / 180
  const direction = unit(add(mul(basis.w, -Math.cos(tilt)), mul(add(mul(basis.u, Math.cos(az)), mul(basis.v, Math.sin(az))), Math.sin(tilt))))
  return { mouth: localToWorldPoint(basis, cavity.u, cavity.v, cavity.depthOffset), direction }
}
export interface PortRegion { index: number; depth: number; min: number; max: number; radius: number; bottom: boolean }
/** Ports describe axial opening bands, not radial drilled cylinders. */
export function portRegions(ports: Port[], bands: ProfileBand[]): PortRegion[] {
  const total = bands.at(-1)?.z1 ?? 0
  return ports.flatMap((port, index) => {
    const bottom = Boolean(port.isBottomPort ?? port.through)
    if (!Number.isFinite(port.depth) || port.depth < 0 || port.depth > total || (!bottom && !(Number(port.diameter) > 0))) return []
    const min = Math.max(0, bottom ? port.depth : port.depth - Number(port.diameter) / 2)
    const max = Math.min(total, bottom ? total : port.depth + Number(port.diameter) / 2)
    const radii = bands.filter(b => b.z1 >= min && b.z0 <= max).map(b => Math.max(b.r0, b.r1))
    return [{ index, depth: port.depth, min, max, bottom, radius: Math.max(0, ...radii) }]
  })
}
