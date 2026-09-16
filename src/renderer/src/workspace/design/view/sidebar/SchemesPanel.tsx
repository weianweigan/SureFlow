import { useLocale as _useLocale } from '@renderer/i18n/useLocale'
import { t as _t, msg as _msg } from '@shared/i18n'
import { useState, type FC } from 'react'
import { Plus, Copy, Trash2, Edit2, Layers, Check } from 'lucide-react'
import { useDesignStore } from '../../model/designStore'
import { cn } from '@renderer/lib/utils'

interface SchemesPanelProps {
  projectId: string
}

function IconBtn({
  title,
  onClick,
  disabled,
  danger,
  active,
  children
}: {
  title: string
  onClick: () => void
  disabled?: boolean
  danger?: boolean
  active?: boolean
  children: React.ReactNode
}) {
  _useLocale()
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'flex size-6 items-center justify-center rounded-full text-foreground/60 transition-colors',
        active && 'bg-accent text-foreground',
        !active && 'hover:bg-accent hover:text-foreground',
        'disabled:pointer-events-none disabled:opacity-40',
        danger && 'hover:bg-destructive/10 hover:text-destructive'
      )}
    >
      {children}
    </button>
  )
}

export const SchemesPanel: FC<SchemesPanelProps> = ({ projectId }) => {
  _useLocale()
  const session = useDesignStore((s) => s.projects[projectId])
  const addScheme = useDesignStore((s) => s.addScheme)
  const cloneScheme = useDesignStore((s) => s.cloneScheme)
  const renameScheme = useDesignStore((s) => s.renameScheme)
  const deleteScheme = useDesignStore((s) => s.deleteScheme)
  const setActiveScheme = useDesignStore((s) => s.setActiveScheme)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')

  if (!session) return null
  const { doc } = session

  const startRename = (id: string, currentName: string) => {
    setEditingId(id)
    setEditingName(currentName)
  }

  const commitRename = (id: string) => {
    if (editingName.trim()) {
      renameScheme(projectId, id, editingName.trim())
    }
    setEditingId(null)
  }

  return (
    <div className="flex h-full flex-col">
      {/* ── 方案组 Header（与库管理 GroupHeader 100% 对齐） ── */}
      <div className="flex h-9 shrink-0 items-center gap-1 pr-2.5">
        <span className="truncate text-xs font-semibold tracking-wide text-foreground pl-4">{_t("方案组")}</span>
        <span className="shrink-0 rounded px-1.5 py-0.2 text-[10px] text-foreground/40 font-mono">
          {doc.schemes.length}
        </span>
        <div className="ml-auto flex shrink-0 items-center gap-0.5">
          <IconBtn
            title={_t("新建方案")}
            onClick={() => addScheme(projectId)}
          >
            <Plus className="size-3.5" />
          </IconBtn>
        </div>
      </div>

      {/* 方案列表 */}
      <div className="flex-1 space-y-0.5 overflow-auto px-2 py-1">
        {doc.schemes.map((scheme) => {
          const active = scheme.id === doc.activeSchemeId
          const isEditing = editingId === scheme.id

          return (
            <div
              key={scheme.id}
              role="button"
              tabIndex={0}
              onClick={() => {
                if (!isEditing) setActiveScheme(projectId, scheme.id)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !isEditing) setActiveScheme(projectId, scheme.id)
              }}
              className={cn(
                'group flex h-8 cursor-pointer items-center gap-2 rounded-md px-2 transition-colors text-xs',
                active
                  ? 'bg-accent text-accent-foreground font-medium'
                  : 'text-foreground hover:bg-accent'
              )}
            >
              {isEditing ? (
                <div className="flex flex-1 items-center gap-1" onClick={(e) => e.stopPropagation()}>
                  <input
                    type="text"
                    autoFocus
                    value={editingName}
                    onChange={(e) => setEditingName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitRename(scheme.id)
                      if (e.key === 'Escape') setEditingId(null)
                    }}
                    onBlur={() => commitRename(scheme.id)}
                    className="h-6 flex-1 rounded border border-primary bg-background px-1.5 text-xs text-foreground focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => commitRename(scheme.id)}
                    className="p-1 text-primary hover:bg-accent rounded"
                  >
                    <Check className="size-3" />
                  </button>
                </div>
              ) : (
                <>
                  <Layers className="size-3.5 shrink-0 text-foreground/50" />
                  <span className="min-w-0 flex-1 truncate text-[11px]">{scheme.name}</span>
                  <span className="shrink-0 text-[10px] text-foreground/40 font-mono">
                    {scheme.cavities.length}{_t("孔")}</span>

                  {/* 悬停快捷按钮 */}
                  <div
                    className="hidden shrink-0 items-center gap-0.5 group-hover:flex"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      type="button"
                      title={_t("重命名")}
                      className="rounded-full p-1 text-foreground/40 hover:bg-accent hover:text-foreground transition-colors"
                      onClick={() => startRename(scheme.id, scheme.name)}
                    >
                      <Edit2 className="size-3" />
                    </button>
                    <button
                      type="button"
                      title={_t("复制方案")}
                      className="rounded-full p-1 text-foreground/40 hover:bg-accent hover:text-foreground transition-colors"
                      onClick={() => cloneScheme(projectId, scheme.id)}
                    >
                      <Copy className="size-3" />
                    </button>
                    {doc.schemes.length > 1 && (
                      <button
                        type="button"
                        title={_t("删除方案")}
                        className="rounded-full p-1 text-foreground/40 hover:bg-destructive/10 hover:text-destructive transition-colors"
                        onClick={() => {
                          if (window.confirm(_msg`确定删除方案「${scheme.name}」吗？`)) {
                            deleteScheme(projectId, scheme.id)
                          }
                        }}
                      >
                        <Trash2 className="size-3" />
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
