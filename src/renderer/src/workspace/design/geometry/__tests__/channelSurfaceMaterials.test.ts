import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { channelSurfaceRegions, cosmeticThreadRegions, makeCavitySurfaceMaterial, regroupCavityMaterials } from '../channelSurfaceMaterials'
import type { CavityInstance, FlowChannel } from '@shared/design/types'

const cavity:CavityInstance={instanceId:'v',name:'v',libraryId:'l',templateId:'t',faceId:'top',u:20,v:30,rotation:0,depthOffset:0,steps:[{type:'straight',diameter:12,length:30}],ports:[{depth:10,diameter:6}]}
const channel:FlowChannel={id:'c',bindingKey:'c',name:'c',isCustomName:false,color:'#ff0000',cavityIds:['v'],regions:[{cavityId:'v',portIndex:0,minDepth:7,maxDepth:13}]}

describe('actual cavity wall materials',()=>{
  it('limits channel color to the port band even with port markings disabled',()=>{
    expect(channelSurfaceRegions(cavity,[channel],false)).toEqual([{min:7,max:13,color:'#ff0000',hidden:false}])
    expect(channelSurfaceRegions(cavity,[],true)).toHaveLength(1)
    expect(channelSurfaceRegions(cavity,[],false)).toEqual([])
  })
  it('clips cosmetic thread length to its own step and excludes zero depth',()=>{
    const thread={family:'METRIC' as const,designation:'M12',depth:5}
    expect(cosmeticThreadRegions([{type:'straight',diameter:14,length:3},{type:'straight',diameter:12,length:10,thread}])).toEqual([{min:3,max:8,spacing:0.8}])
    expect(cosmeticThreadRegions([{type:'straight',diameter:12,length:10,thread:{...thread,depth:99}}])[0].max).toBe(10)
    expect(cosmeticThreadRegions([{type:'straight',diameter:12,length:10,thread:{...thread,depth:0}}])).toEqual([])
  })
  it('preserves picking index order and base materials when adding cavity materials',()=>{
    const geometry=new THREE.BufferGeometry()
    geometry.setAttribute('position',new THREE.Float32BufferAttribute([0,0,0,1,0,0,0,1,0,0,0,1],3))
    geometry.setIndex([0,1,2,0,2,3,1,2,3])
    geometry.addGroup(0,3,1);geometry.addGroup(3,6,2)
    const result=regroupCavityMaterials(geometry,[{type:'face',id:'top'},{type:'cavity',id:'v'},{type:'cavity',id:'other'}],new Map([['v',4]]))
    expect(Array.from(result.index!.array)).toEqual(Array.from(geometry.index!.array))
    expect(result.groups.map(g=>g.materialIndex)).toEqual([1,4,2])
    expect(geometry.groups).toHaveLength(2)
    result.dispose();geometry.dispose()
  })
  it('supports thread-only materials without zero-sized shader arrays and updates selection programs',()=>{
    const threaded={...cavity,steps:[{...cavity.steps![0],thread:{family:'METRIC' as const,designation:'M12'}}]}
    const normal=makeCavitySurfaceMaterial(threaded,[120,100,80],[],false,[])
    const selected=makeCavitySurfaceMaterial(threaded,[120,100,80],[],true,[])
    const shader={uniforms:{},vertexShader:THREE.ShaderLib.standard.vertexShader,fragmentShader:THREE.ShaderLib.standard.fragmentShader}
    normal.onBeforeCompile(shader as THREE.WebGLProgramParametersWithUniforms,{} as THREE.WebGLRenderer)
    expect(shader.fragmentShader).not.toContain('[0]')
    expect(shader.fragmentShader).toContain('fwidth(phase)')
    expect(shader.vertexShader).toContain('vFlowPosition=(modelMatrix*vec4(transformed,1.0)).xyz')
    expect(normal.customProgramCacheKey()).not.toBe(selected.customProgramCacheKey())
    normal.dispose();selected.dispose()
  })
  it('keeps hidden channel walls visible and gives selection color priority',()=>{
    const hidden=makeCavitySurfaceMaterial(cavity,[120,100,80],[{min:0,max:30,color:'#ff0000',hidden:true}],false,[])
    const selected=makeCavitySurfaceMaterial(cavity,[120,100,80],[{min:0,max:30,color:'#ff0000',hidden:false}],true,[])
    const compile=(material:THREE.MeshStandardMaterial)=>{
      const shader={uniforms:{},vertexShader:THREE.ShaderLib.standard.vertexShader,fragmentShader:THREE.ShaderLib.standard.fragmentShader}
      material.onBeforeCompile(shader as THREE.WebGLProgramParametersWithUniforms,{} as THREE.WebGLRenderer)
      return shader.fragmentShader
    }
    const hiddenShader=compile(hidden)
    const selectedShader=compile(selected)
    expect(hiddenShader).not.toContain('discard')
    expect(hiddenShader).toContain('if(flowHidden[i]<0.5)')
    expect(selectedShader).not.toContain('diffuseColor.rgb=flowColors[i]')
    expect(selected.color.getHexString()).toBe('00ebff')
    hidden.dispose();selected.dispose()
  })
})


describe('GPU uniform upload regression', () => {
  it.each([false,true].flatMap(thread=>[false,true].map(color=>({thread,color}))))('populates every declared array slot: %j', ({thread,color}) => {
    const c={...cavity,steps:[{...cavity.steps![0],thread:thread?{family:'METRIC' as const,designation:'M12'}:null}]}
    const material=makeCavitySurfaceMaterial(c,[120,100,80],color?[{min:0,max:30,color:'#ff0000',hidden:false}]:[],false,[])
    const shader={uniforms:{} as Record<string,THREE.IUniform>,vertexShader:THREE.ShaderLib.standard.vertexShader,fragmentShader:THREE.ShaderLib.standard.fragmentShader}
    material.onBeforeCompile(shader as THREE.WebGLProgramParametersWithUniforms,{} as THREE.WebGLRenderer)
    for(const name of ['flowRanges','flowColors','flowHidden','threadRanges']) {
      const declared=Number(shader.fragmentShader.match(new RegExp(name+'\\[(\\d+)\\]'))![1])
      const values=shader.uniforms[name].value
      expect(values).toHaveLength(declared)
      if(name!=='flowHidden') {
        // Three.js WebGLUniforms.flatten reads the first vector and calls toArray.
        const flattened:number[]=[]
        values[0].toArray(flattened)
        expect(flattened.every(Number.isFinite)).toBe(true)
      }
    }
    material.dispose()
  })
})
