import { useGeometrySnap } from '../../interaction/snapping/useGeometrySnap'
import { cavityAxis, type Vec3 } from '@shared/design/cavityGeometry'
import { localToWorldPoint } from '@shared/design/faceMath'
import { useEffect, useRef, type FC } from 'react'
import * as THREE from 'three'
import { useThree } from '@react-three/fiber'
import { usePlacementStore } from '../../model/placementStore'
import { useDesignStore } from '../../model/designStore'
import { useLibraryStore } from '../../../library/viewmodel/libraryStore'
import { resolveAllTemplateHoles } from '../../geometry/templateHoleResolver'
import { detectBaseBodyFace, getBoxFaceBasis, worldToLocalPoint } from '@shared/design/faceMath'
import type { CavityInstance, CavityGroup } from '@shared/design/types'

interface PlacementControllerProps {
  projectId: string
  dimensions: [number, number, number]
  blockMeshRef?: React.RefObject<THREE.Mesh | null>
}

/**
 * 视口布孔控制器（拖拽与瞄准）
 * 严格对齐 PRD-FR-04-04 §1 规范：
 * 1. 拖拽布孔（Drag & Drop）：监听 DOM dragover / drop，光标射线投射至表面，实时吸附与 1mm 网格捕捉；
 * 2. 点选瞄准（Click & Place）：十字准星光标，在表面点击即刻落孔，按 Esc / 右键取消；
 * 3. 实例化与面板停留策略：落孔后右侧栏维持在孔腔库 Tab，方便连续布孔。
 */
export const PlacementController: FC<PlacementControllerProps> = ({
  projectId,
  dimensions
}) => {
  const { gl, camera, scene } = useThree()
  const addCavities = useDesignStore((s) => s.addCavities)
  const libraryDoc = useLibraryStore((s) => s.doc)

  const isPlacing = usePlacementStore((s) => s.isPlacing)
  const mode = usePlacementStore((s) => s.mode)

  const updatePlacement = usePlacementStore((s) => s.updatePlacement)
  const clearHoverPosition = usePlacementStore((s) => s.clearHoverPosition)
  const cancelPlacement = usePlacementStore((s) => s.cancelPlacement)

  const snapping = useGeometrySnap(projectId, dimensions)
  const snapApi = useRef(snapping)
  snapApi.current = snapping
  useEffect(() => { if (!isPlacing) snapApi.current.clear() }, [isPlacing])
  const lastSnapPointer=useRef<{x:number;y:number;shift:boolean}|null>(null)
  const raycasterRef = useRef(new THREE.Raycaster())

  // 实例化模板（完整支持单孔与多孔/组合孔及轮廓）
  const instantiatePlacedTemplate = (store: ReturnType<typeof usePlacementStore.getState>) => {
    if (!store.template || !store.currentFaceId) return
    const resolvedHoles = resolveAllTemplateHoles(store.template, libraryDoc)
    const isMulti = resolvedHoles.length > 1
    const hasOutline = Boolean(store.template.geometry?.outline)
    const groupId = isMulti || hasOutline ? `group-${Date.now()}-${Math.floor(Math.random() * 1000)}` : undefined

    const instances: CavityInstance[] = resolvedHoles.map((h, idx) => ({
      instanceId: `cav-${Date.now()}-${idx}-${Math.floor(Math.random() * 1000)}`,
      name: isMulti ? `${store.template!.name} - ${h.name}` : store.template!.name,
      libraryId: store.libraryId || 'builtin-standard',
      templateId: store.template!.id,
      cavityType: h.cavityType,
      subHoleName: h.name,
      steps: h.steps,
      ports: h.ports,
      tiltAngle: h.tiltAngle,
      azimuth: h.azimuth,
      groupId,
      faceId: store.currentFaceId!,
      u: store.u + h.uOffset,
      v: store.v + h.vOffset,
      rotation: h.rotation || 0,
      depthOffset: 0,
      portSemantic: h.portSemantic,
      suppressed: false
    }))

    let group: CavityGroup | undefined
    if (groupId) {
      group = {
        id: groupId,
        name: store.template.name,
        cavityType: store.template.cavityType,
        faceId: store.currentFaceId,
        cavityIds: instances.map((c) => c.instanceId),
        outline: store.template.geometry?.outline,
        u: store.u,
        v: store.v
      }
    }

    addCavities(projectId, instances, group)
  }

  // 执行射线投射计算宿主面及 1mm 吸附的 (U, V) 坐标
  const performRaycast = (clientX: number, clientY: number, shiftKey: boolean = false) => {
    lastSnapPointer.current={x:clientX,y:clientY,shift:shiftKey}
    const rect = gl.domElement.getBoundingClientRect()
    const x = ((clientX - rect.left) / rect.width) * 2 - 1
    const y = -((clientY - rect.top) / rect.height) * 2 + 1

    const pointer = new THREE.Vector2(x, y)
    raycasterRef.current.setFromCamera(pointer, camera)

    const project = useDesignStore.getState().projects[projectId]
    const body = project?.doc.baseBody
    let point: THREE.Vector3 | null = null
    let faceId: string | null = null
    if (!body?.template || (body.type !== 'step' && body.template === 'box')) {
      point = raycasterRef.current.ray.intersectBox(new THREE.Box3(new THREE.Vector3(), new THREE.Vector3(...dimensions)), new THREE.Vector3())
      if (point) {
        const distances = [Math.abs(point.z-dimensions[2]),Math.abs(point.z),Math.abs(point.y),Math.abs(point.y-dimensions[1]),Math.abs(point.x),Math.abs(point.x-dimensions[0])]
        faceId = ['top','bottom','front','back','left','right'][distances.indexOf(Math.min(...distances))]
      }
    } else {
      const hits = raycasterRef.current.intersectObjects(scene.children,true)
      const hit = hits.find(i=>i.object.userData.selectionMesh && !i.object.userData.cavityId && i.face)
      if (hit?.face) {
        point=hit.point
        faceId=detectBaseBodyFace(hit.face.normal.clone().transformDirection(hit.object.matrixWorld),point,body)
      }
    }
    if (point && faceId) {
      const basis=getBoxFaceBasis(faceId,dimensions,body)
      const local=worldToLocalPoint(basis,point.toArray() as Vec3)
      const template=usePlacementStore.getState().template
      const first=template?resolveAllTemplateHoles(template,libraryDoc)[0]:undefined
      const direction=cavityAxis({faceId,u:0,v:0,depthOffset:0,rotation:first?.rotation??0,tiltAngle:first?.tiltAngle,azimuth:first?.azimuth} as CavityInstance,dimensions,body).direction
      const result=snapApi.current.planar(faceId,local.u,local.v,'uv',[],shiftKey,direction)
      updatePlacement(faceId,result.u,result.v,localToWorldPoint(basis,result.u,result.v),true)
      return
    }
    snapApi.current.clear()

    clearHoverPosition()
  }

  // 1. 拖拽放置（HTML5 Drag & Drop）监听
  useEffect(() => {
    const dom = gl.domElement

    const handleDragOver = (e: DragEvent) => {
      e.preventDefault()
      e.dataTransfer!.dropEffect = 'copy'
      performRaycast(e.clientX, e.clientY, e.shiftKey)
    }

    const handleDragLeave = (e: DragEvent) => {
      // 若离开视口画布区域
      if (e.relatedTarget === null || !dom.contains(e.relatedTarget as Node)) {
        clearHoverPosition()
        snapApi.current.clear()
      }
    }

    const handleDrop = (e: DragEvent) => {
      e.preventDefault()
      performRaycast(e.clientX,e.clientY,e.shiftKey)
      const store = usePlacementStore.getState()
      if (store.isPlacing && store.template && store.currentFaceId) {
        instantiatePlacedTemplate(store)
      }
      cancelPlacement()
    }

    dom.addEventListener('dragover', handleDragOver)
    dom.addEventListener('dragleave', handleDragLeave)
    dom.addEventListener('drop', handleDrop)

    return () => {
      dom.removeEventListener('dragover', handleDragOver)
      dom.removeEventListener('dragleave', handleDragLeave)
      dom.removeEventListener('drop', handleDrop)
    }
  }, [gl.domElement, dimensions, camera, scene, projectId, libraryDoc])

  // 2. 点选瞄准布孔（Click & Place）监听
  useEffect(() => {
    if (!isPlacing || mode !== 'click') return

    const dom = gl.domElement
    const origCursor = dom.style.cursor
    dom.style.cursor = 'crosshair'

    const handlePointerMove = (e: PointerEvent) => {
      performRaycast(e.clientX, e.clientY, e.shiftKey)
    }

    const handleClick = (e: MouseEvent) => {
      if (e.button !== 0) return // 只响应左键
      // 此次点击由布孔消费，不能在退出布孔后又冒泡触发实体选择。
      e.stopImmediatePropagation()
      e.stopPropagation()
      performRaycast(e.clientX,e.clientY,e.shiftKey)
      const store = usePlacementStore.getState()
      if (store.template && store.currentFaceId) {
        instantiatePlacedTemplate(store)
        // 放置完成后退出瞄准模式（按住 Ctrl / Cmd 键允许连续批量点选布孔）
        if (!e.ctrlKey && !e.metaKey) {
          cancelPlacement()
        }
      }
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if(e.key==='Tab'&&lastSnapPointer.current&&!((e.target as HTMLElement)?.closest?.('input,textarea,select,[contenteditable="true"]'))){const p=lastSnapPointer.current;e.preventDefault();snapApi.current.next();performRaycast(p.x,p.y,p.shift)}
      if (e.key === 'Escape') {
        cancelPlacement()
      }
    }

    const handleContextMenu = (e: MouseEvent) => {
      // 右键退出瞄准模式
      e.preventDefault()
      cancelPlacement()
    }

    window.addEventListener('pointermove', handlePointerMove)
    dom.addEventListener('click', handleClick)
    window.addEventListener('keydown', handleKeyDown)
    dom.addEventListener('contextmenu', handleContextMenu)

    return () => {
      dom.style.cursor = origCursor
      window.removeEventListener('pointermove', handlePointerMove)
      dom.removeEventListener('click', handleClick)
      window.removeEventListener('keydown', handleKeyDown)
      dom.removeEventListener('contextmenu', handleContextMenu)
    }
  }, [isPlacing, mode, gl.domElement, dimensions, camera, scene, projectId])

  return null
}
