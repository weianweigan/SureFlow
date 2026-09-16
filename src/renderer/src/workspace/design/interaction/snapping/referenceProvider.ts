import { cavityAxis, profileBands, portRegions, add, mul, type Vec3, type PortRegion } from '@shared/design/cavityGeometry'
import { getBoxFaceBasis, localToWorldPoint } from '@shared/design/faceMath'
import type { CavityInstance, CavityGroup } from '@shared/design/types'
import type { Step, Port } from '@shared/cavity/types'
import type { SnapReference } from '@shared/design/snapping/solver'
export interface PortVisual extends PortRegion { id:string; ownerId:string; label:string; mouth:Vec3; direction:Vec3 }
export function buildReferences(cavities: { cavity:CavityInstance; steps:Step[]; ports:Port[] }[], groups:CavityGroup[], dimensions:Vec3) {
  const references:SnapReference[]=[], ports:PortVisual[]=[]
  for (const {cavity,steps,ports:sourcePorts} of cavities) {
    if (cavity.suppressed || cavity.dangling) continue
    const {mouth,direction}=cavityAxis(cavity,dimensions), bands=profileBands(steps)
    const base={ownerId:cavity.instanceId,faceId:cavity.faceId,label:cavity.name}
    references.push({...base,id:`${cavity.instanceId}:mouth`,kind:'point',point:mouth})
    references.push({...base,id:`${cavity.instanceId}:axis`,kind:'axis',point:mouth,direction,length:bands.at(-1)?.z1??0})
    // Step has no persisted ID. Scope ordinal IDs to the complete profile revision;
    // edits/reorders invalidate references instead of reusing a different step's lock.
    const revision = bands.map(b => `${b.z0},${b.z1},${b.r0},${b.r1}`).join(';')
    const boundaries = new Map<string, SnapReference>()
    const boundary = (depth: number, radius: number, role: string, label: string) => {
      if (!Number.isFinite(depth + radius) || radius < 0) return
      const key = `${depth.toFixed(7)}:${radius.toFixed(7)}`
      const existing = boundaries.get(key)
      if (existing) { existing.label += ` / ${label}`; return }
      const common = {...base,id:`${cavity.instanceId}:${revision}:${role}`,label:`${cavity.name} · ${label}`,point:add(mouth,mul(direction,depth))}
      const ref: SnapReference = radius < 1e-7
        ? {...common,kind:'point',semantic:'tip'}
        : {...common,kind:'circle',semantic:'boundary',direction,radius}
      boundaries.set(key,ref)
      references.push(ref)
    }
    for (const band of bands) {
      if (!Number.isFinite(band.z1 + band.r0 + band.r1) || band.length <= 1e-7) continue
      const role = `step:${band.index}`
      boundary(band.z0,band.r0,`${role}:start`,`Step ${band.index+1} 起始线`)
      boundary(band.z1,band.r1,`${role}:end`,`Step ${band.index+1} ${band.r1 < 1e-7 ? '锥尖' : '终止线'}`)
      references.push({...base,id:`${cavity.instanceId}:${revision}:${role}:wall`,label:`${cavity.name} · Step ${band.index+1} 侧边`,kind:'wall',point:add(mouth,mul(direction,band.z0)),direction,length:band.length,radius:band.r0,endRadius:band.r1})
    }
    for (const port of portRegions(sourcePorts,bands)) {
      const id=`${cavity.instanceId}:port:${port.index}`
      const label=`${cavity.name} · 侧油口 ${port.index+1}${port.bottom?' 通底起始面':''}`
      references.push({...base,id,label,kind:'port',point:add(mouth,mul(direction,port.depth)),direction,radius:port.radius})
      ports.push({...port,id,ownerId:cavity.instanceId,label,mouth,direction})
      for (const [role,depth] of [['start',port.min],['end',port.max]] as const) {
        for (const band of bands) {
          if (depth < band.z0-1e-7 || depth > band.z1+1e-7 || band.length <= 1e-7) continue
          const radius = band.r0 + (band.r1-band.r0) * Math.max(0,Math.min(1,(depth-band.z0)/band.length))
          boundary(depth,radius,`port:${port.index}:${role}`,`侧油口 ${port.index+1} ${role==='start'?'起始线':'终止线'}`)
        }
      }
    }
  }
  for (const group of groups) {
    if (!group.faceId || group.u===undefined || group.v===undefined) continue
    references.push({id:`group:${group.id}:origin`,ownerId:group.id,faceId:group.faceId,label:`${group.name} 原点`,kind:'point',point:localToWorldPoint(getBoxFaceBasis(group.faceId,dimensions),group.u,group.v)})
  }
  for (const faceId of ['top','bottom','front','back','left','right']) {
    const basis=getBoxFaceBasis(faceId,dimensions)
    const center:Vec3=dimensions.map((d,i)=>basis.w[i]?basis.origin[i]:d/2) as Vec3
    references.push({id:`face:${faceId}:center`,ownerId:`face:${faceId}`,faceId,label:`${faceId} 面中心`,kind:'point',point:center})
  }
  return {references,ports}
}
