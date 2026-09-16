import { useLocale as _useLocale } from '@renderer/i18n/useLocale'
import { t as _t, msg as _msg } from '@shared/i18n'
/**
 * 安装面（组合孔）视图 —— konva
 *
 * 画出 base-plate 轮廓 + 全部子孔圆 + 圆内居中的名称（R4），支持：
 *  - 点某子孔圆 → 高亮并显示“安装定位”CAD 引线（极坐标 r/θ 或 笛卡尔 (x,y)）；
 *  - 引用失效的子孔以红字缀『!』且不可选（无几何）。
 *
 * 世界坐标：接收的模型 cx/cy 与 outlinePath 直接作为 mm 使用（与屏幕 y 向下同向）。
 */

import { useEffect, useMemo, useState } from 'react'
import { Circle, Group, Line, Path } from 'react-konva'
import type { FaceModel } from '../faceLayout'
import { buildSection } from '../sectionProfile'
import type { CanvasPalette } from './palette'
import { alpha, rgb } from './palette'
import { DECOR, toMm, type Pt, type Viewport } from './viewport'
import { DimLeader, TextBubble } from './Dimension'
import { HoleName } from './HoleName'
import { SectionView } from './SectionView'
import type { Geometry } from '@shared/cavity/types'

export function FaceView({
  model,
  geos,
  selected,
  onSelect,
  selectedBand,
  onSelectBand,
  selectedPortIndex,
  onSelectPort,
  vp,
  colors
}: {
  model: FaceModel
  geos?: (Geometry | null)[] | null
  /** 当前选中的子孔下标（可为 null） */
  selected: number | null
  onSelect: (idx: number) => void
  selectedBand?: number | null
  onSelectBand?: (idx: number | null) => void
  selectedPortIndex?: number | null
  onSelectPort?: (idx: number | null) => void
  vp: Viewport
  colors: CanvasPalette
}) {
  _useLocale()
  const { k } = vp
  const ringFill = alpha(colors.ink, 0.06)
  const stroke = rgb(colors.ink)

  // 选中子孔剖面内的台阶与侧油口选择状态（支持由外部 store 控制或本地兜底）
  const [localBand, setLocalBand] = useState<number | null>(null)
  const [localPort, setLocalPort] = useState<number | null>(null)

  useEffect(() => {
    setLocalBand(null)
    setLocalPort(null)
  }, [selected])

  const activeBand = selectedBand !== undefined ? selectedBand : localBand
  const handleSelectBand = (idx: number | null) => {
    if (onSelectBand) onSelectBand(idx)
    else setLocalBand(idx)
  }

  const activePort = selectedPortIndex !== undefined ? selectedPortIndex : localPort
  const handleSelectPort = (idx: number | null) => {
    if (onSelectPort) onSelectPort(idx)
    else setLocalPort(idx)
  }

  const selectedHole = selected != null ? model.holes[selected] : null
  const selectedGeo = selected != null ? (geos?.[selected] ?? selectedHole?.geometry ?? null) : null
  const selectedSec = useMemo(() => {
    if (!selectedGeo) return null
    return buildSection(selectedGeo)
  }, [selectedGeo])

  // 下方剖面图基线 Y 坐标（世界 mm，位于安装面底部加上安全间距）
  const gap = Math.max(25, toMm(45, k))
  const ySecFace = model.bounds.maxY + gap

  return (
    <Group>
      {/* 底版轮廓 */}
      {model.outlinePath.trim() && (
        <Path
          data={model.outlinePath}
          fill={alpha(colors.ink, 0.03)}
          stroke={colors.ink}
          strokeWidth={toMm(DECOR.lineW, k)}
          lineJoin="round"
          lineCap="round"
          listening={false}
        />
      )}

      {/* 原点十字 */}
      <Group listening={false}>
        <Line points={[-toMm(6, k), 0, toMm(6, k), 0]} stroke={colors.muted} strokeWidth={toMm(DECOR.weakW, k)} lineCap="round" lineJoin="round" />
        <Line points={[0, -toMm(6, k), 0, toMm(6, k)]} stroke={colors.muted} strokeWidth={toMm(DECOR.weakW, k)} lineCap="round" lineJoin="round" />
      </Group>

      {/* 每个子孔：圆 + 名称 + 螺纹大径示意 */}
      {model.holes.map((h, i) => {
        const enable = !h.unresolved
        const r = Math.max(h.radius, 1)
        const isSel = selected === i
        const hasThread = Boolean(h.geometry?.steps?.some((s) => s.thread != null))

        // 机械制图标准：内螺纹俯视 3/4 圈大径牙底线（细实线）
        const threadRootRadius = r + Math.min(Math.max(r * 0.14, 0.8), 2.2)
        const threadArcPts: number[] = []
        if (hasThread) {
          for (let deg = 30; deg <= 300; deg += 15) {
            const rad = (deg * Math.PI) / 180
            threadArcPts.push(h.cx + threadRootRadius * Math.cos(rad), h.cy + threadRootRadius * Math.sin(rad))
          }
        }

        return (
          <Group key={i}>
            {/* 螺纹大径 3/4 圈细实线示意 */}
            {hasThread && enable && (
              <Line
                points={threadArcPts}
                stroke={colors.ink}
                strokeWidth={toMm(DECOR.weakW, k)}
                lineCap="round"
                listening={false}
              />
            )}

            {/* 命中/形状圆 */}
            <Circle
              x={h.cx}
              y={h.cy}
              radius={r}
              fill={isSel ? alpha(colors.mint, 0.45) : ringFill}
              stroke={stroke}
              strokeWidth={toMm(isSel ? 2.2 : DECOR.lineW, k)}
              listening={enable}
              onClick={() => onSelect(i)}
              onMouseEnter={(e) => {
                if (!enable) return
                const stage = e.target.getStage()
                if (stage) stage.container().style.cursor = 'pointer'
              }}
              onMouseLeave={(e) => {
                const stage = e.target.getStage()
                if (stage) stage.container().style.cursor = 'default'
              }}
            />
            {/* 定位点（极坐标时指向 0° = +X 的小刻度）留空 v0 */}
            {/* 名称（圆内居中） */}
            {enable && (
              <HoleName
                cx={h.cx}
                cy={h.cy}
                radiusPx={r * k}
                name={h.name}
                vp={vp}
                colors={colors}
              />
            )}
            {h.unresolved && (
              <Circle x={h.cx} y={h.cy} radius={r} stroke={colors.bad} strokeWidth={toMm(1, k)} strokeDasharray={`${toMm(2, k)} ${toMm(2, k)}`} dashEnabled listening={false} />
            )}
          </Group>
        )
      })}

      {/* 选中者：安装定位引线 */}
      {selectedHole && (
        <LocationDim hole={selectedHole} vp={vp} colors={colors} />
      )}

      {/* 选中子孔的俯视图横向中心刻度（与下方贯通的纵向中轴线构成标准 CAD 十字中心线） */}
      {selectedHole && (
        <Line
          points={[
            selectedHole.cx - Math.max(selectedHole.radius, 2) - toMm(4, k),
            selectedHole.cy,
            selectedHole.cx + Math.max(selectedHole.radius, 2) + toMm(4, k),
            selectedHole.cy
          ]}
          stroke={colors.muted}
          strokeWidth={toMm(DECOR.weakW, k)}
          dash={[toMm(8, k), toMm(2.5, k), toMm(1.2, k), toMm(2.5, k)]}
          lineCap="round"
          lineJoin="round"
          listening={false}
        />
      )}

      {/* 选中子孔的截面图（严格置于下方 X 坐标相等处：x = selectedHole.cx） */}
      {selectedHole && (
        <Group x={selectedHole.cx} y={ySecFace}>
          {selectedSec ? (
            <SectionView
              sec={selectedSec}
              selectedBand={activeBand}
              onSelectBand={(idx) => {
                handleSelectBand(activeBand === idx ? null : idx)
                if (activeBand !== idx) handleSelectPort(null)
              }}
              selectedPortIndex={activePort}
              onSelectPort={(idx) => {
                handleSelectPort(activePort === idx ? null : idx)
                if (activePort !== idx) handleSelectBand(null)
              }}
              vp={vp}
              colors={colors}
              axisY0={(selectedHole.cy - Math.max(selectedHole.radius, 2) - toMm(6, k)) - ySecFace}
              title={_msg`${selectedHole.name} 剖面`}
              showOverviewDims={true}
            />
          ) : (
            <Group listening={false}>
              <Line
                points={[
                  0,
                  (selectedHole.cy - Math.max(selectedHole.radius, 2) - toMm(6, k)) - ySecFace,
                  0,
                  toMm(24, k)
                ]}
                stroke={colors.muted}
                strokeWidth={toMm(DECOR.weakW, k)}
                dash={[toMm(8, k), toMm(2.5, k), toMm(1.2, k), toMm(2.5, k)]}
                lineCap="round"
                lineJoin="round"
              />
              <TextBubble
                x={0}
                y={toMm(12, k)}
                value={`${selectedHole.name} (${selectedHole.unresolved ?? _t("无可用截面")})`}
                fontPx={10}
                padX={6}
                vp={vp}
                colors={colors}
              />
            </Group>
          )}
        </Group>
      )}

      {/* 选中的子孔文字重绘在中心线顶层，保证文字清晰不被中轴线遮掩 */}
      {selectedHole && !selectedHole.unresolved && (
        <HoleName
          cx={selectedHole.cx}
          cy={selectedHole.cy}
          radiusPx={Math.max(selectedHole.radius, 1) * k}
          name={selectedHole.name}
          vp={vp}
          colors={colors}
        />
      )}
    </Group>
  )
}

/** 选中子孔的「安装定位」引线尺寸（r/θ 或 x,y） */
function LocationDim({ hole, vp, colors }: { hole: { cx: number; cy: number; polar: boolean; x: number; y: number; radius: number }; vp: Viewport; colors: CanvasPalette }) {
  _useLocale()
  const ext = Math.hypot(hole.cx, hole.cy) || 1e-6
  const along = { x: hole.cx / ext, y: hole.cy / ext } // 由原点向孔的单位
  // 引导标签放在孔朝外、远离坑内处
  const tip: Pt = { x: hole.cx, y: hole.cy }
  const label: Pt = {
    x: along.x * (ext + hole.radius) + along.x * toMm(24, vp.k),
    y: along.y * (ext + hole.radius) + along.y * toMm(24, vp.k)
  }
  const value = hole.polar
    ? `r${fmt(hole.x)}   θ${fmt(hole.y)}°`
    : `(${fmt(hole.cx)}, ${fmt(hole.cy)})`
  return (
    <Group>
      <DimLeader value={value} tip={tip} label={_t(label)} vp={vp} colors={colors} />
    </Group>
  )
}

function fmt(v: number): string {
  const r = Math.round(v * 100) / 100
  return Number.isInteger(r) ? `${r}` : r.toFixed(2)
}
