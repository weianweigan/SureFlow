import { useMemo, useRef, useCallback, useEffect } from 'react'
import { useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { useDesignStore } from '../../model/designStore'
import { useLibraryStore, getLoadedLibs } from '../../../library/viewmodel/libraryStore'
import { getCavitySteps } from '../../geometry/cavityProfileBuilder'
import { getCavityPorts } from '../../geometry/templateHoleResolver'
import { buildReferences } from './referenceProvider'
import { useSnapStore } from '../../model/snapStore'
import { snapPlanar, snapDepth, type SnapMatch } from '@shared/design/snapping/solver'
import { getBoxFaceBasis, localToWorldPoint } from '@shared/design/faceMath'
import type { Vec3 } from '@shared/design/cavityGeometry'
import { measurePlanar, measureDepth, type ProximityDimension } from '@shared/design/snapping/measurements'

export function useGeometryReferences(projectId:string) {
  const session=useDesignStore(s=>s.projects[projectId])
  const library=useLibraryStore(s=>s.doc)
  const scheme=session?.doc.schemes.find(s=>s.id===session.doc.activeSchemeId)
  const dimensions=session?.doc.baseBody.dimensions
  return useMemo(()=>buildReferences((scheme?.cavities??[]).map(cavity=>{
    const source=cavity.libraryId===library?.id?library:getLoadedLibs().get(cavity.libraryId)??library
    return {cavity,steps:getCavitySteps(cavity,source),ports:getCavityPorts(cavity,source)}
  }),scheme?.groups??[],dimensions??[100,100,100]),[scheme?.cavities,scheme?.groups,dimensions,library])
}
export function useGeometrySnap(projectId:string, dimensions:Vec3) {
  const {camera,size}=useThree()
  const {references}=useGeometryReferences(projectId)
  const previous=useRef<string[]>([])
  const previousDimensions=useRef<string[]>([])
  const cycle=useRef(0)
  const cycleAnchor=useRef<Vec3|null>(null)
  const lastRaw=useRef<Vec3|null>(null)
  const clear=useCallback(()=>{previous.current=[];previousDimensions.current=[];cycle.current=0;cycleAnchor.current=null;useSnapStore.getState().setFeedback(projectId,[],[])},[projectId])
  useEffect(()=>clear,[clear])
  useEffect(()=>{clear()},[references,clear])
  const publish=(matches:SnapMatch[],dimensions:ProximityDimension[])=>{
    previous.current=matches.map(m=>m.id)
    previousDimensions.current=dimensions.map(m=>m.id)
    useSnapStore.getState().setFeedback(projectId,matches,dimensions)
  }
  const distance=(a:Vec3,b:Vec3)=>{
    const p=new THREE.Vector3(...a).project(camera), q=new THREE.Vector3(...b).project(camera)
    return Math.hypot((p.x-q.x)*size.width/2,(p.y-q.y)*size.height/2)
  }
  const options=(excluded:string[],bypass:boolean)=>{
    const excludedSet=new Set(excluded)
    // Group datums belong to the same moving rigid bodies.
    const state=useDesignStore.getState().projects[projectId]
    const scheme=state?.doc.schemes.find(s=>s.id===state.doc.activeSchemeId)
    for (const group of scheme?.groups??[]) if (group.cavityIds.some(id=>excludedSet.has(id)) || scheme?.cavities.some(c=>c.groupId===group.id&&excludedSet.has(c.instanceId))) excludedSet.add(group.id)
    return {...useSnapStore.getState().settings,references,excluded:excludedSet,bypass,previous:previous.current,cycle:cycle.current,distance}
  }
  const track=(point:Vec3)=>{
    if(cycleAnchor.current&&distance(cycleAnchor.current,point)>4){cycle.current=0;cycleAnchor.current=null;previous.current=[]}
    lastRaw.current=point
  }
  return {
    clear,
    next:()=>{cycle.current++;cycleAnchor.current=lastRaw.current;previous.current=[]},
    planar:(faceId:string,u:number,v:number,dof:'u'|'v'|'uv',excluded:string[]=[],bypass=false,direction?:Vec3)=>{
      track(localToWorldPoint(getBoxFaceBasis(faceId,dimensions),u,v))
      const input={...options(excluded,bypass),basis:getBoxFaceBasis(faceId,dimensions),u,v,dof,direction}
      const result=snapPlanar(input)
      publish(result.matches,input.nearbyDistances?measurePlanar({...input,u:result.u,v:result.v},result.matches,previousDimensions.current):[]);return result
    },
    depth:(mouth:Vec3,direction:Vec3,total:number,upper:number,excluded:string[],bypass=false)=>{
      track(mouth.map((x,i)=>x+direction[i]*total) as Vec3)
      const opts=options(excluded,bypass)
      const project=useDesignStore.getState().projects[projectId]
      const source=project?.doc.schemes.find(s=>s.id===project.doc.activeSchemeId)?.cavities.find(c=>excluded.includes(c.instanceId))
      if (!opts.crossFace) opts.references=references.filter(r=>r.faceId===source?.faceId)
      const result=snapDepth({...opts,mouth,direction,depth:total,minDepth:upper+2,grid:false})
      if (!result.matches.length && !bypass && opts.grid) result.depth=upper+Math.max(2,Math.round(total-upper))
      publish(result.matches,opts.nearbyDistances?measureDepth({...opts,mouth,direction,depth:result.depth,minDepth:upper+2},result.matches,previousDimensions.current):[]);return result
    }
  }
}
