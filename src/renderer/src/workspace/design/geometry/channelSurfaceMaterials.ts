import * as THREE from 'three'
import type { Step } from '@shared/cavity/types'
import type { TriangleTag } from './meshClassifier'
import type { CavityInstance, FlowChannel } from '@shared/design/types'
import { cavityAxis, portRegions, profileBands, type Vec3 } from '@shared/design/cavityGeometry'

export interface SurfaceColorRegion { min:number; max:number; color:string; hidden:boolean }
export function channelSurfaceRegions(cavity:CavityInstance,channels:FlowChannel[], showPorts = true):SurfaceColorRegion[] {
  const bands=profileBands(cavity.steps??[])
  const ports=portRegions(cavity.ports??[],bands)
  const colored = channels.filter(ch=>ch.cavityIds.includes(cavity.instanceId)).flatMap(ch=>{
    const explicit=ch.regions?.filter(r=>r.cavityId===cavity.instanceId)
    const ranges=explicit??(ports.length?ports.map(p=>({minDepth:p.min,maxDepth:p.max})):[{minDepth:0,maxDepth:bands.at(-1)?.z1??0}])
    return ranges.map(r=>({min:r.minDepth,max:r.maxDepth,color:ch.color,hidden:Boolean(ch.hidden)}))
  })
  // Channel colors take precedence over neutral markings, including overlapping bands.
  return [...colored, ...(showPorts ? ports.map(p => ({min:p.min,max:p.max,color:'#a5b4d4',hidden:false})) : [])]
}

/** Cosmetic markings only: no extra geometry and no effect on manufacturing dimensions. */
export function cosmeticThreadRegions(steps: Step[]) {
  return profileBands(steps).flatMap(b => {
    const thread = steps[b.index].thread
    if (!thread) return []
    const max = Math.min(b.z1, b.z0 + Math.max(0, thread.depth ?? b.length))
    if (max <= b.z0) return []
    return [{min:b.z0,max,spacing:Math.max(0.8,(max-b.z0)/12)}]
  })
}
/** Colors actual CSG walls per fragment; a triangle spanning two port bands must not bleed. */
export function makeCavitySurfaceMaterial(cavity:CavityInstance,dimensions:Vec3,regions:SurfaceColorRegion[],selected:boolean,clippingPlanes:THREE.Plane[]) {
  const material=new THREE.MeshStandardMaterial({
    color:selected?'#00EBFF':'#b4bdc6',
    emissive:selected?'#004d54':'#000000',
    emissiveIntensity:selected?0.35:0,
    metalness:selected?0.4:0.2,
    roughness:selected?0.15:0.55,
    side:THREE.DoubleSide,
    clippingPlanes
  })
  const {mouth,direction}=cavityAxis(cavity,dimensions)
  const threads = cosmeticThreadRegions(cavity.steps ?? [])
  material.customProgramCacheKey=()=>`cavity-regions-${regions.length}-threads-${threads.length}-selected-${selected}`
  material.onBeforeCompile=shader=>{
    // Even a zero-iteration GLSL loop may retain its uniform on some drivers.
    // Three.js flattens vector arrays before upload: declared slots must never be empty.
    shader.uniforms.flowMouth={value:new THREE.Vector3(...mouth)}
    shader.uniforms.flowDirection={value:new THREE.Vector3(...direction)}
    shader.uniforms.flowRanges={value:regions.length ? regions.map(r=>new THREE.Vector2(r.min,r.max)) : [new THREE.Vector2(0,0)]}
    shader.uniforms.flowColors={value:regions.length ? regions.map(r=>new THREE.Color(r.color)) : [new THREE.Color()]}
    shader.uniforms.flowHidden={value:regions.length ? regions.map(r=>r.hidden?1:0) : [0]}
    shader.uniforms.threadRanges={value:threads.length ? threads.map(t=>new THREE.Vector3(t.min,t.max,t.spacing)) : [new THREE.Vector3(0,0,1)]}
    shader.vertexShader='varying vec3 vFlowPosition;\n'+shader.vertexShader
    shader.vertexShader=shader.vertexShader.replace('#include <project_vertex>','#include <project_vertex>\nvFlowPosition=(modelMatrix*vec4(transformed,1.0)).xyz;')
    shader.fragmentShader=`uniform vec3 threadRanges[${Math.max(1,threads.length)}];\nvarying vec3 vFlowPosition;\nuniform vec3 flowMouth;\nuniform vec3 flowDirection;\nuniform vec2 flowRanges[${Math.max(1,regions.length)}];\nuniform vec3 flowColors[${Math.max(1,regions.length)}];\nuniform float flowHidden[${Math.max(1,regions.length)}];\n`+shader.fragmentShader
    shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
      float flowDepth=dot(vFlowPosition-flowMouth,flowDirection);
      for(int i=0;i<${regions.length};i++) {
        if(flowDepth>=flowRanges[i].x-0.00001&&flowDepth<=flowRanges[i].y+0.00001){
          // “隐藏通道”只关闭该通道的颜色显示。孔壁属于阀块实体，不能丢弃片元。
          ${selected ? '' : 'if(flowHidden[i]<0.5) diffuseColor.rgb=flowColors[i];'}
          break;
        }
      }
      for(int i=0;i<${threads.length};i++) {
        if(flowDepth>=threadRanges[i].x&&flowDepth<=threadRanges[i].y) {
          // Screen-space antialiasing fades markings out before they become subpixel noise.
          float phase=(flowDepth-threadRanges[i].x)/threadRanges[i].z;
          float footprint=max(fwidth(phase),0.0001);
          float line=1.0-smoothstep(0.025,0.025+footprint,abs(fract(phase+0.5)-0.5));
          float visible=1.0-smoothstep(0.25,0.75,footprint);
          diffuseColor.rgb*=1.0-0.48*line*visible;
        }
      }`)
  }
  return material
}
/** Preserve triangle indices and owner tags so all-depth picking stays valid. */
export function regroupCavityMaterials(geometry:THREE.BufferGeometry,tags:TriangleTag[],materialByOwner:Map<string,number>) {
  const result=geometry.clone()
  result.clearGroups()
  let last=-1,start=0,count=0
  tags.forEach((tag,i)=>{
    const original=geometry.groups.find(g=>i*3>=g.start&&i*3<g.start+g.count)?.materialIndex??0
    const material=tag.type==='cavity'?materialByOwner.get(tag.id)??original:original
    if(material!==last&&count){result.addGroup(start,count,last);start=i*3;count=0}
    last=material;count+=3
  })
  if(count) result.addGroup(start,count,last)
  return result
}
