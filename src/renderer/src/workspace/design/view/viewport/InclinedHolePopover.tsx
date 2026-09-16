import { useLocale as _useLocale } from '@renderer/i18n/useLocale'
import { t as _t, msg as _msg } from '@shared/i18n'
import { type FC, useMemo } from 'react'
import { X, RotateCcw, Compass, ArrowUpRight, Gauge } from 'lucide-react'
import { useDesignStore } from '../../model/designStore'
import { useLibraryStore } from '../../../library/viewmodel/libraryStore'
import { getCavitySteps } from '../../geometry/cavityProfileBuilder'
import type { Step } from '@shared/cavity/types'

interface InclinedHolePopoverProps {
  projectId: string
  cavityId: string
  onClose: () => void
}

const TILT_PRESETS = [0, 15, 30, 45, 60]
const AZIMUTH_PRESETS = [
  { label: '0° (+X)', val: 0 },
  { label: '90° (+Y)', val: 90 },
  { label: '180° (-X)', val: 180 },
  { label: '270° (-Y)', val: 270 }
]

export const InclinedHolePopover: FC<InclinedHolePopoverProps> = ({
  projectId,
  cavityId,
  onClose
}) => {
  _useLocale()
  const session = useDesignStore((s) => s.projects[projectId])
  const updateCavity = useDesignStore((s) => s.updateCavity)
  const libraryDoc = useLibraryStore((s) => s.doc)

  const activeScheme = useMemo(() => {
    if (!session?.doc) return null
    return (
      session.doc.schemes.find((s) => s.id === session.doc.activeSchemeId) ||
      session.doc.schemes[0]
    )
  }, [session?.doc])

  const cavity = useMemo(() => {
    if (!activeScheme) return null
    return activeScheme.cavities.find((c) => c.instanceId === cavityId) || null
  }, [activeScheme, cavityId])

  const cavitySteps = useMemo<Step[]>(() => {
    if (!cavity) return []
    return cavity.steps && cavity.steps.length > 0
      ? cavity.steps
      : getCavitySteps(cavity, libraryDoc)
  }, [cavity, libraryDoc])

  const bottomStepIndex = useMemo(() => {
    if (!cavitySteps || cavitySteps.length === 0) return -1
    for (let i = cavitySteps.length - 1; i >= 0; i--) {
      if (cavitySteps[i].type !== 'tapered') {
        return i
      }
    }
    return 0
  }, [cavitySteps])

  if (!cavity) return null

  const currentTilt = cavity.tiltAngle ?? 0
  const currentAzimuth = cavity.azimuth ?? cavity.rotation ?? 0
  const currentBottomDepth =
    bottomStepIndex >= 0 && bottomStepIndex < cavitySteps.length
      ? cavitySteps[bottomStepIndex]?.length ?? 20
      : 20

  const handleTiltChange = (val: number) => {
    const clamped = Math.max(0, Math.min(60, Math.round(val * 10) / 10))
    updateCavity(projectId, cavity.instanceId, { tiltAngle: clamped })
  }

  const handleAzimuthChange = (val: number) => {
    const normalized = ((Math.round(val) % 360) + 360) % 360
    updateCavity(projectId, cavity.instanceId, {
      azimuth: normalized,
      rotation: normalized
    })
  }

  const handleDepthChange = (val: number) => {
    const clamped = Math.max(2.0, Math.round(val * 10) / 10)
    if (bottomStepIndex >= 0 && bottomStepIndex < cavitySteps.length) {
      const newSteps: Step[] = cavitySteps.map((s, idx) => {
        if (idx === bottomStepIndex) {
          return { ...s, length: clamped }
        }
        return { ...s }
      })
      updateCavity(projectId, cavity.instanceId, { steps: newSteps })
    }
  }

  const handleResetToStraight = () => {
    updateCavity(projectId, cavity.instanceId, { tiltAngle: 0 })
  }

  return (
    <div
      data-html-gizmo="true"
      onPointerDown={(e) => e.stopPropagation()}
      onPointerUp={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      className="absolute top-14 right-4 z-40 w-80 rounded-lg border border-amber-500/40 bg-slate-900/95 p-3.5 shadow-2xl backdrop-blur-md text-slate-100 select-none animate-in fade-in zoom-in-95 duration-150 font-sans"
    >
      {/* ── 标题栏 ── */}
      <div className="flex items-center justify-between border-b border-slate-800 pb-2.5 mb-3">
        <div className="flex items-center gap-2">
          <div className="flex size-6 items-center justify-center rounded bg-amber-500/20 text-amber-400">
            <Compass className="size-3.5" />
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-bold text-slate-100">{_t("斜孔精细化定位")}</span>
              <span className="rounded bg-amber-500/15 px-1.5 py-0.2 text-[10px] font-mono font-semibold text-amber-400 border border-amber-500/30">
                {currentTilt > 0 ? _msg`${currentTilt.toFixed(1)}° 斜孔` : _t("直孔")}
              </span>
            </div>
            <div className="text-[10px] text-slate-400 font-mono truncate max-w-[160px]">
              {cavity.name} ({cavity.faceId}{_t("面)")}</div>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {currentTilt > 0 && (
            <button
              type="button"
              title={_t("一键将倾角重置为 0°（恢复垂直直孔）")}
              onClick={handleResetToStraight}
              className="flex items-center gap-1 px-1.5 py-1 rounded text-[10px] text-slate-400 hover:text-amber-300 hover:bg-slate-800 transition-colors cursor-pointer"
            >
              <RotateCcw className="size-3" />
              <span>{_t("恢复直孔")}</span>
            </button>
          )}
          <button
            type="button"
            title={_t("关闭面板")}
            onClick={onClose}
            className="flex size-6 items-center justify-center rounded text-slate-400 hover:bg-slate-800 hover:text-slate-100 transition-colors cursor-pointer"
          >
            <X className="size-3.5" />
          </button>
        </div>
      </div>

      <div className="space-y-3.5">
        {/* ── 参数 1: 倾斜角 Tilt (0° ~ 60°) ── */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs">
            <span className="flex items-center gap-1 text-slate-300 font-medium">
              <ArrowUpRight className="size-3 text-amber-400" />
              <span>{_t("倾斜夹角 (Tilt)")}</span>
            </span>
            <div className="flex items-center gap-1">
              <input
                type="number"
                min={0}
                max={60}
                step={0.5}
                value={currentTilt}
                onChange={(e) => handleTiltChange(parseFloat(e.target.value) || 0)}
                className="w-14 rounded border border-slate-700 bg-slate-950 px-1.5 py-0.5 text-right font-mono text-xs text-amber-400 focus:border-amber-400 focus:outline-none"
              />
              <span className="text-xs text-slate-400">°</span>
            </div>
          </div>
          {/* 滑块 */}
          <div className="flex items-center gap-2">
            <input
              type="range"
              min={0}
              max={60}
              step={0.5}
              value={currentTilt}
              onChange={(e) => handleTiltChange(parseFloat(e.target.value))}
              className="h-1.5 flex-1 appearance-none rounded-full bg-slate-800 accent-amber-400 cursor-pointer"
            />
          </div>
          {/* 常用倾角快捷芯片 */}
          <div className="flex items-center gap-1.5 pt-0.5">
            {TILT_PRESETS.map((deg) => {
              const active = Math.abs(currentTilt - deg) < 0.2
              return (
                <button
                  key={deg}
                  type="button"
                  onClick={() => handleTiltChange(deg)}
                  className={`flex-1 py-0.5 rounded text-[10px] font-mono font-medium transition-all cursor-pointer border ${
                    active
                      ? 'bg-amber-500 text-slate-950 border-amber-400 font-bold shadow-xs'
                      : 'bg-slate-800/80 text-slate-300 border-slate-700 hover:bg-slate-800 hover:border-slate-600'
                  }`}
                >
                  {deg === 0 ? _t("直孔") : `${deg}°`}
                </button>
              )
            })}
          </div>
        </div>

        {/* ── 参数 2: 偏斜方位角 Azimuth (0° ~ 360°) ── */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs">
            <span className="flex items-center gap-1 text-slate-300 font-medium">
              <Compass className="size-3 text-amber-400" />
              <span>{_t("偏斜方位角 (Azimuth)")}</span>
            </span>
            <div className="flex items-center gap-1">
              <input
                type="number"
                min={0}
                max={360}
                step={1}
                value={Math.round(currentAzimuth)}
                onChange={(e) => handleAzimuthChange(parseFloat(e.target.value) || 0)}
                className="w-14 rounded border border-slate-700 bg-slate-950 px-1.5 py-0.5 text-right font-mono text-xs text-amber-400 focus:border-amber-400 focus:outline-none"
              />
              <span className="text-xs text-slate-400">°</span>
            </div>
          </div>
          {/* 滑块 */}
          <div className="flex items-center gap-2">
            <input
              type="range"
              min={0}
              max={360}
              step={1}
              value={Math.round(currentAzimuth)}
              onChange={(e) => handleAzimuthChange(parseFloat(e.target.value))}
              className="h-1.5 flex-1 appearance-none rounded-full bg-slate-800 accent-amber-400 cursor-pointer"
            />
          </div>
          {/* 常用正交方位芯片 */}
          <div className="grid grid-cols-4 gap-1.5 pt-0.5">
            {AZIMUTH_PRESETS.map((item) => {
              const active = Math.abs((currentAzimuth % 360) - item.val) < 2
              return (
                <button
                  key={item.val}
                  type="button"
                  onClick={() => handleAzimuthChange(item.val)}
                  className={`py-0.5 rounded text-[10px] font-mono transition-all cursor-pointer border text-center ${
                    active
                      ? 'bg-amber-500 text-slate-950 border-amber-400 font-bold shadow-xs'
                      : 'bg-slate-800/80 text-slate-300 border-slate-700 hover:bg-slate-800 hover:border-slate-600'
                  }`}
                >
                  {_t(item.label)}
                </button>
              )
            })}
          </div>
          {/* 步进微调按钮 */}
          <div className="flex items-center gap-1.5 pt-0.5">
            <button
              type="button"
              onClick={() => handleAzimuthChange(currentAzimuth - 15)}
              className="flex-1 py-1 rounded bg-slate-800/60 hover:bg-slate-800 text-[10px] font-mono text-slate-400 hover:text-slate-100 border border-slate-700 transition-colors cursor-pointer text-center"
            >
              ↺ -15°
            </button>
            <button
              type="button"
              onClick={() => handleAzimuthChange(currentAzimuth + 15)}
              className="flex-1 py-1 rounded bg-slate-800/60 hover:bg-slate-800 text-[10px] font-mono text-slate-400 hover:text-slate-100 border border-slate-700 transition-colors cursor-pointer text-center"
            >
              ↻ +15°
            </button>
          </div>
        </div>

        {/* ── 参数 3: 底孔深度 (mm) ── */}
        <div className="space-y-1.5 border-t border-slate-800/80 pt-2.5">
          <div className="flex items-center justify-between text-xs">
            <span className="flex items-center gap-1 text-slate-300 font-medium">
              <Gauge className="size-3 text-amber-400" />
              <span>{_t("底孔直孔深")}</span>
            </span>
            <div className="flex items-center gap-1">
              <input
                type="number"
                min={2}
                max={150}
                step={0.5}
                value={currentBottomDepth}
                onChange={(e) => handleDepthChange(parseFloat(e.target.value) || 2)}
                className="w-14 rounded border border-slate-700 bg-slate-950 px-1.5 py-0.5 text-right font-mono text-xs text-amber-400 focus:border-amber-400 focus:outline-none"
              />
              <span className="text-xs text-slate-400">mm</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="range"
              min={2}
              max={100}
              step={0.5}
              value={currentBottomDepth}
              onChange={(e) => handleDepthChange(parseFloat(e.target.value))}
              className="h-1.5 flex-1 appearance-none rounded-full bg-slate-800 accent-amber-400 cursor-pointer"
            />
          </div>
        </div>
      </div>
    </div>
  )
}
