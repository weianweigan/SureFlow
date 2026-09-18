import { useLocale as _useLocale } from '@renderer/i18n/useLocale'
import { t as _t } from '@shared/i18n'
/**
 * PDF 浏览器组件
 * 基于 react-pdf-viewer，支持页面范围同步与外部打开
 */
import { FC, useMemo, useState, useEffect } from 'react'
import { FileText, ExternalLink, BookOpen } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { PDFViewer } from '@embedpdf/react-pdf-viewer'
import { useLibraryStore } from '../../library/viewmodel/libraryStore'
import { UpdateCmd } from '../../library/viewmodel/commands'
import { PluginRegistry } from '@embedpdf/core'
import { PDFDocument } from 'pdf-lib'

interface PdfViewerProps {
  target: string
  libraryDirPath?: string
  pageStart?: number | null
  pageEnd?: number | null
  referenceIndex?: number
  referenceBasePath?: string
}

export const PdfViewer: FC<PdfViewerProps> = ({
  target,
  libraryDirPath,
  pageStart,
  pageEnd,
  referenceIndex,
  referenceBasePath
}) => {
  _useLocale()
  const execute = useLibraryStore((s) => s.execute)
  const doc = useLibraryStore((s) => s.doc)

  // Use the reference index to keep local state synced with the library
  const currentRef = useMemo(() => {
    if (referenceIndex == null || !referenceBasePath || !doc) return null
    try {
      const parts = referenceBasePath.split('.')
      let current: any = { doc }
      for (const p of parts) {
        if (current == null) break
        current = current[p]
      }
      if (Array.isArray(current)) {
        return current[referenceIndex]
      }
    } catch (e) {
      console.error(e)
    }
    return null
  }, [doc, referenceIndex, referenceBasePath])

  const currentStart = currentRef ? currentRef.pageStart : pageStart
  const currentEnd = currentRef ? currentRef.pageEnd : pageEnd

  const [viewMode, setViewMode] = useState<'all' | 'range'>(pageStart || pageEnd ? 'range' : 'all')
  const [localStart, setLocalStart] = useState<number | null>(currentStart || 1)
  const [localEnd, setLocalEnd] = useState<number | null>(currentEnd || null)
  const [registry, setRegistry] = useState<PluginRegistry | null>(null)

  // Update local state when external props/store changes
  useEffect(() => {
    setLocalStart(currentStart || 1)
    setLocalEnd(currentEnd || null)
    setViewMode(currentStart || currentEnd ? 'range' : 'all')
  }, [currentStart, currentEnd, referenceIndex, pageStart, pageEnd, target])

  // Scroll to page when range mode is active and localStart changes
  useEffect(() => {
    if (registry && viewMode === 'range' && localStart) {
      try {
        const scrollPlugin = registry.getPlugin('scroll') as any
        if (scrollPlugin && typeof scrollPlugin.scrollToPage === 'function') {
          // When we crop the PDF, the start page effectively becomes page 1
          // So we don't need to jump to localStart anymore if we crop it
        }
      } catch (e) {
        console.warn('Failed to scroll to page', e)
      }
    }
  }, [registry, viewMode, localStart])

  // Use pdf-lib to crop the PDF if we are in range mode
  const [processedPdfUrl, setProcessedPdfUrl] = useState<string>('')
  const [isProcessing, setIsProcessing] = useState(false)

  useEffect(() => {
    let isMounted = true
    let currentBlobUrl = ''

    const processPdf = async () => {
      let raw = target.trim()
      // For URL
      if (raw.startsWith('http://') || raw.startsWith('https://')) {
        raw = raw.split('#')[0]
      } else {
        // For local file
        if (libraryDirPath && !raw.startsWith('/') && !/^[a-zA-Z]:/.test(raw)) {
          raw = `${libraryDirPath.replace(/\\/g, '/')}/${raw.replace(/\\/g, '/')}`
        }
        raw = window.fileApi ? window.fileApi.toSafeFileUrl(raw) : raw
      }

      if (viewMode === 'range' && (localStart || localEnd) && raw) {
        setIsProcessing(true)
        try {
          // Fetch the original PDF
          const res = await fetch(raw)
          if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`)
          const arrayBuffer = await res.arrayBuffer()

          // Load into pdf-lib
          const pdfDoc = await PDFDocument.load(arrayBuffer)
          const totalPages = pdfDoc.getPageCount()

          const s = localStart ? Math.max(1, localStart) : 1
          const e = localEnd ? Math.min(totalPages, localEnd) : totalPages

          // Remove pages outside the range (iterate backwards to avoid shifting index issues)
          for (let i = totalPages - 1; i >= 0; i--) {
            const pageNum = i + 1
            if (pageNum < s || pageNum > e) {
              pdfDoc.removePage(i)
            }
          }

          const pdfBytes = await pdfDoc.save()
          const blob = new Blob([pdfBytes as any], { type: 'application/pdf' })
          currentBlobUrl = URL.createObjectURL(blob)
          
          if (isMounted) {
            setProcessedPdfUrl(currentBlobUrl)
          }
        } catch (err) {
          console.error("Failed to crop PDF", err)
          if (isMounted) {
            setProcessedPdfUrl(raw)
          }
        } finally {
          if (isMounted) setIsProcessing(false)
        }
      } else {
        if (isMounted) {
          setProcessedPdfUrl(raw)
        }
      }
    }

    processPdf()

    return () => {
      isMounted = false
      if (currentBlobUrl) {
        URL.revokeObjectURL(currentBlobUrl)
      }
    }
  }, [target, libraryDirPath, viewMode, localStart, localEnd])

  const safePdfUrl = processedPdfUrl

  const handleOpenExternal = () => {
    window.open(safePdfUrl, '_blank')
  }

  const syncToLibrary = (field: 'pageStart' | 'pageEnd', value: number | null) => {
    if (referenceIndex != null && referenceBasePath) {
      const path = `${referenceBasePath}.${referenceIndex}.${field}`
      const oldVal = currentRef ? currentRef[field] : null
      if (oldVal !== value) {
        execute(new UpdateCmd(path, value, oldVal, _t(`修改 PDF ${field === 'pageStart' ? '起始' : '结束'}页`)))
      }
    }
  }

  const fileName = target.split(/[\\/]/).pop() || target

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-background">
      {/* 顶部工具条 */}
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-border/80 bg-muted/20 px-3">
        <div className="flex items-center gap-2 overflow-hidden">
          <FileText className="size-4 shrink-0 text-red-500" />
          <span className="truncate text-xs font-semibold text-foreground">{fileName}</span>

          {referenceIndex != null && referenceBasePath && (
            <div className="flex items-center ml-2 gap-1 bg-muted/50 rounded p-0.5 border border-border/50">
              <button
                type="button"
                className={`text-[11px] px-2 py-0.5 rounded transition-colors ${viewMode === 'all' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                onClick={() => setViewMode('all')}
              >
                {_t("全部查看")}
              </button>
              <button
                type="button"
                className={`text-[11px] px-2 py-0.5 rounded transition-colors ${viewMode === 'range' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                onClick={() => setViewMode('range')}
              >
                {_t("按起止页查看")}
              </button>
            </div>
          )}

          {viewMode === 'range' && referenceIndex != null && referenceBasePath && (
            <div className="flex items-center gap-1.5 ml-2 text-xs">
              <span className="text-muted-foreground">{_t("起始")}</span>
              <input
                type="number"
                value={localStart || ''}
                onChange={e => setLocalStart(e.target.value ? parseInt(e.target.value) : null)}
                onBlur={() => syncToLibrary('pageStart', localStart)}
                onKeyDown={e => e.key === 'Enter' && e.currentTarget.blur()}
                className="w-14 h-6 border border-border rounded px-1.5 bg-background focus:outline-none focus:border-primary text-center"
                min={1}
              />
              <span className="text-muted-foreground">{_t("结束")}</span>
              <input
                type="number"
                value={localEnd || ''}
                onChange={e => setLocalEnd(e.target.value ? parseInt(e.target.value) : null)}
                onBlur={() => syncToLibrary('pageEnd', localEnd)}
                onKeyDown={e => e.key === 'Enter' && e.currentTarget.blur()}
                className="w-14 h-6 border border-border rounded px-1.5 bg-background focus:outline-none focus:border-primary text-center"
                min={localStart || 1}
              />
            </div>
          )}

          {/* Readonly range display for non-library PDFs */}
          {referenceIndex == null && (pageStart || pageEnd) && (
            <span className="flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground ml-2">
              <BookOpen className="size-3" />
              {_t("推荐范围：第")}{pageStart || 1} {pageEnd ? `~ ${pageEnd}` : ''} {_t("页")}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1">
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
        <PDFViewer
          key={safePdfUrl}
          config={{
            src: safePdfUrl,
            i18n: {
              defaultLocale: 'zh-CN'
            }
          }}
          onReady={setRegistry}
          className="h-full w-full"
        />

        {isProcessing && (
          <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-background/50 backdrop-blur-sm">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mb-2"></div>
            <div className="text-sm font-medium">{_t("正在裁剪并加载PDF...")}</div>
          </div>
        )}
      </div>
    </div>
  )
}
