import { useRef, useState } from 'react'
import { Html } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { useSnapStore } from '../../model/snapStore'

interface ScreenDimension { id:string; path:string; projectionPath:string; x:number; y:number; label:string }
export function ProximityDimensions({projectId}:{projectId:string}) {
  const {camera,size}=useThree()
  const [lines,setLines]=useState<ScreenDimension[]>([])
  const previous=useRef('')
  useFrame(()=>{
    const state=useSnapStore.getState()
    const dimensions=state.settings.nearbyDistances?state.dimensions[projectId]??[]:[]
    const project=(point:[number,number,number])=>{
      const p=new THREE.Vector3(...point).project(camera)
      return {x:(p.x+1)*size.width/2,y:(1-p.y)*size.height/2,z:p.z}
    }
    const next:ScreenDimension[]=[]
    for (const d of dimensions) {
      const a=project(d.start),b=project(d.end),target=project(d.target)
      if (a.z < -1 || a.z > 1 || b.z < -1 || b.z > 1) continue
      const length=Math.hypot(b.x-a.x,b.y-a.y)
      if (length<3 || !Number.isFinite(length)) continue
      const nx=-(b.y-a.y)/length,ny=(b.x-a.x)/length
      const sign=d.axis==='v'?-1:1, offset=32*sign
      const ax=a.x+nx*offset,ay=a.y+ny*offset,bx=b.x+nx*offset,by=b.y+ny*offset
      const x=(ax+bx)/2+nx*10*sign,y=(ay+by)/2+ny*10*sign
      if (x<45 || x>size.width-45 || y<14 || y>size.height-14) continue
      if (next.some(line=>Math.abs(line.x-x)<90 && Math.abs(line.y-y)<20)) continue
      const value=Math.abs(d.value)<0.01?d.value.toPrecision(2):d.value.toFixed(2)
      next.push({id:d.id,x,y,label:`Δ${d.axis==='depth'?'深度':d.axis.toUpperCase()} ${value} mm${d.projection?' · 投影':''}`,
        path:`M ${a.x} ${a.y} L ${ax+nx*4*sign} ${ay+ny*4*sign} M ${b.x} ${b.y} L ${bx+nx*4*sign} ${by+ny*4*sign} M ${ax} ${ay} L ${bx} ${by} M ${ax-nx*3} ${ay-ny*3} L ${ax+nx*3} ${ay+ny*3} M ${bx-nx*3} ${by-ny*3} L ${bx+nx*3} ${by+ny*3}`,
        projectionPath:Math.hypot(target.x-b.x,target.y-b.y)>3?`M ${target.x} ${target.y} L ${b.x} ${b.y}`:''})
    }
    const signature=JSON.stringify(next)
    if(signature!==previous.current){previous.current=signature;setLines(next)}
  })
  if (!lines.length) return null
  return <Html fullscreen calculatePosition={()=>[size.width/2,size.height/2]} style={{pointerEvents:'none'}} zIndexRange={[5,0]}>
    <svg width={size.width} height={size.height} style={{pointerEvents:'none',overflow:'hidden'}} data-testid="proximity-dimensions">
      {lines.map(line=><g key={line.id}>
        <path d={line.path} fill="none" stroke="#94a3b8" strokeWidth={1}/>
        <path d={line.projectionPath} fill="none" stroke="#94a3b8" strokeWidth={1} strokeDasharray="3 4" opacity={0.6}/>
        <text x={line.x} y={line.y} textAnchor="middle" dominantBaseline="central" fill="#e2e8f0" stroke="#1e293b" strokeWidth={2} paintOrder="stroke" fontSize={11}>{line.label}</text>
      </g>)}
    </svg>
  </Html>
}
