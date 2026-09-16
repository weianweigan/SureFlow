import { add, sub, mul, dot, cross, norm, type Vec3 } from '../cavityGeometry'
import { localToWorldPoint, worldToLocalPoint, type FaceBasis } from '../faceMath'
import { contourDepths, planarContourPoints, contourBounds, type ContourGeometry } from './contours'
import { queryPlanarReferences } from './referenceQuery'

interface ReferenceBase {
  id: string; ownerId: string; label: string; faceId?: string
  semantic?: 'tip' | 'boundary'
}
export type SnapReference = ReferenceBase & (ContourGeometry | {
  kind: 'point' | 'axis' | 'port'
  point: Vec3
  direction?: Vec3
  length?: number
  radius?: number
})
export interface SnapMatch { id: string; ownerId: string; label: string; point: Vec3; anchor: Vec3; locks?: string }
export interface SnapOptions {
  references: readonly SnapReference[]
  excluded?: ReadonlySet<string>
  bypass?: boolean
  grid?: boolean
  geometry?: boolean
  crossFace?: boolean
  previous?: readonly string[]
  cycle?: number
  searchRadius?: number
  distance: (a: Vec3, b: Vec3) => number
}
export interface PlanarSnapInput extends SnapOptions {
  basis: FaceBasis; u: number; v: number; dof: 'u' | 'v' | 'uv'
  direction?: Vec3
}
export interface PlanarSnapResult { u: number; v: number; matches: SnapMatch[] }
export function axisIntersection(p: Vec3, d: Vec3, q: Vec3, e: Vec3) {
  const r = sub(q,p), a = dot(d,d), b = dot(d,e), c = dot(e,e)
  const den = a*c-b*b
  if (Math.abs(den) < 1e-10) return null
  const t = (c*dot(d,r)-b*dot(e,r))/den
  const s = (b*dot(d,r)-a*dot(e,r))/den
  if (norm(sub(add(p,mul(d,t)),add(q,mul(e,s)))) > 1e-6) return null
  return { t, s }
}
const gridValue = (v: number, options: SnapOptions) => options.bypass || options.grid === false ? v : Math.round(v)
function threshold(id: string, options: SnapOptions) { return options.searchRadius ?? (options.previous?.includes(id) ? 12 : 8) }

export function snapPlanar(input: PlanarSnapInput): PlanarSnapResult {
  const { basis, u, v, dof } = input
  const raw = localToWorldPoint(basis,u,v)
  const direction = input.direction ?? mul(basis.w,-1)
  const boundsKey=`${basis.id}:${basis.origin.join(',')}:${direction.join(',')}`
  type Candidate = { u: number; v: number; locks: string; score: number; ref: SnapReference; id: string; label: string }
  const candidates: Candidate[] = []
  const offer = (ref: SnapReference, cu: number, cv: number, locks: string, label: string) => {
    if (!Number.isFinite(cu+cv) || (dof === 'u' && Math.abs(cv-v)>1e-7) || (dof === 'v' && Math.abs(cu-u)>1e-7)) return
    const id = `${ref.id}:${locks}`
    const distance = input.distance(raw, localToWorldPoint(basis,cu,cv))
    // A view-normal degree of freedom cannot provide a useful pixel threshold.
    if (distance < 0.01 && Math.hypot(cu-u,cv-v)>0.1) return
    if (distance > threshold(id,input)) return
    candidates.push({ u: cu, v: cv, locks, score: distance - (!input.cycle && input.previous?.includes(id) ? 3 : 0), ref, id, label })
  }
  if (!input.bypass && input.geometry !== false) for (const ref of queryPlanarReferences(input.references,basis,direction,u,v,dof,input.distance,input.searchRadius??12)) {
    if (input.excluded?.has(ref.ownerId) || (input.crossFace === false && ref.faceId !== basis.id)) continue
    if (ref.kind === 'circle' || ref.kind === 'wall') {
      const bounds=contourBounds(ref,basis,direction,boundsKey)
      if(!bounds)continue
      const cu=Math.max(bounds[0],Math.min(bounds[1],u)),cv=Math.max(bounds[2],Math.min(bounds[3],v))
      const radius=input.searchRadius??12
      if ((dof==='v'||input.distance(raw,localToWorldPoint(basis,cu,v))>radius) &&
          (dof==='u'||input.distance(raw,localToWorldPoint(basis,u,cv))>radius)) continue
      for (const feature of planarContourPoints(ref, basis, direction, u, v)) {
        const den = dot(direction, basis.w)
        const t = dot(sub(feature.point, basis.origin), basis.w) / den
        if (t < -1e-6 && ref.faceId !== basis.id) continue
        const local = worldToLocalPoint(basis, sub(feature.point, mul(direction, t)))
        const target = { ...ref, id: `${ref.id}:${feature.key}`, point: feature.point }
        if (feature.axis === 'u' && dof !== 'v') offer(target, local.u, v, 'u', '轮廓投影 U 对齐')
        if (feature.axis === 'v' && dof !== 'u') offer(target, u, local.v, 'v', '轮廓投影 V 对齐')
      }
      continue
    }
    if (ref.kind === 'axis' && ref.direction) {
      const normal = cross(direction,ref.direction)
      if (norm(normal) < 1e-8) {
        // Parallel axes: project the target axis onto the active face.
        const den = dot(direction,basis.w)
        if (Math.abs(den)<1e-8) continue
        const t = dot(sub(ref.point,basis.origin),basis.w)/den
        const local = worldToLocalPoint(basis, sub(ref.point,mul(direction,t)))
        offer(ref, local.u, local.v, 'uv', '同轴定位')
        continue
      }
      const a = dof === 'v' ? 0 : dot(normal,basis.u)
      const b = dof === 'u' ? 0 : dot(normal,basis.v)
      const denominator = a*a+b*b
      if (denominator<1e-10) continue
      const error = dot(normal,sub(raw,ref.point))
      const cu = u-error*a/denominator, cv = v-error*b/denominator
      const hit = axisIntersection(localToWorldPoint(basis,cu,cv),direction,ref.point,ref.direction)
      if (!hit || hit.t < -1e-6 || hit.s < -1e-6 || hit.s > (ref.length ?? 0)+1e-6) continue
      offer({...ref,point:add(ref.point,mul(ref.direction,hit.s))},cu,cv,Math.abs(a)<1e-8?'v':Math.abs(b)<1e-8?'u':'uv','轴线对齐（深度另验）')
    } else {
      const den = dot(direction,basis.w)
      if (Math.abs(den)<1e-8) continue
      const t = dot(sub(ref.point,basis.origin),basis.w)/den
      if (t < -1e-6 && ref.faceId !== basis.id) continue
      const local = worldToLocalPoint(basis,sub(ref.point,mul(direction,t)))
      const prefix = ref.kind === 'port' ? '侧油口位置' : ref.semantic === 'tip' ? '锥尖投影' : ref.faceId === basis.id ? '中心' : '跨面投影'
      if (dof !== 'v') offer(ref, local.u,v,'u',`${prefix} U 对齐`)
      if (dof !== 'u') offer(ref,u,local.v,'v',`${prefix} V 对齐`)
      offer(ref,local.u,local.v,'uv',`${prefix}重合`)
    }
  }
  candidates.sort((a,b) => a.score-b.score || a.id.localeCompare(b.id))
  // Shared Step rings and wall endpoints may describe the same relation.
  const seen = new Set<string>()
  let write = 0
  for (const c of candidates) {
    const key = `${c.ref.ownerId}:${c.locks}:${c.u.toFixed(7)}:${c.v.toFixed(7)}`
    if (seen.has(key)) continue
    seen.add(key); candidates[write++] = c
  }
  candidates.length = write
  if (input.cycle && candidates.length) candidates.push(...candidates.splice(0,input.cycle%candidates.length))
  let resultU = u, resultV = v, locked = ''
  const matches: SnapMatch[] = []
  for (const c of candidates) {
    if ([...c.locks].some(k => locked.includes(k))) continue
    if (c.locks.includes('u')) resultU=c.u
    if (c.locks.includes('v')) resultV=c.v
    locked+=c.locks
    matches.push({id:c.id,ownerId:c.ref.ownerId,label:`${c.ref.label} · ${c.label}`,point:c.ref.point,anchor:raw,locks:c.locks})
    if (locked.includes('u') && locked.includes('v')) break
  }
  if (dof !== 'v' && !locked.includes('u')) resultU=gridValue(u,input)
  if (dof !== 'u' && !locked.includes('v')) resultV=gridValue(v,input)
  const anchor=localToWorldPoint(basis,resultU,resultV)
  return { u:resultU, v:resultV, matches:matches.map(m=>({...m,anchor})) }
}

export function snapDepth(input: SnapOptions & { mouth: Vec3; direction: Vec3; depth: number; minDepth: number }) {
  const raw=add(input.mouth,mul(input.direction,input.depth))
  const candidates: { depth:number; match:SnapMatch; score:number }[]=[]
  const offer = (ref: SnapReference, depth: number, relation: string, suffix = '') => {
    if (depth < input.minDepth || !Number.isFinite(depth)) return
    const point = add(input.mouth, mul(input.direction, depth))
    const distance = input.distance(raw, point), id = ref.id + suffix
    if ((distance < 0.01 && Math.abs(depth-input.depth) > 0.1) || distance > threshold(id,input)) return
    // Shared boundaries are deduplicated after ranking so the current lock wins.
    candidates.push({depth,score:distance-(!input.cycle && input.previous?.includes(id)?3:0)-(ref.kind==='port'?0.5:0),match:{id,ownerId:ref.ownerId,label:`${ref.label} · ${relation}`,point:relation.includes('投影')?ref.point:point,anchor:point,locks:'depth'}})
  }
  if (!input.bypass && input.geometry !== false) for (const ref of input.references) {
    if (input.excluded?.has(ref.ownerId)) continue
    if (ref.kind === 'circle' || ref.kind === 'wall') {
      const hits = contourDepths(input.mouth, input.direction, ref).filter(t => t >= 0)
      hits.forEach((t, i) => offer(ref, t, ref.kind === 'circle' ? '到边界线' : hits.length === 1 ? '到孔壁' : i === 0 ? '到近壁' : '到远壁', `:hit:${i}`))
      // Explicit bounded axial-level reference, never claim it touches the ring.
      if (ref.kind === 'circle' && !hits.length) {
        const den = dot(input.direction, ref.direction)
        if (Math.abs(den) > 1e-8) {
          const t = dot(sub(ref.point, input.mouth), ref.direction) / den
          if (norm(sub(add(input.mouth,mul(input.direction,t)),ref.point)) <= ref.radius + 1e-7) offer(ref,t,'边界深度投影',':plane')
        }
      }
      continue
    }
    if (ref.kind === 'point' && ref.semantic === 'tip') {
      const delta = sub(ref.point,input.mouth), t = dot(delta,input.direction)
      if (norm(sub(delta,mul(input.direction,t))) < 1e-7) offer(ref,t,'到锥尖')
      continue
    }
    let depth: number | undefined
    let relation='到轴线'
    if (ref.kind==='axis' && ref.direction) {
      const hit=axisIntersection(input.mouth,input.direction,ref.point,ref.direction)
      if (hit && hit.s>=-1e-6 && hit.s<=(ref.length ?? 0)+1e-6) depth=hit.t
    } else if (ref.kind==='port' && ref.direction) {
      const den=dot(input.direction,ref.direction)
      if (Math.abs(den)>1e-8) {
        const t=dot(sub(ref.point,input.mouth),ref.direction)/den
        const point=add(input.mouth,mul(input.direction,t))
        if (norm(sub(point,ref.point))<=(ref.radius ?? 0)+1e-6) { depth=t; relation='到侧油口截面' }
      } else {
        // A transverse bore lying in the port plane may reach its center.
        const delta=sub(ref.point,input.mouth), t=dot(delta,input.direction)
        if (norm(sub(delta,mul(input.direction,t)))<1e-6) {depth=t;relation='到侧油口中心'}
      }
    }
    if (depth !== undefined) offer(ref,depth,relation)
  }
  candidates.sort((a,b)=>a.score-b.score||a.match.id.localeCompare(b.match.id))
  const seenDepths=new Set<string>()
  let writeDepth=0
  for(const c of candidates){
    const key=`${c.match.ownerId}:${c.depth.toFixed(7)}`
    if(seenDepths.has(key))continue
    seenDepths.add(key);candidates[writeDepth++]=c
  }
  candidates.length=writeDepth
  const winner=candidates.length?candidates[(input.cycle??0)%candidates.length]:undefined
  return { depth:winner?.depth ?? Math.max(input.minDepth,gridValue(input.depth,input)), matches:winner?[winner.match]:[] }
}
