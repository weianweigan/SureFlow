import { useLocale as _useLocale } from '@renderer/i18n/useLocale'
import { t as _t } from '@shared/i18n'
/**
 * PDF 浏览器组件
 * 基于 Chromium 原生 PDF Reader，支持页面跳转、缩放与外置浏览器打开
 */
import { useSettingsStore } from '../../settings/settingsStore'
import { FC, useMemo, useState } from 'react'
import { FileText, ExternalLink, RefreshCw, BookOpen } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'

interface PdfViewerProps {
  target: string
  libraryDirPath?: string
  pageStart?: number | null
  pageEnd?: number | null
}

export const PdfViewer: FC<PdfViewerProps> = ({
  target,
  libraryDirPath,
  pageStart,
  pageEnd
}) => {
  _useLocale()
  const [key, setKey] = useState<number>(0)
  const [currentPage, setCurrentPage] = useState<number | null>(() => useSettingsStore.getState().values.pdfRecommendedPage ? (pageStart ?? 1) : 1)

  // 计算安全的文件访问路径
  const safePdfUrl = useMemo(() => {
    let raw = target.trim()
    if (raw.startsWith('http://') || raw.startsWith('https://')) {
      const pageHash = `#page=${currentPage ?? 1}`
      return `${raw.split('#')[0]}${pageHash}`
    }

    if (libraryDirPath && !raw.startsWith('/') && !/^[a-zA-Z]:/.test(raw)) {
      raw = `${libraryDirPath.replace(/\\/g, '/')}/${raw.replace(/\\/g, '/')}`
    }

    const fileUrl = window.fileApi ? window.fileApi.toSafeFileUrl(raw) : raw
    const pageHash = `#page=${currentPage ?? 1}`
    return `${fileUrl}${pageHash}`
  }, [target, libraryDirPath, currentPage])

  const handleOpenExternal = () => {
    let raw = target.trim()
    if (libraryDirPath && !raw.startsWith('/') && !/^[a-zA-Z]:/.test(raw)) {
      raw = `${libraryDirPath.replace(/\\/g, '/')}/${raw.replace(/\\/g, '/')}`
    }
    window.open(window.fileApi ? window.fileApi.toSafeFileUrl(raw) : raw, '_blank')
  }

  const fileName = target.split(/[\\/]/).pop() || target

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-background">
      {/* 顶部工具条 */}
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-border/80 bg-muted/20 px-3">
        <div className="flex items-center gap-2 overflow-hidden">
          <FileText className="size-4 shrink-0 text-red-500" />
          <span className="truncate text-xs font-semibold text-foreground">{fileName}</span>
          {(pageStart || pageEnd) && (
            <span className="flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
              <BookOpen className="size-3" />
              {_t("推荐范围：第")}{pageStart || 1} {pageEnd ? `~ ${pageEnd}` : ''} {_t("页")}</span>
          )}
        </div>

        <div className="flex items-center gap-1">
          {pageStart && (
            <Button
              size="sm"
              variant="outline"
              className="h-6 px-2 text-[11px]"
              onClick={() => {
                setCurrentPage(pageStart)
                setKey((k) => k + 1)
              }}
            >
              {_t("定位至第")}{pageStart} {_t("页")}</Button>
          )}

          <Button
            size="icon-sm"
            className="size-6"
            variant="ghost"
            title={_t("刷新")}
            onClick={() => setKey((k) => k + 1)}
          >
            <RefreshCw className="size-3.5" />
          </Button>

          <Button
            size="icon-sm"
            className="size-6"
            variant="ghost"
            title={_t("系统浏览器中打开")}
            onClick={handleOpenExternal}
          >
            <ExternalLink className="size-3.5" />
          </Button>
        </div>
      </div>

      {/* PDF 核心容器 */}
      <div className="relative flex-1 min-h-0 w-full bg-muted/40">
        <iframe
          key={key}
          src={safePdfUrl}
          title={fileName}
          className="h-full w-full border-0"
        />
      </div>
    </div>
  )
}
