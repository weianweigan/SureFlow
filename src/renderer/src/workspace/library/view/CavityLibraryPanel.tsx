import { translateMessage } from '@shared/i18n'
import { useLocale as _useLocale } from '@renderer/i18n/useLocale'
import { t as _t, msg as _msg } from '@shared/i18n'
/**
 * 孔腔库编辑器主面板（三栏布局，宽度可拖动）
 *
 * 左：库侧边栏（「库」组 = Pages 列出全部库；「孔腔」组 = Layers 模板树）
 * 中：2D 预览（剖面 / 安装面），header 右侧提供撤销/重做
 * 右：选中孔腔的属性编辑表单，header 右侧提供保存与校验状态
 *
 * 三栏联动：左侧选中孔腔 → 中间预览 + 右侧表单同步刷新；
 * 编辑经命令栈实时反映到预览。快捷键：Ctrl+S 保存、Ctrl+Z 撤销、Ctrl+Y 重做。
 * 校验错误点击可跳转选中对应模板（Figma 属性面板式定位）。
 */

import { Component, useEffect, useRef, useState, type ReactNode } from 'react'
import { AlertTriangle, Check, ChevronDown, Redo2, Save, Undo2 } from 'lucide-react'
import type { IDockviewPanelProps } from 'dockview-react'
import type { TabParams } from '@renderer/workspace/registry/tabTypeRegistry'
import { useWorkspaceStore } from '@renderer/workspace/layout/layoutStore'
import { LibrarySidebar } from './LibrarySidebar'
import { CavityPreview } from './preview/CavityPreview'
import { TemplateForm } from './form/TemplateForm'
import { findTemplate, templatePath } from '../model/documentOps'
import { useLibraryStore } from '../viewmodel/libraryStore'
import { TYPE_REGISTRY } from '@shared/cavity/cavityTypeRegistry'
import { validateLibrary } from '@shared/cavity/validation'
import { cn } from '@renderer/lib/utils'

/** react-konva 预览的隔离错误边界：任何 canvas 渲染/commit 异常只作用中栏，
 *  不把整棵工作区树(含左右表单)拖白或弄成不可点。用类组件以用 componentDidCatch。 */
class PreviewErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null }
  static getDerivedStateFromError(error: Error) {
    return { error }
  }
  componentDidCatch(error: Error): void {
    console.error('[CavityPreview] react-konva render error:', error)
  }
  render() {
    if (this.state.error) {
      return (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-1 px-6 text-center">
          <p className="text-xs font-medium text-destructive">{_t("2D 预览渲染失败")}</p>
          <p className="max-w-sm break-words text-[10px] text-muted-foreground">{String(this.state.error?.message ?? this.state.error)}</p>
          <button
            type="button"
            className="mt-2 rounded-md border border-border px-2 py-1 text-[11px] text-foreground transition-colors hover:bg-accent"
            onClick={() => this.setState({ error: null })}
          >
            {_t("重试")}</button>
        </div>
      )
    }
    return this.props.children
  }
}

const LEFT_MIN = 200
const LEFT_MAX = 560
const RIGHT_MIN = 320
const RIGHT_MAX = 720

const LEFT_DEFAULT = 280
const RIGHT_DEFAULT = 400

export default function CavityLibraryPanel(_props: IDockviewPanelProps<TabParams>) {
  _useLocale()
  const init = useLibraryStore((s) => s.init)
  const doc = useLibraryStore((s) => s.doc)
  const selection = useLibraryStore((s) => s.selection)
  const readonly = useLibraryStore((s) => s.readonly)
  const dirty = useLibraryStore((s) => s.dirty)
  const saving = useLibraryStore((s) => s.saving)
  const undo = useLibraryStore((s) => s.undo)
  const redo = useLibraryStore((s) => s.redo)
  const undoStack = useLibraryStore((s) => s.undoStack)
  const redoStack = useLibraryStore((s) => s.redoStack)
  const save = useLibraryStore((s) => s.save)
  const selectAndReveal = useLibraryStore((s) => s.selectAndReveal)

  const [leftWidth, setLeftWidth] = useState(LEFT_DEFAULT)
  const [rightWidth, setRightWidth] = useState(RIGHT_DEFAULT)

  // 首次挂载加载库列表
  useEffect(() => {
    void init()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const template = findTemplate(doc, selection.templateId)
  const basePath = templatePath(doc, selection.templateId)

  const validationIssues = doc ? validateLibrary(doc) : []
  const errorCount = validationIssues.filter((i) => i.level === 'error').length
  const warnCount = validationIssues.filter((i) => i.level === 'warning').length

  const doSave = async (): Promise<void> => {
    if (errorCount > 0) {
      const errs = validationIssues.filter((i) => i.level === 'error').slice(0, 6)
      const msg = _msg`当前存在 ${errorCount} 处校验错误：\n` +
          errs.map((e) => `• ${e.templateName}（${e.rule}）：${translateMessage(e.message)}`).join('\n') +
          (errorCount > 6 ? _msg`\n…等 ${errorCount} 处` : '') +
          _msg`\n\n您确定要强制保存吗？`
          
      if (!window.confirm(msg)) {
        return
      }
    }
    await save({ force: true })
  }

  // 快捷键（仅在库面板激活时生效）
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const active = useWorkspaceStore.getState().activePanelId
      if (active !== 'library') return
      const mod = e.ctrlKey || e.metaKey
      if (!mod) return
      const k = e.key.toLowerCase()
      if (k === 's') {
        e.preventDefault()
        void doSave()
      } else if (k === 'z' && !e.shiftKey) {
        e.preventDefault()
        undo()
      } else if (k === 'y' || (k === 'z' && e.shiftKey)) {
        e.preventDefault()
        redo()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [undo, redo, save, validationIssues])

  /** 点击校验错误：跳转选中对应模板（含分类定位） */
  const jumpToIssue = (templateId: string): void => {
    if (!doc || !templateId) return
    const tpl = findTemplate(doc, templateId)
    if (!tpl) return
    selectAndReveal({ categoryId: tpl.categoryId, templateId: tpl.id, holeId: null })
  }

  return (
    <div className="flex h-full w-full flex-col bg-background">
      {/* 三栏主体（无全局顶栏 / 无状态栏） */}
      <div className="flex min-h-0 flex-1">
        {/* 左：库侧边栏 */}
        <aside className="flex shrink-0 flex-col" style={{ width: leftWidth }}>
          <LibrarySidebar />
        </aside>

        <Resizer value={leftWidth} onChange={setLeftWidth} min={LEFT_MIN} max={LEFT_MAX} />

        {/* 中：预览 */}
        <main className="flex min-w-0 flex-1 flex-col">
          <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-3">
            <span className="truncate text-[13px] font-medium text-foreground">{_t("预览")}</span>
            {template && (
              <span className="truncate text-[13px] text-muted-foreground">
                · {_t(TYPE_REGISTRY[template.cavityType].label)} / {template.name}
              </span>
            )}
            <div className="flex-1" />
            <IconButton title={_t("撤销（Ctrl+Z）")} disabled={undoStack.length === 0} onClick={undo}>
              <Undo2 className="size-4" />
            </IconButton>
            <IconButton title={_t("重做（Ctrl+Y）")} disabled={redoStack.length === 0} onClick={redo}>
              <Redo2 className="size-4" />
            </IconButton>
          </div>
          <PreviewErrorBoundary>
            <CavityPreview />
          </PreviewErrorBoundary>
        </main>

        <Resizer value={rightWidth} onChange={setRightWidth} min={RIGHT_MIN} max={RIGHT_MAX} reverse />

        {/* 右：属性编辑 */}
        <aside id="cavity-properties-aside" className="flex shrink-0 flex-col" style={{ width: rightWidth }}>
          <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-3">
            <span className="text-[13px] font-semibold text-foreground">{_t("属性")}</span>
            <ValidationBadge
              errorCount={errorCount}
              warnCount={warnCount}
              issues={validationIssues}
              onJump={jumpToIssue}
            />
            <div className="flex-1" />
            {readonly ? (
              <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                {_t("内置库只读")}</span>
            ) : (
              <button
                type="button"
                disabled={!doc || saving}
                onClick={() => void doSave()}
                className={cn(
                  'flex h-7 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors',
                  dirty
                    ? 'border-transparent bg-primary text-primary-foreground hover:bg-primary/85'
                    : 'border-border bg-background text-foreground hover:bg-accent',
                  (!doc || saving) && 'pointer-events-none opacity-50'
                )}
              >
                {saving ? (
                  <span className="size-3.5 animate-spin rounded-full border-[1.5px] border-current border-t-transparent" />
                ) : (
                  <Save className="size-3.5" />
                )}
                {saving ? _t("保存中") : _t("保存")}
                {dirty && <span className="size-1.5 rounded-full bg-current opacity-80" />}
              </button>
            )}
          </div>
          <div className="min-h-0 flex-1 flex flex-col">
            {template && basePath ? (
              <TemplateForm template={template} basePath={basePath} readonly={readonly} />
            ) : (
              <div className="flex h-full items-center justify-center p-4 text-center text-xs text-muted-foreground">
                {doc ? _t("在左侧选择孔腔以编辑其属性") : _t("在左侧打开一个库")}
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  )
}

/** 轻量图标按钮（圆形命中区） */
function IconButton({
  title,
  disabled,
  onClick,
  children
}: {
  title: string
  disabled?: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  _useLocale()
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      className="flex size-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-35"
      onClick={onClick}
    >
      {children}
    </button>
  )
}

/** 校验状态徽标（支持展开错误明细并跳转定位） */
function ValidationBadge({
  errorCount,
  warnCount,
  issues,
  onJump
}: {
  errorCount: number
  warnCount: number
  issues: { level: 'error' | 'warning'; templateId: string; templateName: string; rule: string; message: string }[]
  onJump?: (templateId: string) => void
}) {
  _useLocale()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  // 点击外部关闭下拉
  useEffect(() => {
    if (!open) return
    const onDocClick = (e: MouseEvent): void => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [open])

  if (errorCount > 0) {
    return (
      <div ref={ref} className="relative">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-1 rounded-full bg-destructive/10 px-2 py-0.5 text-[11px] font-medium text-destructive transition-colors hover:bg-destructive/15"
        >
          <AlertTriangle className="size-3" />
          {errorCount} {_t("错误")}<ChevronDown className={cn('size-3 transition-transform', open && 'rotate-180')} />
        </button>
        {open && (
          <div className="absolute right-0 top-full z-50 mt-1 w-80 rounded-lg border border-border bg-background p-1.5 shadow-[0_4px_16px_rgba(0,0,0,0.08)]">
            <ul className="max-h-64 space-y-0.5 overflow-auto">
              {issues
                .filter((i) => i.level === 'error')
                .slice(0, 12)
                .map((e, idx) => (
                  <li key={idx}>
                    <button
                      type="button"
                      className="w-full rounded-md px-2 py-1.5 text-left text-[11px] leading-relaxed transition-colors hover:bg-accent"
                      onClick={() => {
                        onJump?.(e.templateId)
                        setOpen(false)
                      }}
                    >
                      <span className="font-medium text-destructive">{e.templateName}</span>
                      <span className="text-muted-foreground/70"> · {e.rule}</span>
                      <p className="mt-0.5 text-foreground/80">{translateMessage(e.message)}</p>
                    </button>
                  </li>
                ))}
              {errorCount > 12 && (
                <li className="px-2 py-1.5 text-[11px] text-muted-foreground/60">{_t("…等")}{errorCount} {_t("处错误")}</li>
              )}
            </ul>
          </div>
        )}
      </div>
    )
  }

  if (warnCount > 0) {
    return (
      <span
        title={_t("存在警告（不阻断保存）")}
        className="flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-600"
      >
        <AlertTriangle className="size-3" />
        {warnCount} {_t("警告")}</span>
    )
  }

  return (
    <span
      title={_t("校验通过")}
      className="flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-600"
    >
      <Check className="size-3" />
      {_t("通过")}</span>
  )
}

/**
 * 可拖动分隔条：mousedown 后监听全局 mousemove，实时回调宽度。
 * reverse=true 用于右栏（向左拖 = 右栏变宽）。双击复位默认值。
 */
function Resizer({
  value,
  onChange,
  min,
  max,
  reverse = false
}: {
  value: number
  onChange: (v: number) => void
  min: number
  max: number
  reverse?: boolean
}) {
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
      onDoubleClick={() => onChange(reverse ? RIGHT_DEFAULT : LEFT_DEFAULT)}
    >
      <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border transition-colors group-hover:bg-primary/60" />
    </div>
  )
}
