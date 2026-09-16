import { useLayoutEffect, useRef, type ReactNode } from 'react'
import { Group } from 'three'
import { applyGizmoVisualPriority, GIZMO_VISUAL_ORDER } from './gizmoVisualPriority'

/** Reapply after conditional hover/drag visuals mount or their props change. */
export function GizmoVisualLayer({ children, priority = GIZMO_VISUAL_ORDER }: { children: ReactNode; priority?: number }) {
  const root = useRef<Group>(null)
  useLayoutEffect(() => {
    if (root.current) applyGizmoVisualPriority(root.current, priority)
  })
  return <group ref={root} renderOrder={priority}>{children}</group>
}
