import { useEffect, useMemo } from 'react'
import { useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { getCavityWorldMatrix, getBoxFaceBasis } from '@shared/design/faceMath'
import { useDesignStore, getSelectedFeatures } from '../../model/designStore'
import { useAnalysisStore } from '../../model/analysisStore'
import { usePlacementStore } from '../../model/placementStore'
import { useLibraryStore } from '../../../library/viewmodel/libraryStore'
import { buildCavityThreeGeometry, getCavitySteps } from '../../geometry/cavityProfileBuilder'
import { matchesMarquee, promoteFeatures, type ScreenBounds } from '../../model/selectionMath'
import { raycastSelection } from './selectionRaycast'

/** Owns left-button gestures; manipulator pointer-down handlers retain priority. */
export function MarqueeSelection({ projectId, dimensions }: {
  projectId: string; dimensions: [number, number, number]
}): null {
  const { gl, camera, scene, controls } = useThree()
  const session = useDesignStore(s => s.projects[projectId])
  const library = useLibraryStore(s => s.doc)
  const scheme = session?.doc.schemes.find(s => s.id === session.doc.activeSchemeId)
  const cavities = scheme?.cavities
  const [sx, sy, sz] = dimensions
  // Store actual profile vertices, including inclined-hole transforms, rather than mouth centers.
  const projections = useMemo(() => (cavities ?? []).filter(c => !c.suppressed).map(cavity => {
    const geometry = buildCavityThreeGeometry(getCavitySteps(cavity, library))
    const matrix = new THREE.Matrix4().fromArray(getCavityWorldMatrix(
      getBoxFaceBasis(cavity.faceId, [sx, sy, sz]), cavity.u, cavity.v,
      cavity.depthOffset ?? 0, cavity.rotation ?? 0, cavity.tiltAngle ?? 0, cavity.azimuth ?? cavity.rotation ?? 0
    ))
    geometry.applyMatrix4(matrix)
    const positions = Array.from(geometry.getAttribute('position').array)
    geometry.dispose()
    return { id: cavity.instanceId, positions }
  }), [cavities, library, sx, sy, sz])

  useEffect(() => {
    const canvas = gl.domElement
    const orbit = controls as unknown as { enabled: boolean } | null
    let gesture: { x: number; y: number; id: number; additive: boolean; active: boolean } | null = null
    let suppressClick = false
    const overlay = document.createElement('div')
    Object.assign(overlay.style, { position: 'fixed', pointerEvents: 'none', zIndex: '1000', display: 'none' })
    overlay.setAttribute('aria-hidden', 'true')
    document.body.appendChild(overlay)
    const reset = () => {
      if (gesture && canvas.hasPointerCapture(gesture.id)) canvas.releasePointerCapture(gesture.id)
      gesture = null
      overlay.style.display = 'none'
    }
    const down = (e: PointerEvent) => {
      if (e.target !== canvas) return
      suppressClick = false
      if (e.button !== 0 || !e.isPrimary || usePlacementStore.getState().isPlacing) return
      if (orbit?.enabled === false) { suppressClick = true; return }
      gesture = { x: e.clientX, y: e.clientY, id: e.pointerId, additive: e.shiftKey || e.ctrlKey || e.metaKey, active: false }
    }
    const move = (e: PointerEvent) => {
      if (!gesture || e.pointerId !== gesture.id) return
      if (!gesture.active && Math.hypot(e.clientX - gesture.x, e.clientY - gesture.y) <= 5) return
      gesture.active = true
      suppressClick = true
      if (!canvas.hasPointerCapture(e.pointerId)) canvas.setPointerCapture(e.pointerId)
      const crossing = e.clientX < gesture.x
      Object.assign(overlay.style, {
        display: 'block', left: `${Math.min(e.clientX, gesture.x)}px`, top: `${Math.min(e.clientY, gesture.y)}px`,
        width: `${Math.abs(e.clientX - gesture.x)}px`, height: `${Math.abs(e.clientY - gesture.y)}px`,
        border: `1px ${crossing ? 'dashed #22c55e' : 'solid #00a2ff'}`,
        background: crossing ? 'rgba(34,197,94,0.15)' : 'rgba(0,162,255,0.15)'
      })
    }
    const up = (e: PointerEvent) => {
      if (!gesture || e.pointerId !== gesture.id) return
      const start = gesture
      const distance = Math.hypot(e.clientX - start.x, e.clientY - start.y)
      if (start.active) {
        const rect = { minX: Math.min(start.x, e.clientX), maxX: Math.max(start.x, e.clientX), minY: Math.min(start.y, e.clientY), maxY: Math.max(start.y, e.clientY) }
        const viewport = canvas.getBoundingClientRect()
        camera.updateMatrixWorld()
        const point = new THREE.Vector3()
        const hits = projections.filter(({ positions }) => {
          const bounds: ScreenBounds = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity }
          let inDepth = false
          for (let i = 0; i < positions.length; i += 3) {
            point.fromArray(positions, i).project(camera)
            if (point.z >= -1 && point.z <= 1) inDepth = true
            const x = viewport.left + (point.x + 1) * viewport.width / 2
            const y = viewport.top + (1 - point.y) * viewport.height / 2
            bounds.minX = Math.min(bounds.minX, x); bounds.maxX = Math.max(bounds.maxX, x)
            bounds.minY = Math.min(bounds.minY, y); bounds.maxY = Math.max(bounds.maxY, y)
          }
          return inDepth && matchesMarquee(bounds, rect, e.clientX < start.x)
        }).map(hit => ({ type: 'cavity' as const, id: hit.id }))
        const state = useDesignStore.getState()
        const previous = start.additive ? getSelectedFeatures(state.projects[projectId]?.selected) : []
        const items = promoteFeatures([...previous, ...hits], scheme)
        state.selectFeature(projectId, items.length ? { type: 'features', items } : null)
      } else if (distance >= 3) {
        suppressClick = true
      } else {
        const rect = canvas.getBoundingClientRect()
        const raycaster = new THREE.Raycaster()
        raycaster.setFromCamera(new THREE.Vector2((e.clientX - rect.left) / rect.width * 2 - 1, 1 - (e.clientY - rect.top) / rect.height * 2), camera)
        if (!raycastSelection(raycaster.ray, scene).length && !start.additive) {
          useDesignStore.getState().selectFeature(projectId, null)
          useAnalysisStore.getState().selectIssue(null)
        }
      }
      reset()
    }
    const click = (e: MouseEvent) => {
      if (suppressClick) { e.stopImmediatePropagation(); e.preventDefault() }
    }
    const cancel = () => { if (gesture) suppressClick = true; reset() }
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') cancel() }
    // Window bubble runs after R3F has allowed a Gizmo to claim pointer-down.
    window.addEventListener('pointerdown', down)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', cancel)
    window.addEventListener('blur', cancel)
    window.addEventListener('keydown', key)
    canvas.addEventListener('click', click, true)
    canvas.addEventListener('dblclick', click, true)
    return () => {
      reset(); overlay.remove()
      window.removeEventListener('pointerdown', down)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', cancel)
      window.removeEventListener('blur', cancel)
      window.removeEventListener('keydown', key)
      canvas.removeEventListener('click', click, true)
      canvas.removeEventListener('dblclick', click, true)
    }
  }, [gl, camera, scene, controls, projectId, scheme, projections])
  return null
}
