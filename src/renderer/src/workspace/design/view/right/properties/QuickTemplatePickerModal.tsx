import { useLocale as _useLocale } from '@renderer/i18n/useLocale'
import { t as _t } from '@shared/i18n'
import React, { useState, useMemo } from 'react'
import { X, Search, Check, RefreshCw } from 'lucide-react'
import { useLibraryStore, type LibraryState } from '../../../../library/viewmodel/libraryStore'
import { TYPE_REGISTRY } from '@shared/cavity/cavityTypeRegistry'
import type { CavityTemplate } from '@shared/cavity/types'
import { Cavity2DPreview } from '../Cavity2DPreview'
import { cn } from '@renderer/lib/utils'

interface QuickTemplatePickerModalProps {
  open: boolean
  onClose: () => void
  onSelect: (template: CavityTemplate) => void
  currentTemplateId?: string
  isComboMode?: boolean
}

export const QuickTemplatePickerModal: React.FC<QuickTemplatePickerModalProps> = ({
  open,
  onClose,
  onSelect,
  currentTemplateId,
  isComboMode = false
}) => {
  _useLocale()
  const libraryDoc = useLibraryStore((s: LibraryState) => s.doc)
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(currentTemplateId || null)

  const templates = useMemo(() => {
    if (!libraryDoc || !libraryDoc.templates) return []
    return libraryDoc.templates.filter((t: CavityTemplate) => {
      const isCombo = TYPE_REGISTRY[t.cavityType]?.isCombo || Boolean(t.holes && t.holes.length > 0)
      return isComboMode ? isCombo : !isCombo
    })
  }, [libraryDoc, isComboMode])

  const filteredTemplates = useMemo(() => {
    if (!searchQuery.trim()) return templates
    const q = searchQuery.toLowerCase()
    return templates.filter((t: CavityTemplate) =>
      (t.name || '').toLowerCase().includes(q) ||
      (t.meta?.standards?.join(' ') || '').toLowerCase().includes(q) ||
      (t.meta?.supplier || '').toLowerCase().includes(q)
    )
  }, [templates, searchQuery])

  const selectedTemplate = useMemo(() => {
    return templates.find((t: CavityTemplate) => t.id === selectedId) || null
  }, [templates, selectedId])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4">
      <div className="flex h-[520px] w-[720px] flex-col rounded-lg border border-border bg-card shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex h-11 items-center justify-between border-b border-border px-4 bg-muted/40">
          <div className="flex items-center gap-2">
            <RefreshCw className="size-4 text-primary" />
            <h3 className="text-sm font-semibold text-foreground">
              {isComboMode ? _t('替换组合孔腔') : _t('替换孔腔特征')}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Content Body */}
        <div className="flex flex-1 min-h-0">
          {/* Left: List & Search */}
          <div className="flex w-[380px] flex-col border-r border-border min-h-0">
            <div className="p-2.5 border-b border-border">
              <div className="relative flex items-center">
                <Search className="absolute left-2.5 size-3.5 text-muted-foreground" />
                <input
                  type="text"
                  placeholder={_t('搜索孔腔名称、型号或标准...')}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="h-8 w-full rounded border border-border bg-background pl-8 pr-3 text-xs text-foreground placeholder:text-muted-foreground/50 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
            </div>

            <div className="flex-1 overflow-y-auto divide-y divide-border/40 p-1">
              {filteredTemplates.map((tmpl) => {
                const isSelected = tmpl.id === selectedId
                const typeMeta = TYPE_REGISTRY[tmpl.cavityType]
                return (
                  <div
                    key={tmpl.id}
                    onClick={() => setSelectedId(tmpl.id)}
                    className={cn(
                      'flex items-center gap-2.5 rounded-md p-2 cursor-pointer transition-colors text-left',
                      isSelected
                        ? 'bg-primary/15 text-primary'
                        : 'hover:bg-accent/60 text-foreground'
                    )}
                  >
                    <div className="size-8 rounded border border-border/70 bg-background/80 flex items-center justify-center shrink-0 p-0.5">
                      <Cavity2DPreview template={tmpl} compact className="size-full" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate text-xs font-semibold">{tmpl.name}</span>
                        {tmpl.id === currentTemplateId && (
                          <span className="rounded bg-muted px-1 text-[9px] text-muted-foreground">
                            {_t('当前')}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                        <span className="truncate">
                          {tmpl.meta?.standards?.[0] || tmpl.meta?.supplier || typeMeta?.label}
                        </span>
                      </div>
                    </div>
                    {isSelected && <Check className="size-4 text-primary shrink-0 mr-1" />}
                  </div>
                )
              })}

              {filteredTemplates.length === 0 && (
                <div className="py-12 text-center text-xs text-muted-foreground">
                  {_t('未找到匹配的孔腔模板')}
                </div>
              )}
            </div>
          </div>

          {/* Right: Preview & Details */}
          <div className="flex flex-1 flex-col p-4 bg-muted/10 min-h-0">
            {selectedTemplate ? (
              <div className="flex flex-col h-full space-y-3">
                <div className="border border-border rounded-md bg-card/60 p-2 h-48 flex items-center justify-center">
                  <Cavity2DPreview template={selectedTemplate} className="h-full w-full" />
                </div>
                <div className="space-y-1.5 flex-1 min-h-0 text-xs">
                  <div className="font-semibold text-foreground text-sm">
                    {selectedTemplate.name}
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-[11px] text-muted-foreground">
                    <div>{_t('厂家/供应商')}: <span className="font-mono text-foreground">{selectedTemplate.meta?.supplier || '-'}</span></div>
                    <div>{_t('标准规范')}: <span className="font-mono text-foreground">{selectedTemplate.meta?.standards?.join(', ') || '-'}</span></div>
                    <div>{_t('类型')}: <span className="text-foreground">{TYPE_REGISTRY[selectedTemplate.cavityType]?.label}</span></div>
                    <div>{_t('阶梯/子孔数')}: <span className="font-mono text-foreground">{selectedTemplate.holes?.length ?? selectedTemplate.geometry?.steps?.length ?? 1}</span></div>
                  </div>
                  <div className="mt-2 text-[10px] text-amber-600 dark:text-amber-400 bg-amber-500/10 p-2 rounded border border-amber-500/20">
                    {_t('提示：就地替换将继承当前孔腔的面基准、坐标、朝向及安装偏置，并自动更新 3D 几何特征。')}
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
                {_t('请在左侧列表中选择要替换的目标孔腔')}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex h-12 items-center justify-end gap-2 border-t border-border px-4 bg-muted/40">
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground cursor-pointer"
          >
            {_t('取消')}
          </button>
          <button
            type="button"
            disabled={!selectedTemplate || selectedTemplate.id === currentTemplateId}
            onClick={() => {
              if (selectedTemplate) {
                onSelect(selectedTemplate)
                onClose()
              }
            }}
            className="rounded bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
          >
            {_t('确认就地替换')}
          </button>
        </div>
      </div>
    </div>
  )
}
