import { createContext, useContext, useState } from 'react'
import { useLocale as _useLocale } from '@renderer/i18n/useLocale'
import { t as _t, msg as _msg } from '@shared/i18n'
import {
  ChevronDown,
  ChevronRight,
  Copy,
  Folder,
  FolderOpen,
  FolderPlus,
  Pencil,
  Plus,
  Trash2
} from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import { templatesInCategory } from '../../model/documentOps'
import { useLibraryStore } from '../../viewmodel/libraryStore'
import { ALL_CAVITY_TYPES, TYPE_REGISTRY, typeLabel } from '@shared/cavity/cavityTypeRegistry'
import type { CavityType, CategoryNode, CavityLibrary } from '@shared/cavity/types'
import { Popover, PopoverContent, PopoverTrigger } from '@renderer/components/ui/popover'
import { InlineInput } from './InlineInput'
import { LibraryContextMenu, type ContextMenuEntry } from './LibraryContextMenu'
import { TYPE_ICONS, assetUrl } from '../typeIcons'

export interface DragPayload {
  kind: 'category' | 'template'
  id: string
}

interface TreeContextValue {
  editingCatId: string | null
  setEditingCatId: (id: string | null) => void
  editingTplId: string | null
  setEditingTplId: (id: string | null) => void
  openContextMenu: (x: number, y: number, items: ContextMenuEntry[]) => void
  dragPayload: DragPayload | null
  setDragPayload: (p: DragPayload | null) => void
}

const TreeContext = createContext<TreeContextValue | null>(null)

export function LibraryTree() {
  _useLocale()
  const doc = useLibraryStore((s) => s.doc)
  const selection = useLibraryStore((s) => s.selection)
  const expanded = useLibraryStore((s) => s.expanded)
  const search = useLibraryStore((s) => s.search)
  const readonly = useLibraryStore((s) => s.readonly)
  const addCategory = useLibraryStore((s) => s.addCategory)
  const toggleExpandAll = useLibraryStore((s) => s.toggleExpandAll)

  const editingCatId = useLibraryStore((s) => s.editingCatId)
  const setEditingCatId = useLibraryStore((s) => s.setEditingCatId)
  const editingTplId = useLibraryStore((s) => s.editingTplId)
  const setEditingTplId = useLibraryStore((s) => s.setEditingTplId)
  const [dragPayload, setDragPayload] = useState<DragPayload | null>(null)
  const [contextMenu, setContextMenu] = useState<{
    x: number
    y: number
    items: ContextMenuEntry[]
  } | null>(null)

  if (!doc) {
    return (
      <div className="flex flex-1 items-center justify-center p-4 text-center text-[11px] text-muted-foreground">
        {_t("尚未打开库")}<br />
        {_t("请在顶部新建或导入库")}
      </div>
    )
  }

  const q = search.trim().toLowerCase()

  const handleTreeContextMenu = (e: React.MouseEvent): void => {
    e.preventDefault()
    if (readonly) return
    const items: ContextMenuEntry[] = [
      {
        label: _t("新建分类"),
        icon: <FolderPlus className="size-3.5" />,
        onClick: () => {
          const newId = addCategory(null, _t("新分类"))
          if (newId) setEditingCatId(newId)
        }
      },
      { type: 'separator' },
      {
        label: _t("展开全部分类"),
        icon: <FolderOpen className="size-3.5" />,
        onClick: () => toggleExpandAll()
      }
    ]
    setContextMenu({ x: e.clientX, y: e.clientY, items })
  }

  return (
    <TreeContext.Provider
      value={{
        editingCatId,
        setEditingCatId,
        editingTplId,
        setEditingTplId,
        openContextMenu: (x, y, items) => setContextMenu({ x, y, items }),
        dragPayload,
        setDragPayload
      }}
    >
      <div
        className="flex-1 space-y-0.5 overflow-auto px-2 py-2 text-xs"
        onContextMenu={handleTreeContextMenu}
      >
        {doc.categories
          .slice()
          .sort((a, b) => a.sortOrder - b.sortOrder)
          .map((c) => (
            <CategoryRow
              key={c.id}
              node={c}
              doc={doc}
              depth={0}
              expanded={expanded}
              selection={selection}
              readonly={readonly}
              search={q}
            />
          ))}
        {doc.categories.length === 0 && (
          <div className="px-3 py-4 text-center text-[11px] text-muted-foreground">{_t("暂无分类")}</div>
        )}
      </div>

      {contextMenu && (
        <LibraryContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={contextMenu.items}
          onClose={() => setContextMenu(null)}
        />
      )}
    </TreeContext.Provider>
  )
}

interface RowProps {
  node: CategoryNode
  doc: CavityLibrary
  depth: number
  expanded: Record<string, boolean>
  selection: { categoryId: string | null; templateId: string | null }
  readonly: boolean
  search: string
}

function CategoryRow({ node, doc, depth, expanded, selection, readonly, search }: RowProps) {
  _useLocale()
  const treeCtx = useContext(TreeContext)
  const toggleExpand = useLibraryStore((s) => s.toggleExpand)
  const select = useLibraryStore((s) => s.select)
  const addCategory = useLibraryStore((s) => s.addCategory)
  const renameCategory = useLibraryStore((s) => s.renameCategory)
  const deleteCategory = useLibraryStore((s) => s.deleteCategory)
  const createTemplate = useLibraryStore((s) => s.createTemplate)
  const moveCategory = useLibraryStore((s) => s.moveCategory)
  const moveTemplate = useLibraryStore((s) => s.moveTemplate)

  const [addMenuOpen, setAddMenuOpen] = useState(false)
  const [dropPos, setDropPos] = useState<'before' | 'inside' | 'after' | null>(null)

  const isOpen = expanded[node.id] ?? false
  const templates = templatesInCategory(doc, node.id)
  const matched = search ? templates.filter((t) => t.name.toLowerCase().includes(search)) : templates
  const childMatched = search && node.children.some((c) => subtreeHasMatch(doc, c, search))
  const show = !search || matched.length > 0 || childMatched
  if (!show) return null

  const active = selection.categoryId === node.id && !selection.templateId
  const isEditing = treeCtx?.editingCatId === node.id

  const handleContextMenu = (e: React.MouseEvent): void => {
    e.preventDefault()
    e.stopPropagation()
    if (!treeCtx) return

    const items: ContextMenuEntry[] = []

    if (!readonly) {
      items.push({
        label: _t("新建孔腔"),
        icon: <Plus className="size-3.5" />,
        children: ALL_CAVITY_TYPES.map((t) => ({
          label: _t(TYPE_REGISTRY[t].label),
          icon: (
            <img
              src={assetUrl(TYPE_ICONS[t])}
              alt=""
              className="size-3.5 shrink-0 select-none opacity-80"
            />
          ),
          onClick: () => {
            createTemplate(t, node.id)
          }
        }))
      })

      items.push({
        label: _t("新建子分类"),
        icon: <FolderPlus className="size-3.5" />,
        onClick: () => {
          const newId = addCategory(node.id, _t("新分类"))
          if (newId) treeCtx.setEditingCatId(newId)
        }
      })

      items.push({ type: 'separator' })
    }

    items.push({
      label: isOpen ? _t("折叠分类") : _t("展开分类"),
      icon: isOpen ? <Folder className="size-3.5" /> : <FolderOpen className="size-3.5" />,
      onClick: () => toggleExpand(node.id)
    })

    if (!readonly) {
      items.push({ type: 'separator' })
      items.push({
        label: _t("重命名"),
        icon: <Pencil className="size-3.5" />,
        onClick: () => treeCtx.setEditingCatId(node.id)
      })
      items.push({
        label: _t("删除分类"),
        icon: <Trash2 className="size-3.5" />,
        danger: true,
        onClick: () => deleteCategory(node.id)
      })
    }

    treeCtx.openContextMenu(e.clientX, e.clientY, items)
  }

  return (
    <div>
      <div
        draggable={!readonly && !isEditing}
        onDragStart={(e) => {
          e.dataTransfer.setData('text/plain', JSON.stringify({ kind: 'category', id: node.id }))
          e.dataTransfer.effectAllowed = 'move'
          treeCtx?.setDragPayload({ kind: 'category', id: node.id })
          e.stopPropagation()
        }}
        onDragEnd={() => {
          treeCtx?.setDragPayload(null)
          setDropPos(null)
        }}
        onDragOver={(e) => {
          const payload = treeCtx?.dragPayload
          if (!payload || readonly) return
          if (payload.kind === 'category' && payload.id === node.id) return
          e.preventDefault()
          e.stopPropagation()
          e.dataTransfer.dropEffect = 'move'
          const rect = e.currentTarget.getBoundingClientRect()
          const relY = (e.clientY - rect.top) / rect.height
          if (payload.kind === 'template') {
            setDropPos('inside')
          } else {
            if (relY < 0.25) setDropPos('before')
            else if (relY > 0.75) setDropPos('after')
            else setDropPos('inside')
          }
        }}
        onDragLeave={() => setDropPos(null)}
        onDrop={(e) => {
          e.preventDefault()
          e.stopPropagation()
          const payload = treeCtx?.dragPayload
          if (!payload || readonly) return
          if (payload.kind === 'category' && dropPos) {
            moveCategory(payload.id, node.id, dropPos)
          } else if (payload.kind === 'template') {
            moveTemplate(payload.id, node.id, 'insideCategory')
          }
          setDropPos(null)
          treeCtx?.setDragPayload(null)
        }}
        className={cn(
          'group relative flex h-7 cursor-pointer items-center gap-1 rounded-md pr-1.5 transition-colors hover:bg-accent',
          (active || addMenuOpen) && 'bg-accent text-accent-foreground',
          dropPos === 'before' && 'border-t-2 border-primary',
          dropPos === 'after' && 'border-b-2 border-primary',
          dropPos === 'inside' && 'ring-2 ring-primary/80 bg-primary/10'
        )}
        style={{ paddingLeft: depth * 12 + 6 }}
        onClick={() => select({ categoryId: node.id, templateId: null, holeId: null })}
        onContextMenu={handleContextMenu}
      >
        <button
          type="button"
          className="flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:text-foreground"
          onClick={(e) => {
            e.stopPropagation()
            toggleExpand(node.id)
          }}
        >
          {isOpen ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
        </button>

        {/* 文件夹 Lucide 状态图标 */}
        {isOpen ? (
          <FolderOpen className="size-3.5 shrink-0 text-amber-500/85 select-none" />
        ) : (
          <Folder className="size-3.5 shrink-0 text-amber-500/85 select-none" />
        )}

        {isEditing ? (
          <div className="min-w-0 flex-1 pr-1">
            <InlineInput
              initialValue={node.name}
              onCommit={(newName) => {
                renameCategory(node.id, newName)
                treeCtx?.setEditingCatId(null)
              }}
              onCancel={() => treeCtx?.setEditingCatId(null)}
            />
          </div>
        ) : (
          <span
            className="min-w-0 flex-1 truncate select-none"
            onDoubleClick={(e) => {
              e.stopPropagation()
              if (!readonly) treeCtx?.setEditingCatId(node.id)
            }}
          >
            {node.name}
          </span>
        )}

        <span className="shrink-0 text-[10px] text-muted-foreground/70">{matched.length || ''}</span>

        {!readonly && !isEditing && (
          <span className={cn('shrink-0 items-center gap-0.5', addMenuOpen ? 'flex' : 'hidden group-hover:flex')}>
            {/* 添加按钮及下拉类型选择 */}
            <Popover open={addMenuOpen} onOpenChange={setAddMenuOpen}>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  title={_t("添加孔腔或子分类")}
                  onClick={(e) => {
                    e.stopPropagation()
                    setAddMenuOpen((v) => !v)
                  }}
                  className={cn(
                    'flex size-5 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-background/60 hover:text-foreground',
                    addMenuOpen && 'bg-background/80 text-foreground'
                  )}
                >
                  <Plus className="size-3" />
                </button>
              </PopoverTrigger>
              <PopoverContent
                align="start"
                sideOffset={4}
                collisionPadding={8}
                className="w-44 p-1 shadow-lg"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="px-2 py-1 text-[10px] font-semibold text-muted-foreground">
                  {_t("新建孔腔")}
                </div>
                {ALL_CAVITY_TYPES.map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => {
                      setAddMenuOpen(false)
                      createTemplate(t, node.id)
                    }}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-xs text-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                  >
                    <img
                      src={assetUrl(TYPE_ICONS[t])}
                      alt=""
                      className="size-3.5 shrink-0 opacity-80"
                    />
                    <span className="truncate">{_t(TYPE_REGISTRY[t].label)}</span>
                  </button>
                ))}
                <div className="my-1 h-px bg-border/60" />
                <button
                  type="button"
                  onClick={() => {
                    setAddMenuOpen(false)
                    const newId = addCategory(node.id, _t("新分类"))
                    if (newId) treeCtx?.setEditingCatId(newId)
                  }}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-xs text-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                >
                  <FolderPlus className="size-3.5 shrink-0 opacity-80" />
                  <span>{_t("新建子分类")}</span>
                </button>
              </PopoverContent>
            </Popover>

            <IconBtn
              title={_t("重命名")}
              onClick={(e) => {
                e.stopPropagation()
                treeCtx?.setEditingCatId(node.id)
              }}
            >
              <Pencil className="size-2.5" />
            </IconBtn>
            <IconBtn
              title={_t("删除分类")}
              danger
              onClick={(e) => {
                e.stopPropagation()
                deleteCategory(node.id)
              }}
            >
              <Trash2 className="size-2.5" />
            </IconBtn>
          </span>
        )}
      </div>

      {isOpen && (
        <div className="space-y-0.5">
          {matched.map((t) => (
            <TemplateLeafRow
              key={t.id}
              templateId={t.id}
              name={t.name}
              cavityType={t.cavityType}
              typeLabel={typeLabel(t.cavityType)}
              depth={depth + 1}
              active={selection.templateId === t.id}
            />
          ))}
          {node.children
            .slice()
            .sort((a, b) => a.sortOrder - b.sortOrder)
            .map((c) => (
              <CategoryRow
                key={c.id}
                node={c}
                doc={doc}
                depth={depth + 1}
                expanded={expanded}
                selection={selection}
                readonly={readonly}
                search={search}
              />
            ))}
        </div>
      )}
    </div>
  )
}

function subtreeHasMatch(doc: CavityLibrary, node: CategoryNode, q: string): boolean {
  if (templatesInCategory(doc, node.id).some((t) => t.name.toLowerCase().includes(q))) return true
  return node.children.some((c) => subtreeHasMatch(doc, c, q))
}

function TemplateLeafRow({
  templateId,
  name,
  cavityType,
  typeLabel: tl,
  depth,
  active
}: {
  templateId: string
  name: string
  cavityType: CavityType
  typeLabel: string
  depth: number
  active: boolean
}) {
  _useLocale()
  const treeCtx = useContext(TreeContext)
  const select = useLibraryStore((s) => s.select)
  const deleteTemplate = useLibraryStore((s) => s.deleteTemplate)
  const duplicateTemplate = useLibraryStore((s) => s.duplicateTemplate)
  const renameTemplate = useLibraryStore((s) => s.renameTemplate)
  const moveTemplate = useLibraryStore((s) => s.moveTemplate)
  const readonly = useLibraryStore((s) => s.readonly)

  const isEditing = treeCtx?.editingTplId === templateId
  const [dropPos, setDropPos] = useState<'before' | 'after' | null>(null)

  const handleContextMenu = (e: React.MouseEvent): void => {
    e.preventDefault()
    e.stopPropagation()
    if (!treeCtx) return

    const items: ContextMenuEntry[] = [
      {
        label: _t("选中孔腔"),
        onClick: () => {
          const doc = useLibraryStore.getState().doc
          const tpl = doc?.templates.find((t) => t.id === templateId)
          select({ categoryId: tpl?.categoryId ?? null, templateId, holeId: null })
        }
      }
    ]

    if (!readonly) {
      items.push({
        label: _t("复制孔腔"),
        icon: <Copy className="size-3.5" />,
        onClick: () => duplicateTemplate(templateId)
      })
      items.push({
        label: _t("重命名"),
        icon: <Pencil className="size-3.5" />,
        onClick: () => treeCtx.setEditingTplId(templateId)
      })
      items.push({ type: 'separator' })
      items.push({
        label: _t("删除孔腔"),
        icon: <Trash2 className="size-3.5" />,
        danger: true,
        onClick: () => deleteTemplate(templateId)
      })
    }

    treeCtx.openContextMenu(e.clientX, e.clientY, items)
  }

  return (
    <div
      draggable={!readonly && !isEditing}
      onDragStart={(e) => {
        e.dataTransfer.setData('text/plain', JSON.stringify({ kind: 'template', id: templateId }))
        e.dataTransfer.effectAllowed = 'move'
        treeCtx?.setDragPayload({ kind: 'template', id: templateId })
        e.stopPropagation()
      }}
      onDragEnd={() => {
        treeCtx?.setDragPayload(null)
        setDropPos(null)
      }}
      onDragOver={(e) => {
        const payload = treeCtx?.dragPayload
        if (!payload || readonly) return
        if (payload.kind === 'template' && payload.id === templateId) return
        e.preventDefault()
        e.stopPropagation()
        e.dataTransfer.dropEffect = 'move'
        const rect = e.currentTarget.getBoundingClientRect()
        const relY = (e.clientY - rect.top) / rect.height
        setDropPos(relY < 0.5 ? 'before' : 'after')
      }}
      onDragLeave={() => setDropPos(null)}
      onDrop={(e) => {
        e.preventDefault()
        e.stopPropagation()
        const payload = treeCtx?.dragPayload
        if (!payload || readonly) return
        if (payload.kind === 'template' && dropPos) {
          moveTemplate(payload.id, templateId, dropPos)
        }
        setDropPos(null)
        treeCtx?.setDragPayload(null)
      }}
      className={cn(
        'group relative flex h-7 cursor-pointer items-center gap-1.5 rounded-md pr-1.5 transition-colors hover:bg-accent',
        active && 'bg-accent font-medium text-accent-foreground',
        dropPos === 'before' && 'border-t-2 border-primary',
        dropPos === 'after' && 'border-b-2 border-primary'
      )}
      style={{ paddingLeft: depth * 12 + 22 }}
      onClick={() => {
        const doc = useLibraryStore.getState().doc
        const tpl = doc?.templates.find((t) => t.id === templateId)
        select({ categoryId: tpl?.categoryId ?? null, templateId, holeId: null })
      }}
      onContextMenu={handleContextMenu}
    >
      <img
        src={assetUrl(TYPE_ICONS[cavityType])}
        alt=""
        draggable={false}
        className="size-3.5 shrink-0 select-none opacity-90"
      />

      {isEditing ? (
        <div className="min-w-0 flex-1 pr-1">
          <InlineInput
            initialValue={name}
            onCommit={(newName) => {
              renameTemplate(templateId, newName)
              treeCtx?.setEditingTplId(null)
            }}
            onCancel={() => treeCtx?.setEditingTplId(null)}
          />
        </div>
      ) : (
        <span
          className="min-w-0 flex-1 truncate select-none"
          title={`${name}（${tl}）`}
          onDoubleClick={(e) => {
            e.stopPropagation()
            if (!readonly) treeCtx?.setEditingTplId(templateId)
          }}
        >
          {name}
        </span>
      )}

      <span className="shrink-0 text-[10px] text-muted-foreground/60">{tl}</span>
      {!readonly && !isEditing && (
        <IconBtn
          title={_t("删除孔腔")}
          danger
          className="hidden group-hover:flex"
          onClick={(e) => {
            e.stopPropagation()
            deleteTemplate(templateId)
          }}
        >
          <Trash2 className="size-2.5" />
        </IconBtn>
      )}
    </div>
  )
}

/** 轻量图标按钮（树节点操作） */
function IconBtn({
  title,
  onClick,
  danger,
  className,
  children
}: {
  title: string
  onClick: (e: React.MouseEvent) => void
  danger?: boolean
  className?: string
  children: React.ReactNode
}) {
  _useLocale()
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={cn(
        'flex size-5 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-background/60 hover:text-foreground',
        danger && 'hover:text-destructive',
        className
      )}
    >
      {children}
    </button>
  )
}
