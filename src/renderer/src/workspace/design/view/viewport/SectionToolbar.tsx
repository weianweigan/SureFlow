import { useLocale as _useLocale } from '@renderer/i18n/useLocale'
import { t as _t } from '@shared/i18n'
import { type FC, useEffect } from 'react'
import { Scissors, ArrowLeftRight, X, RotateCcw } from 'lucide-react'
import { useDesignStore, type SectionConfig } from '../../model/designStore'
import { cn } from '@renderer/lib/utils'

interface SectionToolbarProps {
  projectId: string
  dimensions: [number, number, number]
}

/**
 * 视口悬浮剖切控制面板 (Sectioning Tool Toolbar)
 * 严格对齐 PRD-FR-04-06 §1.1 规范：
 * [ 剖切视图: 开启 ] | 截面: (• X轴  ○ Y轴  ○ Z轴) | 偏移: [====●========] +15.5mm | [ ⇄ 翻转法向 ] | [ ✕ 退出 ]
 */
export const SectionToolbar: FC<SectionToolbarProps> = ({ projectId, dimensions }) => {
  _useLocale()
  const session = useDesignStore((s) => s.projects[projectId])
  const setSectionConfig = useDesignStore((s) => s.setSectionConfig)
  const toggleSection = useDesignStore((s) => s.toggleSection)

  const sectionConfig: SectionConfig = session?.sectionConfig || {
    enabled: false,
    axis: 'x',
    offset: 0,
    flipped: false
  }

  const [sx, sy, sz] = dimensions
  const axis = sectionConfig.axis
  const maxRange = (axis === 'x' ? sx : axis === 'y' ? sy : sz) / 2

  // 键盘左/右方向键微调（步进 1.0mm）
  useEffect(() => {
    if (!sectionConfig.enabled) return

    const handleKeyDown = (e: KeyboardEvent) => {
      // 避免输入框冲突
      if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName)) return

      if (e.key === 'ArrowLeft') {
        e.preventDefault()
        const next = Math.max(-maxRange, Math.round((sectionConfig.offset - 1.0) * 10) / 10)
        setSectionConfig(projectId, { offset: next })
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        const next = Math.min(maxRange, Math.round((sectionConfig.offset + 1.0) * 10) / 10)
        setSectionConfig(projectId, { offset: next })
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [sectionConfig.enabled, sectionConfig.offset, maxRange, projectId, setSectionConfig])

  if (!sectionConfig.enabled) return null

  const handleAxisChange = (newAxis: 'x' | 'y' | 'z') => {
    setSectionConfig(projectId, { axis: newAxis, offset: 0 })
  }

  const handleOffsetChange = (val: number) => {
    setSectionConfig(projectId, { offset: Math.round(val * 10) / 10 })
  }

  const handleFlip = () => {
    setSectionConfig(projectId, { flipped: !sectionConfig.flipped })
  }

  const handleReset = () => {
    setSectionConfig(projectId, { offset: 0 })
  }

  return (
    <div className="absolute top-3 left-1/2 -translate-x-1/2 z-20 flex items-center gap-3 rounded-xl bg-slate-900/90 px-3.5 py-2 text-xs text-white shadow-2xl backdrop-blur-md border border-slate-700/70 select-none animate-in fade-in slide-in-from-top-2 duration-150">
      {/* 状态标识 */}
      <div className="flex items-center gap-1.5 pr-2 border-r border-slate-700/80">
        <span className="relative flex size-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
          <span className="relative inline-flex rounded-full size-2 bg-emerald-500" />
        </span>
        <Scissors className="size-3.5 text-emerald-400" />
        <span className="font-semibold text-slate-100 text-[11px] whitespace-nowrap">{_t("剖切视图")}</span>
      </div>

      {/* 截面轴向选择 */}
      <div className="flex items-center gap-1 pr-2 border-r border-slate-700/80">
        <span className="text-slate-400 text-[11px] mr-1">{_t("截面:")}</span>
        {(['x', 'y', 'z'] as const).map((a) => (
          <button
            key={a}
            type="button"
            onClick={() => handleAxisChange(a)}
            className={cn(
              'px-2 py-0.5 rounded font-mono text-[11px] transition-colors cursor-pointer',
              axis === a
                ? 'bg-blue-600 text-white font-semibold shadow-xs'
                : 'text-slate-300 hover:bg-slate-800 hover:text-white'
            )}
          >
            {a.toUpperCase()}{_t("轴")}</button>
        ))}
      </div>

      {/* 偏移量滑块与读数 */}
      <div className="flex items-center gap-2 pr-2 border-r border-slate-700/80">
        <span className="text-slate-400 text-[11px]">{_t("偏移:")}</span>
        <input
          type="range"
          min={-maxRange}
          max={maxRange}
          step={0.5}
          value={sectionConfig.offset}
          onChange={(e) => handleOffsetChange(parseFloat(e.target.value))}
          className="w-28 h-1.5 appearance-none rounded-full bg-slate-700 accent-blue-500 cursor-pointer"
        />
        <span
          title={_t("双击重置为 0mm")}
          onDoubleClick={handleReset}
          className="w-16 font-mono text-[11px] text-right text-emerald-400 font-semibold cursor-pointer hover:underline"
        >
          {sectionConfig.offset >= 0 ? `+${sectionConfig.offset.toFixed(1)}` : sectionConfig.offset.toFixed(1)}mm
        </span>
        <button
          type="button"
          title={_t("重置居中 (0mm)")}
          onClick={handleReset}
          className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-white transition-colors cursor-pointer"
        >
          <RotateCcw className="size-3" />
        </button>
      </div>

      {/* 法向翻转按钮 */}
      <button
        type="button"
        title={_t("截面法向瞬间反转 180°")}
        onClick={handleFlip}
        className={cn(
          'flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium transition-colors cursor-pointer',
          sectionConfig.flipped
            ? 'bg-amber-600/30 text-amber-300 border border-amber-500/40'
            : 'text-slate-300 hover:bg-slate-800 hover:text-white'
        )}
      >
        <ArrowLeftRight className="size-3" />
        <span>{_t("翻转法向")}</span>
      </button>

      {/* 退出按钮 */}
      <button
        type="button"
        title={_t("关闭剖切视图 (Alt+S)")}
        onClick={() => toggleSection(projectId)}
        className="p-1 rounded-full text-slate-400 hover:bg-rose-500/20 hover:text-rose-400 transition-colors cursor-pointer"
      >
        <X className="size-3.5" />
      </button>
    </div>
  )
}
