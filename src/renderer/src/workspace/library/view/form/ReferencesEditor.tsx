import { useLocale as _useLocale } from '@renderer/i18n/useLocale'
import { t as _t } from '@shared/i18n'
/**
 * 参考文档编辑器（PRD-002 §8.10 / FR-03-55）
 *
 * 极简参数直接录入设计：
 * - 统一采用 divide-y 紧凑卡片列表；
 * - 首行：文档标题 + 类别切换（PDF / URL） + 删除；
 * - 次行：直接录入文件路径或网址，移除冗余注释；
 * - 说明信息统一移入组标题行「?」帮助 Popover。
 */

import { ExternalLink, FileText, Globe, Plus, Trash2, Eye } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { Label } from '@renderer/components/ui/label'
import { InsertCmd, RemoveCmd, UpdateCmd } from '../../viewmodel/commands'
import { useLibraryStore } from '../../viewmodel/libraryStore'
import { openViewerTab } from '@renderer/workspace/registry/panelActions'
import { NumInput, useBoundText, type IssueForPath } from './FormRenderer'
import { cn } from '@renderer/lib/utils'
import type { Reference } from '@shared/cavity/types'

export interface ReferencesEditorProps {
  basePath: string
  references: Reference[]
  disabled?: boolean
  showAddBtn?: boolean
  issueFor?: IssueForPath
}

function RefFieldInput({
  path,
  placeholder,
  disabled,
  className
}: {
  path: string
  placeholder?: string
  disabled?: boolean
  className?: string
}) {
  _useLocale()
  const bound = useBoundText(path)
  return (
    <input
      type="text"
      value={bound.value}
      placeholder={placeholder}
      disabled={disabled}
      onChange={bound.onChange}
      onBlur={bound.onBlur}
      className={cn(
        'h-7 w-full min-w-0 rounded-md border border-input bg-background px-2 text-xs text-foreground transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50',
        className
      )}
    />
  )
}

export function ReferencesEditor({
  basePath,
  references,
  disabled,
  showAddBtn = false,
  issueFor: _issueFor
}: ReferencesEditorProps) {
  _useLocale()
  const execute = useLibraryStore((s) => s.execute)
  const activeDirPath = useLibraryStore((s) => s.activeDirPath)
  const arrPath = `${basePath}.references`

  const handleOpenReferenceInWorkspace = (ref: Reference) => {
    const target = ref.kind === 'pdf' ? ref.path : ref.url
    if (!target) return
    openViewerTab({
      title: ref.title || (ref.kind === 'pdf' ? _t("参考文档") : _t("在线网址")),
      subType: ref.kind === 'pdf' ? 'pdf' : 'url',
      target,
      libraryDirPath: activeDirPath || undefined,
      pageStart: ref.pageStart,
      pageEnd: ref.pageEnd
    })
  }

  const handleAddRef = (kind: 'pdf' | 'url' = 'pdf') => {
    if (disabled) return
    const newRef: Reference =
      kind === 'pdf'
        ? {
            kind: 'pdf',
            title: _t("技术样本参考"),
            path: 'docs/',
            pageStart: null,
            pageEnd: null,
            note: ''
          }
        : {
            kind: 'url',
            title: _t("在线技术标准"),
            url: 'https://',
            note: ''
          }
    execute(new InsertCmd(arrPath, references.length, newRef, _t("添加参考文档")))
  }

  const handleSwitchKind = (index: number, cur: Reference, targetKind: 'pdf' | 'url') => {
    if (disabled || cur.kind === targetKind) return
    const refPath = `${arrPath}.${index}`
    const next: Reference =
      targetKind === 'pdf'
        ? {
            kind: 'pdf',
            title: cur.title,
            path: 'docs/',
            pageStart: null,
            pageEnd: null,
            note: cur.note
          }
        : {
            kind: 'url',
            title: cur.title,
            url: 'https://',
            note: cur.note
          }
    execute(new UpdateCmd(refPath, next, cur, _t("切换文档类型")))
  }

  const handleOpenUrl = (url?: string | null) => {
    if (!url || !url.startsWith('http')) return
    window.open(url, '_blank', 'noopener,noreferrer')
  }

  return (
    <div className="space-y-2">
      <div className="divide-y divide-border/60 border-y border-border/60">
        {references.map((r, i) => {
          const refPath = `${arrPath}.${i}`
          const hasTarget = Boolean(r.kind === 'pdf' ? r.path : r.url)

          return (
            <div key={i} className="relative px-3 py-2.5 transition-colors space-y-2 hover:bg-muted/30">
              {/* 行 1：标题 + 模式切换 + 在工作区打开 + 删除 */}
              <div className="flex items-center gap-2">
                <RefFieldInput
                  path={`${refPath}.title`}
                  placeholder={_t("文档标题（如 SUN 样本）")}
                  disabled={disabled}
                  className="font-medium text-xs flex-1"
                />

                {/* PDF / URL 图标切换 */}
                <div className="flex items-center rounded-md border border-border/70 bg-muted/40 p-0.5 shadow-2xs shrink-0">
                  <button
                    type="button"
                    disabled={disabled}
                    title={_t("本地 PDF (docs/)")}
                    onClick={() => handleSwitchKind(i, r, 'pdf')}
                    className={cn(
                      'flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] transition-all',
                      r.kind === 'pdf'
                        ? 'border border-border/60 bg-background shadow-xs ring-1 ring-primary/30 text-primary font-semibold'
                        : 'text-muted-foreground hover:text-foreground opacity-70 hover:opacity-100',
                      disabled && 'cursor-not-allowed opacity-30'
                    )}
                  >
                    <FileText className="size-3" />
                    PDF
                  </button>
                  <button
                    type="button"
                    disabled={disabled}
                    title={_t("在线网址链接")}
                    onClick={() => handleSwitchKind(i, r, 'url')}
                    className={cn(
                      'flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] transition-all',
                      r.kind === 'url'
                        ? 'border border-border/60 bg-background shadow-xs ring-1 ring-primary/30 text-primary font-semibold'
                        : 'text-muted-foreground hover:text-foreground opacity-70 hover:opacity-100',
                      disabled && 'cursor-not-allowed opacity-30'
                    )}
                  >
                    <Globe className="size-3" />
                    URL
                  </button>
                </div>

                {/* 在工作区浏览按钮 */}
                <button
                  type="button"
                  title={_t("在工作区打开浏览")}
                  disabled={disabled || !hasTarget}
                  className="flex size-7 items-center justify-center rounded-md border border-border/60 bg-background text-primary transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-30"
                  onClick={() => handleOpenReferenceInWorkspace(r)}
                >
                  <Eye className="size-3.5" />
                </button>

                <button
                  type="button"
                  title={_t("删除此参考文档")}
                  disabled={disabled}
                  className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:pointer-events-none disabled:opacity-30"
                  onClick={() => execute(new RemoveCmd(arrPath, i, r, _t("删除参考文档")))}
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>

              {/* 行 2：参数直接录入 */}
              {r.kind === 'pdf' ? (
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <Label className="mb-1 block text-[11px] font-medium text-muted-foreground/80">{_t("PDF 路径")}</Label>
                    <RefFieldInput
                      path={`${refPath}.path`}
                      placeholder="docs/sample.pdf"
                      disabled={disabled}
                      className="font-mono text-xs"
                    />
                  </div>
                  <div>
                    <Label className="mb-1 block text-[11px] font-medium text-muted-foreground/80">{_t("起始页")}</Label>
                    <NumInput
                      path={`${refPath}.pageStart`}
                      placeholder={_t("选填")}
                      min={1}
                      integer
                      disabled={disabled}
                    />
                  </div>
                  <div>
                    <Label className="mb-1 block text-[11px] font-medium text-muted-foreground/80">{_t("结束页")}</Label>
                    <NumInput
                      path={`${refPath}.pageEnd`}
                      placeholder={_t("选填")}
                      min={1}
                      integer
                      disabled={disabled}
                    />
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-[1fr_auto] items-end gap-1.5">
                  <div>
                    <Label className="mb-1 block text-[11px] font-medium text-muted-foreground/80">{_t("网址 (URL)")}</Label>
                    <RefFieldInput
                      path={`${refPath}.url`}
                      placeholder="https://..."
                      disabled={disabled}
                      className="font-mono text-xs"
                    />
                  </div>
                  {r.url && r.url.startsWith('http') && (
                    <button
                      type="button"
                      title={_t("在浏览器中打开链接")}
                      onClick={() => handleOpenUrl(r.url)}
                      className="flex size-7 shrink-0 items-center justify-center rounded-md border border-border bg-background text-muted-foreground hover:bg-accent hover:text-foreground"
                    >
                      <ExternalLink className="size-3.5" />
                    </button>
                  )}
                </div>
              )}

              {/* 行 3：备注说明 */}
              <div>
                <Label className="mb-1 block text-[11px] font-medium text-muted-foreground/80">{_t("备注说明（选填）")}</Label>
                <RefFieldInput
                  path={`${refPath}.note`}
                  placeholder={_t("如：样本第 12 页规格说明")}
                  disabled={disabled}
                />
              </div>
            </div>
          )
        })}
      </div>

      {showAddBtn && (
        <div className="flex items-center gap-2 pt-1">
          <Button size="sm" variant="outline" className="h-8 flex-1 text-xs" disabled={disabled} onClick={() => handleAddRef('pdf')}>
            <Plus className="size-3.5" /> {_t("添加本地 PDF")}</Button>
          <Button size="sm" variant="outline" className="h-8 flex-1 text-xs" disabled={disabled} onClick={() => handleAddRef('url')}>
            <Plus className="size-3.5" /> {_t("添加在线 URL")}</Button>
        </div>
      )}
    </div>
  )
}
