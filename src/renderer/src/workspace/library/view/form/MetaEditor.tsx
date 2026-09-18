import { useLocale as _useLocale } from '@renderer/i18n/useLocale'
import { t as _t } from '@shared/i18n'
import { Trash2 } from 'lucide-react'
import { RemoveCmd } from '../../viewmodel/commands'
import { useLibraryStore } from '../../viewmodel/libraryStore'
import { useBoundText } from './FormRenderer'
import { cn } from '@renderer/lib/utils'
import type { CustomProperty } from '@shared/cavity/types'

export interface MetaEditorProps {
  basePath: string
  properties: CustomProperty[]
  disabled?: boolean
}

function PropFieldInput({
  path,
  placeholder,
  disabled,
  className,
  list
}: {
  path: string
  placeholder?: string
  disabled?: boolean
  className?: string
  list?: string
}) {
  _useLocale()
  const bound = useBoundText(path)
  return (
    <input
      type="text"
      value={bound.value}
      placeholder={placeholder}
      disabled={disabled}
      list={list}
      onChange={bound.onChange}
      onBlur={bound.onBlur}
      className={cn(
        'h-7 w-full min-w-0 rounded-md border border-input bg-background px-2 text-xs text-foreground transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50',
        className
      )}
    />
  )
}

export function MetaEditor({ basePath, properties, disabled }: MetaEditorProps) {
  _useLocale()
  const execute = useLibraryStore((s) => s.execute)
  const arrPath = `${basePath}.meta.properties`

  return (
    <div className={properties.length > 0 ? "space-y-2" : ""}>
      <datalist id="meta-common-props">
        <option value={_t("供应商")} />
        <option value={_t("备注")} />
        <option value={_t("标准")} />
        <option value={_t("图号")} />
        <option value={_t("材料")} />
      </datalist>

      <div className={cn("divide-y divide-border/60 border-border/60", properties.length > 0 && "border-y")}>
        {properties.map((p, i) => {
          const itemPath = `${arrPath}.${i}`
          return (
            <div key={i} className="flex items-center gap-1.5 px-3 py-2.5 transition-colors hover:bg-muted/30">
              <div className="flex-1 grid grid-cols-2 gap-2">
                <PropFieldInput
                  path={`${itemPath}.name`}
                  placeholder={_t("属性名 (可输入或下拉)")}
                  list="meta-common-props"
                  disabled={disabled}
                  className="font-medium"
                />
                <PropFieldInput
                  path={`${itemPath}.value`}
                  placeholder={_t("属性值")}
                  disabled={disabled}
                />
              </div>
              <button
                type="button"
                title={_t("删除此属性")}
                disabled={disabled}
                className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:pointer-events-none disabled:opacity-30"
                onClick={() => execute(new RemoveCmd(arrPath, i, p, _t("删除自定义属性")))}
              >
                <Trash2 className="size-3.5" />
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
