import { useLocale as _useLocale } from '@renderer/i18n/useLocale'
import { t as _t } from '@shared/i18n'
/**
 * 3D 预览模型配置器（PRD-002 §8.11 / FR-03-74）
 *
 * 极简参数直接录入：
 * - 输入相对路径（如 models/valve.glb）；
 * - 格式要求与存放约定移入组标题行「?」帮助 Popover。
 */

import { useEffect, useState } from 'react'
import { Box, Plus, Trash2 } from 'lucide-react'
import { Label } from '@renderer/components/ui/label'
import { UpdateCmd, RemoveCmd } from '../../viewmodel/commands'
import { useLibraryStore } from '../../viewmodel/libraryStore'
import { openViewerTab } from '@renderer/workspace/registry/panelActions'
import { SelectInput, type IssueForPath } from './FormRenderer'
import { cn } from '@renderer/lib/utils'

export interface Model3dEditorProps {
  basePath: string
  model3ds: string[]
  disabled?: boolean
  issueFor?: IssueForPath
}

export function Model3dEditor({
  basePath,
  model3ds,
  disabled
}: Model3dEditorProps) {
  _useLocale()
  const execute = useLibraryStore((s) => s.execute)
  const activeDirPath = useLibraryStore((s) => s.activeDirPath)
  const arrPath = `${basePath}.model3ds`

  const [modelOptions, setModelOptions] = useState<{value: string, label: string}[]>([])

  useEffect(() => {
    if (activeDirPath) {
      window.libraryApi.listAssets(activeDirPath, 'models').then(files => {
        setModelOptions(files.map(f => ({ value: `models/${f}`, label: `models/${f}` })))
      }).catch(console.error)
    }
  }, [activeDirPath])

  const handleAddFile = async (itemPath: string, currentVal: string) => {
    if (disabled || !activeDirPath) return
    try {
      const filename = await window.libraryApi.addAsset(activeDirPath, 'models')
      if (filename) {
        setModelOptions(prev => {
          const nv = { value: `models/${filename}`, label: `models/${filename}` }
          if (!prev.find(o => o.value === nv.value)) return [...prev, nv]
          return prev
        })
        execute(new UpdateCmd(itemPath, `models/${filename}`, currentVal, _t("设置3D模型路径")))
      }
    } catch (e) {
      console.error(e)
    }
  }

  const handlePreviewInWorkspace = (modelPath: string) => {
    if (!modelPath) return
    openViewerTab({
      title: modelPath.split(/[\\/]/).pop() || _t("CAD模型"),
      subType: 'cad',
      target: modelPath,
      libraryDirPath: activeDirPath || undefined
    })
  }

  return (
    <div className={model3ds.length > 0 ? "space-y-2" : ""}>
      <div className={cn("divide-y divide-border/60 border-border/60", model3ds.length > 0 && "border-y")}>
        {model3ds.map((mPath, i) => {
          const itemPath = `${arrPath}.${i}`
          return (
            <div key={i} className="relative px-3 py-2.5 transition-colors space-y-2 hover:bg-muted/30">
               <Label className="text-[11px] font-medium text-muted-foreground/80">{_t("模型文件路径 (models/...)")}</Label>
               <div className="flex items-center gap-1.5">
                 <div className="relative flex-1 flex items-center gap-1">
                   <SelectInput
                     value={mPath}
                     options={[{value: '', label: _t('请选择文件...')}, ...modelOptions]}
                     disabled={disabled}
                     onChange={(val) => {
                       execute(new UpdateCmd(itemPath, val, mPath, _t("设置3D模型路径")))
                     }}
                     className="font-mono text-xs flex-1"
                   />
                   <button
                     type="button"
                     onClick={() => handleAddFile(itemPath, mPath)}
                     disabled={disabled}
                     className="flex size-7 shrink-0 items-center justify-center rounded-md border border-border bg-background text-muted-foreground hover:bg-accent hover:text-foreground"
                     title={_t("添加本地文件")}
                   >
                     <Plus className="size-3.5" />
                   </button>
                 </div>
                 
                 <button
                   type="button"
                   title={_t("在工作区以 CAD 正交视口预览")}
                   disabled={disabled || !mPath}
                   onClick={() => handlePreviewInWorkspace(mPath)}
                   className="flex size-7 shrink-0 items-center justify-center rounded-md border border-border/70 bg-background text-indigo-600 transition-colors hover:bg-accent hover:text-indigo-700 disabled:opacity-30 disabled:pointer-events-none"
                 >
                   <Box className="size-3.5" />
                 </button>

                 <button
                   type="button"
                   title={_t("删除此模型")}
                   disabled={disabled}
                   className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:pointer-events-none disabled:opacity-30"
                   onClick={() => execute(new RemoveCmd(arrPath, i, mPath, _t("删除3D模型")))}
                 >
                   <Trash2 className="size-3.5" />
                 </button>
               </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
