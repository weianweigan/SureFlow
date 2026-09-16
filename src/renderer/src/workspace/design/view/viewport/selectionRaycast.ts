import * as THREE from 'three'

const pickMaterial = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })

export const GIZMO_INTERACTION_PRIORITY = 'gizmo'

function belongsToGizmo(object: THREE.Object3D | null): boolean {
  for (let current = object; current; current = current.parent) {
    if (current.userData.interactionPriority === GIZMO_INTERACTION_PRIORITY) return true
  }
  return false
}

/** Full-depth cavity picking must yield whenever the pointer ray also hits an active gizmo. */
export function hasGizmoIntersection(intersections: Array<{ object: THREE.Object3D }>): boolean {
  return intersections.some(hit => belongsToGizmo(hit.object))
}

/** R3F deduplicates intersections per object. Query meshes directly to retain all depths. */
export function raycastSelection(ray: THREE.Ray, scene: THREE.Object3D, planes: THREE.Plane[] = []) {
  const caster = new THREE.Raycaster()
  caster.ray.copy(ray)
  const hits: THREE.Intersection[] = []
  scene.updateWorldMatrix(true, true)
  scene.traverse(object => {
    if (object instanceof THREE.Mesh && object.userData.selectionMesh) {
      const proxy = new THREE.Mesh(object.geometry, pickMaterial)
      proxy.matrixWorld.copy(object.matrixWorld)
      hits.push(...caster.intersectObject(proxy, false).map(hit => ({ ...hit, object })))
    }
  })
  return hits.filter(hit => !planes.some(p => p.distanceToPoint(hit.point) < -0.001))
    .sort((a, b) => a.distance - b.distance)
}
