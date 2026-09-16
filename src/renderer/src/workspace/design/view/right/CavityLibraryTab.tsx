import { useLocale as _useLocale } from '@renderer/i18n/useLocale'
import { t as _t, msg as _msg } from '@shared/i18n'
import { useState, useEffect, useMemo, type FC } from 'react'
import {
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  Folder,
  FolderOpen,
  Search,
  Library,
  Layers,
  X,
  Sparkles,
  GripVertical
} from 'lucide-react'
import { useLibraryStore } from '../../../library/viewmodel/libraryStore'
import { usePlacementStore } from '../../model/placementStore'
import { TYPE_REGISTRY } from '@shared/cavity/cavityTypeRegistry'
import { TYPE_ICONS, assetUrl } from '../../../library/view/typeIcons'
import { HorizontalResizer } from '../common/Resizer'
import { templatesInCategory } from '../../../library/model/documentOps'
import type { CavityLibrary, CategoryNode } from '@shared/cavity/types'
import { Cavity2DPreview } from './Cavity2DPreview'
import { cn } from '@renderer/lib/utils'

interface CavityLibraryTabProps {
  projectId: string
}

/** 1x1 透明图片，用于消除 HTML5 原生拖拽时在光标下附带的列表/卡片 UI 幽灵图遮挡 */
const EMPTY_DRAG_IMAGE = (() => {
  if (typeof window === 'undefined') return null
  const img = new Image()
  img.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'
  return img
})()

function setInvisibleDragImage(e: React.DragEvent) {
  if (EMPTY_DRAG_IMAGE && e.dataTransfer) {
    e.dataTransfer.setDragImage(EMPTY_DRAG_IMAGE, 0, 0)
  }
}

/** 递归检查子树是否包含匹配关键字的模板或分类名称 */
function subtreeHasMatch(doc: CavityLibrary, node: CategoryNode, q: string): boolean {
  if (node.name.toLowerCase().includes(q)) return true
  if (templatesInCategory(doc, node.id).some((t) => t.name.toLowerCase().includes(q))) return true
  return node.children.some((c) => subtreeHasMatch(doc, c, q))
}

export const CavityLibraryTab: FC<CavityLibraryTabProps> = ({ projectId }) => {
  _useLocale()
  // 库 store 状态与动作
  const init = useLibraryStore((s) => s.init)
  const libraries = useLibraryStore((s) => s.libraries)
  const activeLibraryId = useLibraryStore((s) => s.activeLibraryId)
  const doc = useLibraryStore((s) => s.doc)
  const openLibrary = useLibraryStore((s) => s.openLibrary)

  // 树状展开与选中状态
  const [expandedCats, setExpandedCats] = useState<Record<string, boolean>>({})
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null)
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')

  // 放置动作
  const startPlacement = usePlacementStore((s) => s.startPlacement)
  const cancelPlacement = usePlacementStore((s) => s.cancelPlacement)

  // 上下分栏高度
  const [treeHeight, setTreeHeight] = useState(500)

  // 监听外部切换 Tab 并定位模板事件 (如属性面板点击「在库中查看」)
  useEffect(() => {
    const handleSwitch = (e: any) => {
      if (e.detail?.templateId) {
        setSelectedTemplateId(e.detail.templateId)
      }
    }
    window.addEventListener('sureflow:switch-right-tab', handleSwitch)
    return () => window.removeEventListener('sureflow:switch-right-tab', handleSwitch)
  }, [])

  // 初始化加载库列表
  useEffect(() => {
    if (libraries.length === 0) {
      void init()
    }
  }, [libraries.length, init])

  // 确保有激活的库
  useEffect(() => {
    if (!activeLibraryId && libraries.length > 0) {
      void openLibrary(libraries[0].id)
    }
  }, [activeLibraryId, libraries, openLibrary])

  // 文件夹分类展开切换
  const toggleCat = (catId: string) => {
    setExpandedCats((prev) => ({ ...prev, [catId]: !prev[catId] }))
  }

  const anyExpanded = Boolean(
    doc?.categories && doc.categories.length > 0 && doc.categories.some((c) => !!expandedCats[c.id])
  )

  const toggleAll = () => {
    if (!doc) return
    if (anyExpanded) {
      setExpandedCats({})
    } else {
      const exp: Record<string, boolean> = {}
      for (const c of doc.categories) exp[c.id] = true
      setExpandedCats(exp)
    }
  }

  // 选中的模板实体
  const activeTemplate = doc?.templates.find((t) => t.id === selectedTemplateId) || null

  // 递归寻找分类节点
  const findCategoryNode = (nodes: CategoryNode[], id: string): CategoryNode | null => {
    for (const n of nodes) {
      if (n.id === id) return n
      const child = findCategoryNode(n.children || [], id)
      if (child) return child
    }
    return null
  }

  const activeCategoryNode = useMemo(() => {
    if (!doc || !selectedCategoryId) return null
    return findCategoryNode(doc.categories, selectedCategoryId)
  }, [doc, selectedCategoryId])

  // 获取该分类及其子分类下的全部模板
  const categoryTemplates = useMemo(() => {
    if (!doc || !selectedCategoryId) return []
    return templatesInCategory(doc, selectedCategoryId)
  }, [doc, selectedCategoryId])

  const q = searchQuery.trim().toLowerCase()

  return (
    <div className="flex h-full flex-col bg-background select-none">
      {/* ═══════════ 上部分：库切换 + 树结构（约 70%） ═══════════ */}
      <div className="flex flex-col min-h-0 overflow-hidden" style={{ height: treeHeight }}>
        {/* 1. 顶部库选择下拉栏（对齐库管理页面设计） */}
        <div className="flex h-9 shrink-0 items-center justify-between border-b border-border px-3 bg-muted/20 gap-2">
          <div className="flex items-center gap-1.5 min-w-0">
            <Library className="size-3.5 shrink-0 text-foreground/50" />
            <select
              value={activeLibraryId || ''}
              onChange={(e) => void openLibrary(e.target.value)}
              className="h-6 rounded border border-border bg-background px-1.5 text-xs text-foreground font-medium focus:outline-none max-w-[130px] truncate"
            >
              {libraries.map((lib) => (
                <option key={lib.id} value={lib.id}>
                  {lib.name} {lib.readonly ? _t("(内置)") : ''}
                </option>
              ))}
            </select>
          </div>
          {doc && doc.categories.length > 0 && (
            <button
              type="button"
              title={anyExpanded ? _t("折叠所有分类") : _t("展开所有分类")}
              onClick={toggleAll}
              className="flex size-6 items-center justify-center rounded-full text-foreground/60 transition-colors hover:bg-accent hover:text-foreground"
            >
              {anyExpanded ? (
                <ChevronsDownUp className="size-3.5" />
              ) : (
                <ChevronsUpDown className="size-3.5" />
              )}
            </button>
          )}
        </div>

        {/* 2. 搜索框 */}
        <div className="px-2.5 py-1.5 border-b border-border/40">
          <div className="relative flex items-center">
            <Search className="absolute left-2 size-3 text-muted-foreground" />
            <input
              type="text"
              placeholder={_t("搜索模板名称…")}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-6.5 w-full rounded border border-border bg-background pl-7 pr-6 text-xs text-foreground focus:outline-none focus:border-primary"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-1.5 flex size-3.5 items-center justify-center rounded-full text-foreground/40 hover:text-foreground"
              >
                <X className="size-2.5" />
              </button>
            )}
          </div>
        </div>

        {/* 3. 递归孔腔库树结构（分类 → 子分类 → 孔腔模板） */}
        <div className="flex-1 space-y-0.5 overflow-auto px-1.5 py-1.5 text-xs">
          {doc ? (
            doc.categories
              .slice()
              .sort((a, b) => a.sortOrder - b.sortOrder)
              .map((c) => (
                <CategoryNodeRow
                  key={c.id}
                  node={c}
                  doc={doc}
                  depth={0}
                  expanded={expandedCats}
                  onToggle={toggleCat}
                  selectedCategoryId={selectedCategoryId}
                  selectedTemplateId={selectedTemplateId}
                  onSelectCategory={(id) => {
                    setSelectedCategoryId(id)
                    setSelectedTemplateId(null)
                  }}
                  onSelectTemplate={(tplId, catId) => {
                    setSelectedTemplateId(tplId)
                    setSelectedCategoryId(catId)
                  }}
                  searchQuery={q}
                  projectId={projectId}
                />
              ))
          ) : (
            <div className="py-8 text-center text-xs text-muted-foreground">{_t("加载库中…")}</div>
          )}
          {doc && doc.categories.length === 0 && (
            <div className="py-8 text-center text-xs text-muted-foreground">{_t("库内暂无分类")}</div>
          )}
        </div>
      </div>

      {/* ═══════════ 分割线（与库管理 Resizer 100% 一致） ═══════════ */}
      <HorizontalResizer
        value={treeHeight}
        onChange={setTreeHeight}
        min={160}
        max={540}
        defaultValue={330}
      />

      {/* ═══════════ 下部分：孔腔 2D 轮廓预览 / 分类内容（约 30%） ═══════════ */}
      <div className="min-h-0 flex-1 overflow-auto bg-muted/5 flex flex-col">
        {/* 情况 1：选中单个模板 → 仅仅显示 2D 预览 */}
        {activeTemplate ? (
          <div className="flex h-full w-full p-2">
            <div
              draggable={true}
              onDragStart={(e) => {
                setInvisibleDragImage(e)
                startPlacement('drag', activeTemplate, activeLibraryId || 'builtin-standard', projectId)
                e.dataTransfer.setData('text/plain', activeTemplate.id)
                e.dataTransfer.effectAllowed = 'copy'
              }}
              onDragEnd={() => {
                cancelPlacement()
              }}
              title={_msg`${activeTemplate.name} (按住可直接拖入 3D 视口布孔)`}
              className="flex-1 h-full w-full rounded-md border border-border/50 bg-background/80 p-2 shadow-2xs overflow-hidden flex items-center justify-center cursor-grab active:cursor-grabbing hover:border-primary/50 transition-colors relative group"
            >
              <Cavity2DPreview template={activeTemplate} className="h-full w-full" />
              <div className="absolute bottom-1.5 right-2 opacity-0 group-hover:opacity-100 transition-opacity bg-slate-950/75 text-white text-[9px] px-1.5 py-0.5 rounded pointer-events-none flex items-center gap-1 font-mono">
                <GripVertical className="size-2.5" />
                <span>{_t("拖拽布孔")}</span>
              </div>
            </div>
          </div>
        ) : activeCategoryNode ? (
          /* 情况 2：选中分类文件夹 → 方形卡片流式排布，仅显示名称与预览 */
          <div className="p-2 overflow-auto">
            <div className="grid grid-cols-[repeat(auto-fill,minmax(76px,1fr))] gap-2">
              {/* 子文件夹方形卡片 */}
              {activeCategoryNode.children?.map((sub) => (
                <button
                  key={sub.id}
                  type="button"
                  onClick={() => {
                    setSelectedCategoryId(sub.id)
                    setExpandedCats((prev) => ({ ...prev, [sub.id]: true }))
                  }}
                  title={_msg`子文件夹: ${sub.name}`}
                  className="flex flex-col items-center justify-between rounded-lg border border-border/60 bg-card p-1.5 aspect-square hover:border-primary/60 hover:bg-accent/40 hover:shadow-xs transition-all cursor-pointer group"
                >
                  <div className="flex-1 w-full min-h-0 flex items-center justify-center rounded bg-background/40">
                    <Folder className="size-7 text-amber-500/80 group-hover:scale-105 group-hover:text-amber-500 transition-all" />
                  </div>
                  <span className="mt-1 truncate w-full text-center text-[10px] font-medium text-foreground/90 group-hover:text-primary transition-colors">
                    {sub.name}
                  </span>
                </button>
              ))}

              {/* 孔腔模板方形卡片 */}
              {categoryTemplates.map((t) => (
                <div
                  key={t.id}
                  draggable={true}
                  onDragStart={(e) => {
                    setInvisibleDragImage(e)
                    startPlacement('drag', t, activeLibraryId || 'builtin-standard', projectId)
                    e.dataTransfer.setData('text/plain', t.id)
                    e.dataTransfer.effectAllowed = 'copy'
                  }}
                  onDragEnd={() => {
                    cancelPlacement()
                  }}
                  onClick={() => setSelectedTemplateId(t.id)}
                  title={_msg`${t.name} (点击预览，或直接拖入 3D 视口布孔)`}
                  className="flex flex-col items-center justify-between rounded-lg border border-border/60 bg-card p-1.5 aspect-square hover:border-primary/60 hover:shadow-xs transition-all cursor-pointer select-none group"
                >
                  <div className="flex-1 w-full min-h-0 flex items-center justify-center p-0.5 rounded bg-background/60 border border-border/20 overflow-hidden">
                    <Cavity2DPreview template={t} compact className="h-full w-full" />
                  </div>
                  <span className="mt-1 truncate w-full text-center text-[10px] font-medium text-foreground/90 group-hover:text-primary transition-colors">
                    {t.name}
                  </span>
                </div>
              ))}

              {categoryTemplates.length === 0 &&
                (!activeCategoryNode.children || activeCategoryNode.children.length === 0) && (
                  <div className="col-span-full py-8 text-center text-[11px] text-muted-foreground italic">
                    {_t("此分类下暂无内容")}</div>
                )}
            </div>
          </div>
        ) : (
          /* 情况 3：未选中任何项 */
          <div className="flex h-full flex-col items-center justify-center text-center p-4 text-muted-foreground">
            <Sparkles className="size-6 text-primary/40 mb-2" />
            <p className="text-xs font-medium text-foreground/80">{_t("孔腔库 2D 预览")}</p>
            <p className="mt-1 text-[10px] text-muted-foreground/70 max-w-[200px] leading-relaxed">
              {_t("在上方树中选择孔腔模板查看 2D 截面轮廓，并可直接拖入 3D 视口布孔。")}</p>
          </div>
        )}
      </div>
    </div>
  )
}

/** 递归分类节点组件（支持任意级子分类嵌套与模板挂载） */
interface CategoryNodeRowProps {
  node: CategoryNode
  doc: CavityLibrary
  depth: number
  expanded: Record<string, boolean>
  onToggle: (catId: string) => void
  selectedCategoryId: string | null
  selectedTemplateId: string | null
  onSelectCategory: (id: string) => void
  onSelectTemplate: (tplId: string, catId: string) => void
  searchQuery: string
  projectId: string
}

function CategoryNodeRow({
  node,
  doc,
  depth,
  expanded,
  onToggle,
  selectedCategoryId,
  selectedTemplateId,
  onSelectCategory,
  onSelectTemplate,
  searchQuery,
  projectId
}: CategoryNodeRowProps) {
  _useLocale()
  const isOpen = expanded[node.id] ?? false
  const templates = templatesInCategory(doc, node.id)

  const matchedTemplates = searchQuery
    ? templates.filter((t) => t.name.toLowerCase().includes(searchQuery))
    : templates

  const childMatched =
    searchQuery && (node.children || []).some((c) => subtreeHasMatch(doc, c, searchQuery))

  const show = !searchQuery || matchedTemplates.length > 0 || childMatched || node.name.toLowerCase().includes(searchQuery)
  if (!show) return null

  const isCatActive = selectedCategoryId === node.id && !selectedTemplateId

  return (
    <div>
      {/* 分类标题行 */}
      <div
        className={cn(
          'group flex h-7 cursor-pointer items-center gap-1 rounded-md pr-1.5 transition-colors hover:bg-accent',
          isCatActive && 'bg-accent font-medium text-accent-foreground'
        )}
        style={{ paddingLeft: depth * 12 + 6 }}
        onClick={() => onSelectCategory(node.id)}
      >
        <button
          type="button"
          className="flex size-4.5 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:text-foreground"
          onClick={(e) => {
            e.stopPropagation()
            onToggle(node.id)
          }}
        >
          {isOpen ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
        </button>

        {isOpen ? (
          <FolderOpen className="size-3.5 shrink-0 text-amber-500/85 select-none" />
        ) : (
          <Folder className="size-3.5 shrink-0 text-amber-500/85 select-none" />
        )}

        <span className="min-w-0 flex-1 truncate text-[11px]">{node.name}</span>
        <span className="shrink-0 text-[10px] text-muted-foreground/70 font-mono">
          {matchedTemplates.length || ''}
        </span>
      </div>

      {/* 展开内容：直接挂载的模板 + 递归子分类 */}
      {isOpen && (
        <div className="space-y-0.5">
          {/* 1. 模板叶子节点 */}
          {matchedTemplates.map((tpl) => {
            const isTplActive = selectedTemplateId === tpl.id
            const iconUrl = TYPE_ICONS[tpl.cavityType]
              ? assetUrl(TYPE_ICONS[tpl.cavityType])
              : null
            const typeLabel = TYPE_REGISTRY[tpl.cavityType]?.label || tpl.cavityType

            return (
              <div
                key={tpl.id}
                draggable={true}
                onDragStart={(e) => {
                  setInvisibleDragImage(e)
                  usePlacementStore
                    .getState()
                    .startPlacement('drag', tpl, doc.id || 'builtin-standard', projectId)
                  e.dataTransfer.setData('text/plain', tpl.id)
                  e.dataTransfer.effectAllowed = 'copy'
                }}
                onDragEnd={() => {
                  usePlacementStore.getState().cancelPlacement()
                }}
                className={cn(
                  'group flex h-7 cursor-pointer items-center gap-1.5 rounded-md pr-1.5 transition-colors hover:bg-accent',
                  isTplActive && 'bg-accent font-medium text-accent-foreground'
                )}
                style={{ paddingLeft: depth * 12 + 22 }}
                onClick={() => onSelectTemplate(tpl.id, node.id)}
              >
                <GripVertical className="size-3 text-muted-foreground/40 opacity-0 group-hover:opacity-100 transition-opacity cursor-grab shrink-0" />
                {iconUrl ? (
                  <img
                    src={iconUrl}
                    alt=""
                    draggable={false}
                    className="size-3.5 shrink-0 select-none opacity-85"
                  />
                ) : (
                  <Layers className="size-3.5 shrink-0 text-muted-foreground" />
                )}
                <span className="min-w-0 flex-1 truncate text-[11px]" title={`${tpl.name}（${typeLabel}）`}>
                  {tpl.name}
                </span>
                <span className="shrink-0 text-[9px] text-muted-foreground/60">
                  {typeLabel}
                </span>
              </div>
            )
          })}

          {/* 2. 递归渲染子分类 */}
          {(node.children || [])
            .slice()
            .sort((a, b) => a.sortOrder - b.sortOrder)
            .map((c) => (
              <CategoryNodeRow
                key={c.id}
                node={c}
                doc={doc}
                depth={depth + 1}
                expanded={expanded}
                onToggle={onToggle}
                selectedCategoryId={selectedCategoryId}
                selectedTemplateId={selectedTemplateId}
                onSelectCategory={onSelectCategory}
                onSelectTemplate={onSelectTemplate}
                searchQuery={searchQuery}
                projectId={projectId}
              />
            ))}
        </div>
      )}
    </div>
  )
}
