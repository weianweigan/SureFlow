import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { hasGizmoIntersection, raycastSelection } from '../selectionRaycast'

describe('all-depth selection raycast', () => {
  it('retains multiple depths of one grouped mesh, including back faces', () => {
    const scene = new THREE.Scene()
    const geometry = new THREE.BoxGeometry(10, 10, 10)
    const material = new THREE.MeshBasicMaterial({ side: THREE.FrontSide })
    const mesh = new THREE.Mesh(geometry, Array(6).fill(material))
    mesh.userData.selectionMesh = true
    scene.add(mesh)
    const ray = new THREE.Ray(new THREE.Vector3(1, 2, 20), new THREE.Vector3(0, 0, -1))
    const hits = raycastSelection(ray, scene)
    expect(hits.map(h => h.distance)).toEqual([15, 25])
    expect(hits.every(h => h.object === mesh)).toBe(true)
    expect(hits.every(h => h.faceIndex != null)).toBe(true)
    expect(material.side).toBe(THREE.FrontSide)
    geometry.dispose(); material.dispose()
  })
  it('finds hidden mouth proxies behind the body and excludes decorative meshes', () => {
    const scene = new THREE.Scene()
    const geometry = new THREE.CircleGeometry(3)
    const material = new THREE.MeshBasicMaterial()
    const mouth = new THREE.Mesh(geometry, material)
    mouth.visible = false
    mouth.userData = { selectionMesh: true, cavityId: 'cavity' }
    const decoration = new THREE.Mesh(geometry, material)
    decoration.position.z = 5
    scene.add(mouth, decoration)
    const ray = new THREE.Ray(new THREE.Vector3(0.1, 0.2, 10), new THREE.Vector3(0, 0, -1))
    const hits = raycastSelection(ray, scene)
    expect(hits).toHaveLength(1)
    expect(hits[0].object.userData.cavityId).toBe('cavity')
    expect(raycastSelection(ray, scene, [new THREE.Plane(new THREE.Vector3(0, 0, 1), -1)])).toHaveLength(0)
    geometry.dispose(); material.dispose()
  })
  it('detects a gizmo through its ancestor even when a cavity is the nearer hit', () => {
    const cavity = new THREE.Mesh()
    const gizmoRoot = new THREE.Group()
    gizmoRoot.userData.interactionPriority = 'gizmo'
    const gizmoHandle = new THREE.Mesh()
    gizmoRoot.add(gizmoHandle)
    expect(hasGizmoIntersection([{object:cavity},{object:gizmoHandle}])).toBe(true)
    expect(hasGizmoIntersection([{object:cavity}])).toBe(false)
  })
})
