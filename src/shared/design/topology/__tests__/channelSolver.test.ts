import { describe, it, expect } from 'vitest'
import {
  solveChannelTopology,
  segmentSegmentDistSq,
  isStructuralCavity
} from '../channelSolver'
import type { CavityInstance } from '../../types'

describe('channelSolver (Hydraulic Channel Topology Solver)', () => {
  const dimensions: [number, number, number] = [120, 100, 80]

  it('calculates 3D segment-to-segment distance correctly', () => {
    // 空间正交线段，相交于 (0, 0, 0)
    const res1 = segmentSegmentDistSq(
      [-10, 0, 0],
      [10, 0, 0],
      [0, -10, 0],
      [0, 10, 0]
    )
    expect(res1.distSq).toBeCloseTo(0, 5)

    // 空间错位平行线段
    const res2 = segmentSegmentDistSq(
      [0, 0, 0],
      [10, 0, 0],
      [0, 5, 0],
      [10, 5, 0]
    )
    expect(res2.distSq).toBeCloseTo(25, 5)
  })

  it('correctly identifies two intersecting orthogonal cavities as a single channel', () => {
    // 顶面垂直孔 (Top face: Z=80 down to Z=30 at X=60, Y=50)
    const cavityTop: CavityInstance = {
      instanceId: 'cav-top-1',
      name: '主压力口 P',
      libraryId: 'lib-1',
      templateId: 'tpl-port-p',
      faceId: 'top',
      u: 60,
      v: 50,
      rotation: 0,
      depthOffset: 0,
      portSemantic: { label: 'P', color: '#ef4444' },
      steps: [{ type: 'straight', diameter: 12, length: 50 }]
    }

    // 前面水平孔 (Front face: Y=0 drilling in +Y up to Y=60 at X=60, Z=40)
    // 此时在 (60, 50, 40) 与顶面孔相贯
    const cavityFront: CavityInstance = {
      instanceId: 'cav-front-1',
      name: '沟通工艺钻孔 1',
      libraryId: 'lib-1',
      templateId: 'tpl-drill-1',
      faceId: 'front',
      u: 60,
      v: 40,
      rotation: 0,
      depthOffset: 0,
      steps: [{ type: 'straight', diameter: 10, length: 60 }]
    }

    const topology = solveChannelTopology([cavityTop, cavityFront], dimensions)

    expect(topology.channels).toHaveLength(1)
    const ch = topology.channels[0]
    expect(ch.cavityIds).toContain('cav-top-1')
    expect(ch.cavityIds).toContain('cav-front-1')
    expect(ch.name).toBe('主油路 P')
    expect(ch.color).toBe('#ef4444')
    expect(topology.unconnectedCavityIds).toHaveLength(0)
  })

  it('places isolated non-intersecting cavities in unconnectedCavityIds', () => {
    const cavity1: CavityInstance = {
      instanceId: 'cav-1',
      name: '油口 A',
      libraryId: 'lib-1',
      templateId: 'tpl-1',
      faceId: 'top',
      u: 20,
      v: 20,
      rotation: 0,
      depthOffset: 0,
      steps: [{ type: 'straight', diameter: 10, length: 20 }]
    }

    const cavity2: CavityInstance = {
      instanceId: 'cav-2',
      name: '工艺孔 2',
      libraryId: 'lib-1',
      templateId: 'tpl-2',
      faceId: 'top',
      u: 90,
      v: 80,
      rotation: 0,
      depthOffset: 0,
      steps: [{ type: 'straight', diameter: 10, length: 20 }]
    }

    const topology = solveChannelTopology([cavity1, cavity2], dimensions)

    expect(topology.channels).toHaveLength(0)
    expect(topology.unconnectedCavityIds).toEqual(
      expect.arrayContaining(['cav-1', 'cav-2'])
    )
  })

  it('merges a 3-cavity transitive chain into a single channel (A connects B, B connects C)', () => {
    // 顶面孔 A: X=60, Y=30, depth 50 -> Z from 80 down to 30
    const cavityA: CavityInstance = {
      instanceId: 'cav-A',
      name: '主孔 A',
      libraryId: 'lib-1',
      templateId: 'tpl-1',
      faceId: 'top',
      u: 60,
      v: 30,
      rotation: 0,
      depthOffset: 0,
      steps: [{ type: 'straight', diameter: 10, length: 50 }]
    }

    // 前面孔 B: X=60, Z=40, depth 80 -> Y from 0 up to 80 (intersects A at Y=30, Z=40)
    const cavityB: CavityInstance = {
      instanceId: 'cav-B',
      name: '过渡孔 B',
      libraryId: 'lib-1',
      templateId: 'tpl-2',
      faceId: 'front',
      u: 60,
      v: 40,
      rotation: 0,
      depthOffset: 0,
      steps: [{ type: 'straight', diameter: 10, length: 80 }]
    }

    // 后面孔 C: Back face Y=100 drilling -Y up to depth 40 -> Y from 100 down to 60 at X=60, Z=40 (intersects B at Y=70, Z=40)
    const cavityC: CavityInstance = {
      instanceId: 'cav-C',
      name: '后端孔 C',
      libraryId: 'lib-1',
      templateId: 'tpl-3',
      faceId: 'back',
      // Back face basis: origin [0, 100, 0], u=[-1, 0, 0], v=[0, 0, 1], w=[0, 1, 0]
      // To get X=60, u = -60
      u: -60,
      v: 40,
      rotation: 0,
      depthOffset: 0,
      steps: [{ type: 'straight', diameter: 10, length: 45 }]
    }

    const topology = solveChannelTopology([cavityA, cavityB, cavityC], dimensions)
    expect(topology.channels).toHaveLength(1)
    expect(topology.channels[0].cavityIds).toHaveLength(3)
  })

  it('filters structural bolt holes into structuralCavityIds', () => {
    const boltHole: CavityInstance = {
      instanceId: 'bolt-1',
      name: 'M10 紧固螺栓孔',
      cavityType: 'bolt-hole',
      libraryId: 'lib-1',
      templateId: 'tpl-bolt',
      faceId: 'top',
      u: 15,
      v: 15,
      rotation: 0,
      depthOffset: 0,
      steps: [{ type: 'straight', diameter: 10, length: 25 }]
    }

    expect(isStructuralCavity(boltHole)).toBe(true)

    const topology = solveChannelTopology([boltHole], dimensions)
    expect(topology.channels).toHaveLength(0)
    expect(topology.unconnectedCavityIds).toHaveLength(0)
    expect(topology.structuralCavityIds).toContain('bolt-1')
  })

  it('respects user custom name and custom color overrides', () => {
    const cavityA: CavityInstance = {
      instanceId: 'cav-A',
      name: '油口 T',
      portSemantic: { label: 'T', color: '#3b82f6' },
      libraryId: 'lib-1',
      templateId: 'tpl-t',
      faceId: 'top',
      u: 60,
      v: 50,
      rotation: 0,
      depthOffset: 0,
      steps: [{ type: 'straight', diameter: 12, length: 50 }]
    }

    const cavityB: CavityInstance = {
      instanceId: 'cav-B',
      name: '回油沟通孔',
      libraryId: 'lib-1',
      templateId: 'tpl-drill',
      faceId: 'front',
      u: 60,
      v: 40,
      rotation: 0,
      depthOffset: 0,
      steps: [{ type: 'straight', diameter: 10, length: 60 }]
    }

    const userConfigs = {
      'port:T': {
        bindingKey: 'port:T',
        customName: '自定义主回油管路',
        customColor: '#06b6d4',
        hidden: true
      }
    }

    const topology = solveChannelTopology([cavityA, cavityB], dimensions, userConfigs)
    expect(topology.channels).toHaveLength(1)
    const ch = topology.channels[0]
    expect(ch.name).toBe('自定义主回油管路')
    expect(ch.color).toBe('#06b6d4')
    expect(ch.hidden).toBe(true)
  })
})


describe('independent valve ports', () => {
  const valve: CavityInstance = {instanceId:'valve',name:'valve',libraryId:'lib',templateId:'v',faceId:'top',u:60,v:50,rotation:0,depthOffset:0,steps:[{type:'straight',diameter:16,length:60}],ports:[{depth:15,diameter:8},{depth:45,diameter:8}]}
  const drill = (id:string,z:number):CavityInstance => ({...valve,instanceId:id,name:id,faceId:'front',v:z,ports:[],steps:[{type:'straight',diameter:6,length:55}]})
  it('keeps side ports independent and binds colors to their own wall bands', () => {
    const t=solveChannelTopology([valve,drill('a',65),drill('b',35)],[120,100,80])
    expect(t.channels).toHaveLength(2)
    expect(new Set(t.channels.map(c=>c.bindingKey)).size).toBe(2)
    expect(t.channels.map(c=>c.regions?.find(r=>r.cavityId==='valve'))).toEqual([
      {cavityId:'valve',portIndex:0,minDepth:11,maxDepth:19},
      {cavityId:'valve',portIndex:1,minDepth:41,maxDepth:49}
    ])
  })
  it('merges ports through an external drill, never through the shared valve cavity', () => {
    const bridge={...valve,instanceId:'bridge',ports:[],v:30,steps:[{type:'straight' as const,diameter:6,length:55}]}
    const t=solveChannelTopology([valve,drill('a',65),drill('b',35),bridge],[120,100,80])
    expect(t.channels).toHaveLength(1)
    expect(t.channels[0].regions?.filter(r=>r.cavityId==='valve')).toHaveLength(2)
  })
  it('reports the unconnected port even when another port is connected', () => {
    const t=solveChannelTopology([valve,drill('a',65)],[120,100,80])
    expect(t.channels).toHaveLength(1)
    expect(t.unconnectedPorts).toEqual([{cavityId:'valve',portIndex:1}])
  })
  it('does not connect a drill ending above a side-port band through a spherical endcap', () => {
    const near={...valve,instanceId:'near',ports:[],steps:[{type:'straight' as const,diameter:6,length:10}]}
    const t=solveChannelTopology([valve,near],[120,100,80])
    expect(t.channels).toHaveLength(0)
  })
})
