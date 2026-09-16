import { useLocale as _useLocale } from '@renderer/i18n/useLocale'
import { t as _t, msg as _msg } from '@shared/i18n'
import { useState, useMemo, type FC, type MouseEvent } from 'react'
import {
  ChevronDown,
  ChevronRight,
  Eye,
  EyeOff,
  AlertTriangle,
  FolderClosed,
  FolderOpen,
  Sparkles,
  Focus
} from 'lucide-react'
import { useDesignStore } from '../../model/designStore'
import { useLibraryStore } from '../../../library/viewmodel/libraryStore'
import { useChannelTopology } from '../../interaction/channels/useChannelTopology'
import type { CavityInstance } from '@shared/design/types'
import { TYPE_ICONS, assetUrl } from '../../../library/view/typeIcons'
import type { CavityLibrary } from '@shared/cavity/types'
import { ChannelColorPickerPopover } from './ChannelColorPickerPopover'
import { cn } from '@renderer/lib/utils'

interface ChannelListPanelProps {
  projectId: string
  collapsed: boolean
  onToggleCollapse: () => void
}

/** 获取孔腔实例对应孔类型的 SVG 图标路径 */
function getCavityTypeIcon(
  cavity: CavityInstance,
  libraryDoc?: CavityLibrary | null
): string {
  if (cavity.cavityType && TYPE_ICONS[cavity.cavityType]) {
    return assetUrl(TYPE_ICONS[cavity.cavityType])
  }
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

export const ChannelListPanel: FC<ChannelListPanelProps> = ({
  projectId,
  collapsed,
  onToggleCollapse
}) => {
  _useLocale()
  const session = useDesignStore((s) => s.projects[projectId])
  const selectFeature = useDesignStore((s) => s.selectFeature)
  const setChannelColor = useDesignStore((s) => s.setChannelColor)
  const renameChannel = useDesignStore((s) => s.renameChannel)
  const toggleChannelHidden = useDesignStore((s) => s.toggleChannelHidden)
  const toggleChannelIsolated = useDesignStore((s) => s.toggleChannelIsolated)

  const libraryDoc = useLibraryStore((s) => s.doc)

  const activeScheme = session?.doc.schemes.find((s) => s.id === session.doc.activeSchemeId) || session?.doc.schemes[0]

  // 展开状态映射
  const [expandedChannels, setExpandedChannels] = useState<Record<string, boolean>>({})
  const [unconnectedExpanded, setUnconnectedExpanded] = useState(true)
  const [structuralExpanded, setStructuralExpanded] = useState(false)

  // 拾色器 Popover 状态
  const [activePickerKey, setActivePickerKey] = useState<string | null>(null)

  // 内联重命名状态
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [editNameText, setEditNameText] = useState('')

  const {topology}=useChannelTopology(projectId)


  const cavityMap = useMemo(() => {
    const map = new Map<string, CavityInstance>()
    if (activeScheme) {
      for (const c of activeScheme.cavities) {
        map.set(c.instanceId, c)
      }
    }
    return map
  }, [activeScheme])

  if (!session) return null

  const isChannelSelected = (channelId: string) => {
    return session.selected?.type === 'channel' && session.selected.id === channelId
  }

  const handleStartRename = (bindingKey: string, currentName: string, e: MouseEvent) => {
    e.stopPropagation()
    setEditingKey(bindingKey)
    setEditNameText(currentName)
  }

  const handleSaveRename = (bindingKey: string) => {
    if (editingKey === bindingKey && editNameText.trim()) {
      renameChannel(projectId, bindingKey, editNameText.trim())
    }
    setEditingKey(null)
  }

  return (
    <div className="flex h-full flex-col bg-background/50 select-none">
      {/* ── 标题栏（可折叠 Header） ── */}
      <div
        className="flex h-9 shrink-0 cursor-pointer items-center justify-between px-2.5 hover:bg-accent/40 transition-colors"
        onClick={onToggleCollapse}
      >
        <div className="flex items-center gap-1.5 min-w-0">
          <button
            type="button"
            className="flex size-4 items-center justify-center rounded text-foreground/50 hover:text-foreground"
            onClick={(e) => {
              e.stopPropagation()
              onToggleCollapse()
            }}
          >
            {collapsed ? <ChevronRight className="size-3.5" /> : <ChevronDown className="size-3.5" />}
          </button>
          <span className="truncate text-xs font-semibold tracking-wide text-foreground">{_t("通道列表")}</span>
          <span className="shrink-0 rounded bg-muted/60 px-1.5 py-0.2 text-[10px] text-foreground/50 font-mono">
            {topology.channels.length} {_t("回路")}{topology.unconnectedCavityIds.length > 0 && _msg` · ${topology.unconnectedCavityIds.length} 未连`}
          </span>
        </div>

        {!collapsed && session.isolatedChannelId && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              toggleChannelIsolated(projectId, null)
            }}
            className="flex items-center gap-1 rounded bg-primary/15 px-1.5 py-0.5 text-[10px] font-medium text-primary hover:bg-primary/25"
            title={_t("退出回路隔离模式")}
          >
            <Sparkles className="size-2.5" />
            <span>{_t("隔离中")}</span>
          </button>
        )}
      </div>

      {/* ── 通道列表内容（折叠时隐藏） ── */}
      {!collapsed && (
        <div className="flex-1 space-y-0.5 overflow-auto px-2 py-1 text-xs">
          {/* 1. 已连通通道列表 */}
          {topology.channels.map((channel) => {
            const isSelected = isChannelSelected(channel.id)
            const isExpanded = !!expandedChannels[channel.id]
            const isIsolated = session.isolatedChannelId === channel.id
            const isEditing = editingKey === channel.bindingKey

            return (
              <div key={channel.id} className="space-y-0.5">
                {/* 通道父节点 */}
                <div
                  className={cn(
                    'group relative flex h-7 cursor-pointer items-center gap-1.5 rounded-md px-1.5 text-xs transition-colors',
                    isSelected
                      ? 'bg-accent text-accent-foreground font-medium'
                      : 'text-foreground hover:bg-accent/60',
                    channel.hidden && 'opacity-40',
                    isIsolated && 'ring-1 ring-primary'
                  )}
                  onClick={() => {
                    selectFeature(projectId, {
                      type: 'channel',
                      id: channel.id,
                      cavityIds: channel.cavityIds
                    })
                  }}
                  onDoubleClick={(e) => handleStartRename(channel.bindingKey, channel.name, e)}
                >
                  {/* 折叠/展开箭头 */}
                  <button
                    type="button"
                    className="flex size-4 items-center justify-center rounded text-foreground/50 hover:text-foreground"
                    onClick={(e) => {
                      e.stopPropagation()
                      setExpandedChannels((prev) => ({
                        ...prev,
                        [channel.id]: !prev[channel.id]
                      }))
                    }}
                  >
                    {isExpanded ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
                  </button>

                  {/* 颜色圆形色块 (Color Pill) */}
                  <div onClick={(e) => e.stopPropagation()}>
                    <ChannelColorPickerPopover
                      currentColor={channel.color}
                      open={activePickerKey === channel.bindingKey}
                      onOpenChange={(open) => setActivePickerKey(open ? channel.bindingKey : null)}
                      onSelectColor={(col) => {
                        setChannelColor(projectId, channel.bindingKey, col)
                      }}
                      trigger={
                        <button
                          type="button"
                          className="size-3.5 rounded-full border border-black/20 shadow-xs hover:scale-115 transition-transform cursor-pointer"
                          style={{ backgroundColor: channel.color }}
                          title={_t("点击配置通道颜色")}
                        />
                      }
                    />
                  </div>

                  {/* 通道名称 */}
                  {isEditing ? (
                    <input
                      type="text"
                      value={editNameText}
                      autoFocus
                      onChange={(e) => setEditNameText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleSaveRename(channel.bindingKey)
                        if (e.key === 'Escape') setEditingKey(null)
                      }}
                      onBlur={() => handleSaveRename(channel.bindingKey)}
                      onClick={(e) => e.stopPropagation()}
                      className="h-5 flex-1 rounded border border-primary bg-background px-1 text-[11px] text-foreground focus:outline-none"
                    />
                  ) : (
                    <span
                      className="min-w-0 flex-1 truncate text-[11px]"
                      title={_t("双击可重命名")}
                    >
                      {channel.name}
                    </span>
                  )}

                  {/* 孔数徽章 */}
                  <span className="shrink-0 rounded px-1 py-px text-[9px] font-mono text-muted-foreground/80 bg-muted/50">
                    {channel.cavityIds.length}{_t("孔")}</span>

                  {/* 操作按钮组 (显隐与隔离) */}
                  <div
                    className="hidden shrink-0 items-center gap-0.5 group-hover:flex"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      type="button"
                      title={channel.hidden ? _t("显示通道") : _t("隐藏通道 (Alt+点击仅隔离当前回路)")}
                      className="rounded-full p-0.5 text-foreground/40 hover:text-foreground"
                      onClick={(e) => {
                        if (e.altKey) {
                          toggleChannelIsolated(projectId, channel.id)
                        } else {
                          toggleChannelHidden(projectId, channel.bindingKey)
                        }
                      }}
                    >
                      {channel.hidden ? (
                        <EyeOff className="size-3 text-destructive" />
                      ) : (
                        <Eye className="size-3" />
                      )}
                    </button>

                    <button
                      type="button"
                      title={_t("在视口中聚焦该通道")}
                      className="rounded-full p-0.5 text-foreground/40 hover:text-foreground"
                      onClick={() => {
                        if (channel.cavityIds[0]) {
                          window.dispatchEvent(
                            new CustomEvent('sureflow:focus-cavity', {
                              detail: channel.cavityIds[0]
                            })
                          )
                        }
                      }}
                    >
                      <Focus className="size-2.5" />
                    </button>
                  </div>
                </div>

                {/* 通道包含的子孔列表 */}
                {isExpanded && (
                  <div className="ml-5 space-y-0.5 border-l border-border/50 pl-2">
                    {channel.cavityIds.map((cid, subIdx) => {
                      const cavity = cavityMap.get(cid)
                      if (!cavity) return null
                      const iconUrl = getCavityTypeIcon(cavity, libraryDoc)
                      const isCavitySelected =
                        session.selected?.type === 'cavity' && session.selected.id === cid

                      return (
                        <div
                          key={cid}
                          data-cavity-id={cid}
                          role="button"
                          tabIndex={0}
                          onClick={(e) => {
                            e.stopPropagation()
                            selectFeature(projectId, { type: 'cavity', id: cid })
                          }}
                          onDoubleClick={() => {
                            window.dispatchEvent(
                              new CustomEvent('sureflow:focus-cavity', { detail: cid })
                            )
                          }}
                          className={cn(
                            'group flex h-6 cursor-pointer items-center gap-1.5 rounded-md px-1.5 text-xs transition-colors',
                            isCavitySelected
                              ? 'bg-accent text-accent-foreground font-medium'
                              : 'text-foreground/80 hover:bg-accent hover:text-foreground'
                          )}
                        >
                          <img
                            src={iconUrl}
                            alt="icon"
                            className="size-3 shrink-0 object-contain"
                          />
                          <span className="text-[10px] text-foreground/40 font-mono shrink-0">
                            {subIdx + 1}.
                          </span>
                          <span className="min-w-0 flex-1 truncate text-[11px]">
                            {cavity.name}
                          </span>
                          <span className="shrink-0 rounded px-1 py-px text-[9px] bg-muted/60 text-foreground/50">
                            {cavity.faceId}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}

          {/* 2. 置底：未连接通道 / 孤立孔腔节点 */}
          <div className="pt-1.5">
            <div
              className={cn(
                'group flex h-7 cursor-pointer items-center gap-1.5 rounded-md px-1.5 text-xs transition-colors',
                topology.unconnectedCavityIds.length > 0
                  ? 'text-amber-600 dark:text-amber-400 hover:bg-amber-500/10'
                  : 'text-foreground/60 hover:bg-accent/40'
              )}
              onClick={() => setUnconnectedExpanded((v) => !v)}
            >
              <button
                type="button"
                className="flex size-4 items-center justify-center rounded text-foreground/50 hover:text-foreground"
                onClick={(e) => {
                  e.stopPropagation()
                  setUnconnectedExpanded((v) => !v)
                }}
              >
                {unconnectedExpanded ? (
                  <ChevronDown className="size-3" />
                ) : (
                  <ChevronRight className="size-3" />
                )}
              </button>

              <AlertTriangle className="size-3.5 shrink-0" />
              <span className="min-w-0 flex-1 truncate text-[11px] font-medium">
                {_t("未连接通道")}</span>

              <span
                className={cn(
                  'shrink-0 rounded px-1.5 py-px text-[9px] font-mono',
                  topology.unconnectedCavityIds.length > 0
                    ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300 font-semibold'
                    : 'bg-muted/50 text-muted-foreground'
                )}
              >
                {topology.unconnectedCavityIds.length}
              </span>
            </div>

            {/* 未连通孔腔子列表 */}
            {unconnectedExpanded && (
              <div className="ml-5 space-y-0.5 border-l border-amber-400/30 pl-2 pt-0.5">
                {topology.unconnectedCavityIds.length === 0 && (
                  <div className="py-1 text-[11px] text-muted-foreground/60 italic">
                    {_t("所有流道孔腔均已打通连通")}</div>
                )}

                {topology.unconnectedCavityIds.map((cid) => {
                  const cavity = cavityMap.get(cid)
                  if (!cavity) return null
                  const iconUrl = getCavityTypeIcon(cavity, libraryDoc)
                  const isSelected =
                    session.selected?.type === 'cavity' && session.selected.id === cid
                  const isPort = !!cavity.portSemantic || cavity.cavityType === 'port-cavity'

                  return (
                    <div
                      key={cid}
                      role="button"
                      tabIndex={0}
                      onClick={() => selectFeature(projectId, { type: 'cavity', id: cid })}
                      onDoubleClick={() => {
                        window.dispatchEvent(
                          new CustomEvent('sureflow:focus-cavity', { detail: cid })
                        )
                      }}
                      className={cn(
                        'flex h-6 cursor-pointer items-center gap-1.5 rounded-md px-1.5 text-xs transition-colors',
                        isSelected
                          ? 'bg-accent text-accent-foreground font-medium'
                          : 'text-foreground/80 hover:bg-accent',
                        isPort && 'text-amber-600 dark:text-amber-400'
                      )}
                    >
                      <img src={iconUrl} alt="icon" className="size-3 shrink-0 object-contain" />
                      <span className="min-w-0 flex-1 truncate text-[11px]">{cavity.name}{topology.unconnectedPorts?.filter(p=>p.cavityId===cid).map(p=>_msg` · 侧油口 ${p.portIndex+1} 未连通`).join('')}</span>
                      {isPort && (
                        <span className="shrink-0 rounded bg-amber-500/15 px-1 text-[8px] font-medium text-amber-700 dark:text-amber-300">
                          {_t("油口孤立")}</span>
                      )}
                      <span className="shrink-0 rounded px-1 py-px text-[9px] bg-muted/60 text-foreground/50">
                        {cavity.faceId}
                      </span>
                    </div>
                  )
                })}

                {/* 结构紧固孔收纳折叠组（螺栓孔/定位销） */}
                {topology.structuralCavityIds.length > 0 && (
                  <div className="pt-1">
                    <div
                      className="flex h-5 cursor-pointer items-center gap-1 text-[10px] text-muted-foreground/70 hover:text-foreground"
                      onClick={() => setStructuralExpanded((v) => !v)}
                    >
                      {structuralExpanded ? (
                        <FolderOpen className="size-3" />
                      ) : (
                        <FolderClosed className="size-3" />
                      )}
                      <span className="truncate">{_t("结构紧固孔 (非流道)")}</span>
                      <span className="font-mono">({topology.structuralCavityIds.length})</span>
                    </div>

                    {structuralExpanded && (
                      <div className="ml-3 space-y-0.5 pl-1.5 border-l border-border/40">
                        {topology.structuralCavityIds.map((cid) => {
                          const cavity = cavityMap.get(cid)
                          if (!cavity) return null
                          return (
                            <div
                              key={cid}
                              onClick={() => selectFeature(projectId, { type: 'cavity', id: cid })}
                              className="flex h-5 cursor-pointer items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground hover:bg-accent/40 rounded px-1"
                            >
                              <span className="truncate flex-1">{cavity.name}</span>
                              <span className="text-[8px] bg-muted px-1 rounded">{cavity.faceId}</span>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
