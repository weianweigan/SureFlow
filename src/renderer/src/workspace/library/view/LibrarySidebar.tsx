import { useLocale as _useLocale } from '@renderer/i18n/useLocale'
import { t as _t, msg as _msg } from '@shared/i18n'
/**
 * 左栏：库侧边栏（参考 Figma Pages / Layers 双分组）
 *
 * 「库」组 = Pages：列出全部库；组 header 右上 = 市场 / 搜索 / 导入 / 新建库。
 * 「孔腔」组 = Layers：当前库的分类 → 孔腔模板树；组 header 右上 = 折叠展开全部 / 搜索 / 新建分类。
 * 库条目 hover 显示删除（非只读），支持内联重命名与右键导出/重命名/删除。
 */

import { useEffect, useRef, useState } from 'react'
import {
  ChevronsDownUp,
  ChevronsUpDown,
  CloudDownload,
  FolderInput,
  Library,
  Pencil,
  Plus,
  Search,
  Trash2,
  Upload,
  X
} from 'lucide-react'
import { Input } from '@renderer/components/ui/input'
import { cn } from '@renderer/lib/utils'
import { LibraryTree } from './tree/LibraryTree'
import { useLibraryStore } from '../viewmodel/libraryStore'
import { OnlineMarketModal } from './market/OnlineMarketModal'
import { InlineInput } from './tree/InlineInput'
import { LibraryContextMenu, type ContextMenuEntry } from './tree/LibraryContextMenu'

/** 分组标题（标题行右侧为图标操作区） */
function GroupHeader({
  title,
  actions
}: {
  title: string
  actions?: React.ReactNode
}) {
  _useLocale()
  return (
    <div className="flex h-9 shrink-0 items-center gap-1 pr-2.5">
      <span className="truncate text-xs font-semibold tracking-wide text-foreground pl-4">{title}</span>
      <div className="ml-auto flex shrink-0 items-center gap-0.5">{actions}</div>
    </div>
  )
}

/** 组 header / 列表项的轻量图标按钮 */
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

export function LibrarySidebar() {
  _useLocale()
  const libraries = useLibraryStore((s) => s.libraries)
  const activeLibraryId = useLibraryStore((s) => s.activeLibraryId)
  const readonly = useLibraryStore((s) => s.readonly)
  const doc = useLibraryStore((s) => s.doc)
  const expanded = useLibraryStore((s) => s.expanded)
  const openLibrary = useLibraryStore((s) => s.openLibrary)
  const createLibrary = useLibraryStore((s) => s.createLibrary)
  const renameLibrary = useLibraryStore((s) => s.renameLibrary)
  const exportLibrary = useLibraryStore((s) => s.exportLibrary)
  const importFromDialog = useLibraryStore((s) => s.importFromDialog)
  const removeLibrary = useLibraryStore((s) => s.removeLibrary)
  const addCategory = useLibraryStore((s) => s.addCategory)
  const toggleExpandAll = useLibraryStore((s) => s.toggleExpandAll)
  const setEditingCatId = useLibraryStore((s) => s.setEditingCatId)

  // 搜索态与弹窗
  const [libSearchOpen, setLibSearchOpen] = useState(false)
  const [libQuery, setLibQuery] = useState('')
  const [treeSearchOpen, setTreeSearchOpen] = useState(false)
  const [marketOpen, setMarketOpen] = useState(false)

  // 库重命名内联编辑态
  const [editingLibId, setEditingLibId] = useState<string | null>(null)
  // 库条目右键菜单
  const [libContextMenu, setLibContextMenu] = useState<{
    x: number
    y: number
    items: ContextMenuEntry[]
  } | null>(null)

  const filteredLibs = libQuery.trim()
    ? libraries.filter((l) => l.name.toLowerCase().includes(libQuery.trim().toLowerCase()))
    : libraries

  const activeLib = libraries.find((l) => l.id === activeLibraryId) ?? null

  const anyFirstLevelExpanded = Boolean(
    doc?.categories && doc.categories.length > 0 && doc.categories.some((c) => !!expanded[c.id])
  )

  return (
    <div className="flex h-full flex-col">
      {/* ── 库组（Pages） ── */}
      <GroupHeader
        title={_t("库")}
        actions={
          <>
            <IconBtn
              title={_t("官方在线孔腔库市场")}
              onClick={() => setMarketOpen(true)}
            >
              <CloudDownload className="size-3.5 text-primary" />
            </IconBtn>
            <IconBtn
              title={libSearchOpen ? _t("关闭搜索") : _t("搜索库")}
              active={libSearchOpen}
              onClick={() => {
                setLibSearchOpen((v) => !v)
                if (libSearchOpen) setLibQuery('')
              }}
            >
              <Search className="size-3.5" />
            </IconBtn>
            <IconBtn
              title={_t("导入库（.sfzip / 文件夹）")}
              onClick={() => void importFromDialog()}
            >
              <FolderInput className="size-3.5" />
            </IconBtn>
            <IconBtn
              title={_t("新建库")}
              onClick={async () => {
                const newId = await createLibrary(_t("新孔腔库"))
                setEditingLibId(newId)
              }}
            >
              <Plus className="size-3.5" />
            </IconBtn>
          </>
        }
      />

      <div className="flex max-h-[36%] shrink-0 flex-col border-b border-border">
        {libSearchOpen && (
          <div className="px-2.5 pb-1.5 pt-1.5">
            <SearchInput
              value={libQuery}
              onChange={setLibQuery}
              placeholder={_t("搜索库…")}
              onClear={() => setLibQuery('')}
            />
          </div>
        )}
        <div className="flex-1 space-y-0.5 overflow-auto px-2 py-1.5">
          {filteredLibs.map((l) => {
            const active = l.id === activeLibraryId
            const isEditing = editingLibId === l.id

            return (
              <div
                key={l.id}
                role="button"
                tabIndex={0}
                onClick={() => {
                  if (l.id !== activeLibraryId) void openLibrary(l.id)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && l.id !== activeLibraryId) void openLibrary(l.id)
                }}
                onContextMenu={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  const items: ContextMenuEntry[] = [
                    {
                      label: _t("导出库 (.sfzip)"),
                      icon: <Upload className="size-3.5" />,
                      onClick: () => {
                        void exportLibrary(l.id)
                      }
                    }
                  ]

                  if (!l.readonly) {
                    items.push({
                      label: _t("重命名"),
                      icon: <Pencil className="size-3.5" />,
                      onClick: () => setEditingLibId(l.id)
                    })
                    items.push({ type: 'separator' })
                    items.push({
                      label: _t("删除库"),
                      icon: <Trash2 className="size-3.5" />,
                      danger: true,
                      onClick: () => {
                        void removeLibrary(l.id)
                      }
                    })
                  }
                  setLibContextMenu({ x: e.clientX, y: e.clientY, items })
                }}
                className={cn(
                  'group flex h-8 cursor-pointer items-center gap-2 rounded-md px-2 transition-colors',
                  active
                    ? 'bg-accent text-accent-foreground'
                    : 'text-foreground hover:bg-accent'
                )}
              >
                <Library className="size-3.5 shrink-0 text-foreground/50" />

                {isEditing ? (
                  <div className="min-w-0 flex-1 pr-1">
                    <InlineInput
                      initialValue={l.name}
                      onCommit={async (newName) => {
                        await renameLibrary(l.id, newName)
                        setEditingLibId(null)
                      }}
                      onCancel={() => setEditingLibId(null)}
                    />
                  </div>
                ) : (
                  <span
                    className="min-w-0 flex-1 truncate text-[10px] font-medium select-none"
                    onDoubleClick={(e) => {
                      e.stopPropagation()
                      if (!l.readonly) setEditingLibId(l.id)
                    }}
                  >
                    {l.name}
                  </span>
                )}

                <span className="shrink-0 text-[10px] text-foreground/40">{l.templateCount}</span>
                {l.readonly ? (
                  <span
                    className={cn(
                      'shrink-0 rounded px-1 py-px text-[10px]',
                      active ? 'bg-accent-foreground/15 text-accent-foreground/80' : 'bg-muted text-foreground/50'
                    )}
                  >
                    {_t("内置")}
                  </span>
                ) : (
                  !active && !isEditing && (
                    <button
                      type="button"
                      title={_t("删除库（移入回收站）")}
                      className="hidden shrink-0 rounded-full p-0.5 text-foreground/40 transition-colors hover:bg-destructive/10 hover:text-destructive group-hover:block"
                      onClick={(e) => {
                        e.stopPropagation()
                        void removeLibrary(l.id)
                      }}
                    >
                      <Trash2 className="size-3" />
                    </button>
                  )
                )}
              </div>
            )
          })}
          {filteredLibs.length === 0 && (
            <p className="px-2 py-3 text-center text-xs text-foreground/40">
              {libraries.length === 0 ? _t("暂无库，点「＋」新建") : _t("无匹配库")}
            </p>
          )}
        </div>
      </div>

      {/* ── 孔腔组（Layers） ── */}
      <GroupHeader
        title={activeLib ? _msg`孔腔 · ${activeLib.name}` : _t("孔腔")}
        actions={
          <>
            {/* 折叠 / 展开所有第一层文件夹按钮 */}
            {doc && doc.categories.length > 0 && (
              <IconBtn
                title={anyFirstLevelExpanded ? _t("折叠所有分类") : _t("展开所有分类")}
                onClick={() => toggleExpandAll()}
              >
                {anyFirstLevelExpanded ? (
                  <ChevronsDownUp className="size-3.5" />
                ) : (
                  <ChevronsUpDown className="size-3.5" />
                )}
              </IconBtn>
            )}
            <IconBtn
              title={_t("搜索孔腔")}
              active={treeSearchOpen}
              onClick={() => setTreeSearchOpen((v) => !v)}
            >
              <Search className="size-3.5" />
            </IconBtn>
            {!readonly && (
              <IconBtn
                title={_t("新建分类")}
                onClick={() => {
                  const newId = addCategory(null, _t("新分类"))
                  if (newId) setEditingCatId(newId)
                }}
              >
                <Plus className="size-3.5" />
              </IconBtn>
            )}
          </>
        }
      />

      {/* 搜索输入 + 树 */}
      {treeSearchOpen && (
        <div className="shrink-0 border-b border-border px-2.5 pb-2 pt-1.5">
          <SearchBox onClose={() => setTreeSearchOpen(false)} />
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <LibraryTree />
      </div>

      {/* 在线孔腔库市场弹窗 */}
      <OnlineMarketModal open={marketOpen} onClose={() => setMarketOpen(false)} />

      {/* 库条目右键上下文菜单 */}
      {libContextMenu && (
        <LibraryContextMenu
          x={libContextMenu.x}
          y={libContextMenu.y}
          items={libContextMenu.items}
          onClose={() => setLibContextMenu(null)}
        />
      )}
    </div>
  )
}

/** 搜索输入（带清空按钮） */
function SearchInput({
  value,
  onChange,
  placeholder,
  onClear
}: {
  value: string
  onChange: (v: string) => void
  placeholder: string
  onClear: () => void
}) {
  _useLocale()
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    ref.current?.focus()
  }, [])
  return (
    <div className="relative flex items-center">
      <Input
        ref={ref}
        size={2}
        className="h-7 pr-7 pl-2.5 text-xs"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {value && (
        <button
          type="button"
          onClick={onClear}
          className="absolute right-1.5 flex size-4 items-center justify-center rounded-full text-foreground/40 hover:bg-accent hover:text-foreground"
        >
          <X className="size-3" />
        </button>
      )}
    </div>
  )
}

/** 搜索框（树内过滤，复用 store.search） */
function SearchBox({ onClose }: { onClose: () => void }) {
  _useLocale()
  const search = useLibraryStore((s) => s.search)
  const setSearch = useLibraryStore((s) => s.setSearch)
  return (
    <SearchInput
      value={search}
      onChange={setSearch}
      placeholder={_t("搜索孔腔模板…")}
      onClear={() => {
        setSearch('')
        onClose()
      }}
    />
  )
}
