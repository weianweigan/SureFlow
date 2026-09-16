import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { applyGizmoVisualPriority, GIZMO_VISUAL_ORDER } from '../gizmoVisualPriority'

describe('gizmo visual priority', () => {
  it('keeps nested handles in the final transparent queue without changing opacity or picking', () => {
    const root = new THREE.Group(), child = new THREE.Group()
    root.add(child)
    const solid = new THREE.MeshBasicMaterial({ depthTest: false })
    const invisible = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0 })
    const backing = new THREE.Mesh(new THREE.PlaneGeometry(), solid)
    const hit = new THREE.Mesh(new THREE.PlaneGeometry(), invisible)
    child.add(backing, hit)
    const raycast = hit.raycast
    applyGizmoVisualPriority(root)
    expect(child.renderOrder).toBe(GIZMO_VISUAL_ORDER)
    for (const material of [solid, invisible]) {
      expect(material.transparent).toBe(true)
      expect(material.depthTest).toBe(false)
      expect(material.depthWrite).toBe(false)
      expect(material.forceSinglePass).toBe(true)
    }
    expect(solid.opacity).toBe(1)
    expect(invisible.opacity).toBe(0)
    expect(hit.raycast).toBe(raycast)
    expect(backing.renderOrder).toBeLessThan(hit.renderOrder)
  })

  it('handles new hover visuals, stays above ghosts, and does not churn material programs', () => {
    const scene = new THREE.Group(), handles = new THREE.Group()
    const ghost = new THREE.Mesh(new THREE.PlaneGeometry(), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.35 }))
    scene.add(ghost, handles)
    const core = new THREE.Mesh(new THREE.PlaneGeometry(), new THREE.MeshBasicMaterial())
    handles.add(core)
    applyGizmoVisualPriority(handles, 11000)
    const version = core.material.version
    const halo = new THREE.Mesh(new THREE.PlaneGeometry(), new THREE.MeshBasicMaterial({ transparent:true, opacity:0.4 }))
    handles.add(halo)
    applyGizmoVisualPriority(handles, 11000)
    expect(core.material.version).toBe(version)
    expect(halo.material.depthWrite).toBe(false)
    expect(ghost.material.depthWrite).toBe(true)
    expect(handles.renderOrder).toBeGreaterThan(ghost.renderOrder)
  })
})
