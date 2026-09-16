import { useLocale as _useLocale } from '@renderer/i18n/useLocale'
import { t as _t } from '@shared/i18n'
import React, { useMemo } from 'react'
import { FormSectionWrapper, PropertyRow } from './PropertyFormComponents'
import { useDesignStore, type DesignState } from '../../../model/designStore'
import { useChannelTopology } from '../../../interaction/channels/useChannelTopology'
import { ArrowLeft, AlertCircle, CheckCircle2 } from 'lucide-react'

interface SidePortInspectorProps {
  projectId: string
  cavityId: string
  portIndex: number
}

export const SidePortInspector: React.FC<SidePortInspectorProps> = ({
  projectId,
  cavityId,
  portIndex
}) => {
  _useLocale()
  const session = useDesignStore((s: DesignState) => s.projects[projectId])
  const selectFeature = useDesignStore((s: DesignState) => s.selectFeature)
  const { topology } = useChannelTopology(projectId)

  if (!session) return null
  const { doc } = session
  const activeScheme = doc.schemes.find((s) => s.id === doc.activeSchemeId) || doc.schemes[0]
  const cavity = activeScheme?.cavities.find((c) => c.instanceId === cavityId)

  if (!cavity) return null
  const port = cavity.ports?.[portIndex]

  // 查找该油口属于哪个通道回路
  const matchedChannel = useMemo(() => {
    return topology.channels.find((ch) => ch.cavityIds.includes(cavityId)) || null
  }, [topology, cavityId])

  const portDia = port?.diameter || 6
  const portDepth = port?.depth || 0
  const isBottom = Boolean(port?.isBottomPort)
  const portAreaMm2 = Math.round((Math.PI * Math.pow(portDia / 2, 2)) * 10) / 10

  return (
    <div className="flex h-full flex-col select-none overflow-y-auto">
      {/* 顶部父孔面包屑导航 */}
      <div className="flex h-9 items-center gap-1.5 border-b border-border/70 px-3 bg-muted/40">
        <button
          type="button"
          onClick={() => selectFeature(projectId, { type: 'cavity', id: cavity.instanceId })}
          className="flex items-center gap-1 text-xs text-primary font-medium hover:underline cursor-pointer"
        >
          <ArrowLeft className="size-3.5" />
          <span>{cavity.name}</span>
        </button>
        <span className="text-muted-foreground text-xs">/</span>
        <span className="text-xs font-semibold text-foreground">
          {_t('侧油口')} P{portIndex + 1}
        </span>
      </div>

      {/* 1. 侧油口基本几何属性 */}
      <FormSectionWrapper
        title={_t('侧油口几何规格')}
        isFirst
        action={
          <span className="rounded bg-sky-500/15 px-1.5 py-0.5 text-[10px] font-mono font-semibold text-sky-600 dark:text-sky-400">
            P{portIndex + 1}
          </span>
        }
      >
        <PropertyRow label={_t('通径规格')} unit="mm">
          <span className="font-mono text-xs text-foreground font-bold">
            Ø {portDia} mm
          </span>
        </PropertyRow>
        <PropertyRow label={_t('轴向深度 Z')} unit="mm">
          <span className="font-mono text-xs text-foreground">
            {portDepth} mm
          </span>
        </PropertyRow>
        <PropertyRow label={_t('端口类型')}>
          <span className="text-xs text-muted-foreground">
            {isBottom ? _t('直孔通底口') : _t('侧壁径向沉割槽开口')}
          </span>
        </PropertyRow>
        <PropertyRow label={_t('流通截面')} unit="mm²">
          <span className="font-mono text-xs text-foreground font-medium">
            {portAreaMm2} mm²
          </span>
        </PropertyRow>
      </FormSectionWrapper>

      {/* 2. 拓扑连通流道诊断 */}
      <FormSectionWrapper title={_t('流道回路连通状态')}>
        {matchedChannel ? (
          <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 p-2.5 space-y-1.5">
            <div className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400 font-semibold">
              <CheckCircle2 className="size-4" />
              <span>{_t('已接入通道回路')}</span>
            </div>
            <div className="flex items-center justify-between text-xs pt-1 border-t border-emerald-500/20">
              <div className="flex items-center gap-1.5">
                <span
                  className="size-2.5 rounded-full"
                  style={{ backgroundColor: matchedChannel.color }}
                />
                <span className="font-medium text-foreground">{matchedChannel.name}</span>
              </div>
              <button
                type="button"
                onClick={() =>
                  selectFeature(projectId, {
                    type: 'channel',
                    id: matchedChannel.id,
                    cavityIds: matchedChannel.cavityIds
                  })
                }
                className="text-[11px] text-primary hover:underline cursor-pointer"
              >
                {_t('查看通道详情')} →
              </button>
            </div>
          </div>
        ) : (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-2.5 space-y-2">
            <div className="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400 font-semibold">
              <AlertCircle className="size-4" />
              <span>{_t('未连通独立流道')}</span>
            </div>
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              {_t('该侧油口暂未与其他直孔形成几何相贯。您可以通过创建相邻相交孔或双孔快捷连接使其形成油路闭环。')}
            </p>
          </div>
        )}
      </FormSectionWrapper>
    </div>
  )
}
