import { useLocale as _useLocale } from '@renderer/i18n/useLocale'
import { t as _t } from '@shared/i18n'
import { useState, useRef, useEffect, type FC } from 'react'
import { useThree, useFrame } from '@react-three/fiber'
import { create } from 'zustand'
import {
  Activity,
  X,
  RotateCcw,
  Zap,
  Layers,
  ChevronUp,
  ChevronDown
} from 'lucide-react'
import { cn } from '@renderer/lib/utils'

export interface PerformanceMetrics {
  fps: number
  avgFps: number
  minFps: number
  maxFps: number
  frameTime: number
  frameHistory: number[]
  drawCalls: number
  triangles: number
  points: number
  lines: number
  geometries: number
  textures: number
}

interface PerfState {
  metrics: PerformanceMetrics | null
  csgComputeTime: number | null
  isCsgComputing: boolean
  cavityCount: number
  groupCount: number
  setMetrics: (metrics: PerformanceMetrics) => void
  setCsgTime: (time: number | null) => void
  setIsCsgComputing: (computing: boolean) => void
  setCounts: (cavityCount: number, groupCount: number) => void
  resetStats: () => void
}

/**
 * 独立的性能监控微型 Store：
 * 完全脱离 React Canvas 根组件树，高频更新仅驱动性能面板自身局部渲染，消除测量者效应
 */
export const usePerfStore = create<PerfState>((set) => ({
  metrics: null,
  csgComputeTime: null,
  isCsgComputing: false,
  cavityCount: 0,
  groupCount: 0,
  setMetrics: (metrics) => set({ metrics }),
  setCsgTime: (time) => set({ csgComputeTime: time }),
  setIsCsgComputing: (computing) => set({ isCsgComputing: computing }),
  setCounts: (cavityCount, groupCount) => set({ cavityCount, groupCount }),
  resetStats: () => {
    window.dispatchEvent(new CustomEvent('sureflow:reset-perf-stats'))
  }
}))

interface PerformanceCollectorProps {
  active: boolean
}

/**
 * 挂载于 Canvas 内部的 WebGL 性能采样器：
 * 使用 useFrame 逐帧测量渲染间隔，并读取 gl.info 的各项显存与绘制指标。
 * 采样数据仅写入独立 usePerfStore，零触碰 Canvas 外部的 React 根组件。
 */
export const PerformanceCollector: FC<PerformanceCollectorProps> = ({ active }) => {
  const { gl } = useThree()
  const frameTimesRef = useRef<number[]>([])
  const lastTimeRef = useRef(performance.now())
  const minFpsRef = useRef(999)
  const maxFpsRef = useRef(0)
  const frameCountRef = useRef(0)
  const lastEmitRef = useRef(0)

  // 监听重置事件
  useEffect(() => {
    const handleReset = () => {
      minFpsRef.current = 999
      maxFpsRef.current = 0
      frameCountRef.current = 0
      frameTimesRef.current = []
    }
    window.addEventListener('sureflow:reset-perf-stats', handleReset)
    return () => window.removeEventListener('sureflow:reset-perf-stats', handleReset)
  }, [])

  useFrame((_state, delta) => {
    if (!active) return

    const now = performance.now()
    // 精确获取单帧耗时（毫秒）
    const actualDelta = delta > 0 ? delta * 1000 : now - lastTimeRef.current
    lastTimeRef.current = now

    if (actualDelta > 0 && actualDelta < 500) {
      const currentFps = 1000 / actualDelta
      frameCountRef.current++
      frameTimesRef.current.push(actualDelta)
      if (frameTimesRef.current.length > 30) {
        frameTimesRef.current.shift()
      }

      // 前 10 帧跳过启动波动
      if (frameCountRef.current > 10) {
        if (currentFps < minFpsRef.current) {
          minFpsRef.current = Math.round(currentFps)
        }
        if (currentFps > maxFpsRef.current) {
          maxFpsRef.current = Math.round(currentFps)
        }
      }

      // 节流为每 100ms 向微型 store 写入一次数据，完全不引发 Canvas 重渲染
      if (now - lastEmitRef.current > 100) {
        lastEmitRef.current = now
        const avgDelta =
          frameTimesRef.current.reduce((a, b) => a + b, 0) /
          frameTimesRef.current.length
        const avgFps = Math.round(1000 / avgDelta)

        usePerfStore.getState().setMetrics({
          fps: Math.round(currentFps),
          avgFps,
          minFps: minFpsRef.current === 999 ? Math.round(currentFps) : minFpsRef.current,
          maxFps: maxFpsRef.current || Math.round(currentFps),
          frameTime: Math.round(avgDelta * 10) / 10,
          frameHistory: [...frameTimesRef.current],
          drawCalls: gl.info.render.calls,
          triangles: gl.info.render.triangles,
          points: gl.info.render.points,
          lines: gl.info.render.lines,
          geometries: gl.info.memory.geometries,
          textures: gl.info.memory.textures
        })
      }
    }
  })

  return null
}

interface PerformanceHudProps {
  onClose: () => void
}

/**
 * 悬浮于三维视口之上的 CAD 性能评测 HUD 面板（独立局部渲染，不影响三维视口）
 */
export const PerformanceHud: FC<PerformanceHudProps> = ({ onClose }) => {
  _useLocale()
  const [minimized, setMinimized] = useState(false)

  const metrics = usePerfStore((s) => s.metrics)
  const csgComputeTime = usePerfStore((s) => s.csgComputeTime)
  const isCsgComputing = usePerfStore((s) => s.isCsgComputing)
  const cavityCount = usePerfStore((s) => s.cavityCount)
  const groupCount = usePerfStore((s) => s.groupCount)
  const resetStats = usePerfStore((s) => s.resetStats)

  if (!metrics) return null

  const { fps, avgFps, minFps, maxFps, frameTime, frameHistory, drawCalls, triangles, geometries } = metrics

  // 帧率健康度语义色
  const fpsColor =
    avgFps >= 55
      ? 'text-emerald-500'
      : avgFps >= 30
        ? 'text-amber-500'
        : 'text-destructive'

  const fpsBg =
    avgFps >= 55
      ? 'bg-emerald-500/10 border-emerald-500/30'
      : avgFps >= 30
        ? 'bg-amber-500/10 border-amber-500/30'
        : 'bg-destructive/10 border-destructive/30'

  if (minimized) {
    return (
      <div className="absolute top-3 left-3 z-30 flex items-center gap-2 rounded-lg border border-border/80 bg-background/85 px-2.5 py-1 text-xs shadow-lg backdrop-blur-md">
        <span className={cn('size-2 rounded-full animate-pulse', avgFps >= 50 ? 'bg-emerald-500' : 'bg-amber-500')} />
        <span className={cn('font-mono font-bold', fpsColor)}>{avgFps} FPS</span>
        <span className="text-[10px] text-muted-foreground font-mono">({frameTime}ms)</span>
        <button
          type="button"
          title={_t("展开性能面板")}
          onClick={() => setMinimized(false)}
          className="ml-1 rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <ChevronDown className="size-3.5" />
        </button>
        <button
          type="button"
          title={_t("关闭性能面板")}
          onClick={onClose}
          className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <X className="size-3.5" />
        </button>
      </div>
    )
  }

  return (
    <div className="absolute top-3 left-3 z-30 w-72 rounded-xl border border-border/80 bg-background/90 p-3 shadow-xl backdrop-blur-md select-none text-foreground text-xs pointer-events-auto">
      {/* ── 顶栏：标题与动作 ── */}
      <div className="flex items-center justify-between pb-2 border-b border-border/60">
        <div className="flex items-center gap-1.5 font-medium">
          <Activity className="size-3.5 text-primary" />
          <span className="text-xs font-semibold">{_t("视口渲染性能")}</span>
          <span className={cn('size-1.5 rounded-full', avgFps >= 50 ? 'bg-emerald-500' : 'bg-amber-500')} />
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            title={_t("重置帧率统计")}
            onClick={resetStats}
            className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
          >
            <RotateCcw className="size-3" />
          </button>
          <button
            type="button"
            title={_t("收起为小组件")}
            onClick={() => setMinimized(true)}
            className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
          >
            <ChevronUp className="size-3" />
          </button>
          <button
            type="button"
            title={_t("关闭性能面板")}
            onClick={onClose}
            className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
          >
            <X className="size-3" />
          </button>
        </div>
      </div>

      {/* ── 核心帧率展示 ── */}
      <div className={cn('mt-2.5 flex items-baseline justify-between rounded-lg border p-2.5', fpsBg)}>
        <div>
          <div className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">{_t("实时帧率")}</div>
          <div className="flex items-baseline gap-1 mt-0.5">
            <span className={cn('text-2xl font-bold font-mono tracking-tight', fpsColor)}>
              {fps}
            </span>
            <span className="text-[11px] font-medium text-muted-foreground font-mono">FPS</span>
          </div>
        </div>

        {/* 均值 / 最低 / 最高 */}
        <div className="flex flex-col items-end gap-0.5 text-[10px] font-mono">
          <div className="flex items-center gap-1 text-foreground/70">
            <span className="text-muted-foreground">{_t("均值:")}</span>
            <span className="font-semibold">{avgFps}</span>
          </div>
          <div className="flex items-center gap-1 text-foreground/70">
            <span className="text-muted-foreground">{_t("最低:")}</span>
            <span className="font-semibold">{minFps}</span>
            <span className="text-muted-foreground ml-1">{_t("最高:")}</span>
            <span className="font-semibold">{maxFps}</span>
          </div>
          <div className="text-[9px] text-muted-foreground">
            {_t("单帧耗时:")}<span className="font-medium text-foreground">{frameTime} ms</span>
          </div>
        </div>
      </div>

      {/* ── 实时单帧耗时微图（Sparkline） ── */}
      <div className="mt-2">
        <div className="flex justify-between text-[9px] text-muted-foreground font-mono mb-1">
          <span>{_t("最近 30 帧耗时")}</span>
          <span>{_t("目标 16.6ms (60 FPS)")}</span>
        </div>
        <div className="flex h-8 items-end gap-0.5 rounded bg-muted/40 p-1 border border-border/40">
          {frameHistory.map((val, idx) => {
            const heightPct = Math.min(Math.max((val / 33.3) * 80, 8), 100)
            const isSlow = val > 20
            return (
              <div
                key={idx}
                className={cn(
                  'flex-1 rounded-t-sm transition-all',
                  isSlow ? 'bg-amber-500' : 'bg-primary/70'
                )}
                style={{ height: `${heightPct}%` }}
                title={`${Math.round(val * 10) / 10} ms`}
              />
            )
          })}
        </div>
      </div>

      {/* ── WebGL 渲染管线与 CSG 关键性能指标 ── */}
      <div className="mt-2.5 grid grid-cols-2 gap-1.5 text-[10px]">
        {/* 三角面数 */}
        <div className="rounded-md border border-border/50 bg-muted/20 p-1.5">
          <div className="text-muted-foreground">{_t("渲染三角面")}</div>
          <div className="mt-0.5 font-mono font-semibold text-xs text-foreground">
            {triangles.toLocaleString()}
          </div>
        </div>

        {/* 绘制调用 Draw Calls */}
        <div className="rounded-md border border-border/50 bg-muted/20 p-1.5">
          <div className="text-muted-foreground">Draw Calls</div>
          <div className="mt-0.5 font-mono font-semibold text-xs text-foreground">
            {drawCalls} {_t("次")}</div>
        </div>

        {/* 显存几何体数 */}
        <div className="rounded-md border border-border/50 bg-muted/20 p-1.5">
          <div className="text-muted-foreground">{_t("显存几何体")}</div>
          <div className="mt-0.5 font-mono font-semibold text-xs text-foreground">
            {geometries} {_t("个")}</div>
        </div>

        {/* CSG 运算耗时 */}
        <div className="rounded-md border border-border/50 bg-muted/20 p-1.5">
          <div className="flex items-center justify-between text-muted-foreground">
            <span>{_t("CSG 切削耗时")}</span>
            {isCsgComputing && <span className="size-1.5 rounded-full bg-primary animate-ping" />}
          </div>
          <div className="mt-0.5 font-mono font-semibold text-xs text-foreground">
            {isCsgComputing ? _t("切削中…") : csgComputeTime != null ? `${csgComputeTime} ms` : '—'}
          </div>
        </div>
      </div>

      {/* ── 底栏：孔腔统计与引擎状态 ── */}
      <div className="mt-2 flex items-center justify-between pt-1.5 border-t border-border/50 text-[9px] text-muted-foreground">
        <div className="flex items-center gap-1.5">
          <Layers className="size-3 text-primary/70" />
          <span>{_t("孔腔总数:")}<strong className="text-foreground font-mono">{cavityCount}</strong></span>
          {groupCount > 0 && <span>({groupCount} {_t("组合)")}</span>}
        </div>
        <div className="flex items-center gap-1">
          <Zap className="size-3 text-amber-500" />
          <span>WebGL 2.0</span>
        </div>
      </div>
    </div>
  )
}
