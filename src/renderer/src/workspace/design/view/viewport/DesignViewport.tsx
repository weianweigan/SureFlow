import { useLocale as _useLocale } from '@renderer/i18n/useLocale'
import { t as _t, msg as _msg } from '@shared/i18n'
import { MouseNavigation } from '../../interaction/MouseNavigation'
import { MouseHint } from '../../../settings/MouseHint'
import { useSettingsStore } from '@renderer/workspace/settings/settingsStore'
import { useEffect, useMemo, useRef, useState, useCallback, type FC } from 'react'
import * as THREE from 'three'
import { Canvas, useThree, useFrame, type RootState } from '@react-three/fiber'
import { Grid, GizmoHelper, GizmoViewport, OrbitControls } from '@react-three/drei'
import {
  Save,
  Undo2,
  Redo2,
  FolderOpen,
  Focus,
  Compass,
  Activity,
  Grid3X3,
  Scissors,
  FileDown,
  Palette,
  Eye,
  ChevronDown,
  Image as ImageIcon,
  Box
} from 'lucide-react'
import {
  BackgroundPreset,
  BACKGROUND_PRESETS,
  DEFAULT_BACKGROUND_PRESET,
  getSavedBackgroundPreset,
  saveBackgroundPreset,
  ViewportBackground,
  CameraHeadlight
} from './viewportEnvironment'
import {
  useDesignStore,
  getSelectedCavityIds,
  getSelectedFeatures,
  type FeatureSelectionItem
} from '../../model/designStore'
import { useLibraryStore } from '../../../library/viewmodel/libraryStore'
import { openProjectDialog } from '../../../../workspace/registry/panelActions'
import { getBoxFaceBasis, getCavityWorldMatrix, detectBoxFace, localToWorldPoint } from '@shared/design/faceMath'
import { getCavitySteps } from '../../geometry/cavityProfileBuilder'
import { csgBridge } from '../../worker/csg/csgWorkerBridge'
import { CsgValveBlockMesh, type MeshRayHit } from './CsgValveBlockMesh'
import { FaceBasisGizmo } from './FaceBasisGizmo'
import { OriginAxes } from './OriginAxes'
import { GhostCavityMesh } from './GhostCavityMesh'
import { PlacementController } from './PlacementController'
import { GroupOutlineGizmo } from './GroupOutlineGizmo'
import { PlanarMoveGizmo } from './PlanarMoveGizmo'
import { SnapGuides, SnapSettings, SnapStatusOverlay } from './SnapGuides'
import { MarqueeSelection } from './MarqueeSelection'
import { promoteFeatures } from '../../model/selectionMath'
import { usePlacementStore } from '../../model/placementStore'
import { CavityProxyRing } from './CavityProxyRing'
import { BlockDimensionGizmo } from './BlockDimensionGizmo'
import { CavityDepthGizmo } from './CavityDepthGizmo'
import { InclinedHolePopover } from './InclinedHolePopover'
import { SectionPlaneGizmo } from './SectionPlaneGizmo'
import { MultiCavityToolbar } from './MultiCavityToolbar'
import { SectionToolbar } from './SectionToolbar'
import { PatternWizardModal } from './PatternWizardModal'
import { MirrorWizardModal } from './MirrorWizardModal'
import { StepExportModal } from './StepExportModal'
import { packMeshCache, unpackMeshCache, exportToGlb } from '../../geometry/meshCache'
import { captureFittedPreview } from '../../geometry/viewportCapture'
import { PerformanceCollector, PerformanceHud, usePerfStore } from './PerformanceOverlay'
import { classifyAndGroupCsgGeometry, type TriangleTag } from '../../geometry/meshClassifier'
import { resolveMaterialConfig } from '@shared/design/types'
import type { MaterialConfig } from '@shared/design/types'
import type { ThreeEvent } from '@react-three/fiber'
import { cn } from '@renderer/lib/utils'
import { Popover, PopoverTrigger, PopoverContent } from '@renderer/components/ui/popover'

/** 视角预设（纯正交，无透视） */
export type ViewPreset =
  | 'isometric'
  | 'top'
  | 'bottom'
  | 'front'
  | 'back'
  | 'left'
  | 'right'

interface CameraRigProps {
  preset: ViewPreset
  boundsRadius: number
  fitTrigger: number
  center: THREE.Vector3
  focusTarget?: { position: THREE.Vector3; target: THREE.Vector3; key: number } | null
}

/**
 * 正交相机控制器：
 * - 严格防裁剪钳制：controls.minDistance = boundsRadius * 1.05
 * - 250ms 平滑居中适应动画 (Fit to View)
 * - 纯正交投影，无透视支持
 */
function CameraRig({ preset, boundsRadius, fitTrigger, center, focusTarget }: CameraRigProps): null {
  const { camera, size } = useThree()
  const controls = useThree((s) => s.controls) as any

  // 记录过渡动画
  const animRef = useRef<{
    startTime: number
    startPos: THREE.Vector3
    targetPos: THREE.Vector3
    startTarget: THREE.Vector3
    endTarget: THREE.Vector3
    startUp: THREE.Vector3
    targetUp: THREE.Vector3
    startZoom: number
    targetZoom: number
    active: boolean
  }>({
    startTime: 0,
    startPos: new THREE.Vector3(),
    targetPos: new THREE.Vector3(),
    startTarget: new THREE.Vector3(),
    endTarget: new THREE.Vector3(),
    startUp: new THREE.Vector3(0, 0, 1),
    targetUp: new THREE.Vector3(0, 0, 1),
    startZoom: 1,
    targetZoom: 1,
    active: false
  })

  /** 视角预设目标位置与 Up 向量计算（围绕零件几何中心 center 偏移） */
  const getPresetConfig = (
    p: ViewPreset,
    r: number,
    c: THREE.Vector3
  ): { targetPos: THREE.Vector3; targetUp: THREE.Vector3 } => {
    const dist = Math.max(r * 2.3, 180)
    let offset = new THREE.Vector3()
    let up = new THREE.Vector3(0, 0, 1)

    switch (p) {
      case 'top':
        // 顶面 +Z 轴（w = [0, 0, 1]），视点位于上方，up 朝 +Y
        offset = new THREE.Vector3(0, 0, dist)
        up = new THREE.Vector3(0, 1, 0)
        break
      case 'bottom':
        // 底面 -Z 轴（w = [0, 0, -1]），视点位于下方，up 朝 -Y
        offset = new THREE.Vector3(0, 0, -dist)
        up = new THREE.Vector3(0, -1, 0)
        break
      case 'front':
        // 前面 -Y 轴（w = [0, -1, 0]），视点位于前方，up 朝 +Z
        offset = new THREE.Vector3(0, -dist, 0)
        up = new THREE.Vector3(0, 0, 1)
        break
      case 'back':
        // 后面 +Y 轴（w = [0, 1, 0]），视点位于后方，up 朝 +Z
        offset = new THREE.Vector3(0, dist, 0)
        up = new THREE.Vector3(0, 0, 1)
        break
      case 'left':
        // 左面 -X 轴（w = [-1, 0, 0]），视点位于左侧，up 朝 +Z
        offset = new THREE.Vector3(-dist, 0, 0)
        up = new THREE.Vector3(0, 0, 1)
        break
      case 'right':
        // 右面 +X 轴（w = [1, 0, 0]），视点位于右侧，up 朝 +Z
        offset = new THREE.Vector3(dist, 0, 0)
        up = new THREE.Vector3(0, 0, 1)
        break
      case 'isometric':
      default:
        offset = new THREE.Vector3(dist * 0.7, -dist * 0.7, dist * 0.6)
        up = new THREE.Vector3(0, 0, 1)
        break
    }
    return { targetPos: c.clone().add(offset), targetUp: up }
  }

  /** 计算使模型占视口约 80% 的正交 zoom 值 */
  const computeFitZoom = (r: number): number => {
    const viewSize = Math.min(size.width, size.height)
    return viewSize / (r * 2 * 1.25)
  }

  const lastPresetRef = useRef<ViewPreset>(preset)
  const lastFitTriggerRef = useRef<number>(fitTrigger)
  const isFirstMountRef = useRef<boolean>(true)

  // 仅在显式预设切换或 Fit 显式触发时响应，基体尺寸更新绝不自动打飞相机定位
  useEffect(() => {
    if (!controls) return

    const isPresetChanged = lastPresetRef.current !== preset
    const isFitTriggered = lastFitTriggerRef.current !== fitTrigger
    lastPresetRef.current = preset
    lastFitTriggerRef.current = fitTrigger

    if (!isFirstMountRef.current && !isPresetChanged && !isFitTriggered) {
      return
    }
    isFirstMountRef.current = false

    const config = getPresetConfig(preset, boundsRadius, center)
    const targetZoom = computeFitZoom(boundsRadius)

    animRef.current = {
      startTime: performance.now(),
      startPos: camera.position.clone(),
      targetPos: config.targetPos,
      startTarget: controls.target ? controls.target.clone() : center.clone(),
      endTarget: center.clone(),
      startUp: camera.up.clone(),
      targetUp: config.targetUp,
      startZoom: (camera as THREE.OrthographicCamera).zoom || 1,
      targetZoom,
      active: true
    }
  }, [preset, fitTrigger, boundsRadius, controls, center])

  // 响应聚焦到孔腔 (Z 键 / 特征树双击)
  useEffect(() => {
    if (!controls || !focusTarget) return
    animRef.current = {
      startTime: performance.now(),
      startPos: camera.position.clone(),
      targetPos: focusTarget.position.clone(),
      startTarget: controls.target ? controls.target.clone() : center.clone(),
      endTarget: focusTarget.target.clone(),
      startUp: camera.up.clone(),
      targetUp: new THREE.Vector3(0, 0, 1),
      startZoom: (camera as THREE.OrthographicCamera).zoom || 1,
      targetZoom: computeFitZoom(boundsRadius * 0.4),
      active: true
    }
  }, [focusTarget, controls])

  // 250ms 缓动插值
  useFrame(() => {
    if (!animRef.current.active || !controls) return

    const elapsed = performance.now() - animRef.current.startTime
    const duration = 250 // 250ms 缓动
    const progress = Math.min(1, elapsed / duration)

    // easeInOutQuad
    const t =
      progress < 0.5
        ? 2 * progress * progress
        : -1 + (4 - 2 * progress) * progress

    camera.position.lerpVectors(animRef.current.startPos, animRef.current.targetPos, t)
    controls.target.lerpVectors(animRef.current.startTarget, animRef.current.endTarget, t)

    if (animRef.current.startUp && animRef.current.targetUp) {
      camera.up.lerpVectors(animRef.current.startUp, animRef.current.targetUp, t).normalize()
    }

    // 插值 zoom
    const orthoCamera = camera as THREE.OrthographicCamera
    orthoCamera.zoom = animRef.current.startZoom + (animRef.current.targetZoom - animRef.current.startZoom) * t
    orthoCamera.updateProjectionMatrix()

    controls.update?.()

    if (progress >= 1) {
      animRef.current.active = false
      if (animRef.current.targetUp) {
        camera.up.copy(animRef.current.targetUp)
      }
      controls.update?.()
    }
  })

  return null
}


interface DisplayToggleItemProps {
  icon: React.ComponentType<{ className?: string }>
  label: string
  shortcut?: string
  checked: boolean
  onCheckedChange: () => void
  activeColorClass?: string
}

function DisplayToggleItem({
  icon: Icon,
  label,
  shortcut,
  checked,
  onCheckedChange,
  activeColorClass = 'text-primary'
}: DisplayToggleItemProps) {
  _useLocale()
  return (
    <button
      type="button"
      onClick={onCheckedChange}
      className={cn(
        'flex w-full items-center justify-between rounded-md px-2 py-1.5 text-xs transition-colors cursor-pointer select-none',
        checked
          ? 'bg-accent/70 text-foreground font-medium'
          : 'text-muted-foreground hover:bg-accent/40 hover:text-foreground'
      )}
    >
      <div className="flex items-center gap-2">
        <Icon className={cn('size-3.5', checked ? activeColorClass : 'text-muted-foreground')} />
        <span>{_t(label)}</span>
      </div>
      <div className="flex items-center gap-1.5">
        {shortcut && (
          <span className="text-[10px] text-muted-foreground font-mono bg-muted/60 px-1 py-0.5 rounded leading-none">
            {shortcut}
          </span>
        )}
        <div
          className={cn(
            'relative inline-flex h-4 w-7 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-150 ease-in-out',
            checked ? 'bg-primary' : 'bg-muted-foreground/30'
          )}
        >
          <span
            className={cn(
              'pointer-events-none inline-block size-3 transform rounded-full bg-background shadow-xs ring-0 transition duration-150 ease-in-out',
              checked ? 'translate-x-3' : 'translate-x-0'
            )}
          />
        </div>
      </div>
    </button>
  )
}

interface DesignViewportProps {
  projectId: string
}

export const DesignViewport: FC<DesignViewportProps> = ({ projectId }) => {
  _useLocale()
  const session = useDesignStore((s) => s.projects[projectId])
  const saveProject = useDesignStore((s) => s.saveProject)
  const saveAsProject = useDesignStore((s) => s.saveAsProject)
  const undo = useDesignStore((s) => s.undo)
  const redo = useDesignStore((s) => s.redo)
  const selectFeature = useDesignStore((s) => s.selectFeature)
  const createGroupFromSelection = useDesignStore((s) => s.createGroupFromSelection)
  const disbandGroup = useDesignStore((s) => s.disbandGroup)
  const toggleSection = useDesignStore((s) => s.toggleSection)

  // 库 store
  const libraryDoc = useLibraryStore((s) => s.doc)

  const [viewPreset, setViewPreset] = useState<ViewPreset>('isometric')
  const [fitTrigger, setFitTrigger] = useState(0)
  const [showOrigin, setShowOrigin] = useState(() => useSettingsStore.getState().values.designOrigin)
  const [showGrid, setShowGrid] = useState(() => useSettingsStore.getState().values.designGrid)
  const [showPerf, setShowPerf] = useState(() => useSettingsStore.getState().values.designPerformance)
  const [isPatternOpen, setIsPatternOpen] = useState(false)
  const [isMirrorOpen, setIsMirrorOpen] = useState(false)
  const orbitControlsRef = useRef<any>(null)
  const [isStepExportOpen, setIsStepExportOpen] = useState(false)
  const [isInclinedPopoverOpen, setIsInclinedPopoverOpen] = useState(false)
  const [faceClickPoint, setFaceClickPoint] = useState<THREE.Vector3 | null>(null)
  const selectedCavityId = session?.selected?.type === 'cavity' ? session.selected.id : null

  // 选中特征改变或非孔腔时，自动关闭斜孔 Popover
  useEffect(() => {
    if (!selectedCavityId) {
      setIsInclinedPopoverOpen(false)
    }
  }, [selectedCavityId])

  // 选中非面特征时重置点击点
  useEffect(() => {
    if (session?.selected?.type !== 'face') {
      setFaceClickPoint(null)
    }
  }, [session?.selected])

  // 场景环境背景预设与持久化（默认为纯白图纸）
  const [bgPreset, setBgPreset] = useState<BackgroundPreset>(() => getSavedBackgroundPreset())
  const activeBgConfig = BACKGROUND_PRESETS[bgPreset] || BACKGROUND_PRESETS[DEFAULT_BACKGROUND_PRESET]

  const handleBgPresetChange = useCallback((preset: BackgroundPreset) => {
    setBgPreset(preset)
    saveBackgroundPreset(preset)
  }, [])

  // 剖切状态
  const sectionConfig = session?.sectionConfig
  const isSectionEnabled = Boolean(sectionConfig?.enabled)

  // 剖切截面 (Clipping Plane) 计算 (WebGL Stencil 与 Three.js Clipping)
  const clippingPlanes = useMemo(() => {
    if (!isSectionEnabled || !sectionConfig) return []
    const axis = sectionConfig.axis
    const offset = sectionConfig.offset || 0
    const flipped = sectionConfig.flipped
    const [sx, sy, sz] = session?.doc.baseBody.dimensions || [100, 100, 100]
    const cx = sx / 2
    const cy = sy / 2
    const cz = sz / 2

    const normal = new THREE.Vector3()
    const point = new THREE.Vector3(cx, cy, cz)

    if (axis === 'x') {
      normal.set(flipped ? 1 : -1, 0, 0)
      point.x += offset
    } else if (axis === 'y') {
      normal.set(0, flipped ? 1 : -1, 0)
      point.y += offset
    } else if (axis === 'z') {
      normal.set(0, 0, flipped ? 1 : -1)
      point.z += offset
    }

    return [new THREE.Plane().setFromNormalAndCoplanarPoint(normal, point)]
  }, [isSectionEnabled, sectionConfig, session?.doc.baseBody.dimensions])

  // 存储原始 CSG 计算结果与 FaceTag 映射
  const rawCsgRef = useRef<{
    positions: Float32Array
    normals: Float32Array
    indices: Uint32Array
    edgePositions: Float32Array
    faceTags?: Uint32Array
    numericIdToInstanceId?: Record<number, string>
  } | null>(null)

  // 保存视口 WebGL 渲染器与场景上下文引用（用于高质量离线快照抓取）
  const threeRef = useRef<(() => RootState) | null>(null)

  // CSG 布尔几何体缓存（按基体外表面、不透明孔腔面、选中孔腔面多材质分组）
  const [csgState, setCsgState] = useState<{
    solidGeometry: THREE.BufferGeometry | null
    edgeGeometry: THREE.BufferGeometry | null
    triangleTags: TriangleTag[] | null
    isComputing: boolean
  }>({
    solidGeometry: null,
    edgeGeometry: null,
    triangleTags: null,
    isComputing: false
  })

  // 基础备选几何体（从原点沿 +x, +y, +z 方向拉伸 [0, sx] × [0, sy] × [0, sz]）
  const fallbackGeom = useMemo(() => {
    if (!session) return null
    const [sx, sy, sz] = session.doc.baseBody.dimensions
    const box = new THREE.BoxGeometry(sx, sy, sz)
    box.clearGroups()
    box.translate(sx / 2, sy / 2, sz / 2)
    const edges = new THREE.EdgesGeometry(box, 24)
    return { box, edges }
  }, [session?.doc.baseBody.dimensions])

  // 极速冷启动：若会话中存在初次载入的二进制缓存，立即反序列化呈现 (首帧呈现耗时 <= 200ms, PRD-FR-04-07 §2.1)
  useEffect(() => {
    if (!session?.initialCacheBuffer) return
    try {
      const unpacked = unpackMeshCache(session.initialCacheBuffer)
      if (!unpacked) return

      rawCsgRef.current = {
        positions: unpacked.positions,
        normals: unpacked.normals,
        indices: unpacked.indices,
        edgePositions: unpacked.edgePositions
      }

      const activeScheme = session.doc.schemes.find((s) => s.id === session.doc.activeSchemeId) || session.doc.schemes[0]

      const classified = classifyAndGroupCsgGeometry(
        unpacked.positions,
        unpacked.normals,
        unpacked.indices,
        unpacked.edgePositions,
        session.doc.baseBody.dimensions,
        activeScheme.cavities,
        session.selected?.type === 'cavity' ? session.selected.id : null,
        session.selected?.type === 'face' ? session.selected.id : null
      )

      setCsgState({
        solidGeometry: classified.solidGeometry,
        edgeGeometry: classified.edgeGeometry,
        triangleTags: classified.triangleTags,
        isComputing: false
      })
    } catch (err) {
      console.warn('[DesignViewport] 载入秒开缓存失败，平滑降级为后台计算:', err)
    }
  }, [session?.initialCacheBuffer])

  // 监听孔腔与群组数量，同步至性能微型 store（完全不触发根组件 Re-render）
  useEffect(() => {
    if (session) {
      const activeScheme = session.doc.schemes.find((s) => s.id === session.doc.activeSchemeId) || session.doc.schemes[0]
      if (activeScheme) {
        usePerfStore.getState().setCounts(activeScheme.cavities.length, activeScheme.groups?.length || 0)
      }
    }
  }, [session?.doc.activeSchemeId, session?.doc.schemes])

  // 监听基体与孔腔状态，驱动 CSG Worker
  useEffect(() => {
    if (!session) return
    const { doc } = session
    const activeScheme = doc.schemes.find((s) => s.id === doc.activeSchemeId) || doc.schemes[0]

    let isCancelled = false
    setCsgState((prev) => ({ ...prev, isComputing: true }))
    usePerfStore.getState().setIsCsgComputing(true)

    async function runCsg() {
      const cavitiesInput = activeScheme.cavities.map((cav, idx) => {
        const basis = getBoxFaceBasis(cav.faceId, doc.baseBody.dimensions)
        const worldMatrix = Array.from(
          getCavityWorldMatrix(
            basis,
            cav.u,
            cav.v,
            cav.depthOffset,
            cav.rotation,
            cav.tiltAngle || 0,
            cav.azimuth ?? cav.rotation ?? 0
          )
        )
        const steps = cav.steps && cav.steps.length > 0 ? cav.steps : getCavitySteps(cav, libraryDoc)
        return {
          instanceId: cav.instanceId,
          numericId: idx + 1,
          steps,
          worldMatrix,
          suppressed: cav.suppressed
        }
      })

      const t0 = performance.now()
      const res = await csgBridge.computeDifference(doc.baseBody, cavitiesInput)
      if (!res || isCancelled) return
      const cost = Math.round(performance.now() - t0)
      usePerfStore.getState().setCsgTime(cost)
      usePerfStore.getState().setIsCsgComputing(false)

      rawCsgRef.current = {
        positions: res.positions,
        normals: res.normals,
        indices: res.indices,
        edgePositions: res.edgePositions,
        faceTags: res.faceTags,
        numericIdToInstanceId: res.numericIdToInstanceId
      }

      const classified = classifyAndGroupCsgGeometry(
        res.positions,
        res.normals,
        res.indices,
        res.edgePositions,
        doc.baseBody.dimensions,
        activeScheme.cavities,
        getSelectedCavityIds(session.selected, activeScheme),
        session.selected?.type === 'face' ? session.selected.id : null,
        res.faceTags,
        res.numericIdToInstanceId
      )

      setCsgState({
        solidGeometry: classified.solidGeometry,
        edgeGeometry: classified.edgeGeometry,
        triangleTags: classified.triangleTags,
        isComputing: false
      })
    }

    void runCsg()

    return () => {
      isCancelled = true
    }
  }, [
    session?.doc.baseBody.dimensions,
    session?.doc.baseBody.template,
    session?.doc.activeSchemeId,
    session?.doc.schemes,
    libraryDoc
  ])

  // 当选中孔腔或基准面切换时，动态对几何体进行高亮材质重分组，无需重新跑 CSG Worker
  const selectedFaceId = session?.selected?.type === 'face' ? session.selected.id : null
  const activeSchemeForSelection = session?.doc.schemes.find((s) => s.id === session?.doc.activeSchemeId) || session?.doc.schemes[0]
  const selectedCavityIds = useMemo(() => {
    return getSelectedCavityIds(session?.selected, activeSchemeForSelection)
  }, [session?.selected, activeSchemeForSelection])
  useEffect(() => {
    if (!rawCsgRef.current || !session) return
    const { doc } = session
    const activeScheme = doc.schemes.find((s) => s.id === doc.activeSchemeId) || doc.schemes[0]

    const classified = classifyAndGroupCsgGeometry(
      rawCsgRef.current.positions,
      rawCsgRef.current.normals,
      rawCsgRef.current.indices,
      rawCsgRef.current.edgePositions,
      doc.baseBody.dimensions,
      activeScheme.cavities,
      selectedCavityIds,
      selectedFaceId,
      rawCsgRef.current.faceTags,
      rawCsgRef.current.numericIdToInstanceId
    )

    setCsgState((prev) => ({
      ...prev,
      solidGeometry: classified.solidGeometry,
      edgeGeometry: classified.edgeGeometry,
      triangleTags: classified.triangleTags
    }))
  }, [selectedCavityIds, selectedFaceId, session?.doc.baseBody.dimensions, session?.doc.activeSchemeId, session?.doc.schemes])

  const [focusTarget, setFocusTarget] = useState<{
    position: THREE.Vector3
    target: THREE.Vector3
    key: number
  } | null>(null)

  // 聚焦指定孔腔孔口辅助函数
  const focusOnCavity = useCallback(
    (cavId: string) => {
      if (!session) return
      const { doc } = session
      const [sx, sy, sz] = doc.baseBody.dimensions
      const activeScheme = doc.schemes.find((s) => s.id === doc.activeSchemeId) || doc.schemes[0]
      const cav = activeScheme.cavities.find((c) => c.instanceId === cavId)
      if (cav) {
        const basis = getBoxFaceBasis(cav.faceId, [sx, sy, sz])
        const mouth = localToWorldPoint(basis, cav.u, cav.v, cav.depthOffset)
        const bRad = Math.sqrt(sx * sx + sy * sy + sz * sz) / 2
        const dist = Math.max(bRad * 1.5, 120)
        const targetPos = new THREE.Vector3(
          mouth[0] + dist * basis.w[0],
          mouth[1] + dist * basis.w[1],
          mouth[2] + dist * basis.w[2]
        )
        const target = new THREE.Vector3(mouth[0], mouth[1], mouth[2])
        setFocusTarget({ position: targetPos, target, key: Date.now() })
      }
    },
    [session]
  )

  // 监听外部触发的聚焦事件（如特征树双击）
  useEffect(() => {
    const handleFocusEvent = (e: any) => {
      if (e.detail) {
        focusOnCavity(e.detail)
      }
    }
    window.addEventListener('sureflow:focus-cavity', handleFocusEvent)
    return () => window.removeEventListener('sureflow:focus-cavity', handleFocusEvent)
  }, [focusOnCavity])

  // F 键全屏居中快捷键、Z 键聚焦、Ctrl+G 成组/解散组与 Esc 取消选择
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (e.target as HTMLElement)?.isContentEditable) return

      if ((e.key === 'f' || e.key === 'F') && !e.ctrlKey && !e.metaKey) {
        e.preventDefault()
        setFitTrigger((k) => k + 1)
        return
      }

      if ((e.key === 'z' || e.key === 'Z') && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (session?.selected?.type === 'cavity') {
          e.preventDefault()
          focusOnCavity(session.selected.id)
        }
        return
      }

      if ((e.ctrlKey || e.metaKey) && (e.key === 'g' || e.key === 'G')) {
        e.preventDefault()
        if (e.shiftKey) {
          // 解散组 (Ctrl+Shift+G)
          if (session?.selected?.type === 'group') {
            disbandGroup(projectId, session.selected.id)
          }
        } else {
          // 成组 (Ctrl+G)
          createGroupFromSelection(projectId)
        }
        return
      }

      if (e.altKey && (e.key === 's' || e.key === 'S')) {
        e.preventDefault()
        toggleSection(projectId)
        return
      }

      if ((e.ctrlKey || e.metaKey) && (e.key === 'a' || e.key === 'A')) {
        const activeTag = (document.activeElement as HTMLElement)?.tagName
        if (activeTag !== 'INPUT' && activeTag !== 'TEXTAREA') {
          e.preventDefault()
          if (activeScheme) {
            const faceId = session?.selected?.type === 'face' ? session.selected.id : null
            const items = promoteFeatures(activeScheme.cavities
              .filter(c => !c.suppressed && (!faceId || c.faceId === faceId))
              .map(c => ({ type: 'cavity', id: c.instanceId })), activeScheme)
            selectFeature(projectId, items.length ? { type: 'features', items } : null)
          }
          return
        }
      }

      if (e.key === 'Escape') {
        selectFeature(projectId, null)
        if (orbitControlsRef.current) {
          orbitControlsRef.current.enabled = true
        }
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [
    session?.selected,
    focusOnCavity,
    projectId,
    createGroupFromSelection,
    disbandGroup,
    selectFeature,
    toggleSection
  ])

  if (!session) return null
  const { doc, dirty, saving, selected, undoStack, redoStack } = session
  const [sx, sy, sz] = doc.baseBody.dimensions
  const center = useMemo(() => new THREE.Vector3(sx / 2, sy / 2, sz / 2), [sx, sy, sz])
  const activeScheme = doc.schemes.find((s) => s.id === doc.activeSchemeId) || doc.schemes[0]

  // 穿透拾取重叠多孔循环游标与屏幕点击位置追踪
  const cycleRef = useRef<{
    lastScreenPos: [number, number]
    cycleIndex: number
    candCavityIds: string[]
  }>({
    lastScreenPos: [-999, -999],
    cycleIndex: 0,
    candCavityIds: []
  })

  // 处理孔腔特征选择（单击子孔直接选中该子孔个体；支持 Shift/Ctrl 多选）
  const handleCavitySelect = useCallback(
    (cavId: string, isMulti: boolean = false) => {
      if (!session || usePlacementStore.getState().isPlacing) return

      // 视口单击始终选中该子孔个体（若属于组合孔，移动 Gizmo 将以此子孔为基准带动整个组合孔刚体移动）
      const targetFeature: FeatureSelectionItem = isMulti
        ? promoteFeatures([{ type: 'cavity', id: cavId }], activeScheme)[0]
        : { type: 'cavity', id: cavId }

      if (isMulti) {
        const current = promoteFeatures(getSelectedFeatures(useDesignStore.getState().projects[projectId]?.selected), activeScheme)
        const exists = current.some((f) => f.type === targetFeature.type && f.id === targetFeature.id)
        let next: FeatureSelectionItem[] = []
        if (exists) {
          next = current.filter((f) => !(f.type === targetFeature.type && f.id === targetFeature.id))
        } else {
          next = [...current, targetFeature]
        }
        if (next.length === 0) {
          selectFeature(projectId, null)
        } else if (next.length === 1) {
          selectFeature(projectId, { type: next[0].type, id: next[0].id } as any)
        } else {
          selectFeature(projectId, {
            type: 'features',
            items: next
          })
        }
      } else {
        selectFeature(projectId, { type: targetFeature.type, id: targetFeature.id } as any)
      }

      // 确保点击选择孔腔特征时，相机控制器始终恢复可用状态
      if (orbitControlsRef.current) {
        orbitControlsRef.current.enabled = true
      }
    },
    [projectId, selectFeature, session]
  )

  // 模型外接包围球半径
  const boundsRadius = Math.sqrt(sx * sx + sy * sy + sz * sz) / 2
  // 相机最小允许距离 (R_bounds * 1.05)，防止穿入模型破面
  const minDistance = boundsRadius * 1.05

  const isBaseSelected = selected?.type === 'base'

  // 解析材质配置
  const materialConfig: MaterialConfig = resolveMaterialConfig(
    doc.baseBody.material,
    doc.baseBody.materialConfig
  )

  // 处理在 3D 模型表面射线拾取：优先穿透外表面抓取内部孔腔并支持重叠多孔循环切换
  const handleMeshClick = useCallback(
    (hits: MeshRayHit[], rawEvent?: ThreeEvent<MouseEvent>) => {
      if (usePlacementStore.getState().isPlacing) return
      const isMulti = rawEvent ? Boolean(rawEvent.shiftKey || rawEvent.ctrlKey || rawEvent.metaKey) : false

      // 1. 穿透遍历所有命中的三角面，提取其中的所有孔腔 ID（按射线深度从小到大排序）
      const traversedCavityIds: string[] = []
      for (const hit of hits) {
        if (hit.cavityId && !traversedCavityIds.includes(hit.cavityId)) traversedCavityIds.push(hit.cavityId)
        if (hit.faceIndex != null && csgState.triangleTags && csgState.triangleTags[hit.faceIndex]) {
          const tag = csgState.triangleTags[hit.faceIndex]
          if (tag.type === 'cavity' && !traversedCavityIds.includes(tag.id)) {
            traversedCavityIds.push(tag.id)
          }
        }
      }

      if (traversedCavityIds.length > 0) {
        // 重叠孔腔循环拾取判定（判断是否在同一屏幕像素附近连续点击）
        const curX = rawEvent?.clientX ?? 0
        const curY = rawEvent?.clientY ?? 0
        const prev = cycleRef.current
        const dist = Math.hypot(curX - prev.lastScreenPos[0], curY - prev.lastScreenPos[1])

        let targetCavId = traversedCavityIds[0]
        if (dist <= 4 && traversedCavityIds.length > 1 &&
          prev.candCavityIds.join() === traversedCavityIds.join() && !isMulti && (rawEvent?.detail ?? 1) < 2) {
          // 同一区域再次点击：循环切换下一顺位孔腔
          const nextIdx = (prev.cycleIndex + 1) % traversedCavityIds.length
          targetCavId = traversedCavityIds[nextIdx]
          cycleRef.current = {
            lastScreenPos: [curX, curY],
            cycleIndex: nextIdx,
            candCavityIds: traversedCavityIds
          }
        } else {
          // 首次点击或位置已偏移：重置循环游标
          cycleRef.current = {
            lastScreenPos: [curX, curY],
            cycleIndex: 0,
            candCavityIds: traversedCavityIds
          }
        }

        handleCavitySelect(targetCavId, isMulti)
        return
      }

      cycleRef.current = { lastScreenPos: [-999, -999], cycleIndex: 0, candCavityIds: [] }
      if (!hits.length) return
      // 2. 无孔腔命中时，退回选中基体主面
      for (const hit of hits) {
        if (hit.faceIndex != null && csgState.triangleTags && csgState.triangleTags[hit.faceIndex]) {
          const tag = csgState.triangleTags[hit.faceIndex]
          if (tag.type === 'face' && tag.id !== 'base') {
            setFaceClickPoint(hit.point.clone())
            selectFeature(projectId, { type: 'face', id: tag.id })
            return
          }
        }
        if (hit.normal) {
          const detected = detectBoxFace(hit.normal, hit.point, doc.baseBody.dimensions)
          if (detected) {
            setFaceClickPoint(hit.point.clone())
            selectFeature(projectId, { type: 'face', id: detected })
            return
          }
        }
      }

      // 3. 兜底基体选择
      selectFeature(projectId, { type: 'base', id: 'base' })
    },
    [csgState.triangleTags, doc.baseBody.dimensions, handleCavitySelect, projectId, selectFeature]
  )

  // 双击始终提升到组合孔；独立孔聚焦。
  const handleMeshDoubleClick = useCallback(
    (hits: MeshRayHit[]) => {
      if (usePlacementStore.getState().isPlacing || !hits.length) return
      // 检查命中的首个孔腔
      for (const hit of hits) {
        if (hit.cavityId || (hit.faceIndex != null && csgState.triangleTags?.[hit.faceIndex])) {
          const tag = hit.cavityId ? { type: 'cavity', id: hit.cavityId } : csgState.triangleTags![hit.faceIndex!]
          if (tag.type === 'cavity') {
            const cavId = tag.id
            const grp = activeScheme?.groups?.find(
              (g) =>
                g.cavityIds.includes(cavId) ||
                activeScheme.cavities.some((c) => c.instanceId === cavId && c.groupId === g.id)
            )

            if (grp) {
              selectFeature(projectId, { type: 'group', id: grp.id })
              return
            }

            // 独立单孔：双击正对聚焦该孔
            focusOnCavity(cavId)
            return
          }
        }
      }

      // 命中基体面双击选中基体
      selectFeature(projectId, { type: 'base', id: 'base' })
    },
    [activeScheme, csgState.triangleTags, focusOnCavity, projectId, selectFeature, session?.selected]
  )

  const activeSolidGeom = csgState.solidGeometry || fallbackGeom?.box || null
  const activeEdgeGeom = csgState.edgeGeometry || fallbackGeom?.edges || null

  // 材质预设显示名
  const materialLabel = doc.baseBody.material || materialConfig.presetId

  // 采集配套二进制缓存、标准 GLB 与预览位图 (PRD-FR-04-07 §2)
  const getSaveExtra = useCallback(async () => {
    let cacheBuffer: ArrayBuffer | null = null
    let glbBuffer: ArrayBuffer | null = null
    let previewImageBase64: string | null = null

    // 保留当前观察方向，自动适配完整模型后捕获正常渲染帧。
    try {
      if (threeRef.current) {
        previewImageBase64 = await captureFittedPreview(threeRef.current(), new THREE.Box3(new THREE.Vector3(), new THREE.Vector3(sx, sy, sz)))
      }
    } catch (e) {
      console.warn('[DesignViewport] 抓取视口预览位图失败:', e)
    }

    if (rawCsgRef.current) {
      try {
        cacheBuffer = packMeshCache({
          positions: rawCsgRef.current.positions,
          normals: rawCsgRef.current.normals,
          indices: rawCsgRef.current.indices,
          edgePositions: rawCsgRef.current.edgePositions,
          triangleTags: (csgState.triangleTags as any) || undefined
        })
      } catch (e) {
        console.warn('[DesignViewport] 打包二进制网格缓存失败:', e)
      }
    }

    // 优先使用当前 CSG 实体网格；若状态暂时未就绪但存在 rawCSG 数据，原地组装真实切削网格，杜绝回退到无孔立方体
    let geomToExport = activeSolidGeom
    let edgeToExport = activeEdgeGeom
    let ownsExportGeometry = false
    if (!csgState.solidGeometry && rawCsgRef.current) {
      try {
        const classified = classifyAndGroupCsgGeometry(
          rawCsgRef.current.positions,
          rawCsgRef.current.normals,
          rawCsgRef.current.indices,
          rawCsgRef.current.edgePositions,
          doc.baseBody.dimensions,
          activeScheme?.cavities || [],
          null,
          null,
          rawCsgRef.current.faceTags,
          rawCsgRef.current.numericIdToInstanceId
        )
        geomToExport = classified.solidGeometry
        edgeToExport = classified.edgeGeometry
        ownsExportGeometry = true
      } catch (err) {
        console.warn('[DesignViewport] 从 rawCsg 组装 GLB 几何体失败:', err)
      }
    }

    if (geomToExport) {
      try {
        glbBuffer = await exportToGlb(
          geomToExport,
          edgeToExport,
          materialConfig.color
        )
      } catch (e) {
        console.warn('[DesignViewport] 导出 GLB 缓存失败:', e)
      }
    }

    if (ownsExportGeometry) {
      geomToExport?.dispose()
      edgeToExport?.dispose()
    }

    return { cacheBuffer, glbBuffer, previewImageBase64 }
  }, [activeEdgeGeom, activeSolidGeom, csgState.solidGeometry, csgState.triangleTags, doc.baseBody.dimensions, activeScheme?.cavities, materialConfig.color])

  const handleSave = useCallback(async () => {
    const extra = await getSaveExtra()
    await saveProject(projectId, extra)
  }, [getSaveExtra, projectId, saveProject])

  const handleSaveAs = useCallback(async () => {
    const extra = await getSaveExtra()
    await saveAsProject(projectId, extra)
  }, [getSaveExtra, projectId, saveAsProject])

  const handleExportPNG = useCallback(async () => {
    try {
      if (threeRef.current) {
        const base64 = await captureFittedPreview(threeRef.current(), new THREE.Box3(new THREE.Vector3(), new THREE.Vector3(sx, sy, sz)))
        
        const a = document.createElement('a')
        a.href = base64
        a.download = `${session.filePath ? session.filePath.split(/[\\/]/).pop()?.replace('.sfb', '') : 'Preview'}.png`
        a.click()
      }
    } catch (e) {
      console.error('[DesignViewport] Export PNG Failed:', e)
    }
  }, [session.filePath, sx, sy, sz])

  // 拦截全局 Ctrl+S / Cmd+S 快捷键，确保通过快捷键保存同样自动生成配套 .cache, .glb 与 .png
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey
      if (!mod) return
      if (e.key.toLowerCase() === 's') {
        e.preventDefault()
        e.stopPropagation()
        if (e.shiftKey) {
          void handleSaveAs()
        } else {
          void handleSave()
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [handleSave, handleSaveAs])

  return (
    <div className="flex h-full w-full flex-col bg-background">
      {/* ── 视口顶栏 Header（对齐库管理 h-10 border-b border-border px-3） ── */}
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-border px-3 bg-background">
        {/* 左侧：工程文件名与保存状态 */}
        <div className="flex items-center gap-2 min-w-0">
          {session.filePath && (
            <span className="font-semibold text-xs text-foreground truncate max-w-[260px]" title={session.filePath}>
              {session.filePath.split(/[\\/]/).pop()}
            </span>
          )}
          {dirty && (
            <span
              title={_t("有未保存修改")}
              className="size-2 rounded-full bg-amber-500 animate-pulse shrink-0"
            />
          )}
        </div>

        {/* 中间：文件与历史动作 */}
        <div className="flex items-center gap-1">
          <button
            type="button"
            disabled={saving || (!dirty && !!session.filePath)}
            title={_t("保存工程（Ctrl+S）")}
            className={cn(
              'flex size-7 items-center justify-center rounded-md border transition-colors cursor-pointer',
              dirty
                ? 'border-transparent bg-primary text-primary-foreground hover:bg-primary/90'
                : 'border-transparent text-muted-foreground hover:bg-accent hover:text-foreground'
            )}
            onClick={() => void handleSave()}
          >
            {saving ? (
              <span className="size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
            ) : (
              <Save className="size-4" />
            )}
          </button>

          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                title={_t("文件操作")}
                className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors cursor-pointer"
              >
                <ChevronDown className="size-4" />
              </button>
            </PopoverTrigger>
            <PopoverContent side="bottom" align="center" className="w-44 p-1 flex flex-col gap-1 z-50">
              <button
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-foreground hover:bg-accent hover:text-accent-foreground transition-colors cursor-pointer"
                onClick={() => void openProjectDialog()}
              >
                <FolderOpen className="size-3.5 text-muted-foreground" />
                <span>{_t("打开...")}</span>
              </button>
              <button
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-foreground hover:bg-accent hover:text-accent-foreground transition-colors cursor-pointer"
                onClick={() => void handleSaveAs()}
              >
                <Save className="size-3.5 text-muted-foreground" />
                <span>{_t("另存为...")}</span>
              </button>
              <button
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-foreground hover:bg-accent hover:text-accent-foreground transition-colors cursor-pointer"
                onClick={() => setIsStepExportOpen(true)}
              >
                <FileDown className="size-3.5 text-blue-500" />
                <span>{_t("导出 STEP 实体模型")}</span>
              </button>
              <button
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-foreground hover:bg-accent hover:text-accent-foreground transition-colors cursor-pointer"
                onClick={handleExportPNG}
              >
                <ImageIcon className="size-3.5 text-emerald-500" />
                <span>{_t("导出当前视口图片")}</span>
              </button>
            </PopoverContent>
          </Popover>

          <div className="h-4 w-px bg-border mx-1" />

          <button
            type="button"
            disabled={undoStack.length === 0}
            title={_t("撤销（Ctrl+Z）")}
            className="flex size-7 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground transition-colors disabled:opacity-30 disabled:pointer-events-none cursor-pointer"
            onClick={() => undo(projectId)}
          >
            <Undo2 className="size-3.5" />
          </button>

          <button
            type="button"
            disabled={redoStack.length === 0}
            title={_t("重做（Ctrl+Y）")}
            className="flex size-7 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground transition-colors disabled:opacity-30 disabled:pointer-events-none cursor-pointer"
            onClick={() => redo(projectId)}
          >
            <Redo2 className="size-3.5" />
          </button>
        </div>

        {/* 右侧：视角预设、全屏居中、视口显示与辅助设置 Popover */}
        <div className="flex items-center gap-1.5">
          {/* 视角预设下拉（纯正交视图） */}
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                title={_t("视角预设")}
                className="flex size-7 items-center justify-center rounded-md border border-transparent text-muted-foreground hover:bg-accent hover:text-foreground transition-colors cursor-pointer"
              >
                <Box className="size-4" />
              </button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-40 p-1 flex flex-col gap-1 z-50">
              <button
                className={cn('flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs transition-colors cursor-pointer', viewPreset === 'isometric' ? 'bg-accent text-accent-foreground' : 'text-foreground hover:bg-accent/50 hover:text-accent-foreground')}
                onClick={() => setViewPreset('isometric')}
              >{_t("等轴测")}</button>
              <button
                className={cn('flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs transition-colors cursor-pointer', viewPreset === 'top' ? 'bg-accent text-accent-foreground' : 'text-foreground hover:bg-accent/50 hover:text-accent-foreground')}
                onClick={() => setViewPreset('top')}
              >{_t("俯视图 (Top)")}</button>
              <button
                className={cn('flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs transition-colors cursor-pointer', viewPreset === 'bottom' ? 'bg-accent text-accent-foreground' : 'text-foreground hover:bg-accent/50 hover:text-accent-foreground')}
                onClick={() => setViewPreset('bottom')}
              >{_t("仰视图 (Bottom)")}</button>
              <button
                className={cn('flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs transition-colors cursor-pointer', viewPreset === 'front' ? 'bg-accent text-accent-foreground' : 'text-foreground hover:bg-accent/50 hover:text-accent-foreground')}
                onClick={() => setViewPreset('front')}
              >{_t("主视图 (Front)")}</button>
              <button
                className={cn('flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs transition-colors cursor-pointer', viewPreset === 'back' ? 'bg-accent text-accent-foreground' : 'text-foreground hover:bg-accent/50 hover:text-accent-foreground')}
                onClick={() => setViewPreset('back')}
              >{_t("后视图 (Back)")}</button>
              <button
                className={cn('flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs transition-colors cursor-pointer', viewPreset === 'left' ? 'bg-accent text-accent-foreground' : 'text-foreground hover:bg-accent/50 hover:text-accent-foreground')}
                onClick={() => setViewPreset('left')}
              >{_t("左视图 (Left)")}</button>
              <button
                className={cn('flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs transition-colors cursor-pointer', viewPreset === 'right' ? 'bg-accent text-accent-foreground' : 'text-foreground hover:bg-accent/50 hover:text-accent-foreground')}
                onClick={() => setViewPreset('right')}
              >{_t("右视图 (Right)")}</button>
            </PopoverContent>
          </Popover>

          {/* 全屏居中适应 */}
          <button
            type="button"
            title={_t("全屏居中适应（F 键）")}
            className="flex size-7 items-center justify-center rounded border border-border hover:bg-accent text-foreground transition-colors cursor-pointer"
            onClick={() => setFitTrigger((k) => k + 1)}
          >
            <Focus className="size-3.5" />
          </button>

          <div className="h-4 w-px bg-border mx-0.5" />

          {/* 捕捉与对齐设置 Popover */}
          <SnapSettings />

          {/* 视图显示与辅助设置 Popover */}
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                title={_t("视图显示与辅助设置（剖切/网格/原点/性能/背景）")}
                className={cn(
                  'relative flex size-7 items-center justify-center rounded-md border transition-colors cursor-pointer',
                  isSectionEnabled || showPerf || showGrid
                    ? 'border-primary/50 bg-primary/10 text-primary font-medium'
                    : 'border-transparent text-muted-foreground hover:bg-accent hover:text-foreground'
                )}
              >
                <Eye className="size-4" />
                {isSectionEnabled && (
                  <span className="absolute right-1 top-1 size-1.5 rounded-full bg-primary animate-pulse" />
                )}
              </button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-56 p-2 text-xs space-y-1">
              <div className="px-2 py-0.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                {_t("视图模式")}</div>
              <DisplayToggleItem
                icon={Scissors}
                label={_t("剖切视图")}
                shortcut="Alt+S"
                checked={isSectionEnabled}
                onCheckedChange={() => toggleSection(projectId)}
                activeColorClass="text-blue-500"
              />

              <div className="my-1 h-px bg-border/60" />

              <div className="px-2 py-0.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                {_t("辅助显示")}</div>
              <DisplayToggleItem
                icon={Compass}
                label={_t("原点坐标系 (WCS)")}
                checked={showOrigin}
                onCheckedChange={() => setShowOrigin((v) => !v)}
              />
              <DisplayToggleItem
                icon={Grid3X3}
                label={_t("全局参考网格")}
                checked={showGrid}
                onCheckedChange={() => setShowGrid((v) => !v)}
              />
              <DisplayToggleItem
                icon={Activity}
                label={_t("性能监控 HUD")}
                checked={showPerf}
                onCheckedChange={() => setShowPerf((v) => !v)}
                activeColorClass="text-emerald-500"
              />

              <div className="my-1 h-px bg-border/60" />

              <div className="px-2 py-0.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                {_t("场景环境")}</div>
              <div className="flex items-center justify-between rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:bg-accent/40">
                <div className="flex items-center gap-2">
                  <Palette className="size-3.5 text-muted-foreground" />
                  <span className="text-foreground">{_t("视口背景")}</span>
                </div>
                <select
                  value={bgPreset}
                  onChange={(e) => handleBgPresetChange(e.target.value as BackgroundPreset)}
                  title={_msg`视口场景环境背景：${activeBgConfig.label}\n${activeBgConfig.description}`}
                  className="h-6 rounded border border-border bg-background px-1.5 text-[11px] text-foreground focus:outline-none cursor-pointer max-w-[110px]"
                >
                  {Object.values(BACKGROUND_PRESETS).map((preset) => (
                    <option key={preset.id} value={preset.id}>
                      {_t(preset.label)}
                    </option>
                  ))}
                </select>
              </div>
            </PopoverContent>
          </Popover>
        </div>
      </div>

      {/* 3D 渲染画布 */}
      <div
        className="relative flex-1 min-h-0"
        style={{ background: activeBgConfig.cssGradient }}
      >
        <SnapStatusOverlay projectId={projectId} />
        <Canvas
          orthographic
          gl={{
            preserveDrawingBuffer: true,
            localClippingEnabled: true,
            antialias: true
          }}
          dpr={[1, Math.min(typeof window !== 'undefined' ? window.devicePixelRatio : 1, 1.5)]}
          camera={{
            position: [sx / 2 + boundsRadius * 1.6, sy / 2 + boundsRadius * 1.4, sz / 2 + boundsRadius * 1.9],
            zoom: Math.min(800, 600) / (boundsRadius * 2 * 1.25),
            near: 0.1,
            far: 10000
          }}
          onCreated={({ gl, get }) => {
            gl.localClippingEnabled = true
            threeRef.current = get
          }}
        >
          <SnapGuides projectId={projectId} />
          <MarqueeSelection projectId={projectId} dimensions={[sx, sy, sz]} />
          {/* 视口场景环境背景（默认纯白图纸） */}
          <ViewportBackground preset={bgPreset} />

          {/* CAD 级视线随动前向补光（直射深孔阶梯内壁，消除死黑） */}
          <CameraHeadlight intensity={0.26} />

          {/* 工程环境光照（CAD 经典三点光照协同调优） */}
          <ambientLight intensity={0.65} />
          <hemisphereLight args={['#ffffff', activeBgConfig.isDark ? '#334155' : '#94a3b8', 0.65]} />
          <directionalLight position={[180, 240, 160]} intensity={1.15} />
          <directionalLight position={[-160, -100, -120]} intensity={0.55} />

          {/* 阀块 CAD Shaded with Edges 边线实体复合渲染（支持 WebGL Stencil 实心封口剖切与 X-Ray 磨砂半透） */}
          <CsgValveBlockMesh
            projectId={projectId}
            triangleTags={csgState.triangleTags}
            selectedCavityIds={selectedCavityIds}
            solidGeometry={activeSolidGeom}
            edgeGeometry={activeEdgeGeom}
            isSelected={isBaseSelected}
            selectedCavityId={selected?.type === 'cavity' ? selected.id : null}
            selectedFaceId={selected?.type === 'face' ? selected.id : null}
            materialConfig={materialConfig}
            clippingPlanes={clippingPlanes}
            isDarkBackground={activeBgConfig.isDark}
            dimensions={[sx, sy, sz]}
            onClick={handleMeshClick}
            onDoubleClick={handleMeshDoubleClick}
          />

          {/* 组合孔/多孔类型安装面 Outline 轮廓投影 */}
          <GroupOutlineGizmo
            groups={activeScheme?.groups}
            cavities={activeScheme?.cavities}
            dimensions={[sx, sy, sz]}
            selectedCavityId={selected?.type === 'cavity' ? selected.id : null}
            selectedCavityIds={selectedCavityIds}
            selectedGroupId={selected?.type === 'group' ? selected.id : null}
          />

          {/* 原点坐标系（World Coordinate System - WCS） */}
          <OriginAxes dimensions={[sx, sy, sz]} visible={showOrigin} />

          {/* 不可见孔口拾取代理（双击聚焦） */}
          {activeScheme?.cavities.filter(c => !c.suppressed).map((cavity) => (
            <CavityProxyRing key={cavity.instanceId} cavity={cavity} dimensions={[sx,sy,sz]}
              onClick={handleMeshClick} onDoubleClick={handleMeshDoubleClick}/>
          ))}

          {/* 选中面时显示面基准坐标系 Gizmo (X/Y 轴 + 正视于手柄 + 推拉手柄) */}
          {selected?.type === 'face' && (
            <FaceBasisGizmo
              faceId={selected.id}
              dimensions={[sx, sy, sz]}
              clickPoint={faceClickPoint}
              onNormalTo={(faceId) => {
                const presetMap: Record<string, ViewPreset> = {
                  top: 'top',
                  bottom: 'bottom',
                  front: 'front',
                  back: 'back',
                  left: 'left',
                  right: 'right',
                  '+z': 'top',
                  '-z': 'bottom',
                  '-y': 'front',
                  '+y': 'back',
                  '-x': 'left',
                  '+x': 'right'
                }
                const targetPreset = presetMap[faceId.toLowerCase()] || (faceId as ViewPreset)
                setViewPreset(targetPreset)
                setFitTrigger((t) => t + 1)
              }}
            />
          )}

          {/* 基体 3D 驱动尺寸与表面法向推拉 Gizmo */}
          <BlockDimensionGizmo
            projectId={projectId}
            dimensions={[sx, sy, sz]}
            selectedFaceId={selected?.type === 'face' ? selected.id : null}
          />

          {/* 选中孔腔时显示 2D 贴面平移 Gizmo（支持单孔、多孔与同面成组移动） */}
          <PlanarMoveGizmo projectId={projectId} dimensions={[sx, sy, sz]} />

          {/* 底孔深度推拉与斜孔角度操纵手柄 Gizmo */}
          <CavityDepthGizmo
            projectId={projectId}
            dimensions={[sx, sy, sz]}
            isInclinedPopoverOpen={isInclinedPopoverOpen}
            onOpenInclinedPopover={() => setIsInclinedPopoverOpen((prev) => !prev)}
          />

          {/* 3D 剖切平面推拉与翻转操纵器 Gizmo */}
          <SectionPlaneGizmo projectId={projectId} dimensions={[sx, sy, sz]} />

          {/* 实时布孔控制器（处理 HTML5 拖拽与点选瞄准） */}
          <PlacementController projectId={projectId} dimensions={[sx, sy, sz]} />

          {/* 幽灵孔腔模型与浮动数字标签 HUD（支持内部孔道干涉检测与警戒标） */}
          <GhostCavityMesh dimensions={[sx, sy, sz]} projectId={projectId} />

          {/* 平铺网格地面（默认不显示，按需开启） */}
          {showGrid && (
            <Grid
              position={[sx / 2, -0.2, sy / 2]}
              args={[14, 14]}
              cellSize={20}
              cellThickness={0.6}
              cellColor={activeBgConfig.isDark ? '#475569' : '#cbd5e1'}
              sectionSize={100}
              sectionThickness={1.2}
              sectionColor={activeBgConfig.isDark ? '#64748b' : '#94a3b8'}
              fadeDistance={800}
              fadeStrength={1.2}
              infiniteGrid
            />
          )}

          {/* 相机控制器：纯正交 + 250ms 缓动居中 */}
          <CameraRig
            preset={viewPreset}
            boundsRadius={boundsRadius}
            fitTrigger={fitTrigger}
            center={center}
            focusTarget={focusTarget}
          />
          <OrbitControls
            ref={orbitControlsRef}
            makeDefault
            enableDamping={false}
            target={[sx / 2, sy / 2, sz / 2]}
            minDistance={minDistance}
            maxDistance={boundsRadius * 8}
            mouseButtons={{
              LEFT: undefined,
              MIDDLE: THREE.MOUSE.PAN,
              RIGHT: THREE.MOUSE.ROTATE
            }}
            zoomToCursor={true}
          />

          <MouseNavigation />

          {/* 右下角导航坐标指示器 */}
          <GizmoHelper alignment="bottom-right" margin={[60, 60]}>
            <GizmoViewport
              axisColors={['#ef4444', '#10b981', '#3b82f6']}
              labelColor="#0f172a"
            />
          </GizmoHelper>

          {/* WebGL 性能采样器（数据直推 usePerfStore，零触碰 DesignViewport） */}
          <PerformanceCollector active={showPerf} />
        </Canvas>

        {/* 悬浮性能评测 HUD 面板（独立局部订阅） */}
        {showPerf && (
          <PerformanceHud onClose={() => setShowPerf(false)} />
        )}

        {/* 多孔辅助排布浮动工具栏（多选 ≥ 2 孔或选中组时激活） */}
        <MultiCavityToolbar
          projectId={projectId}
          onOpenPattern={() => setIsPatternOpen(true)}
          onOpenMirror={() => setIsMirrorOpen(true)}
        />

        {/* 剖切截面控制面板 (PRD-FR-04-06 §1.1) */}
        <SectionToolbar projectId={projectId} dimensions={[sx, sy, sz]} />

        {/* 阵列特征向导弹窗 */}
        <PatternWizardModal
          projectId={projectId}
          isOpen={isPatternOpen}
          onClose={() => setIsPatternOpen(false)}
        />

        {/* 镜像特征向导弹窗 */}
        <MirrorWizardModal
          projectId={projectId}
          isOpen={isMirrorOpen}
          onClose={() => setIsMirrorOpen(false)}
        />

        {/* STEP 实体模型导出向导弹窗 (PRD-FR-04-07 §3) */}
        <StepExportModal
          projectId={projectId}
          isOpen={isStepExportOpen}
          onClose={() => setIsStepExportOpen(false)}
        />

        {/* 斜孔倾角/方位角右上角精细化调节 Popover */}
        {isInclinedPopoverOpen && session?.selected?.type === 'cavity' && (
          <InclinedHolePopover
            projectId={projectId}
            cavityId={session.selected.id}
            onClose={() => setIsInclinedPopoverOpen(false)}
          />
        )}

        {/* 视口左下角信息指示 */}
        <div className="absolute bottom-2 left-3 pointer-events-none flex items-center gap-2 text-[11px] text-muted-foreground/80 font-mono select-none">
          <span><MouseHint /></span>
          <span>{_t("外形:")}{doc.baseBody.template || 'box'} {_t("· 尺寸:")}{sx} × {sy} × {sz} {_t("mm · 材质:")}{_t(materialLabel)}</span>
          {csgState.isComputing && (
            <span className="flex items-center gap-1 text-primary text-[10px] animate-pulse">
              <span className="size-1.5 rounded-full bg-primary" />
              <span>{_t("计算布尔中...")}</span>
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
