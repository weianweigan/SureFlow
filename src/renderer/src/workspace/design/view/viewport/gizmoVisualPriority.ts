import { Group, Material, type Object3D } from 'three'

export const GIZMO_VISUAL_ORDER = 10_000

/** Three sorts opaque and transparent objects in separate queues. All handle
 * surfaces must join the final queue, even when their opacity is exactly one.
 * Nested Groups reset groupOrder, so set the priority throughout the subtree.
 * Only pass handle visuals here; model/ghost materials retain their own policy.
 */
export function applyGizmoVisualPriority(root: Object3D, priority = GIZMO_VISUAL_ORDER): void {
  let order = 0
  root.traverse(object => {
    if (object instanceof Group) object.renderOrder = priority
    const drawable = object as Object3D & { material?: Material | Material[] }
    if (!drawable.material) return
    object.renderOrder = priority + order++
    const materials = Array.isArray(drawable.material) ? drawable.material : [drawable.material]
    for (const material of materials) {
      if (!material.transparent || !material.forceSinglePass) material.needsUpdate = true
      material.transparent = true
      material.depthTest = false
      material.depthWrite = false
      material.forceSinglePass = true
    }
  })
}
