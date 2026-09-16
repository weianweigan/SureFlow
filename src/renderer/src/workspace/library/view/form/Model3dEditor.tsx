import { useLocale as _useLocale } from '@renderer/i18n/useLocale'
import { t as _t } from '@shared/i18n'
/**
 * 3D 预览模型配置器（PRD-002 §8.11 / FR-03-74）
 *
 * 极简参数直接录入：
 * - 输入相对路径（如 models/valve.glb）；
 * - 格式要求与存放约定移入组标题行「?」帮助 Popover。
 */

import { X, Box } from 'lucide-react'
import { Label } from '@renderer/components/ui/label'
import { UpdateCmd } from '../../viewmodel/commands'
import { useLibraryStore } from '../../viewmodel/libraryStore'
import { openViewerTab } from '@renderer/workspace/registry/panelActions'
import { useBoundText, type IssueForPath } from './FormRenderer'
import { cn } from '@renderer/lib/utils'

export interface Model3dEditorProps {
  basePath: string
  model3d?: string | null
  disabled?: boolean
  issueFor?: IssueForPath
}

export function Model3dEditor({
  basePath,
  model3d,
  disabled
}: Model3dEditorProps) {
  _useLocale()
  const execute = useLibraryStore((s) => s.execute)
  const activeDirPath = useLibraryStore((s) => s.activeDirPath)
  const path = `${basePath}.model3d`
  const bound = useBoundText(path)

  const handleClear = () => {
    if (disabled) return
    execute(new UpdateCmd(path, null, model3d ?? null, _t("清除 3D 模型路径")))
  }

  const handlePreviewInWorkspace = () => {
    if (!bound.value) return
    openViewerTab({
      title: bound.value.split(/[\\/]/).pop() || _t("CAD模型"),
      subType: 'cad',
      target: bound.value,
      libraryDirPath: activeDirPath || undefined
    })
  }

  return (
    <div className="space-y-1">
      <Label className="text-[11px] font-medium text-muted-foreground/80">{_t("模型文件路径 (models/...)")}</Label>
      <div className="flex items-center gap-1.5">
        <div className="relative flex-1 flex items-center">
          <input
            type="text"
            value={bound.value}
            placeholder={_t("如 models/valve-sample.glb")}
            disabled={disabled}
            onChange={bound.onChange}
            onBlur={bound.onBlur}
            className={cn(
              'h-7 w-full rounded-md border border-input bg-background pr-7 pl-2 text-xs font-mono text-foreground',
              'transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
              disabled && 'cursor-not-allowed opacity-50'
            )}
          />
          {bound.value && !disabled && (
            <button
              type="button"
              title={_t("清除")}
              onClick={handleClear}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground/60 hover:text-foreground"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>

        {bound.value && (
          <button
            type="button"
            title={_t("在工作区以 CAD 正交视口预览")}
            onClick={handlePreviewInWorkspace}
            className="flex size-7 shrink-0 items-center justify-center rounded-md border border-border/70 bg-background text-indigo-600 transition-colors hover:bg-accent hover:text-indigo-700"
          >
            <Box className="size-3.5" />
          </button>
        )}
      </div>
    </div>
  )
}
