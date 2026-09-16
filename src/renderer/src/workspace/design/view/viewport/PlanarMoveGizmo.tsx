import { useLocale as _useLocale } from '@renderer/i18n/useLocale'
import { GizmoVisualLayer } from './GizmoVisualLayer'
import { t as _t } from '@shared/i18n'
import { useGeometrySnap, useGeometryReferences } from '../../interaction/snapping/useGeometrySnap'
import { cavityAxis } from '@shared/design/cavityGeometry'
import { promoteFeatures } from '../../model/selectionMath'
import { useState, useRef, useMemo, useEffect, type FC } from 'react'
import * as THREE from 'three'
import { useThree, useFrame, type ThreeEvent } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import {
  useDesignStore,
  getSelectedCavityIds,
  getSelectedFeatures
} from '../../model/designStore'
import {
  getBoxFaceBasis,
  detectBoxFace,
  worldToLocalPoint,
  localToWorldPoint,
  type FaceBasis
} from '@shared/design/faceMath'
import type { CavityInstance, CavityGroup } from '@shared/design/types'
import { useLibraryStore } from '../../../library/viewmodel/libraryStore'
import { getCavitySteps, parseCavityBands } from '../../geometry/cavityProfileBuilder'
import { buildOutlineGeometry } from '../../geometry/outlineBuilder'
import { CadDimensionLines } from './CadDimensionLines'
import { snapValue, computeScreenPixelScale } from './gizmoMath'

interface PlanarMoveGizmoProps {
  projectId: string
  dimensions: [number, number, number]
}

type DragAxis = 'x' | 'y' | 'plane' | 'rotate' | null

const QUAD_BLOCK_SIZE = 16
const QUAD_BLOCK_OUTLINE_GEOM = (() => {
  const h = QUAD_BLOCK_SIZE / 2
  const pts = [
    new THREE.Vector3(-h, -h, 0.01),
    new THREE.Vector3(h, -h, 0.01),
    new THREE.Vector3(h, -h, 0.01),
    new THREE.Vector3(h, h, 0.01),
    new THREE.Vector3(h, h, 0.01),
    new THREE.Vector3(-h, h, 0.01),
    new THREE.Vector3(-h, h, 0.01),
    new THREE.Vector3(-h, -h, 0.01)
  ]
  return new THREE.BufferGeometry().setFromPoints(pts)
})()

// 2D 平面贴面箭头几何体（恒定像素比例下尺寸，总长 52px）
// 轴杆宽 2.4px，长 38px；箭头底宽 9.0px，长 14px
const ARROW_2D_GEOM = (() => {
  const shaftWidth = 2.4
  const shaftLength = 38
  const headWidth = 9.0
  const headLength = 14
  const totalLength = shaftLength + headLength
  const sw = shaftWidth / 2
  const hw = headWidth / 2

  const shape = new THREE.Shape()
  shape.moveTo(-sw, 0)
  shape.lineTo(-sw, shaftLength)
  shape.lineTo(-hw, shaftLength)
  shape.lineTo(0, totalLength)
  shape.lineTo(hw, shaftLength)
  shape.lineTo(sw, shaftLength)
  shape.lineTo(sw, 0)
  shape.closePath()

  return new THREE.ShapeGeometry(shape)
})()

// 2D 箭头外光晕 Halo 几何体（稍微外扩，提供 #00EBFF 荧光边缘）
const ARROW_2D_HALO_GEOM = (() => {
  const shaftWidth = 5.0
  const shaftLength = 38
  const headWidth = 13.5
  const headLength = 16
  const totalLength = shaftLength + headLength
  const sw = shaftWidth / 2
  const hw = headWidth / 2

  const shape = new THREE.Shape()
  shape.moveTo(-sw, -1)
  shape.lineTo(-sw, shaftLength)
  shape.lineTo(-hw, shaftLength)
  shape.lineTo(0, totalLength + 1)
  shape.lineTo(hw, shaftLength)
  shape.lineTo(sw, shaftLength)
  shape.lineTo(sw, -1)
  shape.closePath()

  return new THREE.ShapeGeometry(shape)
})()

// 2D 箭头透明命中拾取区（加宽至 16px，方便鼠标点击）
const ARROW_2D_HIT_GEOM = (() => {
  const shape = new THREE.Shape()
  const hw = 8.0
  shape.moveTo(-hw, 0)
  shape.lineTo(-hw, 54)
  shape.lineTo(hw, 54)
  shape.lineTo(hw, 0)
  shape.closePath()
  return new THREE.ShapeGeometry(shape)
})()


// X+ 基准线与角度射线几何体（长 92px，显著超越 52px 的 X 轴与 76px 的旋转环）
const ANGLE_BASE_LINE_GEOM = (() => {
  const pts = [new THREE.Vector3(0, 0, 0.05), new THREE.Vector3(92, 0, 0.05)]
  return new THREE.BufferGeometry().setFromPoints(pts)
})()

// 360° 纤细极坐标参考导轨圆（外置半径 76px，彻底远离 52px 的 X 轴与 Y 轴箭头）
const ROT_DIAL_RING_GEOM = (() => {
  return new THREE.RingGeometry(75.5, 76.5, 64)
})()

// 0°, 90°, 180°, 270° 正交刻度缺口（半径 73px ~ 79px，长 6px）
const ROT_DIAL_TICKS_GEOM = (() => {
  const pts = [
    // 0° (右)
    new THREE.Vector3(73, 0, 0.01),
    new THREE.Vector3(79, 0, 0.01),
    // 90° (上)
    new THREE.Vector3(0, 73, 0.01),
    new THREE.Vector3(0, 79, 0.01),
    // 180° (左)
    new THREE.Vector3(-73, 0, 0.01),
    new THREE.Vector3(-79, 0, 0.01),
    // 270° (下)
    new THREE.Vector3(0, -73, 0.01),
    new THREE.Vector3(0, -79, 0.01)
  ]
  return new THREE.BufferGeometry().setFromPoints(pts)
})()

// 圆形操作手柄宽容拾取层（半径 15px 透明圆）
const ROT_KNOB_HIT_GEOM = (() => {
  return new THREE.CircleGeometry(15, 24)
})()

// 圆形操作手柄实心内核（半径 5.5px）
const ROT_KNOB_CORE_GEOM = (() => {
  return new THREE.CircleGeometry(5.5, 32)
})()

// 圆形操作手柄白金外圈边框（半径 4.8px 到 6.5px）
const ROT_KNOB_RING_GEOM = (() => {
  return new THREE.RingGeometry(4.8, 6.5, 32)
})()

// 圆形操作手柄激活外光晕 Halo
const ROT_KNOB_HALO_GEOM = (() => {
  return new THREE.RingGeometry(6.0, 11.0, 32)
})()

// 旋转中心支点符号 (SolidWorks Pivot Center Crosshair)
const PIVOT_CROSS_GEOM = (() => {
  const pts = [
    new THREE.Vector3(-3.0, 0, 0.02),
    new THREE.Vector3(3.0, 0, 0.02),
    new THREE.Vector3(0, -3.0, 0.02),
    new THREE.Vector3(0, 3.0, 0.02)
  ]
  return new THREE.BufferGeometry().setFromPoints(pts)
})()

/**
 * G-05 · 2D 贴面平移 Gizmo (Planar Move Gizmo) & G-08 · 多孔旋转手柄
 * 严格对齐 PRD-FR-04-10 规范：
 * 1. 坐标严格面向用户采用 X 轴（红）与 Y 轴（绿），废除 U/V；
 * 2. 恒定屏幕像素缩放（直径约 80px），不随视角缩放变形；
 * 3. 2D 扁平贴面渲染（meshBasicMaterial，无 3D 光照阴影）；
 * 4. 消除点击瞬移（基于点击交点相对增量计算）；
 * 5. 表面锁定与边缘吸附防滑脱（防止意外跳面）；
 * 6. 自由平面拖拽手柄采用 +X/+Y 正交象限内的经典 CAD 直角方块；
 * 7. 默认 1.0mm 整数吸附（按住 Shift 解除），键盘方向键 1.0mm（Alt: 0.1mm）步进微调；
 * 8. 多孔旋转默认 90° 强吸附（按住 Shift 解除），支持直观幽灵孔位预览与快捷 90° 旋转按钮；
 * 9. 严格针对多孔特征本身的定位原点 (grp.u, grp.v) 进行旋转，杜绝面原点错误。
 */
export const PlanarMoveGizmo: FC<PlanarMoveGizmoProps> = ({ projectId, dimensions }) => {
  _useLocale()
  const { camera, gl, scene } = useThree()
  const controls = useThree((s) => s.controls) as any

  const session = useDesignStore((s) => s.projects[projectId])
  const libraryDoc = useLibraryStore((s) => s.doc)
  const updateCavityPosition = useDesignStore((s) => s.updateCavityPosition)
  const updateCavityPositions = useDesignStore((s) => s.updateCavityPositions)
  const moveRigidCavities = useDesignStore((s) => s.moveRigidCavities)
  const moveGroup = useDesignStore((s) => s.moveGroup)
  const rotateGroup = useDesignStore((s) => s.rotateGroup)
  const rebindGroupFace = useDesignStore((s) => s.rebindGroupFace)

  const [anchorChoice,setAnchorChoice]=useState('auto')
  const [referenceChoice,setReferenceChoice]=useState('')
  const {references}=useGeometryReferences(projectId)
  const snapping = useGeometrySnap(projectId, dimensions)
  const snapApi = useRef(snapping)
  snapApi.current = snapping
  const lastSnapPointer=useRef<PointerEvent|null>(null)
  const gizmoGroupRef = useRef<THREE.Group>(null)

  const [dragAxis, setDragAxis] = useState<DragAxis>(null)
  const [hoverAxis, setHoverAxis] = useState<DragAxis>(null)

  // 临时拖拽状态
  const [previewOffset, setPreviewOffsetState] = useState<{
    deltaX: number
    deltaY: number
    targetFaceId?: string
    newX?: number
    newY?: number
  } | null>(null)

  const previewOffsetRef = useRef<typeof previewOffset>(null)
  const setPreviewOffset = (value: typeof previewOffset) => {
    previewOffsetRef.current=value
    setPreviewOffsetState(value)
    if (!value) snapApi.current.clear()
  }
  // 旋转角度预览（度）
  const [rotatePreviewDeg, setRotatePreviewDegState] = useState<number>(0)
  const rotatePreviewRef=useRef(0)
  const setRotatePreviewDeg=(value:number)=>{rotatePreviewRef.current=value;setRotatePreviewDegState(value)}
  // 悬停在快捷旋转按钮上的预演角度（如 +90° / -90°）
  const [hoverRotateDeg, setHoverRotateDeg] = useState<number | null>(null)
  const justDraggedUntilRef = useRef<number>(0)

  const dragStartRef = useRef<{
    axis: DragAxis
    startX: number
    startY: number
    clickU: number
    clickV: number
    startAngleDeg?: number
    startPointerAngleRad?: number
    startFaceId: string
    startPlane: THREE.Plane
    initialPositions: Map<string, { x: number; y: number; faceId: string; rotation?: number }>
  } | null>(null)

  const activeScheme = session?.doc.schemes.find((s) => s.id === session.doc.activeSchemeId) || session?.doc.schemes[0]
  const selected = session?.selected

  // 解析选中的特征集合
  const selectedFeatures = useMemo(() => {
    return getSelectedFeatures(selected)
  }, [selected])

  // 判断是否直接选中了组合孔组（双击组合孔或从特征树显式选中组）
  const isDirectGroupSelected = useMemo(() => {
    if (anchorChoice !== 'auto') return false
    if (selected?.type === 'group') return true
    if (selectedFeatures.length === 1 && selectedFeatures[0].type === 'group') return true
    return false
  }, [selected, selectedFeatures, anchorChoice])

  // 判断是否为组合孔多孔特征目标与基准中心：
  // 1. 若直接选中组合孔组：严格以组合孔自身的定位原点 (grp.u, grp.v) 为基准中心，移动整个组合孔；
  // 2. 若视口单击选中组合孔内的子孔：以该子孔自身的坐标 (cav.u, cav.v) 为基准中心，移动整个组合孔！
  // 3. 若为独立单孔或多选孔：以孔自身或平均中心为基准。
  const { isTargetGroup, targetGroup, targetCavities, targetFaceId, centerX: defaultCenterX, centerY: defaultCenterY } = useMemo(() => {
    if (!activeScheme) {
      return {
        isTargetGroup: false,
        targetGroup: null as CavityGroup | null,
        targetCavities: [] as CavityInstance[],
        datumCavity: null as CavityInstance | null,
        targetFaceId: 'top',
        centerX: 0,
        centerY: 0
      }
    }

    // 1. 如果直接选中类型是 group（双击组合孔）
    if (selected?.type === 'group') {
      const grp = activeScheme.groups?.find((g) => g.id === selected.id) || null
      if (grp) {
        const members = activeScheme.cavities.filter((c) => c.groupId === grp.id || grp.cavityIds.includes(c.instanceId))
        const fId = grp.faceId || members[0]?.faceId || 'top'
        // 关键：组合孔原点作为基准
        const cu = grp.u != null ? grp.u : (members.length > 0 ? members.reduce((acc, c) => acc + c.u, 0) / members.length : 0)
        const cv = grp.v != null ? grp.v : (members.length > 0 ? members.reduce((acc, c) => acc + c.v, 0) / members.length : 0)
        return {
          isTargetGroup: true,
          targetGroup: grp,
          targetCavities: members,
          datumCavity: null as CavityInstance | null,
          targetFaceId: fId,
          centerX: cu,
          centerY: cv
        }
      }
    }

    // 2. 如果选中的是单一特征且对应组（兼容 features 结构）
    if (selectedFeatures.length === 1 && selectedFeatures[0].type === 'group') {
      const grp = activeScheme.groups?.find((g) => g.id === selectedFeatures[0].id) || null
      if (grp) {
        const members = activeScheme.cavities.filter((c) => c.groupId === grp.id || grp.cavityIds.includes(c.instanceId))
        const fId = grp.faceId || members[0]?.faceId || 'top'
        const cu = grp.u != null ? grp.u : (members.length > 0 ? members.reduce((acc, c) => acc + c.u, 0) / members.length : 0)
        const cv = grp.v != null ? grp.v : (members.length > 0 ? members.reduce((acc, c) => acc + c.v, 0) / members.length : 0)
        return {
          isTargetGroup: true,
          targetGroup: grp,
          targetCavities: members,
          datumCavity: null as CavityInstance | null,
          targetFaceId: fId,
          centerX: cu,
          centerY: cv
        }
      }
    }

    // 3. 选中的是单个 cavity（单击子孔）
    const singleCavityId =
      selected?.type === 'cavity' && (!selected.extraIds || selected.extraIds.length === 0)
        ? selected.id
        : selectedFeatures.length === 1 && selectedFeatures[0].type === 'cavity'
        ? selectedFeatures[0].id
        : null

    if (singleCavityId) {
      const cav = activeScheme.cavities.find((c) => c.instanceId === singleCavityId)
      if (cav) {
        const grp = activeScheme.groups?.find(
          (g) => g.id === cav.groupId || g.cavityIds.includes(cav.instanceId)
        ) || null

        if (grp) {
          // 该子孔归属于组合孔！
          // 核心设计：移动 gizmo 使用该子孔作为基准 (centerX = cav.u, centerY = cav.v)，但移动整个组合孔！
          const members = activeScheme.cavities.filter(
            (c) => c.groupId === grp.id || grp.cavityIds.includes(c.instanceId)
          )
          const fId = cav.faceId || grp.faceId || 'top'
          return {
            isTargetGroup: true, // 作为 Group 处理整体平移
            targetGroup: grp,
            targetCavities: members,
            datumCavity: cav, // 记录子孔基准
            targetFaceId: fId,
            centerX: cav.u, // 关键：基准锚定在被选中的子孔上！
            centerY: cav.v
          }
        } else {
          // 独立单孔
          return {
            isTargetGroup: false,
            targetGroup: null,
            targetCavities: [cav],
            datumCavity: cav,
            targetFaceId: cav.faceId || 'top',
            centerX: cav.u,
            centerY: cav.v
          }
        }
      }
    }

    // 4. 多选多个孔腔
    const cavIds = getSelectedCavityIds({ type: 'features', items: promoteFeatures(selectedFeatures, activeScheme) }, activeScheme)
    const cavs = activeScheme.cavities.filter((c) => cavIds.includes(c.instanceId))
    const first = cavs[0]
    const fId = first?.faceId || 'top'
    const cu = cavs.length > 0 ? cavs.reduce((acc, c) => acc + c.u, 0) / cavs.length : 0
    const cv = cavs.length > 0 ? cavs.reduce((acc, c) => acc + c.v, 0) / cavs.length : 0

    return {
      isTargetGroup: false,
      targetGroup: null as CavityGroup | null,
      targetCavities: cavs,
      datumCavity: null,
      targetFaceId: fId,
      centerX: cu,
      centerY: cv
    }
  }, [activeScheme, selected, selectedFeatures])

  const anchorCavity=targetCavities.find(c=>`cavity:${c.instanceId}`===anchorChoice)
  const anchorGroup=activeScheme?.groups?.find(g=>`group:${g.id}`===anchorChoice && targetCavities.some(c=>g.cavityIds.includes(c.instanceId)||c.groupId===g.id))
  const centerX=anchorCavity?.u??anchorGroup?.u??defaultCenterX
  const centerY=anchorCavity?.v??anchorGroup?.v??defaultCenterY
  const referenceOptions=references.filter(r=>r.kind==='point'&&r.faceId===targetFaceId&&!targetCavities.some(c=>c.instanceId===r.ownerId))
  const chosenReference=referenceOptions.find(r=>r.id===referenceChoice)
  const referenceLocal=chosenReference?worldToLocalPoint(getBoxFaceBasis(targetFaceId,dimensions),chosenReference.point):null

  useEffect(()=>{
    setDragAxis(null);setPreviewOffset(null);setRotatePreviewDeg(0)
    dragStartRef.current=null
    if (controls) controls.enabled=true
  },[activeScheme?.cavities,dimensions[0],dimensions[1],dimensions[2]])

  // 判断选中的孔是否都在同一宿主面上
  const allSameFace = useMemo(() => {
    if (targetCavities.length <= 1) return true
    const f0 = targetCavities[0].faceId
    return targetCavities.every((c) => c.faceId === f0)
  }, [targetCavities])

  // 关键自愈与重置 1：当选中的目标孔腔集合或组合发生任何改变时，强制清理并重置所有残留拖拽状态
  const targetKeys = useMemo(() => {
    return targetCavities.map((c) => c.instanceId).sort().join(',') + `:${targetGroup?.id ?? ''}:${anchorChoice}`
  }, [targetCavities, targetGroup?.id, anchorChoice])

  useEffect(() => {
    setDragAxis(null)
    setPreviewOffset(null)
    setRotatePreviewDeg(0)
    setHoverRotateDeg(null)
    setHoverAxis(null)
    dragStartRef.current = null
    if (controls) {
      controls.enabled = true
    }
  }, [targetKeys, controls])

  // 关键自愈与重置 2：组件卸载或隐藏时，必须确保恢复相机控制器 OrbitControls，彻底杜绝视口假死
  useEffect(() => {
    return () => {
      if (controls) {
        controls.enabled = true
      }
    }
  }, [controls])

  // 关键自愈与重置 3：全局拦截 ESC 按键与窗口失焦（Blur）事件，拖拽中按下 ESC 立即安全回滚并解除锁定
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (dragAxis || dragStartRef.current || previewOffset || rotatePreviewDeg !== 0) {
          e.preventDefault()
          e.stopPropagation()
          setDragAxis(null)
          setPreviewOffset(null)
          setRotatePreviewDeg(0)
          setHoverRotateDeg(null)
          setHoverAxis(null)
          dragStartRef.current = null
          if (controls) {
            controls.enabled = true
          }
        }
      }
    }

    const handleWindowBlur = () => {
      if (dragAxis || dragStartRef.current) {
        setDragAxis(null)
        setPreviewOffset(null)
        setRotatePreviewDeg(0)
        setHoverRotateDeg(null)
        setHoverAxis(null)
        dragStartRef.current = null
        if (controls) {
          controls.enabled = true
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown, true)
    window.addEventListener('blur', handleWindowBlur)
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true)
      window.removeEventListener('blur', handleWindowBlur)
    }
  }, [dragAxis, previewOffset, rotatePreviewDeg, controls])

  // 当前有效宿主面与基准坐标系
  const currentFaceId = previewOffset?.targetFaceId || targetFaceId
  const basis = useMemo<FaceBasis>(() => {
    return getBoxFaceBasis(currentFaceId, dimensions)
  }, [currentFaceId, dimensions])

  // 当前 Gizmo 局部坐标系旋转四元数（X->u, Y->v, Z->w）
  const orientationQuat = useMemo(() => {
    const m = new THREE.Matrix4()
    const { u: U, v: V, w: W } = basis
    m.set(
      U[0], V[0], W[0], 0,
      U[1], V[1], W[1], 0,
      U[2], V[2], W[2], 0,
      0, 0, 0, 1
    )
    return new THREE.Quaternion().setFromRotationMatrix(m)
  }, [basis])

  // 当前有效 X, Y 坐标值
  const effectiveX = useMemo(() => {
    return previewOffset?.newX ?? (centerX + (previewOffset?.deltaX || 0))
  }, [centerX, previewOffset])

  const effectiveY = useMemo(() => {
    return previewOffset?.newY ?? (centerY + (previewOffset?.deltaY || 0))
  }, [centerY, previewOffset])

  // 当前 Gizmo 几何中心世界坐标位置
  const gizmoWorldPos = useMemo<[number, number, number]>(() => {
    const { origin, u: U, v: V, w: W } = basis
    const offsetW = 0.25 // 微偏置 0.25mm 贴面（需足够间距防止孔腔内壁遮挡）
    return [
      origin[0] + effectiveX * U[0] + effectiveY * V[0] + offsetW * W[0],
      origin[1] + effectiveX * U[1] + effectiveY * V[1] + offsetW * W[1],
      origin[2] + effectiveX * U[2] + effectiveY * V[2] + offsetW * W[2]
    ]
  }, [basis, effectiveX, effectiveY])

  // 当前有效旋转增量预演（来自拖拽或鼠标悬停在快捷旋转按钮上）
  const effectiveRotateDeg = dragAxis === 'rotate' ? rotatePreviewDeg : (hoverRotateDeg ?? 0)

  // 当前特征的基准绝对角度与实时生效角度 (度)
  const groupBaseRotation = targetGroup?.rotation || 0
  const currentRealAngle = groupBaseRotation + effectiveRotateDeg
  const normalizedAngle = ((Math.round(currentRealAngle) % 360) + 360) % 360
  const angleRad = (normalizedAngle * Math.PI) / 180

  // 关键：实时计算多孔特征绕自身定位原点 (centerX, centerY) 同心旋转后的幽灵孔腔位姿与运动轨迹（真实物理毫米尺寸）
  const ghostCavities = useMemo(() => {
    if (effectiveRotateDeg === 0 || !isTargetGroup || targetCavities.length === 0) return []
    const rad = (effectiveRotateDeg * Math.PI) / 180
    const cosA = Math.cos(rad)
    const sinA = Math.sin(rad)

    return targetCavities.map((c) => {
      const du = c.u - centerX
      const dv = c.v - centerY
      const radius = Math.hypot(du, dv)
      const startAngle = Math.atan2(dv, du)
      // 刚体旋转：与 2D 坐标系及 rotateGroup 保持绝对同向 (+X 向 +Y 正向旋转)
      const newDu = du * cosA - dv * sinA
      const newDv = du * sinA + dv * cosA

      // 解析每个孔口的真实孔径半径 (mm)
      const steps = c.steps && c.steps.length > 0 ? c.steps : getCavitySteps(c, libraryDoc)
      const bands = parseCavityBands(steps)
      const mouthRadius = Math.max(bands[0]?.r0 ?? 5, 1.5)

      return {
        id: c.instanceId,
        relU: newDu,
        relV: newDv,
        radius,
        startAngle,
        mouthRadius,
        name: c.subHoleName || c.portSemantic || c.name
      }
    })
  }, [effectiveRotateDeg, isTargetGroup, targetCavities, centerX, centerY, libraryDoc])

  // 解析组合特征的安装轮廓几何体（在自身原点局部坐标系下，单位 mm）
  const groupOutlineLineGeom = useMemo(() => {
    if (!isTargetGroup || !targetGroup || targetCavities.length === 0) return null
    if (targetGroup.outline) {
      const built = buildOutlineGeometry(targetGroup.outline)
      if (built?.lineGeometry) return built.lineGeometry
    }

    // 默认回退：基于所有成员孔的外接矩形框（含 6mm 安装余量）
    let minRelU = Infinity
    let maxRelU = -Infinity
    let minRelV = Infinity
    let maxRelV = -Infinity

    for (const c of targetCavities) {
      const relU = c.u - centerX
      const relV = c.v - centerY
      const steps = c.steps && c.steps.length > 0 ? c.steps : getCavitySteps(c, libraryDoc)
      const bands = parseCavityBands(steps)
      const r = Math.max(bands[0]?.r0 ?? 5, 2)
      minRelU = Math.min(minRelU, relU - r)
      maxRelU = Math.max(maxRelU, relU + r)
      minRelV = Math.min(minRelV, relV - r)
      maxRelV = Math.max(maxRelV, relV + r)
    }

    const pad = 6.0
    minRelU -= pad
    maxRelU += pad
    minRelV -= pad
    maxRelV += pad

    const pts = [
      new THREE.Vector3(minRelU, minRelV, 0.05),
      new THREE.Vector3(maxRelU, minRelV, 0.05),
      new THREE.Vector3(maxRelU, minRelV, 0.05),
      new THREE.Vector3(maxRelU, maxRelV, 0.05),
      new THREE.Vector3(maxRelU, maxRelV, 0.05),
      new THREE.Vector3(minRelU, maxRelV, 0.05),
      new THREE.Vector3(minRelU, maxRelV, 0.05),
      new THREE.Vector3(minRelU, minRelV, 0.05)
    ]
    return new THREE.BufferGeometry().setFromPoints(pts)
  }, [isTargetGroup, targetGroup, targetCavities, centerX, centerY, libraryDoc])

  // 恒定屏幕像素缩放控制（保持约 60px 精致 SolidWorks CAD 视觉比例）
  useFrame(() => {
    if (!gizmoGroupRef.current) return
    const s = computeScreenPixelScale(camera, gizmoWorldPos, 1.0, 1.0)
    gizmoGroupRef.current.scale.set(s, s, s)
  })

  // 监听全局方向键微调（选中的孔腔通过 Arrow 键以 1.0mm 步进微调，按 Alt 为 0.1mm 精密微调）
  useEffect(() => {
    if (dragAxis || targetCavities.length === 0 || !allSameFace) return

    const onKeyDown = (e: KeyboardEvent) => {
      const activeEl = document.activeElement
      if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.tagName === 'SELECT' || (activeEl as HTMLElement).isContentEditable)) {
        return
      }
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        e.preventDefault()
        const step = e.altKey ? 0.1 : 1.0
        let dX = 0
        let dY = 0
        if (e.key === 'ArrowRight') dX = step
        if (e.key === 'ArrowLeft') dX = -step
        if (e.key === 'ArrowUp') dY = step
        if (e.key === 'ArrowDown') dY = -step

        if (isTargetGroup && targetGroup) {
          moveGroup(projectId, targetGroup.id, dX, dY)
        } else if (targetCavities.length === 1) {
          const cav = targetCavities[0]
          updateCavityPosition(
            projectId,
            cav.instanceId,
            snapValue(cav.u + dX, step, false),
            snapValue(cav.v + dY, step, false)
          )
        } else {
          moveRigidCavities(projectId, targetCavities.map(c => c.instanceId), dX, dY)
        }
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [dragAxis, targetCavities, projectId, updateCavityPosition, moveRigidCavities, isTargetGroup, targetGroup, moveGroup, allSameFace])

  // 监听全局指针移动与释放
  useEffect(() => {
    if (!dragAxis || !dragStartRef.current || targetCavities.length === 0) return

    const raycaster = new THREE.Raycaster()

    const onPointerMove = (e: PointerEvent) => {
      lastSnapPointer.current=e
      const startState = dragStartRef.current
      if (!startState || !dragAxis) return

      // 自愈保护：如果当前目标孔腔与拖拽起始记录的孔腔集合不一致，说明发生了非预期选择变更，立即重置并退出
      if (startState.axis !== 'rotate') {
        const hasValidTarget = targetCavities.some((c) => startState.initialPositions.has(c.instanceId))
        if (!hasValidTarget) {
          setDragAxis(null)
          setPreviewOffset(null)
          dragStartRef.current = null
          if (controls) controls.enabled = true
          return
        }
      }

      const rect = gl.domElement.getBoundingClientRect()
      const mouse = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1
      )
      raycaster.setFromCamera(mouse, camera)

      const isFine = e.shiftKey
      // 默认 1.0mm 整数吸附，按住 Shift 允许无级连续微调

      // ── 1. 旋转手柄拖拽逻辑（支持顺时针/逆时针双向丝滑拖拽，90° 顺畅磁吸锁定，Shift 解除） ──
      if (startState.axis === 'rotate') {
        const curBasis = getBoxFaceBasis(startState.startFaceId, dimensions)
        const intersectPoint = new THREE.Vector3()
        if (raycaster.ray.intersectPlane(startState.startPlane, intersectPoint)) {
          const local = worldToLocalPoint(curBasis, [intersectPoint.x, intersectPoint.y, intersectPoint.z])
          const curPointerAngleRad = Math.atan2(local.v - startState.startY, local.u - startState.startX)
          const basePointerRad = startState.startPointerAngleRad ?? 0

          // 计算指针角度差，处理 [-PI, PI] 跨界跳跃，确保顺时针与逆时针绝对平滑连续
          let deltaRad = curPointerAngleRad - basePointerRad
          while (deltaRad > Math.PI) deltaRad -= 2 * Math.PI
          while (deltaRad < -Math.PI) deltaRad += 2 * Math.PI

          const deltaDeg = (deltaRad * 180) / Math.PI
          const baseAngleDeg = startState.startAngleDeg ?? 0
          const rawTargetAngle = baseAngleDeg + deltaDeg
          // 归一化到 [0, 360) 范围
          const normAngle = ((rawTargetAngle % 360) + 360) % 360

          let targetAngleDeg = normAngle
          if (isFine) {
            // Shift 细微微调模式：0.1° 连续微调，无吸附
            targetAngleDeg = Math.round(normAngle * 10) / 10
          } else {
            // 90° 正交磁吸锁定模式：在 0°, 90°, 180°, 270° 附近 ±9° 范围内顺畅强吸附锁定
            const nearest90 = Math.round(normAngle / 90) * 90 // 0, 90, 180, 270, 360
            const distTo90 = Math.abs(normAngle - nearest90)
            if (distTo90 <= 9.0) {
              targetAngleDeg = nearest90 === 360 ? 0 : nearest90
            } else {
              targetAngleDeg = Math.round(normAngle)
            }
          }

          // 设置相对于初始 group 角度的预览增量
          let previewDelta = targetAngleDeg - baseAngleDeg
          while (previewDelta > 180) previewDelta -= 360
          while (previewDelta < -180) previewDelta += 360

          setRotatePreviewDeg(previewDelta)
        }
        return
      }

      // ── 2. 平移计算（基于初始点击点相对增量，彻底消除 Jump-on-Click 瞬移） ──
      const curBasis = getBoxFaceBasis(startState.startFaceId, dimensions)
      const intersectPoint = new THREE.Vector3()
      if (raycaster.ray.intersectPlane(startState.startPlane, intersectPoint)) {
        const local = worldToLocalPoint(curBasis, [intersectPoint.x, intersectPoint.y, intersectPoint.z])
        const deltaU = local.u - startState.clickU
        const deltaV = local.v - startState.clickV

        let candU = startState.startX
        let candV = startState.startY

        if (startState.axis === 'x') {
          candU = startState.startX + deltaU
        } else if (startState.axis === 'y') {
          candV = startState.startY + deltaV
        } else if (startState.axis === 'plane') {
          candU = startState.startX + deltaU
          candV = startState.startY + deltaV
        }

        // ── 3. 象限自由拖拽模式下的跨面防误触检测与表面滞后锁定 ──
        if (startState.axis === 'plane' && (isTargetGroup || targetCavities.length===1)) {
          // 检查目标点是否已经明确移出当前表面边界（8mm 保护阈值，未移出则 100% 锁定在当前表面）
          const worldTarget = localToWorldPoint(curBasis, candU, candV)
          const [sx, sy, sz] = dimensions
          const margin = 8.0
          const isOutsideFace =
            worldTarget[0] < -margin || worldTarget[0] > sx + margin ||
            worldTarget[1] < -margin || worldTarget[1] > sy + margin ||
            worldTarget[2] < -margin || worldTarget[2] > sz + margin

          if (isOutsideFace) {
            const intersects = raycaster.intersectObjects(scene.children, true)
            const hit = intersects.find((i) => {
              const obj = i.object as THREE.Mesh
              return obj.type === 'Mesh' && (obj.geometry as any)?.type !== 'RingGeometry' && i.face
            })

            if (hit && hit.face?.normal) {
              const detectedFace = detectBoxFace(hit.face.normal, hit.point, dimensions)
              if (detectedFace && detectedFace !== startState.startFaceId) {
                const newBasis = getBoxFaceBasis(detectedFace, dimensions)
                const newLocal = worldToLocalPoint(newBasis, [hit.point.x, hit.point.y, hit.point.z])
                const result=snapApi.current.planar(detectedFace,newLocal.u,newLocal.v,'uv',targetCavities.map(c=>c.instanceId),e.shiftKey)
                const snappedX=result.u, snappedY=result.v

                setPreviewOffset({
                  deltaX: snappedX - startState.startX,
                  deltaY: snappedY - startState.startY,
                  targetFaceId: detectedFace,
                  newX: snappedX,
                  newY: snappedY
                })
                return
              }
            }
          }
        }

        // ── 4. 同表面内的吸附与位移计算 ──
        const source=anchorCavity??targetCavities.find(c=>c.instanceId===(selected?.type==='cavity'?selected.id:null))??targetCavities[0]
        const direction=source?cavityAxis(source,dimensions).direction:undefined
        const result=snapApi.current.planar(startState.startFaceId,candU,candV,startState.axis==='x'?'u':startState.axis==='y'?'v':'uv',targetCavities.map(c=>c.instanceId),e.shiftKey,direction)
        const snappedX=result.u, snappedY=result.v

        setPreviewOffset({
          deltaX: snappedX - startState.startX,
          deltaY: snappedY - startState.startY,
          targetFaceId: startState.startFaceId,
          newX: snappedX,
          newY: snappedY
        })
      }
    }

    const onPointerUp = (e: PointerEvent) => {
      onPointerMove(e)
      const startState = dragStartRef.current
      if (startState) {
        // 1. 处理旋转提交
        if (startState.axis === 'rotate') {
          if (targetGroup && Math.abs(rotatePreviewRef.current) > 0.1) {
            rotateGroup(projectId, targetGroup.id, rotatePreviewRef.current)
          }
          justDraggedUntilRef.current = Date.now() + 250
        } else if (previewOffsetRef.current) {
          const { deltaX, deltaY, targetFaceId: newFace, newX, newY } = previewOffsetRef.current

          // 2. 跨面移动（多孔成组或单孔）
          if (newFace && newFace !== startState.startFaceId) {
            if (isTargetGroup && targetGroup) {
              rebindGroupFace(projectId, targetGroup.id, newFace, 'project', { u: (newX ?? centerX) - (centerX - (targetGroup.u ?? centerX)), v: (newY ?? centerY) - (centerY - (targetGroup.v ?? centerY)) })
            } else if (targetCavities.length === 1) {
              updateCavityPosition(
                projectId,
                targetCavities[0].instanceId,
                newX ?? targetCavities[0].u,
                newY ?? targetCavities[0].v,
                newFace
              )
            }
          } else if (Math.abs(deltaX) > 0.001 || Math.abs(deltaY) > 0.001) {
            // 3. 同面移动
            if (isTargetGroup && targetGroup) {
              moveGroup(projectId, targetGroup.id, deltaX, deltaY)
            } else if (targetCavities.length === 1) {
              updateCavityPosition(
                projectId,
                targetCavities[0].instanceId,
                newX ?? targetCavities[0].u + deltaX,
                newY ?? targetCavities[0].v + deltaY
              )
            } else {
              moveRigidCavities(projectId, targetCavities.map(c => c.instanceId), deltaX, deltaY)
            }
          }
        }
      }

      // 恢复状态
      setDragAxis(null)
      setPreviewOffset(null)
      setRotatePreviewDeg(0)
      setHoverRotateDeg(null)
      dragStartRef.current = null
      if (controls) {
        controls.enabled = true
      }
    }

    const onCancel = () => {
      setDragAxis(null)
      setPreviewOffset(null)
      setRotatePreviewDeg(0)
      setHoverRotateDeg(null)
      dragStartRef.current = null
      if (controls) controls.enabled = true
    }
    const onCycle=(e:KeyboardEvent)=>{
      if(e.key==='Tab'&&dragAxis!=='rotate'&&lastSnapPointer.current&&!((e.target as HTMLElement)?.closest?.('input,textarea,select,[contenteditable="true"]'))){
        e.preventDefault();snapApi.current.next();onPointerMove(lastSnapPointer.current)
      }
    }
    window.addEventListener('keydown',onCycle)
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
    window.addEventListener('pointercancel', onCancel)
    window.addEventListener('contextmenu', onCancel)

    return () => {
      window.removeEventListener('keydown',onCycle)
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
      window.removeEventListener('pointercancel', onCancel)
      window.removeEventListener('contextmenu', onCancel)
    }
  }, [
    dragAxis,
    targetCavities,
    previewOffset,
    rotatePreviewDeg,
    camera,
    gl,
    scene,
    dimensions,
    controls,
    isTargetGroup,
    projectId,
    rebindGroupFace,
    rotateGroup,
    moveGroup,
    moveRigidCavities,
    targetGroup,
    updateCavityPosition,
    updateCavityPositions
  ])

  // 按下任意手柄时锁定控制器并记录起点状态
  const handlePointerDown = (axis: DragAxis, e: ThreeEvent<PointerEvent>) => {
    if (e.button !== 0) return
    e.stopPropagation()
    if (!allSameFace || targetCavities.length === 0) return

    if (controls) {
      controls.enabled = false
    }

    const { origin, u: U, v: V, w: W } = basis
    const planeNormal = new THREE.Vector3(...W)
    const planePoint = new THREE.Vector3(
      origin[0] + centerX * U[0] + centerY * V[0],
      origin[1] + centerX * U[1] + centerY * V[1],
      origin[2] + centerX * U[2] + centerY * V[2]
    )
    const dragPlane = new THREE.Plane().setFromNormalAndCoplanarPoint(planeNormal, planePoint)

    const initMap = new Map<string, { x: number; y: number; faceId: string; rotation?: number }>()
    targetCavities.forEach((c) => {
      initMap.set(c.instanceId, { x: c.u, y: c.v, faceId: c.faceId, rotation: c.rotation })
    })

    // 计算鼠标光标在当前拖拽基准面上的初始交点 (clickU, clickV)
    const raycaster = new THREE.Raycaster()
    const rect = gl.domElement.getBoundingClientRect()
    const mouse = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1
    )
    raycaster.setFromCamera(mouse, camera)
    const hitPt = new THREE.Vector3()

    let clickU = centerX
    let clickV = centerY
    let startAngleDeg: number | undefined
    let startPointerAngleRad: number | undefined

    if (raycaster.ray.intersectPlane(dragPlane, hitPt)) {
      const local = worldToLocalPoint(basis, [hitPt.x, hitPt.y, hitPt.z])
      clickU = local.u
      clickV = local.v
      if (axis === 'rotate') {
        startAngleDeg = targetGroup?.rotation || 0
        startPointerAngleRad = Math.atan2(local.v - centerY, local.u - centerX)
      }
    }

    dragStartRef.current = {
      axis,
      startX: centerX,
      startY: centerY,
      clickU,
      clickV,
      startAngleDeg,
      startPointerAngleRad,
      startFaceId: targetFaceId,
      startPlane: dragPlane,
      initialPositions: initMap
    }

    setDragAxis(axis)
  }

  // 仅在有选中的孔腔特征且都在同一面时显示 Gizmo
  if (targetCavities.length === 0 || !allSameFace) return null

  const quadBlockSize = QUAD_BLOCK_SIZE // 象限方块大小 16px

  const isXActive = dragAxis === 'x' || hoverAxis === 'x'
  const isYActive = dragAxis === 'y' || hoverAxis === 'y'
  const isPlaneActive = dragAxis === 'plane' || hoverAxis === 'plane'
  const isRotateActive = dragAxis === 'rotate' || hoverAxis === 'rotate'

  return (
    <>
      {!dragAxis&&<Html position={gizmoWorldPos} style={{pointerEvents:'auto'}}>
        <div className="ml-10 mt-10 flex flex-col gap-1 rounded border bg-background/95 p-2 text-[10px] shadow-sm" onPointerDown={e=>e.stopPropagation()}>
          {targetCavities.length>1&&<label className="flex gap-2 items-center whitespace-nowrap">{_t("移动基准")}<select aria-label={_t("移动基准")} className="max-w-40 bg-background" value={anchorCavity||anchorGroup?anchorChoice:'auto'} onChange={e=>setAnchorChoice(e.target.value)}>
            <option value="auto">{_t("默认定位基准")}</option>
            {targetCavities.map(c=><option key={c.instanceId} value={`cavity:${c.instanceId}`}>{c.name}</option>)}
            {activeScheme?.groups?.filter(g=>targetCavities.some(c=>g.cavityIds.includes(c.instanceId)||c.groupId===g.id)).map(g=><option key={g.id} value={`group:${g.id}`}>{g.name} {_t("原点")}</option>)}
          </select></label>}
          <label className="flex gap-2 items-center whitespace-nowrap">{_t("尺寸参考")}<select aria-label={_t("尺寸参考")} className="max-w-40 bg-background" value={chosenReference?referenceChoice:''} onChange={e=>setReferenceChoice(e.target.value)}>
            <option value="">{_t("安装面原点")}</option>{referenceOptions.map(r=><option key={r.id} value={r.id}>{_t(r.label)}</option>)}
          </select></label>
        </div>
      </Html>}
      {/* ── G-11 CAD 工程标注尺寸线（支持双击内联直接驱动孔位） ── */}
      <CadDimensionLines
        basis={basis}
        u={effectiveX}
        v={effectiveY}
        dimensions={dimensions}
        isDragging={Boolean(dragAxis)}
        referenceCavity={chosenReference&&referenceLocal?{id:chosenReference.id,name:chosenReference.label,x:referenceLocal.u,y:referenceLocal.v}:null}
        onClearReference={()=>setReferenceChoice('')}
        onUpdateX={(newX) => {
          if (isTargetGroup && targetGroup) {
            const deltaX = newX - effectiveX
            moveGroup(projectId, targetGroup.id, deltaX, 0)
          } else if (targetCavities.length === 1) {
            updateCavityPosition(projectId, targetCavities[0].instanceId, newX, effectiveY)
          } else {
            moveRigidCavities(projectId, targetCavities.map(c => c.instanceId), newX - effectiveX, 0)
          }
        }}
        onUpdateY={(newY) => {
          if (isTargetGroup && targetGroup) {
            const deltaY = newY - effectiveY
            moveGroup(projectId, targetGroup.id, 0, deltaY)
          } else if (targetCavities.length === 1) {
            updateCavityPosition(projectId, targetCavities[0].instanceId, effectiveX, newY)
          } else {
            moveRigidCavities(projectId, targetCavities.map(c => c.instanceId), 0, newY - effectiveY)
          }
        }}
      />

      {/* ── 平移拖拽实时幽灵代理（包含组合孔组内所有孔腔与安装外框平移预览） ── */}
      {dragAxis && dragAxis !== 'rotate' && previewOffset && (
        <group
          position={gizmoWorldPos}
          quaternion={orientationQuat}
          renderOrder={280}
        >
          {targetCavities.map((c) => {
            const relU = c.u - centerX
            const relV = c.v - centerY
            const steps = c.steps && c.steps.length > 0 ? c.steps : getCavitySteps(c, libraryDoc)
            const bands = parseCavityBands(steps)
            const mouthRadius = Math.max(bands[0]?.r0 ?? 5, 1.5)
            const crossHalf = mouthRadius * 1.3
            const crossPts = [
              new THREE.Vector3(-crossHalf, 0, 0.02),
              new THREE.Vector3(crossHalf, 0, 0.02),
              new THREE.Vector3(0, -crossHalf, 0.02),
              new THREE.Vector3(0, crossHalf, 0.02)
            ]
            const crossGeom = new THREE.BufferGeometry().setFromPoints(crossPts)

            return (
              <group key={c.instanceId} position={[relU, relV, 0.05]}>
                <mesh>
                  <ringGeometry args={[Math.max(0.2, mouthRadius - 0.3), mouthRadius + 0.3, 36]} />
                  <meshBasicMaterial
                    color="#00EBFF"
                    side={THREE.DoubleSide}
                    depthTest={false} depthWrite={false}
                    transparent
                    opacity={0.8}
                  />
                </mesh>
                <lineSegments geometry={crossGeom}>
                  <lineBasicMaterial color="#00EBFF" depthTest={false} depthWrite={false} transparent opacity={0.7} />
                </lineSegments>
              </group>
            )
          })}
          {isTargetGroup && groupOutlineLineGeom && (
            <lineSegments geometry={groupOutlineLineGeom} renderOrder={282}>
              <lineBasicMaterial color="#38bdf8" depthTest={false} depthWrite={false} transparent opacity={0.6} />
            </lineSegments>
          )}
        </group>
      )}

      {/* ── G-08 SolidWorks 风格动态旋转世界坐标预览（真实物理毫米尺寸，与三维模型 1:1 绝对贴合） ── */}
      {isTargetGroup && isDirectGroupSelected && effectiveRotateDeg !== 0 && (
        <group position={gizmoWorldPos} quaternion={orientationQuat} renderOrder={280}>
          {/* 旋转中心支点符号 (SolidWorks Pivot Center) */}
          <group position={[0, 0, 0.04]}>
            <mesh>
              <ringGeometry args={[1.2, 1.8, 32]} />
              <meshBasicMaterial color="#f59e0b" side={THREE.DoubleSide} depthTest={false} depthWrite={false} transparent opacity={0.9} />
            </mesh>
            <lineSegments geometry={PIVOT_CROSS_GEOM}>
              <lineBasicMaterial color="#f59e0b" depthTest={false} depthWrite={false} transparent opacity={0.85} />
            </lineSegments>
          </group>

          {/* 旋转后的组合安装轮廓预演 */}
          {groupOutlineLineGeom && (
            <group rotation={[0, 0, (effectiveRotateDeg * Math.PI) / 180]}>
              <lineSegments geometry={groupOutlineLineGeom} renderOrder={285}>
                <lineBasicMaterial
                  color="#fbbf24"
                  depthTest={false} depthWrite={false}
                  transparent
                  opacity={0.65}
                />
              </lineSegments>
            </group>
          )}

          {/* 各孔腔落点物理孔口轮廓与同心运动轨迹线 */}
          {ghostCavities.map((gc) => {
            const radSpan = Math.abs((effectiveRotateDeg * Math.PI) / 180)
            const thetaStart = effectiveRotateDeg >= 0 ? gc.startAngle : gc.startAngle - radSpan
            const crossHalf = gc.mouthRadius * 1.3
            const crossPts = [
              new THREE.Vector3(-crossHalf, 0, 0.02),
              new THREE.Vector3(crossHalf, 0, 0.02),
              new THREE.Vector3(0, -crossHalf, 0.02),
              new THREE.Vector3(0, crossHalf, 0.02)
            ]
            const crossGeom = new THREE.BufferGeometry().setFromPoints(crossPts)

            return (
              <group key={gc.id}>
                {/* 同心运动圆弧轨迹 (SolidWorks 经典同心路径线) */}
                {gc.radius > 1.5 && (
                  <mesh position={[0, 0, 0.03]}>
                    <ringGeometry
                      args={[
                        Math.max(0.1, gc.radius - 0.25),
                        gc.radius + 0.25,
                        48,
                        1,
                        thetaStart,
                        radSpan
                      ]}
                    />
                    <meshBasicMaterial
                      color="#f59e0b"
                      side={THREE.DoubleSide}
                      depthTest={false} depthWrite={false}
                      transparent
                      opacity={0.45}
                    />
                  </mesh>
                )}

                {/* 旋转落点物理孔口轮廓圈 (真实孔径 mm) */}
                <group position={[gc.relU, gc.relV, 0.05]}>
                  <mesh>
                    <ringGeometry args={[Math.max(0.2, gc.mouthRadius - 0.3), gc.mouthRadius + 0.3, 48]} />
                    <meshBasicMaterial
                      color="#fbbf24"
                      side={THREE.DoubleSide}
                      depthTest={false} depthWrite={false}
                      transparent
                      opacity={0.9}
                    />
                  </mesh>
                  {/* 孔位中心十字线 */}
                  <lineSegments geometry={crossGeom}>
                    <lineBasicMaterial color="#fbbf24" depthTest={false} depthWrite={false} transparent opacity={0.8} />
                  </lineSegments>
                </group>
              </group>
            )
          })}
        </group>
      )}

      {/* ── G-05 2D 贴面平移 Gizmo 手柄（恒定屏幕比例） ── */}
      <GizmoVisualLayer>
      <group
        ref={gizmoGroupRef}
        position={gizmoWorldPos}
        quaternion={orientationQuat}
        renderOrder={300}
        userData={{ interactionPriority: 'gizmo' }}
      >
        {/* ── 1. +X 轴向手柄（红色扁平 2D 贴面箭头，支持 Halo 与宽容点击区） ── */}
        <group
          position={[0, 0, 0.05]}
          rotation={[0, 0, -Math.PI / 2]}
          onPointerOver={(e) => {
            e.stopPropagation()
            setHoverAxis('x')
          }}
          onPointerOut={() => setHoverAxis(null)}
          onPointerDown={(e) => handlePointerDown('x', e)}
        >
          {/* 宽容命中拾取平面（透明，宽 16px，长 54px） */}
          <mesh geometry={ARROW_2D_HIT_GEOM}>
            <meshBasicMaterial transparent opacity={0} depthTest={false} depthWrite={false} side={THREE.DoubleSide} />
          </mesh>
          {/* 外光晕 Halo */}
          {isXActive && (
            <mesh geometry={ARROW_2D_HALO_GEOM} position={[0, 0, -0.005]}>
              <meshBasicMaterial color="#00EBFF" side={THREE.DoubleSide} depthTest={false} depthWrite={false} transparent opacity={0.5} />
            </mesh>
          )}
          {/* 2D 箭头主体（纯色平面，无 3D 阴影光照） */}
          <mesh geometry={ARROW_2D_GEOM}>
            <meshBasicMaterial
              color={isXActive ? '#ff4d4f' : '#ef4444'}
              side={THREE.DoubleSide}
              depthTest={false} depthWrite={false}
            />
          </mesh>
          {/* X 轴标 */}
          <Html position={[0, 52 + 7.0, 0]} center style={{ pointerEvents: 'none' }}>
            <span className="font-bold text-[12px] font-mono text-red-500 drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)] select-none">
              X
            </span>
          </Html>
        </group>

        {/* ── 2. +Y 轴向手柄（绿色扁平 2D 贴面箭头，支持 Halo 与宽容点击区） ── */}
        <group
          position={[0, 0, 0.05]}
          onPointerOver={(e) => {
            e.stopPropagation()
            setHoverAxis('y')
          }}
          onPointerOut={() => setHoverAxis(null)}
          onPointerDown={(e) => handlePointerDown('y', e)}
        >
          {/* 宽容命中拾取平面（透明，宽 16px，长 54px） */}
          <mesh geometry={ARROW_2D_HIT_GEOM}>
            <meshBasicMaterial transparent opacity={0} depthTest={false} depthWrite={false} side={THREE.DoubleSide} />
          </mesh>
          {/* 外光晕 Halo */}
          {isYActive && (
            <mesh geometry={ARROW_2D_HALO_GEOM} position={[0, 0, -0.005]}>
              <meshBasicMaterial color="#00EBFF" side={THREE.DoubleSide} depthTest={false} depthWrite={false} transparent opacity={0.5} />
            </mesh>
          )}
          {/* 2D 箭头主体（纯色平面，无 3D 阴影光照） */}
          <mesh geometry={ARROW_2D_GEOM}>
            <meshBasicMaterial
              color={isYActive ? '#52c41a' : '#22c55e'}
              side={THREE.DoubleSide}
              depthTest={false} depthWrite={false}
            />
          </mesh>
          {/* Y 轴标 */}
          <Html position={[0, 52 + 7.0, 0]} center style={{ pointerEvents: 'none' }}>
            <span className="font-bold text-[12px] font-mono text-emerald-500 drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)] select-none">
              Y
            </span>
          </Html>
        </group>

        {/* ── 3. 经典 CAD 象限方块自由平移手柄（位于 +X 与 +Y 正交夹角内） ── */}
        <group
          position={[quadBlockSize / 2 + 2.0, quadBlockSize / 2 + 2.0, 0.06]}
          onPointerOver={(e) => {
            e.stopPropagation()
            setHoverAxis('plane')
          }}
          onPointerOut={() => setHoverAxis(null)}
          onPointerDown={(e) => handlePointerDown('plane', e)}
        >
          {/* 外光晕 Halo */}
          {isPlaneActive && (
            <mesh position={[0, 0, -0.005]}>
              <planeGeometry args={[quadBlockSize * 1.35, quadBlockSize * 1.35]} />
              <meshBasicMaterial color="#00EBFF" side={THREE.DoubleSide} depthTest={false} depthWrite={false} transparent opacity={0.45} />
            </mesh>
          )}
          {/* 象限方块本体（纯色平面） */}
          <mesh>
            <planeGeometry args={[quadBlockSize, quadBlockSize]} />
            <meshBasicMaterial
              color={isPlaneActive ? '#00EBFF' : '#0284c7'}
              side={THREE.DoubleSide}
              depthTest={false} depthWrite={false}
              transparent
              opacity={isPlaneActive ? 0.95 : 0.65}
            />
          </mesh>
          {/* 象限方块边框勾勒 */}
          <lineSegments
            geometry={QUAD_BLOCK_OUTLINE_GEOM}
            renderOrder={305}
          >
            <lineBasicMaterial color={isPlaneActive ? '#ffffff' : '#38bdf8'} linewidth={2} depthTest={false} depthWrite={false} />
          </lineSegments>
        </group>

        {/* ── 4. G-08 角度尺寸操纵器（基于 X+ 基准线、角度射线、连接圆弧、圆形手柄与实时角度矩形标牌，仅在双击选中组合孔组时激活） ── */}
        {isTargetGroup && isDirectGroupSelected && (
          <group position={[0, 0, 0.05]}>
            {/* 360° 纤细极坐标刻度参考底盘与 0°, 90°, 180°, 270° 正交刻度缺口 */}
            <mesh geometry={ROT_DIAL_RING_GEOM} renderOrder={302}>
              <meshBasicMaterial color="#64748b" transparent opacity={0.25} depthTest={false} depthWrite={false} side={THREE.DoubleSide} />
            </mesh>
            <lineSegments geometry={ROT_DIAL_TICKS_GEOM} renderOrder={303}>
              <lineBasicMaterial color="#94a3b8" transparent opacity={0.5} depthTest={false} depthWrite={false} />
            </lineSegments>

            {/* 基于 X+ 渲染的比 X 轴长 (68px > 52px) 的角度基准直线 */}
            <lineSegments geometry={ANGLE_BASE_LINE_GEOM} renderOrder={304}>
              <lineBasicMaterial color="#94a3b8" linewidth={1.5} transparent opacity={0.7} depthTest={false} depthWrite={false} />
            </lineSegments>

            {/* 按当前真实角度绘制的射线直线 */}
            <group rotation={[0, 0, angleRad]}>
              <lineSegments geometry={ANGLE_BASE_LINE_GEOM} renderOrder={305}>
                <lineBasicMaterial color={isRotateActive ? '#fde047' : '#f59e0b'} linewidth={2} depthTest={false} depthWrite={false} />
              </lineSegments>
            </group>

            {/* 连接 X+ 基准线与当前角度射线的圆弧 (外置 R=76px，居中连接 X+ 与当前角度射线) */}
            {normalizedAngle > 0.5 && (
              <mesh position={[0, 0, 0.01]} renderOrder={306}>
                <ringGeometry args={[74.8, 77.2, 64, 1, 0, angleRad]} />
                <meshBasicMaterial
                  color={isRotateActive ? '#fde047' : '#f59e0b'}
                  side={THREE.DoubleSide}
                  depthTest={false} depthWrite={false}
                  transparent
                  opacity={0.85}
                />
              </mesh>
            )}

            {/* 圆形操作手柄（外置 R=76px，位置由真实角度确定：[R*cos(angle), R*sin(angle)]，彻底避开 52px X轴箭头） */}
            <group
              position={[76 * Math.cos(angleRad), 76 * Math.sin(angleRad), 0.06]}
              onPointerOver={(e) => {
                e.stopPropagation()
                setHoverAxis('rotate')
              }}
              onPointerOut={() => {
                setHoverAxis(null)
              }}
              onPointerDown={(e) => handlePointerDown('rotate', e)}
            >
              {/* 宽容透明圆形拾取层 */}
              <mesh geometry={ROT_KNOB_HIT_GEOM}>
                <meshBasicMaterial transparent opacity={0} depthTest={false} depthWrite={false} side={THREE.DoubleSide} />
              </mesh>

              {/* 激活/悬停外光晕 Halo */}
              {isRotateActive && (
                <mesh geometry={ROT_KNOB_HALO_GEOM} position={[0, 0, -0.005]}>
                  <meshBasicMaterial color="#fbbf24" side={THREE.DoubleSide} depthTest={false} depthWrite={false} transparent opacity={0.45} />
                </mesh>
              )}

              {/* 圆形手柄实心内核 */}
              <mesh geometry={ROT_KNOB_CORE_GEOM}>
                <meshBasicMaterial
                  color={isRotateActive ? '#fde047' : '#f59e0b'}
                  side={THREE.DoubleSide}
                  depthTest={false} depthWrite={false}
                />
              </mesh>

              {/* 圆形手柄精细白金外边框 */}
              <mesh geometry={ROT_KNOB_RING_GEOM}>
                <meshBasicMaterial
                  color="#ffffff"
                  side={THREE.DoubleSide}
                  depthTest={false} depthWrite={false}
                />
              </mesh>
            </group>

            {/* 真实当前角度矩形标牌：外置于圆弧外侧一定距离 (R=118px，比 R=76px 圆弧外凸 42px)，严格居中于圆弧角度中点；即使度数极小 (0°~15°) 也保有至少 42px 间距，彻底避免遮挡圆形手柄 */}
            {(() => {
              const badgeRadius = 118
              const badgeAngleDeg = normalizedAngle / 2
              const badgeAngleRad = (badgeAngleDeg * Math.PI) / 180
              const badgeX = badgeRadius * Math.cos(badgeAngleRad)
              const badgeY = badgeRadius * Math.sin(badgeAngleRad)
              return (
                <Html
                  position={[badgeX, badgeY, 0.08]}
                  center
                  style={{ pointerEvents: 'auto' }}
                >
                  <button
                    type="button"
                    title={_t("当前真实角度 (单击顺时针 +90°，或拖拽圆形手柄平滑旋转)")}
                    className="flex items-center justify-center px-1.5 py-0.5 rounded-[2px] bg-slate-900/95 hover:bg-amber-500 text-amber-400 hover:text-slate-950 border border-amber-400/80 shadow-md transition-all cursor-pointer select-none active:scale-95 text-[11px] font-mono font-bold whitespace-nowrap"
                    onClick={(e) => {
                      e.stopPropagation()
                      if (Date.now() < justDraggedUntilRef.current) return
                      if (targetGroup) rotateGroup(projectId, targetGroup.id, 90)
                    }}
                    onPointerOver={() => {
                      setHoverAxis('rotate')
                    }}
                    onPointerOut={() => {
                      setHoverAxis(null)
                    }}
                  >
                    {normalizedAngle}°
                  </button>
                </Html>
              )
            })()}
          </group>
        )}
      </group>
      </GizmoVisualLayer>
    </>
  )
}
