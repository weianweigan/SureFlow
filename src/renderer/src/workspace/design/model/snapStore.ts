import { create } from 'zustand'
import type { SnapMatch } from '@shared/design/snapping/solver'
import type { ProximityDimension } from '@shared/design/snapping/measurements'
export interface SnapSettings { geometry:boolean; grid:boolean; crossFace:boolean; showPorts:boolean; nearbyDistances:boolean }
const defaults:SnapSettings={geometry:true,grid:true,crossFace:true,showPorts:true,nearbyDistances:true}
function initial():SnapSettings {
  try {
    const saved=JSON.parse(localStorage.getItem('sureflow:snap-settings')??'{}')
    return Object.fromEntries(Object.entries(defaults).map(([k,v])=>[k,typeof saved[k]==='boolean'?saved[k]:v])) as unknown as SnapSettings
  } catch { return defaults }
}
export const useSnapStore=create<{
  settings:SnapSettings
  matches:Record<string,SnapMatch[]>
  dimensions:Record<string,ProximityDimension[]>
  setFeedback:(id:string,matches:SnapMatch[],dimensions:ProximityDimension[])=>void
  setMatches:(id:string,matches:SnapMatch[])=>void
  toggle:(key:keyof SnapSettings)=>void
}>((set)=>({
  settings:initial(), matches:{}, dimensions:{},
  setFeedback:(id,matches,dimensions)=>set(s=>({matches:{...s.matches,[id]:matches},dimensions:{...s.dimensions,[id]:dimensions}})),
  setMatches:(id,matches)=>set(s=>({matches:{...s.matches,[id]:matches}})),
  toggle:(key)=>set(s=>{
    const settings={...s.settings,[key]:!s.settings[key]}
    try {localStorage.setItem('sureflow:snap-settings',JSON.stringify(settings))} catch { /* session settings remain usable */ }
    return {settings}
  })
}))
