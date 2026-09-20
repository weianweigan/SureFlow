/**
 * 视口主动间隙分析面板 (ActiveClearanceBar)
 * 严格对齐 PRD-FR-04-15 §9 与 SureFlow Design.md 设计规范
 *
 * 特性：
 * 1. 停靠在视口左上角，元素全部纵向排列
 * 2. 统一 SureFlow 黑白编辑风与单色卡片样式，无突兀异质风格
 * 3. 头部支持按住自由拖拽位置，右下角提供工业级缩放角标
 * 4. 纵向实体选择框，直观展示已加入间隙分析的对象列表
 * 5. 多组分析结果纵向卡片呈现，支持清晰查看两两最小净距
 */

import React, { useEffect, useRef, useState, useMemo } from 'react'
import {
  Ruler,
  RefreshCw,
  X,
  CircleDot,
  Layers,
  RotateCcw,
  Trash2
} from 'lucide-react'
import { useAnalysisStore } from '../../model/analysisStore'
import { useDesignStore } from '../../model/designStore'
import { analysisBridge } from '../../worker/analysis/analysisWorkerBridge'
import type { EntityRef } from '@shared/design/analysis/contracts'
import { getFacesForTemplate, type BaseFaceDefinition } from '@shared/design/types'

interface ActiveClearanceBarProps {
  projectId: string
}

export const ActiveClearanceBar: React.FC<ActiveClearanceBarProps> = ({ projectId }) => {
  const isOpen = useAnalysisStore((s) => s.isActiveClearanceOpen)
  const clearanceObjects = useAnalysisStore((s) => s.clearanceObjects)
  const activeClearanceResults = useAnalysisStore((s) => s.activeClearanceResults)
  const isMeasuring = useAnalysisStore((s) => s.isMeasuring)
  const resetActiveClearance = useAnalysisStore((s) => s.resetActiveClearance)
  const resetBadgeOffsets = useAnalysisStore((s) => s.resetBadgeOffsets)
  const setActiveClearanceOpen = useAnalysisStore((s) => s.setActiveClearanceOpen)
  const removeClearanceObject = useAnalysisStore((s) => s.removeClearanceObject)

  const session = useDesignStore((s) => s.projects[projectId])
  const doc = session?.doc
  const baseBody = doc?.baseBody
  const activeScheme = doc?.schemes.find((s) => s.id === doc.activeSchemeId) || doc?.schemes[0]

  // 浮窗位置与尺寸（支持自由拖拽与缩放）
  const [pos, setPos] = useState<{ x: number; y: number }>({ x: 16, y: 56 })
  const [size, setSize] = useState<{ width: number; height: number }>({ width: 280, height: 400 })

  const dragRef = useRef<{
    isDragging: boolean
    startX: number
    startY: number
    initX: number
    initY: number
  }>({
    isDragging: false,
    startX: 0,
    startY: 0,
    initX: 16,
    initY: 56
  })

  const resizeRef = useRef<{
    isResizing: boolean
    startX: number
    startY: number
    initW: number
    initH: number
  }>({
    isResizing: false,
    startX: 0,
    startY: 0,
    initW: 280,
    initH: 400
  })

  // 全局鼠标拖拽与缩放监听
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (dragRef.current.isDragging) {
        const dx = e.clientX - dragRef.current.startX
        const dy = e.clientY - dragRef.current.startY
        const nextX = Math.max(8, Math.min(window.innerWidth - size.width - 8, dragRef.current.initX + dx))
        const nextY = Math.max(8, Math.min(window.innerHeight - size.height - 8, dragRef.current.initY + dy))
        setPos({ x: nextX, y: nextY })
      }
      if (resizeRef.current.isResizing) {
        const dx = e.clientX - resizeRef.current.startX
        const dy = e.clientY - resizeRef.current.startY
        const nextW = Math.max(240, Math.min(600, resizeRef.current.initW + dx))
        const nextH = Math.max(260, Math.min(800, resizeRef.current.initH + dy))
        setSize({ width: nextW, height: nextH })
      }
    }

    const handleMouseUp = () => {
      dragRef.current.isDragging = false
      resizeRef.current.isResizing = false
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [size.width, size.height])

  // Esc 退出
  useEffect(() => {
    if (!isOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setActiveClearanceOpen(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isOpen, setActiveClearanceOpen])

  // 实体名称映射
  const allFaces: BaseFaceDefinition[] = useMemo(() => {
    if (!doc?.baseBody) return []
    return (
      doc.baseBody.faces ||
      getFacesForTemplate(doc.baseBody.template, doc.baseBody.dimensions, doc.baseBody.extraParams)
    )
  }, [doc?.baseBody])

  const getEntityName = (ref: EntityRef): string => {
    if (ref.kind === 'cavity') {
      const cav = activeScheme?.cavities?.find((c) => c.instanceId === ref.instanceId)
      return cav?.subHoleName || cav?.name || `孔 ${ref.instanceId.slice(0, 6)}`
    }
    if (ref.kind === 'base-face') {
      const face = allFaces.find((f) => f.id === ref.faceId)
      return face?.name || `面 ${ref.faceId}`
    }
    return '未知对象'
  }

  if (!isOpen) return null

  const relationLabels: Record<string, { label: string; color: string }> = {
    separated: { label: '分离', color: 'text-emerald-600 dark:text-emerald-400' },
    contacting: { label: '接触 (0 mm)', color: 'text-primary font-medium' },
    intersecting: { label: '相交', color: 'text-destructive font-semibold' },
    containing: { label: '完全包含', color: 'text-destructive font-semibold' }
  }

  const minClearanceResult =
    activeClearanceResults.length > 0
      ? activeClearanceResults.reduce((min, curr) => (curr.dist < min.dist ? curr : min))
      : null

  const handleHeaderMouseDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button')) return
    dragRef.current = {
      isDragging: true,
      startX: e.clientX,
      startY: e.clientY,
      initX: pos.x,
      initY: pos.y
    }
  }

  const handleResizeMouseDown = (e: React.MouseEvent) => {
    e.stopPropagation()
    resizeRef.current = {
      isResizing: true,
      startX: e.clientX,
      startY: e.clientY,
      initW: size.width,
      initH: size.height
    }
  }

  return (
    <div
      style={{
        position: 'absolute',
        left: pos.x,
        top: pos.y,
        width: size.width,
        height: size.height
      }}
      className="z-40 flex flex-col bg-background/95 backdrop-blur-md border border-border shadow-2xl rounded-xl text-xs select-none overflow-hidden animate-in fade-in zoom-in-95 duration-150"
    >
      {/* 头部标题栏（统一风格：标准标题与图标，支持按住拖动位置） */}
      <div
        onMouseDown={handleHeaderMouseDown}
        className="px-3.5 py-2.5 border-b border-border bg-muted/30 flex items-center justify-between cursor-move shrink-0"
      >
        <div className="flex items-center gap-2 font-semibold text-foreground text-xs">
          <Ruler className="size-3.5 text-primary" />
          <span>间隙分析</span>
        </div>

        {/* 右侧工具操作 */}
        <div className="flex items-center gap-1">
          {clearanceObjects.length >= 2 && (
            <button
              type="button"
              onClick={() => {
                if (clearanceObjects.length >= 2 && baseBody) {
                  useAnalysisStore.getState().setMeasuring(true)
                  analysisBridge.measureClearance(clearanceObjects, {
                    dimensions: baseBody.dimensions || [100, 100, 100],
                    baseBody,
                    cavities: activeScheme?.cavities || []
                  })
                }
              }}
              title="重新高精度计算间隙"
              className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors cursor-pointer"
            >
              <RefreshCw className={`size-3.5 ${isMeasuring ? 'animate-spin text-primary' : ''}`} />
            </button>
          )}
          <button
            type="button"
            onClick={resetBadgeOffsets}
            title="重置视口引线标签位置"
            className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors cursor-pointer"
          >
            <RotateCcw className="size-3.5" />
          </button>
          <button
            type="button"
            onClick={resetActiveClearance}
            title="清空选择对象"
            className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors cursor-pointer"
          >
            <Trash2 className="size-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setActiveClearanceOpen(false)}
            title="关闭面板 (Esc)"
            className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors cursor-pointer ml-1"
          >
            <X className="size-3.5" />
          </button>
        </div>
      </div>

      {/* 属性页主体内容：竖向排列 */}
      <div className="flex-1 overflow-y-auto p-3.5 space-y-3.5">
        {/* 1. 实体选择列表框 */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-[11px] font-medium text-foreground">
            <span>选择的实体</span>
            <span className="font-mono text-[10px] text-muted-foreground">
              共 {clearanceObjects.length} 个对象
            </span>
          </div>

          <div className="border border-border rounded-lg bg-muted/30 p-1.5 min-h-[90px] max-h-[140px] overflow-y-auto space-y-1">
            {clearanceObjects.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-20 text-[11px] text-muted-foreground text-center px-2 space-y-1">
                <CircleDot className="size-4 text-muted-foreground/60" />
                <span>在 3D 视口中单击选择孔腔或表面</span>
              </div>
            ) : (
              clearanceObjects.map((ref) => {
                const isCavity = ref.kind === 'cavity'
                const name = getEntityName(ref)
                const key =
                  ref.kind === 'cavity'
                    ? `cav-${ref.instanceId}`
                    : ref.kind === 'base-face'
                      ? `face-${ref.faceId}`
                      : `item-${name}`

                return (
                  <div
                    key={key}
                    className="flex items-center justify-between px-2 py-1.5 rounded bg-background border border-border text-[11px] group transition-colors"
                  >
                    <div className="flex items-center gap-1.5 truncate">
                      {isCavity ? (
                        <CircleDot className="size-3 text-primary shrink-0" />
                      ) : (
                        <Layers className="size-3 text-primary shrink-0" />
                      )}
                      <span className="truncate font-medium text-foreground" title={name}>
                        {name}
                      </span>
                      <span className="text-[10px] text-muted-foreground shrink-0 font-mono">
                        ({isCavity ? '孔腔' : '表面'})
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeClearanceObject(ref)}
                      className="opacity-60 hover:opacity-100 hover:text-destructive p-0.5 rounded transition-all cursor-pointer"
                      title="移除此对象"
                    >
                      <X className="size-3" />
                    </button>
                  </div>
                )
              })
            )}
          </div>
        </div>

        {/* 2. 测量状态与计算结果 */}
        {clearanceObjects.length < 2 ? (
          <div className="p-2.5 rounded-lg border border-border bg-muted/20 text-muted-foreground text-[11px] flex items-center gap-2">
            <CircleDot className="size-3.5 text-muted-foreground shrink-0" />
            <span>
              {clearanceObjects.length === 0
                ? '请选择至少 2 个对象以开始计算间隙'
                : '已选 1 个对象，请继续选择第 2 个对象'}
            </span>
          </div>
        ) : isMeasuring ? (
          <div className="p-2.5 rounded-lg border border-border bg-muted/20 text-muted-foreground text-[11px] flex items-center gap-2 animate-pulse">
            <RefreshCw className="size-3.5 animate-spin shrink-0 text-primary" />
            <span>正在高精度计算各实体间净距...</span>
          </div>
        ) : minClearanceResult ? (
          <div className="space-y-3">
            {/* 最小净距卡片 */}
            <div className="p-3 rounded-lg border border-border bg-muted/30 space-y-1">
              <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                <span>最小净距</span>
                <span className={`font-medium ${relationLabels[minClearanceResult.relation]?.color || 'text-foreground'}`}>
                  {relationLabels[minClearanceResult.relation]?.label || minClearanceResult.relation}
                </span>
              </div>
              <div className="flex items-baseline gap-1 py-0.5">
                <span className="font-mono text-2xl font-bold text-foreground">
                  {minClearanceResult.dist.toFixed(2)}
                </span>
                <span className="text-xs text-muted-foreground">mm</span>
              </div>
              <div className="text-[11px] text-muted-foreground truncate pt-1 border-t border-border">
                {minClearanceResult.objectAName || getEntityName(minClearanceResult.objectA)} ↔{' '}
                {minClearanceResult.objectBName || getEntityName(minClearanceResult.objectB)}
              </div>
            </div>

            {/* 多组间隙明细清单（竖向滚动列表） */}
            {activeClearanceResults.length > 1 && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-[11px] font-medium text-foreground">
                  <span>各组间隙清单</span>
                  <span className="font-mono text-[10px] text-muted-foreground">
                    共 {activeClearanceResults.length} 组
                  </span>
                </div>
                <div className="space-y-1 max-h-36 overflow-y-auto pr-0.5">
                  {activeClearanceResults.map((r, idx) => {
                    const nameA = r.objectAName || getEntityName(r.objectA)
                    const nameB = r.objectBName || getEntityName(r.objectB)
                    return (
                      <div
                        key={idx}
                        className="flex items-center justify-between p-2 rounded bg-muted/30 hover:bg-muted/60 text-[11px] border border-border transition-colors"
                      >
                        <div className="truncate max-w-[130px]" title={`${nameA} ↔ ${nameB}`}>
                          <span className="font-medium text-foreground">{nameA}</span>
                          <span className="text-muted-foreground mx-1">↔</span>
                          <span className="font-medium text-foreground">{nameB}</span>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0 font-mono">
                          <span className="font-bold text-foreground">{r.dist.toFixed(2)} mm</span>
                          <span className={`text-[10px] ${relationLabels[r.relation]?.color || 'text-muted-foreground'}`}>
                            ({relationLabels[r.relation]?.label || r.relation})
                          </span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="p-2.5 rounded-lg border border-border bg-muted/20 text-muted-foreground text-[11px]">
            等待测量结果...
          </div>
        )}
      </div>

      {/* 底部信息与右下角缩放手柄 */}
      <div className="px-3.5 py-2 border-t border-border bg-muted/20 flex items-center justify-between text-[11px] text-muted-foreground shrink-0 relative">
        <span>按 Esc 键可退出</span>

        {/* 右下角缩放手柄 */}
        <div
          onMouseDown={handleResizeMouseDown}
          className="cursor-nwse-resize p-1 -mr-1 -mb-1 text-muted-foreground hover:text-foreground transition-colors"
          title="拖动调整大小"
        >
          <svg className="size-2.5 text-muted-foreground" viewBox="0 0 6 6" fill="currentColor">
            <circle cx="5" cy="5" r="0.8" />
            <circle cx="5" cy="2.5" r="0.8" />
            <circle cx="2.5" cy="5" r="0.8" />
          </svg>
        </div>
      </div>
    </div>
  )
}
