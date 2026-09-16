import { useLocale as _useLocale } from '@renderer/i18n/useLocale'
import { t as _t } from '@shared/i18n'
/**
 * 通用浮动可拖拽与可调整大小弹窗（Floating Draggable & Resizable Popover）
 *
 * 核心特性：
 * 1. Portal 渲染到 document.body，高层级固定展示；
 * 2. 智能对齐：横向支持按 anchorSelector（默认 #cavity-properties-aside）吸附，
 *    纵向对齐 triggerRef，并具备视口边界碰撞保护；
 * 3. 自由拖拽：标头拖拽手柄、双击复位、支持忽略内部交互元素；
 * 4. 自由调整大小（Resize）：支持 4 边缘与 4 角落手动拖动缩放，带有角落网格角标提示及双击复位尺寸；
 * 5. 智能关闭：Escape 键关闭、外部点击关闭（自动排除侧边栏及触发器）。
 */

import React, { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { GripHorizontal, X } from 'lucide-react'
import { cn } from '@renderer/lib/utils'

export interface UseDraggableWindowOptions {
  initialOffset?: { x: number; y: number }
  disabled?: boolean
}

/**
 * 窗口自由拖拽 Hook
 */
export function useDraggableWindow(options?: UseDraggableWindowOptions) {
  const [dragOffset, setDragOffset] = useState(options?.initialOffset ?? { x: 0, y: 0 })
  const [isDragging, setIsDragging] = useState(false)
  const dragStart = useRef({ mouseX: 0, mouseY: 0, initialX: 0, initialY: 0 })

  const handleHeaderMouseDown = (e: React.MouseEvent) => {
    if (options?.disabled) return
    // 忽略输入框、按钮等交互元素
    if ((e.target as HTMLElement).closest('button, input, select, textarea, a, [data-no-drag]')) {
      return
    }
    e.preventDefault()
    setIsDragging(true)
    dragStart.current = {
      mouseX: e.clientX,
      mouseY: e.clientY,
      initialX: dragOffset.x,
      initialY: dragOffset.y
    }

    const onMouseMove = (moveEvent: MouseEvent) => {
      const dx = moveEvent.clientX - dragStart.current.mouseX
      const dy = moveEvent.clientY - dragStart.current.mouseY
      setDragOffset({
        x: dragStart.current.initialX + dx,
        y: dragStart.current.initialY + dy
      })
    }

    const onMouseUp = () => {
      setIsDragging(false)
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }

    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
  }

  const resetDrag = () => {
    setDragOffset({ x: 0, y: 0 })
  }

  return {
    dragOffset,
    setDragOffset,
    isDragging,
    handleHeaderMouseDown,
    resetDrag
  }
}

export type ResizeDirection = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'

export interface UseResizableWindowOptions {
  defaultWidth?: number
  defaultHeight?: number
  minWidth?: number
  minHeight?: number
  maxWidth?: number
  maxHeight?: number
  disabled?: boolean
  dragOffset: { x: number; y: number }
  setDragOffset: React.Dispatch<React.SetStateAction<{ x: number; y: number }>>
}

/**
 * 窗口自由调整大小 Hook
 */
export function useResizableWindow(options: UseResizableWindowOptions) {
  const {
    defaultWidth = 400,
    defaultHeight,
    minWidth = 320,
    minHeight = 240,
    maxWidth = 1400,
    maxHeight = typeof window !== 'undefined' ? window.innerHeight - 32 : 900,
    disabled = false,
    dragOffset,
    setDragOffset
  } = options

  const [size, setSize] = useState<{ width: number; height?: number }>({
    width: defaultWidth,
    height: defaultHeight
  })
  const [isResizing, setIsResizing] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  const handleResizeStart = (e: React.MouseEvent, direction: ResizeDirection) => {
    if (disabled) return
    e.preventDefault()
    e.stopPropagation()
    setIsResizing(true)

    const startX = e.clientX
    const startY = e.clientY
    const startWidth = size.width ?? containerRef.current?.offsetWidth ?? defaultWidth
    const startHeight = size.height ?? containerRef.current?.offsetHeight ?? 400
    const startOffset = { ...dragOffset }

    const onMouseMove = (moveEvent: MouseEvent) => {
      const dx = moveEvent.clientX - startX
      const dy = moveEvent.clientY - startY

      let newWidth = startWidth
      let newHeight = startHeight
      let newOffsetX = startOffset.x
      let newOffsetY = startOffset.y

      // 水平方向尺寸与位移联动
      if (direction.includes('w')) {
        // 左边缘向左拖动（dx < 0）增加宽度，右边缘保持固定（因此 offset.x 不变）
        newWidth = Math.max(minWidth, Math.min(maxWidth, startWidth - dx))
      } else if (direction.includes('e')) {
        // 右边缘向右拖动（dx > 0）增加宽度，左边缘保持固定（因此 offset.x 加上增量）
        const candidateWidth = Math.max(minWidth, Math.min(maxWidth, startWidth + dx))
        const deltaW = candidateWidth - startWidth
        newWidth = candidateWidth
        newOffsetX = startOffset.x + deltaW
      }

      // 垂直方向尺寸与位移联动
      if (direction.includes('n')) {
        // 上边缘向上拖动（dy < 0）增加高度，下边缘保持固定
        const candidateHeight = Math.max(minHeight, Math.min(maxHeight, startHeight - dy))
        const deltaH = candidateHeight - startHeight
        newHeight = candidateHeight
        newOffsetY = startOffset.y - deltaH
      } else if (direction.includes('s')) {
        // 下边缘向下拖动（dy > 0）增加高度，上边缘保持固定
        newHeight = Math.max(minHeight, Math.min(maxHeight, startHeight + dy))
      }

      setSize({ width: newWidth, height: newHeight })
      setDragOffset({ x: newOffsetX, y: newOffsetY })
    }

    const onMouseUp = () => {
      setIsResizing(false)
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
      document.body.style.removeProperty('user-select')
      document.body.style.removeProperty('cursor')
    }

    document.body.style.userSelect = 'none'
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
  }

  const resetSize = () => {
    setSize({ width: defaultWidth, height: defaultHeight })
  }

  return {
    size,
    setSize,
    isResizing,
    handleResizeStart,
    resetSize,
    containerRef
  }
}

export interface FloatingPopoverProps {
  open?: boolean
  onClose?: () => void
  triggerRef?: React.RefObject<HTMLElement | null>
  anchorSelector?: string
  anchorRef?: React.RefObject<HTMLElement | null>
  sideOffset?: number
  ignoreOutsideSelectors?: string[]
  closeOnEsc?: boolean
  zIndex?: number

  // 尺寸与缩放配置
  resizable?: boolean
  defaultWidth?: number
  defaultHeight?: number
  minWidth?: number
  minHeight?: number
  maxWidth?: number
  maxHeight?: number

  // 标头与外观配置
  title?: React.ReactNode
  icon?: React.ReactNode
  headerBadge?: React.ReactNode
  headerExtra?: React.ReactNode
  showCloseButton?: boolean
  footer?: React.ReactNode
  className?: string
  style?: React.CSSProperties
  children: React.ReactNode
}

export function FloatingPopover({
  open = true,
  onClose,
  triggerRef,
  anchorSelector = '#cavity-properties-aside',
  anchorRef,
  sideOffset = 14,
  ignoreOutsideSelectors = ['#cavity-properties-aside', '[data-popover-trigger]'],
  closeOnEsc = true,
  zIndex = 60,
  resizable = true,
  defaultWidth = 400,
  defaultHeight,
  minWidth = 320,
  minHeight = 240,
  maxWidth = 1400,
  maxHeight,
  title,
  icon,
  headerBadge,
  headerExtra,
  showCloseButton = false,
  footer,
  className,
  style,
  children
}: FloatingPopoverProps) {
  _useLocale()
  const [pos, setPos] = useState({ right: 354, top: 56 })
  const rootRef = useRef<HTMLDivElement>(null)
  const { dragOffset, setDragOffset, isDragging, handleHeaderMouseDown, resetDrag } = useDraggableWindow()

  const calculatedMaxHeight = maxHeight ?? (typeof window !== 'undefined' ? window.innerHeight - 32 : 900)

  const {
    size,
    isResizing,
    handleResizeStart,
    resetSize,
    containerRef
  } = useResizableWindow({
    defaultWidth,
    defaultHeight,
    minWidth,
    minHeight,
    maxWidth,
    maxHeight: calculatedMaxHeight,
    disabled: !resizable,
    dragOffset,
    setDragOffset
  })

  // 每次打开重置拖拽位置
  useEffect(() => {
    if (open) {
      resetDrag()
    }
  }, [open])

  // 定位计算与外部事件监听
  useEffect(() => {
    if (!open) return

    const update = () => {
      let right = 354
      const anchorEl =
        anchorRef?.current ||
        (anchorSelector ? (document.querySelector(anchorSelector) as HTMLElement | null) : null)

      if (anchorEl) {
        const rect = anchorEl.getBoundingClientRect()
        right = Math.round(window.innerWidth - rect.left + sideOffset)
      }

      let top = 56
      if (triggerRef?.current) {
        const btnRect = triggerRef.current.getBoundingClientRect()
        const popoverHeight = rootRef.current?.offsetHeight || size.height || 520
        const maxTop = Math.max(16, window.innerHeight - popoverHeight - 16)
        top = Math.max(16, Math.min(Math.round(btnRect.top), maxTop))
      } else if (anchorEl) {
        const rect = anchorEl.getBoundingClientRect()
        top = Math.round(Math.max(50, rect.top + 8))
      }

      setPos({ right, top })
    }

    update()
    const rafId = requestAnimationFrame(update)

    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)

    const anchorEl =
      anchorRef?.current ||
      (anchorSelector ? (document.querySelector(anchorSelector) as HTMLElement | null) : null)
    let observer: ResizeObserver | null = null
    if (anchorEl && typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(update)
      observer.observe(anchorEl)
    }

    const onPointerDown = (e: PointerEvent) => {
      if (!onClose || isResizing) return
      const target = e.target as HTMLElement | null
      if (!target) return
      // 内部点击不关闭
      if (rootRef.current?.contains(target)) return
      // 触发器点击不在此关闭（由触发器自身处理切换）
      if (triggerRef?.current?.contains(target)) return
      if (target.closest('[data-popover-trigger]')) return
      // 检查是否在白名单容器内（如属性侧边栏，允许对照查看）
      if (ignoreOutsideSelectors) {
        for (const sel of ignoreOutsideSelectors) {
          if (target.closest(sel)) return
        }
      }
      onClose()
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (closeOnEsc && e.key === 'Escape') {
        onClose?.()
      }
    }

    window.addEventListener('pointerdown', onPointerDown)
    if (closeOnEsc) {
      window.addEventListener('keydown', onKeyDown)
    }

    return () => {
      cancelAnimationFrame(rafId)
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
      window.removeEventListener('pointerdown', onPointerDown)
      if (closeOnEsc) {
        window.removeEventListener('keydown', onKeyDown)
      }
      observer?.disconnect()
    }
  }, [
    open,
    triggerRef,
    anchorRef,
    anchorSelector,
    sideOffset,
    ignoreOutsideSelectors,
    closeOnEsc,
    onClose,
    isResizing,
    size.height
  ])

  if (!open) return null

  return createPortal(
    <div
      ref={rootRef}
      style={{
        position: 'fixed',
        right: `${pos.right}px`,
        top: `${pos.top}px`,
        zIndex
      }}
    >
      <div
        ref={containerRef}
        style={{
          width: size.width ? `${size.width}px` : undefined,
          height: size.height ? `${size.height}px` : undefined,
          minWidth: `${minWidth}px`,
          minHeight: size.height ? `${minHeight}px` : undefined,
          maxWidth: `${maxWidth}px`,
          maxHeight: `${calculatedMaxHeight}px`,
          transform: `translate3d(${dragOffset.x}px, ${dragOffset.y}px, 0)`,
          willChange: isDragging || isResizing ? 'transform, width, height' : undefined,
          ...style
        }}
        className={cn(
          'relative flex flex-col rounded-lg border border-border/80 bg-popover text-popover-foreground shadow-2xl p-3.5 outline-none ring-1 ring-border/50',
          (isDragging || isResizing) && 'select-none',
          className
        )}
      >
        {/* 标头区域 */}
        {title && (
          <div
            onMouseDown={handleHeaderMouseDown}
            onDoubleClick={resetDrag}
            className={cn(
              'flex items-center justify-between border-b border-border pb-2 mb-3 cursor-move select-none shrink-0',
              isDragging && 'opacity-90'
            )}
            title={_t("按住标头可自由拖拽窗口位置，双击标头复位位置")}
          >
            <div className="flex items-center gap-1.5 min-w-0">
              <GripHorizontal className="size-4 shrink-0 text-muted-foreground/60" />
              {icon}
              <span className="text-xs font-semibold tracking-wide truncate">{title}</span>
              {headerBadge}
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              {headerExtra}
              {showCloseButton && onClose && (
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded p-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  title={_t("关闭")}
                >
                  <X className="size-3.5" />
                </button>
              )}
            </div>
          </div>
        )}

        {/* 主体内容（可自适应拉伸与滚动） */}
        <div className="flex-1 min-h-0 flex flex-col space-y-3 overflow-y-auto overflow-x-hidden select-text">
          {children}
        </div>

        {/* 底部按钮栏 */}
        {footer && (
          <div className="flex items-center justify-end border-t border-border pt-2 mt-3 shrink-0">
            {footer}
          </div>
        )}

        {/* 自由调整大小拖动手柄（边缘与角落） */}
        {resizable && (
          <>
            {/* 4 边缘拉伸触发区 */}
            <div
              onMouseDown={(e) => handleResizeStart(e, 'n')}
              className="absolute -top-1 left-3 right-3 h-2 cursor-ns-resize z-20"
              title={_t("上下拖动调整高度")}
            />
            <div
              onMouseDown={(e) => handleResizeStart(e, 's')}
              className="absolute -bottom-1 left-3 right-3 h-2 cursor-ns-resize z-20"
              title={_t("上下拖动调整高度")}
            />
            <div
              onMouseDown={(e) => handleResizeStart(e, 'w')}
              className="absolute -left-1 top-3 bottom-3 w-2 cursor-ew-resize z-20"
              title={_t("左右拖动调整宽度")}
            />
            <div
              onMouseDown={(e) => handleResizeStart(e, 'e')}
              className="absolute -right-1 top-3 bottom-3 w-2 cursor-ew-resize z-20"
              title={_t("左右拖动调整宽度")}
            />

            {/* 4 角落拉伸触发区 */}
            <div
              onMouseDown={(e) => handleResizeStart(e, 'nw')}
              className="absolute -top-1 -left-1 size-3.5 cursor-nwse-resize z-20"
              title={_t("对角拖动调整大小")}
            />
            <div
              onMouseDown={(e) => handleResizeStart(e, 'ne')}
              className="absolute -top-1 -right-1 size-3.5 cursor-nesw-resize z-20"
              title={_t("对角拖动调整大小")}
            />
            <div
              onMouseDown={(e) => handleResizeStart(e, 'sw')}
              onDoubleClick={resetSize}
              className="group absolute -bottom-1 -left-1 size-3.5 cursor-nesw-resize z-20 flex items-center justify-center text-muted-foreground/40 hover:text-muted-foreground transition-colors"
              title={_t("拖动调整大小，双击复位默认尺寸")}
            >
              <svg viewBox="0 0 8 8" className="size-2 pointer-events-none fill-current opacity-40 group-hover:opacity-100">
                <circle cx="2" cy="6" r="0.9" />
                <circle cx="6" cy="6" r="0.9" />
                <circle cx="2" cy="2" r="0.9" />
              </svg>
            </div>
            <div
              onMouseDown={(e) => handleResizeStart(e, 'se')}
              onDoubleClick={resetSize}
              className="group absolute -bottom-1 -right-1 size-3.5 cursor-nwse-resize z-20 flex items-center justify-center text-muted-foreground/40 hover:text-muted-foreground transition-colors"
              title={_t("拖动调整大小，双击复位默认尺寸")}
            >
              <svg viewBox="0 0 8 8" className="size-2 pointer-events-none fill-current opacity-40 group-hover:opacity-100">
                <circle cx="6" cy="6" r="0.9" />
                <circle cx="2" cy="6" r="0.9" />
                <circle cx="6" cy="2" r="0.9" />
              </svg>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body
  )
}

/**
 * 辅助复合组件：弹窗自定义标头
 */
export function FloatingPopoverHeader({
  title,
  icon,
  badge,
  extra,
  onClose,
  onMouseDown,
  onDoubleClick,
  isDragging,
  className
}: {
  title: React.ReactNode
  icon?: React.ReactNode
  badge?: React.ReactNode
  extra?: React.ReactNode
  onClose?: () => void
  onMouseDown?: (e: React.MouseEvent) => void
  onDoubleClick?: () => void
  isDragging?: boolean
  className?: string
}) {
  _useLocale()
  return (
    <div
      onMouseDown={onMouseDown}
      onDoubleClick={onDoubleClick}
      className={cn(
        'flex items-center justify-between border-b border-border pb-2 cursor-move select-none',
        isDragging && 'opacity-90',
        className
      )}
      title={_t("按住标头可自由拖拽窗口位置，双击标头复位位置")}
    >
      <div className="flex items-center gap-1.5 min-w-0">
        <GripHorizontal className="size-4 shrink-0 text-muted-foreground/60" />
        {icon}
        <span className="text-xs font-semibold tracking-wide truncate">{title}</span>
        {badge}
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        {extra}
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="rounded p-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            title={_t("关闭")}
          >
            <X className="size-3.5" />
          </button>
        )}
      </div>
    </div>
  )
}
