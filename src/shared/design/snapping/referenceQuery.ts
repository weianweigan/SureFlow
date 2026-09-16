import { contourBounds } from './contours'
import { localToWorldPoint, type FaceBasis } from '../faceMath'
import type { Vec3 } from '../cavityGeometry'
import type { SnapReference } from './solver'

type Entry = { ref: SnapReference; low:number; high:number; center:number }
type AxisIndex = { entries:Entry[]; halfSpan:number }
type Index = { ordinary:SnapReference[]; u:AxisIndex; v:AxisIndex }
const indexes=new WeakMap<readonly SnapReference[],Map<string,Index>>()

/** Orthogonal contours form bounded intervals; index both coordinates so distant
 * same-row references are retained without visiting every contour on each frame.
 * Geometry indexes survive camera changes; pixel thresholds are evaluated live.
 */
export function queryPlanarReferences(references:readonly SnapReference[],basis:FaceBasis,direction:Vec3,u:number,v:number,dof:'u'|'v'|'uv',distance:(a:Vec3,b:Vec3)=>number,radius:number): readonly SnapReference[] {
  const key=`${basis.id}:${basis.origin.join(',')}:${direction.join(',')}`
  let cache=indexes.get(references)
  if(!cache){cache=new Map();indexes.set(references,cache)}
  let index=cache.get(key)
  if(!index){
    index={ordinary:[],u:{entries:[],halfSpan:0},v:{entries:[],halfSpan:0}}
    for(const ref of references){
      if(ref.kind!=='circle'&&ref.kind!=='wall'){index.ordinary.push(ref);continue}
      const bounds=contourBounds(ref,basis,direction,key)
      if(!bounds)continue
      for(const [axis,offset] of [['u',0],['v',2]] as const){
        const low=bounds[offset],high=bounds[offset+1]
        index[axis].entries.push({ref,low,high,center:(low+high)/2})
        index[axis].halfSpan=Math.max(index[axis].halfSpan,(high-low)/2)
      }
    }
    index.u.entries.sort((a,b)=>a.center-b.center)
    index.v.entries.sort((a,b)=>a.center-b.center)
    if(cache.size>12)cache.clear()
    cache.set(key,index)
  }
  const found=new Set<SnapReference>()
  const raw=localToWorldPoint(basis,u,v)
  for(const axis of dof==='uv'?['u','v'] as const:[dof]){
    const {entries,halfSpan}=index[axis],value=axis==='u'?u:v
    const pixelDistance=(coordinate:number)=>distance(raw,localToWorldPoint(basis,axis==='u'?coordinate:u,axis==='v'?coordinate:v))
    let low=0,high=entries.length
    while(low<high){const mid=(low+high)>>>1;if(entries[mid].center<value)low=mid+1;else high=mid}
    for(const sign of [-1,1]){
      for(let i=sign<0?low-1:low;i>=0&&i<entries.length;i+=sign){
        const entry=entries[i],nearestPossible=entry.center-sign*halfSpan
        if(sign*(nearestPossible-value)>0&&pixelDistance(nearestPossible)>radius)break
        const nearest=Math.max(entry.low,Math.min(entry.high,value))
        if(pixelDistance(nearest)<=radius)found.add(entry.ref)
      }
    }
  }
  return [...index.ordinary,...found]
}
