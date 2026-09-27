import { projectBody, physicalScheme, activeScheme as canonicalScheme } from '@shared/design/cavityTree'
import { useLocale as _useLocale } from '@renderer/i18n/useLocale'
import { t as _t, msg as _msg } from '@shared/i18n'
import { useState, useEffect, useMemo, useRef, type FC, type MouseEvent } from 'react'
import {
  ChevronDown,
  ChevronRight,
  Eye,
  EyeOff,
  Trash2,
  AlertTriangle,
  Copy,
  ClipboardPaste
} from 'lucide-react'
import {
  useDesignStore,
  getSelectedCavityIds,
  getSelectedFeatures,
  type FeatureSelectionItem
} from '../../model/designStore'
import { useAnalysisStore } from '../../model/analysisStore'
import { useLibraryStore } from '../../../library/viewmodel/libraryStore'
import { getBaseBodyIcon, type BaseFaceDefinition, type CavityInstance, type CompoundFrame } from '@shared/design/types'
import { TYPE_ICONS, assetUrl } from '../../../library/view/typeIcons'
import type { CavityLibrary } from '@shared/cavity/types'
import { cn } from '@renderer/lib/utils'

interface FeatureTreePanelProps {
  projectId: string
}

/** 获取孔腔实例对应孔类型的 SVG 图标路径 */
function getCavityTypeIcon(
  cavity: CavityInstance,
  libraryDoc?: CavityLibrary | null
): string {
  if (cavity.cavityType && TYPE_ICONS[cavity.cavityType]) {
    return assetUrl(TYPE_ICONS[cavity.cavityType])
  }
  // 从库模板中查找类型定义
  if (libraryDoc && cavity.templateId) {
    const tpl = libraryDoc.templates.find((t) => t.id === cavity.templateId)
    if (tpl) {
      if (cavity.subHoleName && tpl.holes) {
        const sub = tpl.holes.find((h) => h.name === cavity.subHoleName)
        if (sub?.cavityType && TYPE_ICONS[sub.cavityType]) {
          return assetUrl(TYPE_ICONS[sub.cavityType])
        }
      }
      if (tpl.cavityType && TYPE_ICONS[tpl.cavityType]) {
        return assetUrl(TYPE_ICONS[tpl.cavityType])
      }
    }
  }
  // 关键词语义回退推断
  const text = `${cavity.subHoleName || ''} ${cavity.name}`.toLowerCase()
  if (text.includes('bolt') || text.includes('screw') || text.includes('螺栓') || text.includes('螺钉') || text.includes('螺纹')) {
    return assetUrl(TYPE_ICONS['bolt-hole'])
  }
  if (text.includes('pin') || text.includes('销')) {
    return assetUrl(TYPE_ICONS['locating-pin-hole'])
  }
  if (text.includes('cartridge') || text.includes('插装')) {
    return assetUrl(TYPE_ICONS['cartridge-valve'])
  }
  if (text.includes('port') || text.includes('油口') || text.includes(' p') || text.includes(' t') || text.includes(' a') || text.includes(' b')) {
    return assetUrl(TYPE_ICONS['port-cavity'])
  }
  return assetUrl(TYPE_ICONS['drill-hole'])
}

/** 获取多孔父组对应类型的 SVG 图标路径 */
function getGroupTypeIcon(
  group: CompoundFrame,
  libraryDoc?: CavityLibrary | null
): string {
  if (group.cavityType && TYPE_ICONS[group.cavityType]) {
    return assetUrl(TYPE_ICONS[group.cavityType])
  }
  if (libraryDoc) {
    const matched = libraryDoc.templates.find(
      (t) => t.name === group.name || group.name.startsWith(t.name)
    )
    if (matched?.cavityType && TYPE_ICONS[matched.cavityType]) {
      return assetUrl(TYPE_ICONS[matched.cavityType])
    }
  }
  const text = group.name.toLowerCase()
  if (text.includes('flange') || text.includes('法兰')) {
    return assetUrl(TYPE_ICONS['flange'])
  }
  if (text.includes('cartridge') || text.includes('二通') || text.includes('插装')) {
    return assetUrl(TYPE_ICONS['two-way-cartridge-valve'])
  }
  if (text.includes('foot') || text.includes('安装面')) {
    return assetUrl(TYPE_ICONS['foot-print'])
  }
  return assetUrl(TYPE_ICONS['pattern-valve'])
}

export const FeatureTreePanel: FC<FeatureTreePanelProps> = ({ projectId }) => {
  _useLocale()
  const session = useDesignStore((s) => s.projects[projectId])
  const selectFeature = useDesignStore((s) => s.selectFeature)
  const deleteCavity = useDesignStore((s) => s.deleteCavity)
  const toggleCavitySuppressed = useDesignStore((s) => s.toggleCavitySuppressed)
  const copySelection = useDesignStore((s) => s.copySelection)
  const pasteSelection = useDesignStore((s) => s.pasteSelection)
  const reorderChildren = useDesignStore((s) => s.reorderChildren)
  const reorderFeatures = useDesignStore((s) => s.reorderFeatures)

  const libraryDoc = useLibraryStore((s) => s.doc)

  const [baseExpanded, setBaseExpanded] = useState(false)
  const [groupsExpanded, setGroupsExpanded] = useState<Record<string, boolean>>({})
  const containerRef = useRef<HTMLDivElement>(null)

  const [contextFeature, setContextFeature] = useState<{ type: 'cavity' | 'compound'; id: string } | null>(null)
  const [contextPoint, setContextPoint] = useState<{ x: number; y: number } | null>(null)
  useEffect(() => {
    if (!contextPoint) return
    const close = () => setContextPoint(null)
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    window.addEventListener('pointerdown', close)
    window.addEventListener('keydown', onKey)
    return () => {window.removeEventListener('pointerdown', close);window.removeEventListener('keydown', onKey)}
  }, [contextPoint])
  const draggedFeature = useRef<{ id: string; parentId?: string } | null>(null)
  const reorderFeature = (targetId: string, parentId?: string) => {
    const source = draggedFeature.current
    if (!source || source.parentId !== parentId || source.id === targetId || !session) return
    const scheme = canonicalScheme(session.doc)
    const parent = scheme.cavities.find(f => f.instanceId === parentId)
    const list = parent?.kind === 'compound' ? parent.children : scheme.cavities
    const ids = list.map(f => f.instanceId)
    const from = ids.indexOf(source.id), to = ids.indexOf(targetId)
    if (from < 0 || to < 0) return
    ids.splice(from, 1); ids.splice(to, 0, source.id)
    if (parentId) reorderChildren(projectId, parentId, ids)
    else reorderFeatures(projectId, 'cavity', ids)
    draggedFeature.current = null
  }
  const deleteSelection = () => useDesignStore.getState().deleteSelection(projectId)

  const activeScheme = physicalScheme(session?.doc.schemes.find((s) => s.id === session.doc.activeSchemeId) || session?.doc.schemes[0])

  // 3D 拾取或特征树选择后平滑滚动到视野中央（不强制展开多孔父组，保持默认折叠）
  useEffect(() => {
    if (session?.selected) {
      const firstId =
        'id' in session.selected
          ? session.selected.id
          : session.selected.type === 'features' && session.selected.items[0]
            ? session.selected.items[0].id
            : null
      if (firstId) {
        setTimeout(() => {
          const el = containerRef.current?.querySelector(`[data-group-id="${firstId}"], [data-cavity-id="${firstId}"]`)
          if (el) {
            el.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
          }
        }, 50)
      }
    }
  }, [session?.selected])

  // 当前选中的特征集合与所有底层孔腔 ID
  const selectedFeatures = useMemo(() => {
    return getSelectedFeatures(session?.selected)
  }, [session?.selected])

  const selectedCavityIds = useMemo(() => {
    return getSelectedCavityIds(session?.selected, activeScheme)
  }, [session?.selected, activeScheme])

  // 处理特征点击（支持 Shift/Ctrl 多选特征）
  const handleFeatureClick = (feat: { type: 'cavity' | 'compound'; id: string }, isMulti: boolean) => {
    if (useAnalysisStore.getState().isActiveClearanceOpen) {
      if (feat.type === 'cavity') {
        useAnalysisStore.getState().pickClearanceObject({ kind: 'cavity', instanceId: feat.id })
        return
      }
    }

    if (isMulti) {
      const current = getSelectedFeatures(session?.selected)
      const exists = current.some((f) => f.type === feat.type && f.id === feat.id)
      let next: FeatureSelectionItem[] = []
      if (exists) {
        next = current.filter((f) => !(f.type === feat.type && f.id === feat.id))
      } else {
        next = [...current, feat]
      }
      if (next.length === 0) {
        selectFeature(projectId, { type: 'base', id: 'base' })
      } else if (next.length === 1) {
        selectFeature(projectId, { type: next[0].type, id: next[0].id } as any)
      } else {
        selectFeature(projectId, {
          type: 'features',
          items: next
        })
      }
    } else {
      selectFeature(projectId, { type: feat.type, id: feat.id } as any)
    }
  }

  if (!session) return null
  const { doc, selected } = session
  const [sx, sy, sz] = projectBody(doc).dimensions

  const isBaseSelected = selected?.type === 'base'
  const baseIcon = assetUrl(getBaseBodyIcon(projectBody(doc)))

  const shapeLabels: Record<string, string> = {
    box: _t("长方体"),
    'l-shape': _t("L型基体"),
    't-shape': _t("T型基体")
  }
  const shapeName =
    projectBody(doc).type === 'step'
      ? _t("STEP导入")
      : shapeLabels[projectBody(doc).template || 'box'] || _t("自定义基体")

  const totalHoleCount = activeScheme?.cavities.length || 0
  const openContextMenu = (event: MouseEvent, feat: { type: 'cavity' | 'compound'; id: string }) => {
    event.preventDefault()
    event.stopPropagation()
    if (!selectedFeatures.some(f => f.id === feat.id)) selectFeature(projectId, feat)
    setContextFeature(feat)
    setContextPoint({ x: event.clientX, y: event.clientY })
  }

  return (
    <div ref={containerRef} className="flex h-full flex-col select-none">
      {/* ── 标题 Header（对齐库管理 GroupHeader） ── */}
      <div className="flex h-9 shrink-0 items-center gap-1 pr-2.5">
        <span className="truncate text-xs font-semibold tracking-wide text-foreground pl-4">{_t("特征树")}</span>
        <span className="shrink-0 rounded px-1.5 py-0.2 text-[10px] text-foreground/40 font-mono">
          {totalHoleCount}
        </span>
        <button className="ml-auto p-1" title={_t('展开/折叠全部')} onClick={() => {
          const next = !baseExpanded || activeScheme?.compounds.some(g => !groupsExpanded[g.id])
          setBaseExpanded(Boolean(next)); setGroupsExpanded(Object.fromEntries((activeScheme?.compounds || []).map(g => [g.id, Boolean(next)])))
        }}>{baseExpanded ? <ChevronDown className="size-3"/> : <ChevronRight className="size-3"/>}</button>
      </div>

      {/* ── 树状节点列表（直接铺开基体与所有特征节点，不使用孔腔特征外层文件夹） ── */}
      <div className="flex-1 space-y-0.5 overflow-auto px-2 py-1 text-xs">
        {/* 1. 基体特征节点（默认折叠面子节点，点击直接选中基体） */}
        <div>
          <div
            className={cn(
              'group flex h-7 cursor-pointer items-center gap-1.5 rounded-md px-1.5 transition-colors',
              session?.baseBodyError
                ? 'border border-amber-500/40 bg-amber-500/10 text-foreground'
                : isBaseSelected
                  ? 'bg-accent text-accent-foreground font-medium'
                  : 'text-foreground hover:bg-accent'
            )}
            onClick={() => selectFeature(projectId, { type: 'base', id: 'base' })}
          >
            <button
              type="button"
              className="flex size-4 items-center justify-center rounded text-foreground/50 hover:text-foreground"
              onClick={(e) => {
                e.stopPropagation()
                setBaseExpanded((v) => !v)
              }}
            >
              {baseExpanded ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
            </button>

            {/* 根据类型渲染 Block.svg, LBlock.svg, TBlock.svg, ImportStep.svg */}
            <img src={baseIcon} alt="block" className="size-4 shrink-0 object-contain" />

            <span className="min-w-0 flex-1 truncate text-[11px] flex items-center gap-1">
              <span>{_t("基体 ·")}{shapeName}</span>
              {session?.baseBodyError && (
                <span className="text-[9px] font-semibold text-amber-600 dark:text-amber-400 bg-amber-500/20 px-1 py-0.2 rounded shrink-0">
                  {_t("已降级")}
                </span>
              )}
            </span>

            {/* 警告提示图标 */}
            {session?.baseBodyError && (
              <span
                title={session.baseBodyError}
                className="flex items-center text-amber-500 hover:text-amber-600 transition-colors shrink-0"
                onClick={(e) => {
                  e.stopPropagation()
                  alert(session.baseBodyError)
                }}
              >
                <AlertTriangle className="size-3.5 shrink-0 animate-pulse" />
              </span>
            )}

            <span className="shrink-0 text-[10px] text-foreground/40 font-mono">
              {sx}×{sy}×{sz}
            </span>
          </div>

          {/* 基体特征展开：子节点为当前基体的安装面 */}
          {baseExpanded && (
            <div className="space-y-0.5 pl-6 py-0.5">
              {(projectBody(doc).faces || []).map((face: BaseFaceDefinition) => {
                const isFaceSelected = selected?.type === 'face' && selected.id === face.id
                return (
                  <div
                    key={face.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => selectFeature(projectId, { type: 'face', id: face.id })}
                    className={cn(
                      'group flex h-6 cursor-pointer items-center gap-1.5 rounded px-1.5 text-[11px] transition-colors',
                      isFaceSelected
                        ? 'bg-accent text-accent-foreground font-medium'
                        : 'text-foreground/75 hover:bg-accent hover:text-foreground'
                    )}
                  >
                    <span className="size-1.5 rounded-full bg-foreground/30 group-hover:bg-primary/70 shrink-0" />
                    <span className="min-w-0 flex-1 truncate">{face.name}</span>
                    <span className="text-[9px] font-mono text-foreground/35">
                      ({face.normal.join(',')})
                    </span>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {canonicalScheme(doc).cavities.map((feature) => {
          const compound = feature.kind === 'compound'
          const expanded = Boolean(groupsExpanded[feature.instanceId])
          const frame = activeScheme?.compounds.find(g => g.id === feature.instanceId)
          const selectedRoot = selectedFeatures.some(f => f.id === feature.instanceId)
          const row = (id: string, name: string, u: number, v: number, suppressed: boolean, parentId?: string) => {
            const hole = activeScheme?.cavities.find(c => c.instanceId === id)
            const isParent = compound && !parentId
            const chosen = selectedRoot || selectedCavityIds.includes(id)
            const type = isParent ? 'compound' as const : 'cavity' as const
            return <div key={id} data-cavity-id={id} role="button" tabIndex={0} draggable
              onDragStart={e => { e.stopPropagation(); draggedFeature.current = {id, parentId} }}
              onDragOver={e => e.preventDefault()}
              onDrop={e => { e.preventDefault(); e.stopPropagation(); reorderFeature(id, parentId) }}
              onContextMenu={e => openContextMenu(e, {type, id})}
              onClick={e => handleFeatureClick({type, id}, e.shiftKey || e.ctrlKey || e.metaKey)}
              onDoubleClick={() => window.dispatchEvent(new CustomEvent('sureflow:focus-cavity', {detail:id}))}
              className={cn('group flex h-7 cursor-pointer items-center gap-1.5 rounded-md px-1.5 text-black transition-colors hover:bg-accent', chosen && 'bg-[#8DD7F4]', suppressed && 'opacity-40 italic')}>
              {isParent && <button onClick={e => {e.stopPropagation();setGroupsExpanded(prev => ({...prev,[id]:!expanded}))}}>{expanded ? <ChevronDown className="size-3"/> : <ChevronRight className="size-3"/>}</button>}
              <img className="size-3.5" src={isParent && frame ? getGroupTypeIcon(frame, libraryDoc) : hole ? getCavityTypeIcon(hole, libraryDoc) : ''}/>
              <span className="min-w-0 flex-1 truncate">{name}</span>
              <span className="text-[9px] font-mono">({Number(u.toFixed(2))}, {Number(v.toFixed(2))})</span>
              <button title={_t('抑制/恢复')} onClick={e => {e.stopPropagation();toggleCavitySuppressed(projectId,id)}}>{suppressed ? <EyeOff className="size-3"/> : <Eye className="size-3"/>}</button>
              {!parentId && <button title={_t('删除')} onClick={e => {e.stopPropagation();deleteCavity(projectId,id)}}><Trash2 className="size-3"/></button>}
            </div>
          }
          return <div key={feature.instanceId}>
            {row(feature.instanceId, feature.name, feature.u, feature.v, Boolean(feature.suppressed))}
            {compound && expanded && <div className="space-y-0.5 pl-5">{feature.children.map(child => row(child.instanceId,child.subHoleName || child.name,child.u,child.v,Boolean(child.suppressed),feature.instanceId))}</div>}
          </div>
        })}
        {!canonicalScheme(doc).cavities.length && <div className="py-4 text-center text-muted-foreground">{_t('暂无孔腔特征，请从右侧「孔腔库」添加')}</div>}
      </div>
      {contextPoint && contextFeature && (
        <div className="fixed z-[1000] min-w-32 rounded-md border bg-popover p-1 text-popover-foreground shadow-md" style={{ left: contextPoint.x, top: contextPoint.y }} onPointerDown={e => e.stopPropagation()}>
          <button className="flex w-full items-center rounded px-2 py-1.5 text-xs hover:bg-accent" onClick={() => { deleteSelection(); setContextPoint(null) }}><Trash2 className="mr-2 size-3.5" />{_t('删除')}</button>
          <button className="flex w-full items-center rounded px-2 py-1.5 text-xs hover:bg-accent" onClick={() => {copySelection(projectId);setContextPoint(null)}}>
            <Copy className="mr-2 size-3.5" />
            <span>{_t('复制')}</span>
            <kbd className="ml-auto pl-6 font-mono text-[10px] text-muted-foreground">Ctrl/Cmd+C</kbd>
          </button>
          <button className="flex w-full items-center rounded px-2 py-1.5 text-xs hover:bg-accent" onClick={() => {pasteSelection(projectId);setContextPoint(null)}}>
            <ClipboardPaste className="mr-2 size-3.5" />
            <span>{_t('粘贴')}</span>
            <kbd className="ml-auto pl-6 font-mono text-[10px] text-muted-foreground">Ctrl/Cmd+V</kbd>
          </button>
        </div>
      )}
    </div>
  )
}
