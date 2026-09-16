import { describe,it,expect } from 'vitest'
import { snapPlanar,snapDepth,axisIntersection,type SnapReference } from '../solver'
import { getBoxFaceBasis,localToWorldPoint } from '../../faceMath'
import { cavityAxis,profileBands,portRegions,norm,sub,type Vec3 } from '../../cavityGeometry'
import { buildReferences } from '../../../../renderer/src/workspace/design/interaction/snapping/referenceProvider'
import type { CavityInstance } from '../../types'
const dimensions:Vec3=[100,100,100]
const basis=getBoxFaceBasis('top',dimensions)
const distance=(a:Vec3,b:Vec3)=>norm(sub(a,b))*10
const point=(id:string,u:number,v:number):SnapReference=>({id,ownerId:id,label:id,kind:'point',faceId:'top',point:localToWorldPoint(basis,u,v)})
const cavity=(id:string,faceId='top',u=30,v=40):CavityInstance=>({instanceId:id,name:id,faceId,u,v,depthOffset:0,rotation:0,libraryId:'lib',templateId:'tpl'})

describe('unified snapping',()=>{
  it('geometry wins over grid and U/V may use independent references',()=>{
    const result=snapPlanar({basis,u:37.6,v:24.8,dof:'uv',references:[point('a',37.25,80),point('b',80,25.125)],distance})
    expect(result.u).toBe(37.25);expect(result.v).toBe(25.125)
    expect(result.matches.map(m=>m.ownerId).sort()).toEqual(['a','b'])
  })
  it('an axis handle never changes the locked coordinate or snaps it to grid',()=>{
    const result=snapPlanar({basis,u:37.6,v:24.8,dof:'u',references:[point('a',37.25,25)],distance})
    expect(result.u).toBe(37.25);expect(result.v).toBe(24.8)
  })
  it('Shift bypasses both geometry and grid',()=>{
    const result=snapPlanar({basis,u:37.6,v:24.8,dof:'uv',references:[point('a',37.25,25)],distance,bypass:true})
    expect(result).toEqual({u:37.6,v:24.8,matches:[]})
  })
  it('excludes moving members and keeps the previous target inside release threshold',()=>{
    const refs=[point('self',37.6,24.8),point('other',37.25,80)]
    expect(snapPlanar({basis,u:38.3,v:24.8,dof:'u',references:refs,distance,excluded:new Set(['self'])}).matches).toHaveLength(0)
    expect(snapPlanar({basis,u:38.3,v:24.8,dof:'u',references:refs,distance,excluded:new Set(['self']),previous:['other:u']}).u).toBe(37.25)
  })
  it('aligns to a cross-face finite axis by default and honors the toggle',()=>{
    const axis:SnapReference={id:'front',ownerId:'front',label:'front',faceId:'front',kind:'axis',point:[37.25,0,50],direction:[0,1,0],length:80}
    const input={basis,u:37.6,v:40,dof:'uv' as const,references:[axis],distance}
    expect(snapPlanar(input).u).toBe(37.25)
    expect(snapPlanar({...input,crossFace:false}).matches).toHaveLength(0)
    expect(snapPlanar({...input,v:90}).matches).toHaveLength(0)
  })
  it('side port locations guide a transverse hole to the right axial level',()=>{
    const port:SnapReference={id:'port',ownerId:'valve',label:'port',kind:'port',faceId:'top',point:[30,40,63.25],direction:[0,0,-1],radius:5}
    const front=getBoxFaceBasis('front',dimensions)
    const result=snapPlanar({basis:front,u:30.2,v:63.6,dof:'uv',references:[port],distance})
    expect(result.u).toBe(30);expect(result.v).toBe(63.25)
  })
  it('solves positive depths and rejects skew, parallel and finite-segment misses',()=>{
    expect(axisIntersection([30,40,100],[0,0,-1],[30,0,63.25],[0,1,0])).toEqual({t:36.75,s:40})
    expect(axisIntersection([30,40,100],[0,0,-1],[31,0,63.25],[0,1,0])).toBeNull()
    expect(axisIntersection([30,40,100],[0,0,-1],[30,40,0],[0,0,1])).toBeNull()
    const ref:SnapReference={id:'axis',ownerId:'other',label:'other',kind:'axis',point:[30,0,63.25],direction:[0,1,0],length:50}
    const input={mouth:[30,40,100] as Vec3,direction:[0,0,-1] as Vec3,depth:37,minDepth:10,references:[ref],distance}
    expect(snapDepth(input).depth).toBe(36.75)
    expect(snapDepth({...input,references:[{...ref,length:20}]}).matches).toHaveLength(0)
    expect(snapDepth({...input,bypass:true}).depth).toBe(37)
  })
  it('captures a side port plane only within the represented opening region',()=>{
    const ref:SnapReference={id:'port',ownerId:'other',label:'side',kind:'port',point:[30,40,63.25],direction:[0,0,-1],radius:5}
    const input={mouth:[32,40,100] as Vec3,direction:[0,0,-1] as Vec3,depth:37,minDepth:10,references:[ref],distance}
    expect(snapDepth(input).depth).toBe(36.75)
    expect(snapDepth({...input,mouth:[40,40,100]}).matches).toHaveLength(0)
    expect(snapDepth({...input,bypass:true}).matches).toHaveLength(0)
  })
  it('does not jump in depth when the axis projects to a single screen pixel',()=>{
    const ref:SnapReference={id:'axis',ownerId:'other',label:'axis',kind:'axis',point:[30,0,20],direction:[0,1,0],length:80}
    expect(snapDepth({mouth:[30,40,100],direction:[0,0,-1],depth:37,minDepth:10,references:[ref],distance:()=>0}).matches).toHaveLength(0)
  })
})

describe('shared geometry and side ports',()=>{
  it('uses the actual tilted axis on every mounting face',()=>{
    for(const face of ['top','bottom','front','back','left','right']) {
      const c={...cavity('c',face),tiltAngle:30,azimuth:0}
      const axis=cavityAxis(c,dimensions), b=getBoxFaceBasis(face,dimensions)
      expect(norm(axis.direction)).toBeCloseTo(1,12)
      expect(axis.direction.reduce((sum,x,i)=>sum+x*b.w[i],0)).toBeCloseTo(-Math.cos(Math.PI/6),12)
    }
  })
  it('includes implicit cone depth and preserves bottom-port start semantics',()=>{
    const bands=profileBands([{type:'straight',diameter:10,length:20},{type:'tapered',diameter:10,length:null,angle:90}])
    expect(bands.at(-1)?.z1).toBeCloseTo(25)
    const regions=portRegions([{depth:12,diameter:4},{depth:18,isBottomPort:true},{depth:60,diameter:4}],bands)
    expect(regions).toHaveLength(2)
    expect(regions[0]).toMatchObject({depth:12,min:10,max:14,bottom:false})
    expect(regions[1]).toMatchObject({depth:18,min:18,bottom:true})
    expect(regions[1].max).toBeCloseTo(25)
  })
  it('generates negative-face centers from the actual face domain',()=>{
    const {references}=buildReferences([],[],dimensions)
    expect(references.find(r=>r.faceId==='left')?.point).toEqual([0,50,50])
    expect(references.find(r=>r.faceId==='bottom')?.point).toEqual([50,50,0])
  })
  it('references follow instance position, tilt and effective depth without rendered meshes',()=>{
    const c={...cavity('c'),tiltAngle:30,azimuth:90}
    const {references,ports}=buildReferences([{cavity:c,steps:[{type:'straight',diameter:10,length:30}],ports:[{depth:12,diameter:4}]}],[],dimensions)
    const port=references.find(r=>r.kind==='port')!
    const a=cavityAxis(c,dimensions)
    expect(port.point[1]).toBeCloseTo(a.mouth[1]+a.direction[1]*12)
    expect(ports[0].ownerId).toBe('c')
  })
})
