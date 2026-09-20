/**
 * 3D 视口检查证据与主动间隙标注叠加层 (AnalysisEvidenceOverlay)
 * 严格对齐 PRD-FR-04-15 §10 (FR-04-15-064) 与 §9 (FR-04-15-063)
 *
 * 功能特性：
 * 1. 支持多选孔腔与基体表面，展示所有两两之间的最短净距测量线、端点球与引线
 * 2. 真实 CAD 风格引线：间隙最小位置 -> 弯折水平台阶 (Shelf) -> 信息标签
 * 3. 采用 @react-three/drei 的 Line (Line2 屏幕像素级粗线，保证高分辨率与各视角清晰醒目)
 * 4. 标签支持在 3D 视口中鼠标按住自由拖拽平移，引线自适应动态跟随，双击可复位位置
 * 5. 检查问题 (Check Issue) 证据标签与主动间隙 (Active Clearance) 标签均支持手动拖动
 */

import React, { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useThree } from '@react-three/fiber'
import { Html, Line } from '@react-three/drei'
import { useAnalysisStore } from '../../model/analysisStore'
import { useDesignStore } from '../../model/designStore'
import type { ActiveClearanceResult, EntityRef } from '@shared/design/analysis/contracts'
import { getFacesForTemplate, type BaseFaceDefinition } from '@shared/design/types'

function getEntityKey(ref: EntityRef): string {
  if (ref.kind === 'cavity') return `cav-${ref.instanceId}`
  if (ref.kind === 'base-face') return `face-${ref.faceId}`
  if (ref.kind === 'port') return `port-${ref.instanceId}-${ref.portId}`
  return 'obj'
}

interface AnalysisEvidenceOverlayProps {
  projectId: string
}

/**
 * 可在 3D 视口投影平面上自由拖拽的 HTML 标注标签组件
 */
interface DraggableHtmlBadgeProps {
  badgeId: string
  defaultPos: [number, number, number]
  offset: [number, number, number]
  onOffsetChange: (badgeId: string, newOffset: [number, number, number]) => void
  children: React.ReactNode
  className?: string
  title?: string
}

const DraggableHtmlBadge: React.FC<DraggableHtmlBadgeProps> = ({
  badgeId,
  defaultPos,
  offset,
  onOffsetChange,
  children,
  className,
  title
}) => {
  const { camera, size } = useThree()
  const dragRef = useRef<{
    isDragging: boolean
    startX: number
    startY: number
    initialOffset: [number, number, number]
  } | null>(null)

  const currentPos: [number, number, number] = [
    defaultPos[0] + offset[0],
    defaultPos[1] + offset[1],
    defaultPos[2] + offset[2]
  ]

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation()
    e.nativeEvent.stopImmediatePropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    dragRef.current = {
      isDragging: true,
      startX: e.clientX,
      startY: e.clientY,
      initialOffset: offset
    }
  }

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current?.isDragging) return
    e.stopPropagation()
    e.nativeEvent.stopImmediatePropagation()

    const dx = e.clientX - dragRef.current.startX
    const dy = e.clientY - dragRef.current.startY
    const [initX, initY, initZ] = dragRef.current.initialOffset

    // 提取相机在世界空间中的 X (右) 和 Y (上) 轴
    const right = new THREE.Vector3(
      camera.matrixWorld.elements[0],
      camera.matrixWorld.elements[1],
      camera.matrixWorld.elements[2]
    )
    const up = new THREE.Vector3(
      camera.matrixWorld.elements[4],
      camera.matrixWorld.elements[5],
      camera.matrixWorld.elements[6]
    )

    let scale = 1
    if ((camera as THREE.OrthographicCamera).isOrthographicCamera) {
      const zoom = (camera as THREE.OrthographicCamera).zoom || 1
      scale = 1 / zoom
    } else if ((camera as THREE.PerspectiveCamera).isPerspectiveCamera) {
      const persCam = camera as THREE.PerspectiveCamera
      const vFov = (persCam.fov * Math.PI) / 180
      const targetPos = new THREE.Vector3(...currentPos)
      const dist = camera.position.distanceTo(targetPos)
      scale = (2 * Math.tan(vFov / 2) * dist) / (size.height || 600)
    }

    const worldDelta = right.multiplyScalar(dx * scale).add(up.multiplyScalar(-dy * scale))
    onOffsetChange(badgeId, [initX + worldDelta.x, initY + worldDelta.y, initZ + worldDelta.z])
  }

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.isDragging) {
      e.stopPropagation()
      e.nativeEvent.stopImmediatePropagation()
      try {
        e.currentTarget.releasePointerCapture(e.pointerId)
      } catch {}
      dragRef.current = null
    }
  }

  return (
    <Html
      position={currentPos}
      center
      style={{
        pointerEvents: 'auto',
        userSelect: 'none'
      }}
    >
      <div
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onDoubleClick={(e) => {
          e.stopPropagation()
          onOffsetChange(badgeId, [0, 0, 0])
        }}
        title={title || '按住可自由拖拽调整位置，双击可重置位置'}
        className={className}
      >
        {children}
      </div>
    </Html>
  )
}

const MEASURE_LINE_WIDTH = 1.8
const LEADER_LINE_WIDTH = 1.4
const UP_VECTOR = new THREE.Vector3(0, 1, 0)

interface ArrowHeadProps {
  tip: [number, number, number]
  dir: [number, number, number] | THREE.Vector3
  color: string
  height?: number
  radius?: number
}

/**
 * 3D CAD 风格尺寸线与引线箭头组件（尖端精准对齐目标点）
 */
const ArrowHead: React.FC<ArrowHeadProps> = ({
  tip,
  dir,
  color,
  height = 2.4,
  radius = 0.65
}) => {
  const { position, quaternion } = useMemo(() => {
    const vDir = dir instanceof THREE.Vector3 ? dir.clone() : new THREE.Vector3(...dir)
    if (!Number.isFinite(vDir.x) || !Number.isFinite(vDir.y) || !Number.isFinite(vDir.z) || vDir.lengthSq() < 1e-6) {
      vDir.set(0, 1, 0)
    } else {
      vDir.normalize()
    }
    const quat = new THREE.Quaternion().setFromUnitVectors(UP_VECTOR, vDir)
    const pos = new THREE.Vector3(...tip).sub(vDir.clone().multiplyScalar(height / 2))
    return { position: pos, quaternion: quat }
  }, [tip[0], tip[1], tip[2], dir, height])

  return (
    <mesh position={position} quaternion={quaternion} renderOrder={1001}>
      <coneGeometry args={[radius, height, 16]} />
      <meshBasicMaterial color={color} depthTest={false} />
    </mesh>
  )
}

/**
 * 单条主动间隙引线标注组件（使用 Drei Line 像素级线条渲染与 CAD 箭头）
 */
interface ClearanceItemAnnotationProps {
  result: ActiveClearanceResult
  index: number
  total: number
  center: [number, number, number]
  badgeOffsets: Record<string, [number, number, number]>
  onOffsetChange: (badgeId: string, newOffset: [number, number, number]) => void
  getEntityName: (ref: any) => string
}

const ClearanceItemAnnotation: React.FC<ClearanceItemAnnotationProps> = ({
  result,
  index,
  total,
  center,
  badgeOffsets,
  onOffsetChange,
  getEntityName
}) => {
  const { pointA: p0, pointB: p1, dist, relation } = result
  if (
    !p0 ||
    !p1 ||
    !Number.isFinite(p0[0]) ||
    !Number.isFinite(p0[1]) ||
    !Number.isFinite(p0[2]) ||
    !Number.isFinite(p1[0]) ||
    !Number.isFinite(p1[1]) ||
    !Number.isFinite(p1[2])
  ) {
    return null
  }

  const keyA = getEntityKey(result.objectA)
  const keyB = getEntityKey(result.objectB)
  const badgeId = `clearance-${keyA}-${keyB}`
  const offset = badgeOffsets[badgeId] || [0, 0, 0]

  const mid: [number, number, number] = [
    (p0[0] + p1[0]) / 2,
    (p0[1] + p1[1]) / 2,
    (p0[2] + p1[2]) / 2
  ]

  // 向外辐射的基准方向向量
  let dirX = mid[0] - center[0]
  let dirY = mid[1] - center[1]
  let dirZ = mid[2] - center[2]
  const len = Math.hypot(dirX, dirY, dirZ)
  if (len > 1e-4) {
    dirX /= len
    dirY /= len
    dirZ /= len
  } else {
    dirX = 0
    dirY = 1
    dirZ = 0
  }

  // 多组间隙交错辐射长度，避免多个标签初始重叠
  const leaderLength = 24 + (index % 4) * 7
  const corner: [number, number, number] = [
    mid[0] + dirX * leaderLength,
    mid[1] + dirY * leaderLength,
    mid[2] + dirZ * leaderLength
  ]
  const shelfX = dirX >= 0 ? 8 : -8
  const defaultEnd: [number, number, number] = [corner[0] + shelfX, corner[1], corner[2]]

  // 当前标签实际三维位置（含拖拽偏移量）
  const currentBadgePos: [number, number, number] = [
    defaultEnd[0] + offset[0],
    defaultEnd[1] + offset[1],
    defaultEnd[2] + offset[2]
  ]

  // 动态水平落脚台阶 (Shelf Corner)
  const dxShelf =
    Math.sign(currentBadgePos[0] - mid[0]) *
    Math.min(10, Math.max(2, Math.abs(currentBadgePos[0] - mid[0]) * 0.4))
  const shelfCorner: [number, number, number] = [
    currentBadgePos[0] - (dxShelf || 8),
    currentBadgePos[1],
    currentBadgePos[2]
  ]

  const nameA = result.objectAName || getEntityName(result.objectA)
  const nameB = result.objectBName || getEntityName(result.objectB)

  const isContacting = relation === 'contacting'
  const isIntersecting = relation === 'intersecting' || relation === 'containing'
  const themeColor = isIntersecting ? '#ef4444' : isContacting ? '#3b82f6' : '#06b6d4'
  const leaderColor = isIntersecting ? '#f87171' : isContacting ? '#60a5fa' : '#38bdf8'

  // 最短测量线端点箭头方向计算 (p0 处箭头指向 p0，p1 处箭头指向 p1)
  const v01 = useMemo(
    () => new THREE.Vector3(p0[0] - p1[0], p0[1] - p1[1], p0[2] - p1[2]),
    [p0, p1]
  )
  const arrowDist = v01.length()
  const arrowConeHeight = Math.min(2.4, Math.max(0.6, arrowDist * 0.35))
  const arrowConeRadius = arrowConeHeight * 0.28
  const dir0 = useMemo(() => v01.clone().normalize(), [v01])
  const dir1 = useMemo(() => v01.clone().negate().normalize(), [v01])

  // 引线根部箭头方向 (从 shelfCorner 指向 mid)
  const dirLeader = useMemo(() => {
    const v = new THREE.Vector3(mid[0] - shelfCorner[0], mid[1] - shelfCorner[1], mid[2] - shelfCorner[2])
    return v.lengthSq() > 1e-6 ? v.normalize() : new THREE.Vector3(0, 1, 0)
  }, [mid, shelfCorner])

  return (
    <group name={`clearance-pair-${index}`}>
      {/* 1. 最短净距测量线（精致 CAD 细实线，1.8px） */}
      <Line
        points={[p0, p1]}
        color={themeColor}
        lineWidth={MEASURE_LINE_WIDTH}
        depthTest={false}
        renderOrder={1000}
      />

      {/* 两端点 CAD 箭头（替代原点球） */}
      <ArrowHead
        tip={p0}
        dir={dir0}
        color={themeColor}
        height={arrowConeHeight}
        radius={arrowConeRadius}
      />
      <ArrowHead
        tip={p1}
        dir={dir1}
        color={themeColor}
        height={arrowConeHeight}
        radius={arrowConeRadius}
      />

      {/* 2. 外部引线 (mid -> shelfCorner -> badgePos)（精致细实线，1.4px） */}
      <Line
        points={[mid, shelfCorner, currentBadgePos]}
        color={leaderColor}
        lineWidth={LEADER_LINE_WIDTH}
        depthTest={false}
        renderOrder={1000}
      />

      {/* 引线端点 CAD 箭头（指向测量目标 mid，替代原点球） */}
      <ArrowHead
        tip={mid}
        dir={dirLeader}
        color={leaderColor}
        height={2.4}
        radius={0.65}
      />

      {/* 3. 可手动拖拽的信息标签 */}
      <DraggableHtmlBadge
        badgeId={badgeId}
        defaultPos={defaultEnd}
        offset={offset}
        onOffsetChange={onOffsetChange}
        className={`px-2 py-0.5 rounded shadow-xl text-[10px] font-mono whitespace-nowrap font-bold border cursor-grab active:cursor-grabbing select-none transition-shadow hover:ring-2 hover:ring-primary/50 ${
          isIntersecting
            ? 'bg-destructive/95 text-destructive-foreground border-destructive'
            : isContacting
              ? 'bg-blue-600/95 text-white border-blue-400'
              : 'bg-cyan-600/95 text-white border-cyan-400'
        }`}
      >
        {total === 1 ? (
          <span>净距: {dist.toFixed(2)} mm</span>
        ) : (
          <span>
            {nameA} ↔ {nameB}: {dist.toFixed(2)} mm
          </span>
        )}
      </DraggableHtmlBadge>
    </group>
  )
}

export const AnalysisEvidenceOverlay: React.FC<AnalysisEvidenceOverlayProps> = ({
  projectId
}) => {
  const session = useDesignStore((s) => s.projects[projectId])
  const doc = session?.doc
  const activeScheme = doc?.schemes.find((s) => s.id === doc.activeSchemeId) || doc?.schemes[0]
  const schemeId = activeScheme?.id || 'default'

  const schemeData = useAnalysisStore((s) => s.resultsByScheme[schemeId])
  const selectedIssueId = useAnalysisStore((s) => s.selectedIssueId)
  const activeClearanceResults = useAnalysisStore((s) => s.activeClearanceResults)
  const isActiveClearanceOpen = useAnalysisStore((s) => s.isActiveClearanceOpen)
  const badgeOffsets = useAnalysisStore((s) => s.badgeOffsets)
  const setBadgeOffset = useAnalysisStore((s) => s.setBadgeOffset)

  // 1. 查找选中的检查问题证据
  const selectedIssue = useMemo(() => {
    if (!selectedIssueId || !schemeData?.issues) return null
    return schemeData.issues.find((i) => i.id === selectedIssueId) || null
  }, [selectedIssueId, schemeData])

  const dimensions = doc?.baseBody?.dimensions || [100, 100, 100]
  const center: [number, number, number] = useMemo(
    () => [dimensions[0] / 2, dimensions[1] / 2, dimensions[2] / 2],
    [dimensions]
  )

  // 实体名称映射字典
  const allFaces: BaseFaceDefinition[] = useMemo(() => {
    if (!doc?.baseBody) return []
    return (
      doc.baseBody.faces ||
      getFacesForTemplate(doc.baseBody.template, doc.baseBody.dimensions, doc.baseBody.extraParams)
    )
  }, [doc?.baseBody])

  const getEntityName = (ref: any): string => {
    if (!ref) return ''
    if (ref.kind === 'cavity') {
      const cav = activeScheme?.cavities?.find((c) => c.instanceId === ref.instanceId)
      return cav?.subHoleName || cav?.name || `孔 ${ref.instanceId.slice(0, 6)}`
    }
    if (ref.kind === 'base-face') {
      const face = allFaces.find((f) => f.id === ref.faceId)
      return face?.name || `面 ${ref.faceId}`
    }
    return ''
  }

  // 选中的检查问题尺寸线与引线信息计算
  const issueAnnotation = useMemo(() => {
    if (!selectedIssue?.evidence?.lines?.[0]) return null
    const [p0, p1] = selectedIssue.evidence.lines[0]
    if (!p0 || !p1) return null
    if (
      !Number.isFinite(p0[0]) ||
      !Number.isFinite(p0[1]) ||
      !Number.isFinite(p0[2]) ||
      !Number.isFinite(p1[0]) ||
      !Number.isFinite(p1[1]) ||
      !Number.isFinite(p1[2])
    ) {
      return null
    }

    const mid: [number, number, number] = [
      (p0[0] + p1[0]) / 2,
      (p0[1] + p1[1]) / 2,
      (p0[2] + p1[2]) / 2
    ]

    let dirX = mid[0] - center[0]
    let dirY = mid[1] - center[1]
    let dirZ = mid[2] - center[2]
    const len = Math.hypot(dirX, dirY, dirZ)
    if (len > 1e-4) {
      dirX /= len
      dirY /= len
      dirZ /= len
    } else {
      dirX = 0
      dirY = 1
      dirZ = 0
    }

    const leaderLength = 26
    const corner: [number, number, number] = [
      mid[0] + dirX * leaderLength,
      mid[1] + dirY * leaderLength,
      mid[2] + dirZ * leaderLength
    ]
    const shelfX = dirX >= 0 ? 8 : -8
    const defaultEnd: [number, number, number] = [corner[0] + shelfX, corner[1], corner[2]]

    const badgeId = `issue-${selectedIssue.id}`
    const offset = badgeOffsets[badgeId] || [0, 0, 0]

    const currentBadgePos: [number, number, number] = [
      defaultEnd[0] + offset[0],
      defaultEnd[1] + offset[1],
      defaultEnd[2] + offset[2]
    ]

    const dxShelf =
      Math.sign(currentBadgePos[0] - mid[0]) *
      Math.min(10, Math.max(2, Math.abs(currentBadgePos[0] - mid[0]) * 0.4))
    const shelfCorner: [number, number, number] = [
      currentBadgePos[0] - (dxShelf || 8),
      currentBadgePos[1],
      currentBadgePos[2]
    ]

    // 最短测量线端点箭头方向计算 (p0 处箭头指向 p0，p1 处箭头指向 p1)
    const v01 = new THREE.Vector3(p0[0] - p1[0], p0[1] - p1[1], p0[2] - p1[2])
    const arrowDist = v01.length()
    const arrowConeHeight = Math.min(2.4, Math.max(0.6, arrowDist * 0.35))
    const arrowConeRadius = arrowConeHeight * 0.28
    const dir0 = v01.clone().normalize()
    const dir1 = v01.clone().negate().normalize()

    // 引线根部箭头方向 (从 shelfCorner 指向 mid)
    const vLeader = new THREE.Vector3(
      mid[0] - shelfCorner[0],
      mid[1] - shelfCorner[1],
      mid[2] - shelfCorner[2]
    )
    const dirLeader = vLeader.lengthSq() > 1e-6 ? vLeader.normalize() : new THREE.Vector3(0, 1, 0)

    return {
      p0,
      p1,
      mid,
      badgeId,
      defaultEnd,
      offset,
      currentBadgePos,
      shelfCorner,
      arrowConeHeight,
      arrowConeRadius,
      dir0,
      dir1,
      dirLeader
    }
  }, [selectedIssue, center, badgeOffsets])

  return (
    <group name="analysis-evidence-overlay">
      {/* 1. 选中的设计检查问题尺寸线与可拖拽引线 */}
      {selectedIssue && issueAnnotation && (
        <group name="selected-issue-evidence">
          {/* 最短位置测量线（精致 CAD 细实线，1.8px） */}
          <Line
            points={[issueAnnotation.p0, issueAnnotation.p1]}
            color={selectedIssue.severity === 'error' ? '#ef4444' : '#f59e0b'}
            lineWidth={MEASURE_LINE_WIDTH}
            depthTest={false}
            renderOrder={1000}
          />

          {/* 两端点 CAD 箭头（替代原点球） */}
          <ArrowHead
            tip={issueAnnotation.p0}
            dir={issueAnnotation.dir0}
            color={selectedIssue.severity === 'error' ? '#ef4444' : '#f59e0b'}
            height={issueAnnotation.arrowConeHeight}
            radius={issueAnnotation.arrowConeRadius}
          />
          <ArrowHead
            tip={issueAnnotation.p1}
            dir={issueAnnotation.dir1}
            color={selectedIssue.severity === 'error' ? '#ef4444' : '#f59e0b'}
            height={issueAnnotation.arrowConeHeight}
            radius={issueAnnotation.arrowConeRadius}
          />

          {/* 外部引线 (mid -> shelfCorner -> badgePos)（精致细实线，1.4px） */}
          <Line
            points={[
              issueAnnotation.mid,
              issueAnnotation.shelfCorner,
              issueAnnotation.currentBadgePos
            ]}
            color={selectedIssue.severity === 'error' ? '#f87171' : '#fcd34d'}
            lineWidth={LEADER_LINE_WIDTH}
            depthTest={false}
            renderOrder={1000}
          />

          {/* 引线端点 CAD 箭头（指向测量目标 mid，替代原点球） */}
          <ArrowHead
            tip={issueAnnotation.mid}
            dir={issueAnnotation.dirLeader}
            color={selectedIssue.severity === 'error' ? '#f87171' : '#fcd34d'}
            height={2.4}
            radius={0.65}
          />

          {selectedIssue.measurements?.[0] && (
            <DraggableHtmlBadge
              badgeId={issueAnnotation.badgeId}
              defaultPos={issueAnnotation.defaultEnd}
              offset={issueAnnotation.offset}
              onOffsetChange={setBadgeOffset}
              className={`px-2 py-0.5 rounded shadow-lg text-[10px] font-mono whitespace-nowrap border select-none cursor-grab active:cursor-grabbing transition-shadow hover:ring-2 hover:ring-primary/50 ${
                selectedIssue.severity === 'error'
                  ? 'bg-destructive/95 hover:bg-destructive text-destructive-foreground border-destructive font-semibold'
                  : 'bg-amber-500/95 hover:bg-amber-400 text-black border-amber-400 font-bold'
              }`}
            >
              {selectedIssue.measurements[0].name}: {selectedIssue.measurements[0].value}{' '}
              {selectedIssue.measurements[0].unit}
            </DraggableHtmlBadge>
          )}
        </group>
      )}

      {/* 2. 主动间隙分析：多选实体两两净距尺寸线与可拖拽引线 */}
      {isActiveClearanceOpen && activeClearanceResults.length > 0 && (
        <group name="active-clearance-evidence">
          {activeClearanceResults.map((res, idx) => (
            <ClearanceItemAnnotation
              key={`${getEntityKey(res.objectA)}-${getEntityKey(res.objectB)}-${idx}`}
              result={res}
              index={idx}
              total={activeClearanceResults.length}
              center={center}
              badgeOffsets={badgeOffsets}
              onOffsetChange={setBadgeOffset}
              getEntityName={getEntityName}
            />
          ))}
        </group>
      )}
    </group>
  )
}
