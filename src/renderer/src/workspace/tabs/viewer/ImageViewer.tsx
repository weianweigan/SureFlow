import { useLocale as _useLocale } from '@renderer/i18n/useLocale'
import { t as _t } from '@shared/i18n'
/**
 * 图片查看器组件
 * 支持 PNG、JPG、WEBP、SVG 等格式，提供缩放、拖拽平移与自适应
 */
import { useSettingsStore, zoomFactor } from '../../settings/settingsStore'
import { FC, useMemo, useState, useRef } from 'react'
import {
  Image as ImageIcon,
  ZoomIn,
  ZoomOut,
  Maximize2,
  RotateCw,
  ExternalLink
} from 'lucide-react'
import { Button } from '@renderer/components/ui/button'

interface ImageViewerProps {
  target: string
  libraryDirPath?: string
}

export const ImageViewer: FC<ImageViewerProps> = ({ target, libraryDirPath }) => {
  _useLocale()
  const wheelZoom = useSettingsStore((s) => s.values.imageWheelZoom)
  const speed = useSettingsStore((s) => s.values.imageZoom)
  const factor = zoomFactor(speed)
  const [scale, setScale] = useState<number>(1)
  const [rotation, setRotation] = useState<number>(0)
  const [position, setPosition] = useState<{ x: number; y: number }>({ x: 0, y: 0 })
  const [isDragging, setIsDragging] = useState<boolean>(false)
  const dragStartRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 })

  const safeImageUrl = useMemo(() => {
    let raw = target.trim()
    if (raw.startsWith('http://') || raw.startsWith('https://') || raw.startsWith('data:')) {
      return raw
    }

    if (libraryDirPath && !raw.startsWith('/') && !/^[a-zA-Z]:/.test(raw)) {
      raw = `${libraryDirPath.replace(/\\/g, '/')}/${raw.replace(/\\/g, '/')}`
    }

    return window.fileApi ? window.fileApi.toSafeFileUrl(raw) : raw
  }, [target, libraryDirPath])

  const fileName = target.split(/[\\/]/).pop() || target

  const handleZoomIn = () => setScale((s) => Math.min(s * factor, 8))
  const handleZoomOut = () => setScale((s) => Math.max(s / factor, 0.1))
  const handleReset = () => {
    setScale(1)
    setRotation(0)
    setPosition({ x: 0, y: 0 })
  }
  const handleRotate = () => setRotation((r) => (r + 90) % 360)

  const handleMouseDown = (e: React.MouseEvent) => {
    setIsDragging(true)
    dragStartRef.current = { x: e.clientX - position.x, y: e.clientY - position.y }
  }

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return
    setPosition({
      x: e.clientX - dragStartRef.current.x,
      y: e.clientY - dragStartRef.current.y
    })
  }

  const handleMouseUp = () => setIsDragging(false)

  const handleWheel = (e: React.WheelEvent) => {
    if (!wheelZoom) return
    e.preventDefault()
    if (e.deltaY < 0) {
      handleZoomIn()
    } else {
      handleZoomOut()
    }
  }

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-background">
      {/* 顶部工具条 */}
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-border/80 bg-muted/20 px-3">
        <div className="flex items-center gap-2 overflow-hidden">
          <ImageIcon className="size-4 shrink-0 text-emerald-500" />
          <span className="truncate text-xs font-semibold text-foreground">{fileName}</span>
          <span className="text-[11px] text-muted-foreground">({Math.round(scale * 100)}%)</span>
        </div>

        <div className="flex items-center gap-1">
          <Button size="icon-sm" className="size-6" variant="ghost" title={_t("放大")} onClick={handleZoomIn}>
            <ZoomIn className="size-3.5" />
          </Button>
          <Button size="icon-sm" className="size-6" variant="ghost" title={_t("缩小")} onClick={handleZoomOut}>
            <ZoomOut className="size-3.5" />
          </Button>
          <Button size="icon-sm" className="size-6" variant="ghost" title={_t("顺时针旋转")} onClick={handleRotate}>
            <RotateCw className="size-3.5" />
          </Button>
          <Button size="icon-sm" className="size-6" variant="ghost" title={_t("复位 (100%)")} onClick={handleReset}>
            <Maximize2 className="size-3.5" />
          </Button>
          <Button
            size="icon-sm"
            className="size-6"
            variant="ghost"
            title={_t("外置浏览器打开")}
            onClick={() => window.open(safeImageUrl, '_blank')}
          >
            <ExternalLink className="size-3.5" />
          </Button>
        </div>
      </div>

      {/* 图片主视口 */}
      <div
        className="relative flex-1 min-h-0 w-full overflow-hidden select-none cursor-grab active:cursor-grabbing bg-muted/10 flex items-center justify-center"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onWheel={handleWheel}
        onDoubleClick={handleReset}
      >
        <img
          src={safeImageUrl}
          alt={fileName}
          draggable={false}
          style={{
            transform: `translate(${position.x}px, ${position.y}px) scale(${scale}) rotate(${rotation}deg)`,
            transition: isDragging ? 'none' : 'transform 0.1s ease-out'
          }}
          className="max-h-[85%] max-w-[85%] object-contain shadow-md rounded border border-border/40"
        />
      </div>
    </div>
  )
}
