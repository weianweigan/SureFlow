import { useLocale as _useLocale } from '@renderer/i18n/useLocale'
import { t as _t } from '@shared/i18n'
/**
 * 孔腔 2D 预览 —— react-konva（整体替换旧 SVG 实现）
 *
 * - 非组合孔（单孔）：剖面图（SectionView）。点击任一台阶以两条 CAD 尺寸
 *   （φ口径＋自安装面深度）即时呈现；点空白/取消选中则不再标注（R2/A 粒度:单段），
 * - 组合孔：安装面图（FaceView）；点击某子孔圆会高亮并标注“安装定位”，
 *   并在下方呈现投影剖面与关键尺寸；
 * - R4 子孔名称字号随孔径自适应、圆内居中；
 * - R5 画布无边框，Stage 铺满本面板（外层相对定位裁切）并由 ResizeObserver 适配；
 * - R6 线宽/字号/箭头/标注恒定 px（经 toMm 换算），几何随 zoom 缩放的轴保持。
 *
 * 所有视图内选择均为本组件内部局部状态，不触碰库文档 selection。
 */

import { useSettingsStore, zoomFactor } from '@renderer/workspace/settings/settingsStore'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Maximize2 } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { Group, Layer, Stage } from 'react-konva'
import type Konva from 'konva'
import { palette } from './konva/palette'
import type { Viewport } from './konva/viewport'
import { buildSection, type SectionModel } from './sectionProfile'
import { buildFaceLayout, type FaceModel } from './faceLayout'
import { findTemplate, resolveHole } from '../../model/documentOps'
import { getLoadedLibs, useLibraryStore } from '../../viewmodel/libraryStore'
import { TYPE_REGISTRY } from '@shared/cavity/cavityTypeRegistry'
import type { Geometry } from '@shared/cavity/types'
import { SectionView } from './konva/SectionView'
import { FaceView } from './konva/FaceView'

const SCALE_MIN = 0.05
const SCALE_MAX = 200
const clampK = (k: number) => Math.min(SCALE_MAX, Math.max(SCALE_MIN, k))
/** fit 时四周保底留白(python px)，防止几何贴边/被裁 */
const CHROME_M = 48

type LocalSel = { kind: 'band'; i: number } | { kind: 'hole'; i: number } | null

export function CavityPreview() {
  _useLocale()
  const doc = useLibraryStore((s) => s.doc)
  const selection = useLibraryStore((s) => s.selection)
  const libCacheVersion = useLibraryStore((s) => s.libCacheVersion)
  const selectedStepIndex = useLibraryStore((s) => s.selectedStepIndex)
  const setSelectedStepIndex = useLibraryStore((s) => s.setSelectedStepIndex)
  const selectedPortIndex = useLibraryStore((s) => s.selectedPortIndex)
  const setSelectedPortIndex = useLibraryStore((s) => s.setSelectedPortIndex)
  const selectedHoleIndex = useLibraryStore((s) => s.selectedHoleIndex)
  const setSelectedHoleIndex = useLibraryStore((s) => s.setSelectedHoleIndex)
  const template = findTemplate(doc, selection.templateId)
  const isCombo = template ? TYPE_REGISTRY[template.cavityType].isCombo : false

  const hostRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const colors = useMemo(() => palette(), [])

  // 两种模型
  const section: SectionModel | null = useMemo(() => {
    if (isCombo || !template) return null
    return buildSection(template.geometry)
  }, [template, isCombo])

  const face: FaceModel | null = useMemo(() => {
    if (!isCombo || !template) return null
    return buildFaceLayout(template, {
      currentLib: doc,
      loadedLibs: getLoadedLibs(),
      parentUnit: template.unit ?? 'mm'
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [template, isCombo, doc, libCacheVersion])

  // 组合孔每个子孔已解析几何（panel/剖面用）
  const geoOfHole = useMemo(() => {
    if (!isCombo) return null
    // 优先使用 face.holes 已解析的 geometry
    if (face?.holes && face.holes.length > 0) {
      return face.holes.map((h) => h.geometry ?? null)
    }
    // 备用：从 template.holes 解析
    if (template?.holes) {
      const arr: (Geometry | null)[] = template.holes.map((h) => {
        const r = resolveHole(h, {
          currentLib: doc,
          loadedLibs: getLoadedLibs(),
          parentUnit: template.unit ?? 'mm'
        })
        return r.ok ? r.geometry : null
      })
      return arr
    }
    return null
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCombo, face, template, doc, libCacheVersion])

  // 视口
  const [vp, setVp] = useState<Viewport>({ k: 1, tx: 0, ty: 0 })
  const vpRef = useRef<Viewport>(vp)
  const drag = useRef<{ sx: number; sy: number; tx: number; ty: number; moved: boolean; bg: boolean } | null>(null)
  const selRef = useRef<LocalSel>(null)

  const setView = (v: Viewport) => {
    vpRef.current = v
    setVp(v)
  }

  const applyFit = (w = size.w, h = size.h, targetSel: LocalSel = selRef.current) => {
    if (section) {
      // 竖向剖面：以剖面水平跨距(含两侧尺寸线与侧油口引出标注)与总深组成的包围盒按合适比例放
      const hasPorts = (section.ports ?? []).length > 0
      const diaX = Math.max(section.maxRadius || 1, 1) * (hasPorts ? 3.4 : 2.6)
      const depthY = Math.max(section.totalDepth, 1) * 1.35
      const k = Math.min((w - CHROME_M) / diaX, (h - CHROME_M) / depthY)
      // 令剖面在剩余面积垂直居中
      const depthPx = depthY * k
      setView({ k: clampK(Number.isFinite(k) ? k : 1), tx: w / 2, ty: (h - depthPx) / 2 })
    } else if (face) {
      const fb = face.bounds
      let minX = fb.minX
      let maxX = fb.maxX
      let minY = fb.minY
      let maxY = fb.maxY

      // 若选中子孔且有截面，将下方截面图包围盒纳入视口计算
      const holeIdx = targetSel?.kind === 'hole' ? targetSel.i : selectedHoleIndex
      const hObj = holeIdx != null ? face.holes[holeIdx] : null
      const hGeo = holeIdx != null ? (geoOfHole?.[holeIdx] ?? hObj?.geometry ?? null) : null
      const hSec = hGeo ? buildSection(hGeo) : null

      if (hObj) {
        const gap = 30
        const ySecFace = fb.maxY + gap
        const secR = hSec ? Math.max(hSec.maxRadius, 5) : 10
        const secD = hSec ? Math.max(hSec.totalDepth, 10) : 25
        minX = Math.min(minX, hObj.cx - secR - 25)
        maxX = Math.max(maxX, hObj.cx + secR + 10)
        maxY = Math.max(maxY, ySecFace + secD + 15)
      } else {
        const extent = face.extent
        minX = Math.min(minX, -extent)
        maxX = Math.max(maxX, extent)
        minY = Math.min(minY, -extent)
        maxY = Math.max(maxY, extent)
      }

      const spanX = Math.max(maxX - minX, 1)
      const spanY = Math.max(maxY - minY, 1)
      const k = clampK(Math.min((w - CHROME_M) / spanX, (h - CHROME_M) / spanY))
      const midX = (minX + maxX) / 2
      const midY = (minY + maxY) / 2
      const tx = w / 2 - midX * k
      const ty = h / 2 - midY * k
      setView({ k, tx, ty })
    } else {
      setView({ k: 1, tx: w / 2, ty: h / 2 })
    }
  }

  // 首次挂载与尺寸变化后 fit
  useEffect(() => {
    if (size.w < 20 || size.h < 20) return
    applyFit(size.w, size.h)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size.w, size.h])

  // 模板（含组合/轴向）切换后自动回归适应
  const templateToken = template ? `${template.id}:${isCombo}` : ''
  useEffect(() => {
    if (templateToken && size.w >= 20 && size.h >= 20) applyFit(size.w, size.h)
    setSel(null)
    setSelectedStepIndex(null)
    setSelectedPortIndex(null)
    setSelectedHoleIndex(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templateToken])

  // ResizeObserver 观测面板
  useEffect(() => {
    const el = hostRef.current
    if (!el) return
    const ro = new ResizeObserver((es) => {
      const r = es[0].contentRect
      setSize({ w: Math.round(r.width), h: Math.round(r.height) })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // 原生非 passive 滚轮缩放（锚点）
  useEffect(() => {
    const el = hostRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const rect = el.getBoundingClientRect()
      const mx = e.clientX - rect.left
      const my = e.clientY - rect.top
      const v = vpRef.current
      const factor = zoomFactor(useSettingsStore.getState().values.libraryZoom)
      const k2 = clampK(v.k * (e.deltaY < 0 ? factor : 1 / factor))
      const s = k2 / v.k
      setView({ k: k2, tx: mx - (mx - v.tx) * s, ty: my - (my - v.ty) * s })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  const setSel = (s: LocalSel) => {
    selRef.current = s
  }

  const onSelectHole = (i: number) => {
    const next = selectedHoleIndex === i ? null : i
    setSelectedHoleIndex(next)
    setSel(next != null ? { kind: 'hole', i: next } : null)
  }

  // 平移 / 空白点清
  const onDown = (ev: Konva.KonvaEventObject<MouseEvent>) => {
    if (ev.evt.button !== 0) return
    const st = ev.target.getStage()
    if (!st) return
    const p = st.getPointerPosition()
    if (!p) return
    // 空白：目标即 Stage
    const bg = ev.target === st
    drag.current = { sx: p.x, sy: p.y, tx: vpRef.current.tx, ty: vpRef.current.ty, moved: false, bg }
  }
  const onMove = (ev: Konva.KonvaEventObject<TouchEvent | MouseEvent>) => {
    const d = drag.current
    const st = ev.target.getStage()
    if (!d || !st) return
    const p = st.getPointerPosition()
    if (!p) return
    const dx = p.x - d.sx
    const dy = p.y - d.sy
    if (Math.hypot(dx, dy) > 3) {
      d.moved = true
      setView({ ...vpRef.current, tx: d.tx + dx, ty: d.ty + dy })
    }
  }
  const onUp = (ev: Konva.KonvaEventObject<TouchEvent | MouseEvent>) => {
    const d = drag.current
    drag.current = null
    const st = ev.target.getStage()
    if (d && !d.moved && d.bg && st && ev.target === st) {
      setSel(null)
      setSelectedStepIndex(null)
      setSelectedPortIndex(null)
      setSelectedHoleIndex(null)
    }
  }

  const isEmpty = !template || !doc

  return (
    <div
      className="relative flex min-h-0 w-full flex-1 flex-col items-stretch overflow-hidden bg-background"
      ref={hostRef}
    >
      {isEmpty ? (
        <div className="flex min-h-0 flex-1 items-center justify-center text-xs text-muted-foreground">
          {_t("在左侧选择孔腔后在此预览")}</div>
      ) : (
        <Stage
          width={size.w}
          height={size.h}
          pixelRatio={Math.min(window.devicePixelRatio || 1, 2)}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
        >
          <Layer listening>
            <Group x={vp.tx} y={vp.ty} scaleX={vp.k} scaleY={vp.k}>
              {isCombo ? (
                face && (
                  <FaceView
                    model={face}
                    geos={geoOfHole}
                    selected={selectedHoleIndex}
                    onSelect={onSelectHole}
                    selectedBand={selectedStepIndex}
                    onSelectBand={(i) => {
                      const next = selectedStepIndex === i ? null : i
                      setSelectedStepIndex(next)
                      setSel(next != null ? { kind: 'band', i: next } : null)
                    }}
                    selectedPortIndex={selectedPortIndex}
                    onSelectPort={(i) => {
                      const next = selectedPortIndex === i ? null : i
                      setSelectedPortIndex(next)
                    }}
                    vp={vp}
                    colors={colors}
                  />
                )
              ) : (
                section && (
                  <SectionView
                    sec={section}
                    selectedBand={selectedStepIndex}
                    onSelectBand={(i) => {
                      const next = selectedStepIndex === i ? null : i
                      setSelectedStepIndex(next)
                      setSel(next != null ? { kind: 'band', i: next } : null)
                    }}
                    selectedPortIndex={selectedPortIndex}
                    onSelectPort={(i) => {
                      const next = selectedPortIndex === i ? null : i
                      setSelectedPortIndex(next)
                    }}
                    vp={vp}
                    colors={colors}
                  />
                )
              )}
            </Group>
          </Layer>
        </Stage>
      )}

      {isEmpty ? null : (
        <>
          {/* 提示 */}
          <div className="pointer-events-none absolute left-2 top-2 flex items-center gap-1.5 rounded-md border border-border/40 bg-background/85 px-2 py-0.5 text-[10px] text-muted-foreground shadow-xs backdrop-blur">
            <span>{isCombo ? _t("安装面 · 滚轮缩放 · 拖拽平移 · 点子孔看尺寸") : _t("轴向剖面 · 滚轮缩放 · 拖拽平移 · 点台阶看尺寸")}</span>
            <span className="rounded bg-muted px-1 py-0.5 font-mono text-[9px] font-bold tracking-wider text-foreground/85 uppercase">
              {template?.unit ?? 'mm'}
            </span>
          </div>

          <div className="absolute right-2 top-2">
            <Button
              size="icon-sm"
              variant="outline"
              className="size-6 bg-background/80"
              title={_t("适应视图")}
              onClick={() => applyFit()}
            >
              <Maximize2 className="size-3" />
            </Button>
          </div>
        </>
      )}
    </div>
  )
}
