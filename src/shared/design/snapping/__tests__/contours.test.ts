import { describe, it, expect } from 'vitest'
import { contourDepths, planarContourPoints, type CircleGeometry, type WallGeometry } from '../contours'
import { snapDepth, snapPlanar, type SnapReference } from '../solver'
import { measureDepth, measurePlanar } from '../measurements'
import { getBoxFaceBasis, localToWorldPoint } from '../../faceMath'
import { norm, sub, type Vec3 } from '../../cavityGeometry'
import { buildReferences } from '../../../../renderer/src/workspace/design/interaction/snapping/referenceProvider'
import type { CavityInstance } from '../../types'

const distance = (a:Vec3,b:Vec3) => norm(sub(a,b))*10
const basis = getBoxFaceBasis('top',[100,100,100])
const wall: WallGeometry = {kind:'wall',point:[30,20,60],direction:[0,1,0],length:40,radius:5,endRadius:5}
const ring: CircleGeometry = {kind:'circle',point:[30,40,80],direction:[0,0,1],radius:5}
const reference = <T extends WallGeometry | CircleGeometry>(geometry:T): SnapReference => ({...geometry,id:'target',ownerId:'target',label:'目标',faceId:'top'})

describe('finite analytic contours',()=>{
  it('finds near/far walls, tangency, and rejects the infinite extension',()=>{
    expect(contourDepths([30,40,100],[0,0,-1],wall)).toEqual([35,45])
    expect(contourDepths([35,40,100],[0,0,-1],wall)).toEqual([40])
    expect(contourDepths([36,40,100],[0,0,-1],wall)).toEqual([])
    expect(contourDepths([30,70,100],[0,0,-1],wall)).toEqual([])
  })
  it('uses the local tapered radius and includes the cone tip',()=>{
    const cone:WallGeometry={...wall,endRadius:0}
    expect(contourDepths([30,40,100],[0,0,-1],cone)).toEqual([37.5,42.5])
    expect(contourDepths([30,60,100],[0,0,-1],cone)).toEqual([40])
  })
  it('solves continuous ring intersections in and across its plane',()=>{
    expect(contourDepths([33,40,80],[0,1,0],ring)).toEqual([-4,4])
    expect(contourDepths([35,40,100],[0,0,-1],ring)).toEqual([20])
    expect(contourDepths([30,40,100],[0,0,-1],ring)).toEqual([])
  })
  it('captures a ring at a non-cardinal point without changing the locked coordinate',()=>{
    const result=snapPlanar({basis,u:34.3,v:43,dof:'u',grid:false,references:[reference(ring)],distance})
    expect(result.u).toBeCloseTo(34)
    expect(result.v).toBe(43)
    expect(norm(sub(result.matches[0].point,ring.point))).toBeCloseTo(5)
  })
  it('captures tapered side lines at the actual axial station',()=>{
    const result=snapPlanar({basis,u:32.7,v:40,dof:'u',grid:false,references:[reference({...wall,endRadius:0})],distance})
    expect(result.u).toBeCloseTo(32.5)
    expect(result.v).toBe(40)
  })
  it('retains distant same-column contours in the interval query and obeys cross-face filtering',()=>{
    const references=Array.from({length:1000},(_,i)=>({...reference(ring),id:`r${i}`,ownerId:`r${i}`,faceId:'front',point:[i*20,1000,80] as Vec3}))
    const input={basis,u:45.2,v:40,dof:'u' as const,grid:false,references,distance}
    expect(snapPlanar(input).u).toBe(45)
    expect(snapPlanar({...input,crossFace:false}).matches).toHaveLength(0)
  })
  it('produces valid radial points for oblique axes on all six faces',()=>{
    const direction:Vec3=[1/Math.sqrt(3),1/Math.sqrt(3),1/Math.sqrt(3)]
    for(const face of ['top','bottom','front','back','left','right']) {
      const b=getBoxFaceBasis(face,[100,100,100])
      const points=planarContourPoints({...ring,direction},b,b.w,30,40)
      expect(points.length).toBeGreaterThan(0)
      for(const p of points) expect(norm(sub(p.point,ring.point))).toBeCloseTo(ring.radius)
    }
  })
  it('distinguishes ring depth projection from real boundary contact',()=>{
    const input={mouth:[30,40,100] as Vec3,direction:[0,0,-1] as Vec3,depth:20.3,minDepth:2,grid:false,references:[reference(ring)],distance}
    expect(snapDepth(input).matches[0].label).toContain('投影')
    expect(snapDepth({...input,mouth:[35,40,100]}).matches[0].label).toContain('到边界线')
    expect(snapDepth({...input,mouth:[40,40,100]}).matches).toHaveLength(0)
  })
  it('captures near/far depth and never captures excluded moving geometry',()=>{
    const input={mouth:[30,40,100] as Vec3,direction:[0,0,-1] as Vec3,depth:35.4,minDepth:2,grid:false,references:[reference(wall)],distance}
    expect(snapDepth(input).depth).toBe(35)
    expect(snapDepth({...input,depth:45.3}).matches[0].label).toContain('远壁')
    expect(snapDepth({...input,excluded:new Set(['target'])}).matches).toHaveLength(0)
    expect(snapDepth({...input,bypass:true}).depth).toBe(35.4)
  })
})

describe('profile references and read-only measurements',()=>{
  it('deduplicates shared circles, retains shoulder rings and scopes IDs to profile revisions',()=>{
    const cavity:CavityInstance={instanceId:'c',name:'C',libraryId:'l',templateId:'t',faceId:'top',u:30,v:40,rotation:0,depthOffset:0}
    const steps=[{type:'straight' as const,diameter:10,length:10},{type:'straight' as const,diameter:10,length:10},{type:'tapered' as const,diameter:6,length:null,angle:90}]
    const build=()=>buildReferences([{cavity,steps,ports:[]}],[],[100,100,100]).references.filter(r=>r.ownerId==='c')
    const refs=build()
    expect(refs.filter(r=>r.kind==='circle')).toHaveLength(4)
    expect(refs.filter(r=>r.semantic==='tip')).toHaveLength(1)
    const old=refs.find(r=>r.kind==='wall')!.id
    steps[0].length=12
    expect(build().find(r=>r.kind==='wall')!.id).not.toBe(old)
  })
  it('measures orthogonal values while snapping is disabled, without changing the input',()=>{
    const point:SnapReference={id:'p',ownerId:'p',label:'p',kind:'point',faceId:'top',point:localToWorldPoint(basis,34,44)}
    const input={basis,u:30,v:40,dof:'uv' as const,references:[point],distance,bypass:true,geometry:false}
    const before=JSON.stringify(input)
    const dimensions=measurePlanar(input,[])
    expect(dimensions.map(d=>d.value)).toEqual([4,4])
    expect(JSON.stringify(input)).toBe(before)
    expect(measurePlanar({...input,excluded:new Set(['p'])},[])).toEqual([])
  })
  it('measures from final depth to the actual wall and suppresses zero snapped dimensions',()=>{
    const input={mouth:[30,40,100] as Vec3,direction:[0,0,-1] as Vec3,depth:32,minDepth:2,references:[reference(wall)],distance,bypass:true}
    const dimensions=measureDepth(input,[])
    expect(dimensions[0].value).toBe(3)
    expect(dimensions[0].start).toEqual([30,40,68])
    expect(measureDepth(input,snapDepth({...input,bypass:false,depth:35}).matches)).toEqual([])
  })
})
