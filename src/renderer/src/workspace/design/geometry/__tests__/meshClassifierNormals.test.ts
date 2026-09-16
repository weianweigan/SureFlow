import { describe, expect, it } from 'vitest'
import { stabilizeAxisAlignedPlanarNormals, type TriangleTag } from '../meshClassifier'

describe('CSG display normals', () => {
  it('gives a planar face one exact normal while retaining curved cavity normals', () => {
    const positions=new Float32Array([
      0,0,0, 1,0,0, 0,1,0,
      0,0,0, 0,1,0, 0,0,1
    ])
    const normals=new Float32Array([
      .2,0,.98, .1,0,.99, 0,.2,.98,
      .7,0,.7, .7,0,.7, .7,0,.7
    ])
    const indices=new Uint32Array([0,1,2,3,4,5])
    const tags:TriangleTag[]=[{type:'face',id:'top'},{type:'cavity',id:'hole'}]
    const result=stabilizeAxisAlignedPlanarNormals(positions,normals,indices,tags)

    for(const index of result.indices.slice(0,3)) {
      expect(Array.from(result.normals.slice(index*3,index*3+3))).toEqual([0,0,1])
    }
    expect(Array.from(result.normals.slice(3*3,3*3+3))).toEqual(Array.from(normals.slice(3*3,3*3+3)))
    expect(Array.from(result.indices.slice(3))).toEqual([3,4,5])
  })

  it('does not flatten a non-planar or oblique surface', () => {
    const positions=new Float32Array([0,0,0, 1,0,1, 0,1,1])
    const normals=new Float32Array([0,-.7,.7, 0,-.7,.7, 0,-.7,.7])
    const indices=new Uint32Array([0,1,2])
    const result=stabilizeAxisAlignedPlanarNormals(positions,normals,indices,[{type:'base',id:'base'}])
    expect(result.positions).toEqual(positions)
    expect(result.normals).toEqual(normals)
    expect(result.indices).toEqual(indices)
  })
})
