import { useLocale as _useLocale } from '@renderer/i18n/useLocale'
import React from 'react'

export interface VerticalResizerProps {
  value: number
  onChange: (v: number) => void
  min: number
  max: number
  reverse?: boolean
  defaultValue?: number
}

/**
 * 垂直分割条（调整列宽，左右拖拽）：样式严格对齐 CavityLibraryPanel
 */
export function VerticalResizer({
  value,
  onChange,
  min,
  max,
  reverse = false,
  defaultValue
}: VerticalResizerProps) {
  _useLocale()
  const startDrag = (e: React.MouseEvent): void => {
    e.preventDefault()
    const startX = e.clientX
    const startW = value
    const clamp = (w: number): number => Math.min(max, Math.max(min, w))

    const onMove = (ev: MouseEvent): void => {
      const delta = reverse ? startX - ev.clientX : ev.clientX - startX
      onChange(clamp(startW + delta))
    }

    const onUp = (): void => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }

    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      className="group relative z-10 w-1 shrink-0 cursor-col-resize"
      onMouseDown={startDrag}
      onDoubleClick={() => defaultValue != null && onChange(defaultValue)}
    >
      <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border transition-colors group-hover:bg-primary/60" />
    </div>
  )
}

export interface HorizontalResizerProps {
  value: number
  onChange: (v: number) => void
  onRelease?: (v: number) => void
  min: number
  max: number
  reverse?: boolean
  defaultValue?: number
}

/**
 * 水平分割条（调整上下高度，上下拖拽）：样式严格对齐 CavityLibraryPanel
 */
export function HorizontalResizer({
  value,
  onChange,
  onRelease,
  min,
  max,
  reverse = false,
  defaultValue = 160
}: HorizontalResizerProps) {
  _useLocale()
  const startDrag = (e: React.MouseEvent): void => {
    e.preventDefault()
    const startY = e.clientY
    const startH = value
    const clamp = (h: number): number => Math.min(max, Math.max(min, h))
    let lastRawH = startH

    const onMove = (ev: MouseEvent): void => {
      const delta = reverse ? startY - ev.clientY : ev.clientY - startY
      lastRawH = startH + delta
      onChange(clamp(lastRawH))
    }

    const onUp = (): void => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      if (onRelease) {
        onRelease(lastRawH)
      }
    }

    document.body.style.cursor = 'row-resize'
    document.body.style.userSelect = 'none'
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  return (
    <div
      role="separator"
      aria-orientation="horizontal"
      className="group relative z-10 h-1 shrink-0 cursor-row-resize"
      onMouseDown={startDrag}
      onDoubleClick={() => defaultValue != null && onChange(defaultValue)}
    >
      <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-border transition-colors group-hover:bg-primary/60" />
    </div>
  )
}
