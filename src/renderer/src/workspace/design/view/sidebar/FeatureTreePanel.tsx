import { useLocale as _useLocale } from '@renderer/i18n/useLocale'
import { t as _t, msg as _msg } from '@shared/i18n'
import { useState, useEffect, useMemo, useRef, type FC } from 'react'
import {
  ChevronDown,
  ChevronRight,
  Eye,
  EyeOff,
  Trash2,
  AlertTriangle
} from 'lucide-react'
import {
  useDesignStore,
  getSelectedCavityIds,
  getSelectedFeatures,
  type FeatureSelectionItem
} from '../../model/designStore'
import { useLibraryStore } from '../../../library/viewmodel/libraryStore'
import { getBaseBodyIcon, type BaseFaceDefinition, type CavityInstance, type CavityGroup } from '@shared/design/types'
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
  group: CavityGroup,
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
  const deleteGroup = useDesignStore((s) => s.deleteGroup)
  const toggleGroupSuppressed = useDesignStore((s) => s.toggleGroupSuppressed)

  const libraryDoc = useLibraryStore((s) => s.doc)

  const [baseExpanded, setBaseExpanded] = useState(true)
  const [groupsExpanded, setGroupsExpanded] = useState<Record<string, boolean>>({})
  const containerRef = useRef<HTMLDivElement>(null)

  const activeScheme = session?.doc.schemes.find((s) => s.id === session.doc.activeSchemeId) || session?.doc.schemes[0]

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
  const handleFeatureClick = (feat: { type: 'cavity' | 'group'; id: string }, isMulti: boolean) => {
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

  // 组织多孔父组与独立单孔列表
  const { groupedList, standaloneList } = useMemo(() => {
    if (!activeScheme) return { groupedList: [], standaloneList: [] }

    const groups = activeScheme.groups || []
    const groupCavityIdSet = new Set<string>()

    const gList = groups
      .map((grp) => {
        const memberCavities = activeScheme.cavities.filter(
          (c) => c.groupId === grp.id || grp.cavityIds.includes(c.instanceId)
        )
        for (const c of memberCavities) {
          groupCavityIdSet.add(c.instanceId)
        }
        return {
          group: grp,
          cavities: memberCavities
        }
      })
      .filter((item) => item.cavities.length > 0)

    const sList = activeScheme.cavities.filter(
      (c) => !groupCavityIdSet.has(c.instanceId) && !c.groupId
    )

    return { groupedList: gList, standaloneList: sList }
  }, [activeScheme])

  if (!session) return null
  const { doc, selected } = session
  const [sx, sy, sz] = doc.baseBody.dimensions

  const isBaseSelected = selected?.type === 'base'
  const baseIcon = assetUrl(getBaseBodyIcon(doc.baseBody))

  const shapeLabels: Record<string, string> = {
    box: _t("长方体"),
    'l-shape': _t("L型基体"),
    't-shape': _t("T型基体")
  }
  const shapeName =
    doc.baseBody.type === 'step'
      ? _t("STEP导入")
      : shapeLabels[doc.baseBody.template || 'box'] || _t("自定义基体")

  const totalHoleCount = activeScheme?.cavities.length || 0

  return (
    <div ref={containerRef} className="flex h-full flex-col select-none">
      {/* ── 标题 Header（对齐库管理 GroupHeader） ── */}
      <div className="flex h-9 shrink-0 items-center gap-1 pr-2.5">
        <span className="truncate text-xs font-semibold tracking-wide text-foreground pl-4">{_t("特征树")}</span>
        <span className="shrink-0 rounded px-1.5 py-0.2 text-[10px] text-foreground/40 font-mono">
          {totalHoleCount}
        </span>
      </div>

      {/* ── 树状节点列表（直接铺开基体与所有特征节点，不使用孔腔特征外层文件夹） ── */}
      <div className="flex-1 space-y-0.5 overflow-auto px-2 py-1 text-xs">
        {/* 1. 基体特征节点 */}
        <div>
          <div
            className={cn(
              'group flex h-7 cursor-pointer items-center gap-1.5 rounded-md px-1.5 transition-colors',
              isBaseSelected ? 'bg-accent text-accent-foreground font-medium' : 'text-foreground hover:bg-accent'
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

            <span className="min-w-0 flex-1 truncate text-[11px]">
              {_t("基体 ·")}{shapeName}
            </span>
            <span className="shrink-0 text-[10px] text-foreground/40 font-mono">
              {sx}×{sy}×{sz}
            </span>
          </div>

          {/* 基体特征展开：子节点为各个安装面 */}
          {baseExpanded && (
            <div className="space-y-0.5 pl-6 py-0.5">
              {doc.baseBody.faces.map((face: BaseFaceDefinition) => {
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

        {/* 2. 多孔/组合孔父节点列表（直接平级展示于基体下方） */}
        {/* 2. 多孔/组合孔父节点列表（直接平级展示于基体下方） */}
        {groupedList.map(({ group, cavities }) => {
          const isGrpExpanded = Boolean(groupsExpanded[group.id])
          const isGrpSelected = selectedFeatures.some((f) => f.type === 'group' && f.id === group.id)
          const allSuppressed = cavities.length > 0 && cavities.every((c) => c.suppressed)
          const groupIconUrl = getGroupTypeIcon(group, libraryDoc)

          return (
            <div key={group.id} className="space-y-0.5">
              {/* 组合孔父级节点行 */}
              <div
                role="button"
                tabIndex={0}
                onClick={(e) => handleFeatureClick({ type: 'group', id: group.id }, e.shiftKey || e.ctrlKey || e.metaKey)}
                className={cn(
                  'group flex h-7 cursor-pointer items-center gap-1.5 rounded-md px-1.5 text-xs transition-colors',
                  isGrpSelected
                    ? 'bg-accent text-accent-foreground font-medium'
                    : 'text-foreground hover:bg-accent',
                  allSuppressed && 'opacity-40 italic'
                )}
              >
                <button
                  type="button"
                  className="flex size-4 items-center justify-center rounded text-foreground/50 hover:text-foreground"
                  onClick={(e) => {
                    e.stopPropagation()
                    setGroupsExpanded((prev) => ({ ...prev, [group.id]: !isGrpExpanded }))
                  }}
                >
                  {isGrpExpanded ? (
                    <ChevronDown className="size-3" />
                  ) : (
                    <ChevronRight className="size-3" />
                  )}
                </button>

                {/* 组合孔类型对应图标 */}
                <img
                  src={groupIconUrl}
                  alt={group.cavityType || 'group'}
                  className="size-3.5 shrink-0 object-contain"
                />

                <span className="min-w-0 flex-1 truncate text-[11px] font-medium">
                  {group.name}
                </span>

                {group.faceId && (
                  <span className="shrink-0 rounded px-1 py-px text-[9px] bg-muted text-foreground/50">
                    {group.faceId}
                  </span>
                )}

                <span className="shrink-0 text-[10px] text-foreground/40 font-mono">
                  {cavities.length}{_t("孔")}</span>

                {/* 组显隐与删除 */}
                <div
                  className="hidden shrink-0 items-center gap-0.5 group-hover:flex"
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    type="button"
                    title={allSuppressed ? _t("恢复整组") : _t("抑制整组")}
                    className="rounded-full p-0.5 text-foreground/40 hover:text-foreground"
                    onClick={() => toggleGroupSuppressed(projectId, group.id)}
                  >
                    {allSuppressed ? (
                      <EyeOff className="size-3 text-destructive" />
                    ) : (
                      <Eye className="size-3" />
                    )}
                  </button>
                  <button
                    type="button"
                    title={_t("删除整组孔腔")}
                    className="rounded-full p-0.5 text-foreground/40 hover:bg-destructive/10 hover:text-destructive"
                    onClick={() => deleteGroup(projectId, group.id)}
                  >
                    <Trash2 className="size-3" />
                  </button>
                </div>
              </div>

              {/* 展开各子孔节点 */}
              {isGrpExpanded && (
                <div className="space-y-0.5 pl-5 py-0.2">
                  {cavities.map((cavity, idx) => {
                    const isSelected = isGrpSelected || selectedCavityIds.includes(cavity.instanceId)
                    const isSuppressed = !!cavity.suppressed
                    const displayName =
                      cavity.subHoleName ||
                      cavity.name.replace(new RegExp(`^${group.name}\\s*-\\s*`), '')
                    const childIconUrl = getCavityTypeIcon(cavity, libraryDoc)

                    return (
                      <div
                        key={cavity.instanceId}
                        data-cavity-id={cavity.instanceId}
                        role="button"
                        tabIndex={0}
                        onClick={(e) => {
                          // 特征树直接选择：选择哪个节点就是哪一个
                          handleFeatureClick({ type: 'cavity', id: cavity.instanceId }, e.shiftKey || e.ctrlKey || e.metaKey)
                        }}
                        onDoubleClick={() => {
                          window.dispatchEvent(
                            new CustomEvent('sureflow:focus-cavity', { detail: cavity.instanceId })
                          )
                        }}
                        className={cn(
                          'group flex h-6.5 cursor-pointer items-center gap-1.5 rounded-md px-1.5 text-xs transition-colors',
                          isSelected
                            ? 'bg-accent text-accent-foreground font-medium'
                            : 'text-foreground/80 hover:bg-accent hover:text-foreground',
                          isSuppressed && 'opacity-40 italic',
                          cavity.dangling && !isSuppressed && 'bg-amber-50 dark:bg-amber-950/20 border border-amber-300/50'
                        )}
                      >
                        {isSuppressed ? (
                          <EyeOff className="size-3 text-muted-foreground shrink-0" />
                        ) : cavity.dangling ? (
                          <AlertTriangle className="size-3 text-amber-500 shrink-0" />
                        ) : (
                          <img
                            src={childIconUrl}
                            alt={cavity.cavityType || 'hole'}
                            className="size-3 shrink-0 object-contain"
                          />
                        )}

                        {cavity.portSemantic && !isSuppressed && (
                          <span
                            className="size-1.5 rounded-full shrink-0"
                            style={{ backgroundColor: cavity.portSemantic.color || '#38bdf8' }}
                            title={_msg`油口: ${cavity.portSemantic.label}`}
                          />
                        )}

                        <span className="text-[10px] text-foreground/40 font-mono shrink-0">
                          {idx + 1}.
                        </span>
                        <span className="min-w-0 flex-1 truncate text-[11px]">{displayName}</span>
                        <span className="shrink-0 text-[9px] font-mono text-muted-foreground/60">
                          ({cavity.u >= 0 ? `+${cavity.u}` : cavity.u}, {cavity.v >= 0 ? `+${cavity.v}` : cavity.v})
                        </span>

                        {/* 子孔显隐与删除 */}
                        <div
                          className="hidden shrink-0 items-center gap-0.5 group-hover:flex"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            type="button"
                            title={isSuppressed ? _t("取消抑制") : _t("临时抑制")}
                            className="rounded-full p-0.5 text-foreground/40 hover:text-foreground"
                            onClick={() => toggleCavitySuppressed(projectId, cavity.instanceId)}
                          >
                            {isSuppressed ? (
                              <EyeOff className="size-2.5 text-destructive" />
                            ) : (
                              <Eye className="size-2.5" />
                            )}
                          </button>
                          <button
                            type="button"
                            title={_t("删除孔腔")}
                            className="rounded-full p-0.5 text-foreground/40 hover:bg-destructive/10 hover:text-destructive"
                            onClick={() => deleteCavity(projectId, cavity.instanceId)}
                          >
                            <Trash2 className="size-2.5" />
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}

        {/* 3. 独立单孔列表（直接平级展示于基体和组合孔下方） */}
        {standaloneList.map((cavity, index) => {
          const isSelected = selectedFeatures.some((f) => f.type === 'cavity' && f.id === cavity.instanceId)
          const isSuppressed = !!cavity.suppressed
          const cavityIconUrl = getCavityTypeIcon(cavity, libraryDoc)

          return (
            <div
              key={cavity.instanceId}
              data-cavity-id={cavity.instanceId}
              role="button"
              tabIndex={0}
              onClick={(e) => {
                handleFeatureClick({ type: 'cavity', id: cavity.instanceId }, e.shiftKey || e.ctrlKey || e.metaKey)
              }}
              onDoubleClick={() => {
                window.dispatchEvent(
                  new CustomEvent('sureflow:focus-cavity', { detail: cavity.instanceId })
                )
              }}
              className={cn(
                'group flex h-7 cursor-pointer items-center gap-1.5 rounded-md px-1.5 text-xs transition-colors',
                isSelected
                  ? 'bg-accent text-accent-foreground font-medium'
                  : 'text-foreground hover:bg-accent',
                isSuppressed && 'opacity-40 italic',
                cavity.dangling && !isSuppressed && 'bg-amber-50 dark:bg-amber-950/20 border border-amber-300/50'
              )}
            >
              {isSuppressed ? (
                <EyeOff className="size-3.5 text-muted-foreground shrink-0" />
              ) : cavity.dangling ? (
                <AlertTriangle className="size-3.5 text-amber-500 shrink-0" />
              ) : (
                <img
                  src={cavityIconUrl}
                  alt={cavity.cavityType || 'cavity'}
                  className="size-3.5 shrink-0 object-contain"
                />
              )}

              {cavity.portSemantic && !isSuppressed && (
                <span
                  className="size-1.5 rounded-full shrink-0"
                  style={{ backgroundColor: cavity.portSemantic.color || '#38bdf8' }}
                  title={_msg`油口: ${cavity.portSemantic.label}`}
                />
              )}

              <span className="text-[10px] text-foreground/40 font-mono shrink-0">
                {index + 1}.
              </span>
              <span className="min-w-0 flex-1 truncate text-[11px]">{cavity.name}</span>

              <span className="shrink-0 text-[9px] font-mono text-muted-foreground/60">
                ({cavity.u >= 0 ? `+${cavity.u}` : cavity.u}, {cavity.v >= 0 ? `+${cavity.v}` : cavity.v})
              </span>

              <span className="shrink-0 rounded px-1 py-px text-[9px] bg-muted text-foreground/50">
                {cavity.faceId}
              </span>

              {/* 显隐与删除 */}
              <div
                className="hidden shrink-0 items-center gap-0.5 group-hover:flex"
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  type="button"
                  title={isSuppressed ? _t("取消抑制") : _t("临时抑制")}
                  className="rounded-full p-0.5 text-foreground/40 hover:text-foreground"
                  onClick={() => toggleCavitySuppressed(projectId, cavity.instanceId)}
                >
                  {isSuppressed ? (
                    <EyeOff className="size-3 text-destructive" />
                  ) : (
                    <Eye className="size-3" />
                  )}
                </button>
                <button
                  type="button"
                  title={_t("删除孔腔")}
                  className="rounded-full p-0.5 text-foreground/40 hover:bg-destructive/10 hover:text-destructive"
                  onClick={() => deleteCavity(projectId, cavity.instanceId)}
                >
                  <Trash2 className="size-3" />
                </button>
              </div>
            </div>
          )
        })}

        {/* 空态 */}
        {groupedList.length === 0 && standaloneList.length === 0 && (
          <div className="py-4 text-center text-[11px] text-muted-foreground/60">
            {_t("暂无孔腔特征，请从右侧「孔腔库」添加")}</div>
        )}
      </div>
    </div>
  )
}
