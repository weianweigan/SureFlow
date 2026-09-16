import { useLocale as _useLocale } from '@renderer/i18n/useLocale'
import { t as _t } from '@shared/i18n'
import React, { useState, useMemo } from 'react'
import {
  FormSectionWrapper,
  PropertyRow,
  TextInput,
  NumberInput
} from './PropertyFormComponents'
import { useDesignStore, type DesignState } from '../../../model/designStore'
import { useChannelTopology } from '../../../interaction/channels/useChannelTopology'
import { ChannelColorPickerPopover } from '../../sidebar/ChannelColorPickerPopover'
import type { CavityInstance } from '@shared/design/types'
import {
  Eye,
  EyeOff,
  Focus,
  Activity,
  AlertTriangle,
  Zap,
  Gauge
} from 'lucide-react'
import { cn } from '@renderer/lib/utils'

interface FlowChannelInspectorProps {
  projectId: string
  channelId: string
}

export const FlowChannelInspector: React.FC<FlowChannelInspectorProps> = ({
  projectId,
  channelId
}) => {
  _useLocale()
  const session = useDesignStore((s: DesignState) => s.projects[projectId])
  const setChannelColor = useDesignStore((s: DesignState) => s.setChannelColor)
  const renameChannel = useDesignStore((s: DesignState) => s.renameChannel)
  const toggleChannelHidden = useDesignStore((s: DesignState) => s.toggleChannelHidden)
  const toggleChannelIsolated = useDesignStore((s: DesignState) => s.toggleChannelIsolated)
  const selectFeature = useDesignStore((s: DesignState) => s.selectFeature)

  const { topology } = useChannelTopology(projectId)
  const [colorPickerOpen, setColorPickerOpen] = useState(false)
  const [flowRateQ, setFlowRateQ] = useState(40) // 默认设定流量 40 L/min

  const channel = topology.channels.find((ch) => ch.id === channelId)

  if (!session || !channel) return null
  const { doc, isolatedChannelId } = session
  const activeScheme = doc.schemes.find((s) => s.id === doc.activeSchemeId) || doc.schemes[0]

  const memberCavities = (activeScheme?.cavities || []).filter((c: CavityInstance) =>
    channel.cavityIds.includes(c.instanceId)
  )

  const isIsolated = isolatedChannelId === channel.id

  // 估算通道最小通径 Deq (mm)
  const minDeq = useMemo(() => {
    let minDia = 10
    for (const c of memberCavities) {
      if (c.ports && c.ports.length > 0) {
        for (const p of c.ports) {
          if (p.diameter && p.diameter < minDia) minDia = p.diameter
        }
      }
    }
    return minDia
  }, [memberCavities])

  // 理论最小截面积 A_min (mm²)
  const minAreaMm2 = Math.round((Math.PI * Math.pow(minDeq / 2, 2)) * 10) / 10

  // 流速 v = Q / A (m/s)
  // Q in L/min = (Q * 1000 / 60) cm³/s = (Q * 1e6 / 60) mm³/s
  // v = (Q * 1e6 / 60) / (A * 1e3) = Q / (A * 0.06)
  const velocityMs = useMemo(() => {
    if (minAreaMm2 <= 0) return 0
    const v = flowRateQ / (minAreaMm2 * 0.06)
    return Math.round(v * 100) / 100
  }, [flowRateQ, minAreaMm2])

  // 局部流阻压降估算 Δp (bar)
  // Δp ≈ ζ * (1/2 * ρ * v²) / 10^5, 取液压油 ρ=860 kg/m³, 弯管/相交典型阻力系数 ζ ≈ 1.5 * N_cavities
  const estimatedDeltaPBar = useMemo(() => {
    const zeta = Math.max(1.5, memberCavities.length * 0.8)
    const pPa = zeta * 0.5 * 860 * Math.pow(velocityMs, 2)
    return Math.round((pPa / 100000) * 100) / 100
  }, [velocityMs, memberCavities.length])

  // 流速是否偏高警报 (> 6.0 m/s 判定为高流速管路，需警惕发热或冲蚀)
  const isVelocityHigh = velocityMs > 6.0

  return (
    <div className="flex h-full flex-col select-none overflow-y-auto">
      {/* 1. 通道名称与颜色 */}
      <FormSectionWrapper
        title={_t('通道回路属性')}
        isFirst
        action={
          <div className="flex items-center gap-1">
            <button
              type="button"
              title={isIsolated ? _t('取消通道隔离') : _t('隔离此通道显示')}
              onClick={() => toggleChannelIsolated(projectId, channel.id)}
              className={cn(
                'rounded p-1 transition-colors cursor-pointer',
                isIsolated
                  ? 'bg-primary/20 text-primary'
                  : 'text-muted-foreground hover:bg-accent hover:text-foreground'
              )}
            >
              <Zap className="size-3.5" />
            </button>
            <button
              type="button"
              title={channel.hidden ? _t('显示通道') : _t('隐藏通道')}
              onClick={() => toggleChannelHidden(projectId, channel.bindingKey)}
              className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground cursor-pointer"
            >
              {channel.hidden ? (
                <EyeOff className="size-3.5 text-destructive" />
              ) : (
                <Eye className="size-3.5" />
              )}
            </button>
          </div>
        }
      >
        <PropertyRow label={_t('通道名称')}>
          <TextInput
            value={channel.name}
            onChange={(val) => renameChannel(projectId, channel.bindingKey, val)}
          />
        </PropertyRow>

        <PropertyRow label={_t('通道颜色')}>
          <ChannelColorPickerPopover
            currentColor={channel.color}
            open={colorPickerOpen}
            onOpenChange={setColorPickerOpen}
            onSelectColor={(col: string) => setChannelColor(projectId, channel.bindingKey, col)}
            trigger={
              <button
                type="button"
                className="flex items-center gap-1.5 rounded border border-border px-2 py-1 hover:bg-accent cursor-pointer"
              >
                <div
                  className="size-3.5 rounded-full border border-black/20 shadow-2xs"
                  style={{ backgroundColor: channel.color }}
                />
                <span className="font-mono text-xs uppercase text-foreground">
                  {channel.color}
                </span>
              </button>
            }
          />
        </PropertyRow>

        <PropertyRow label={_t('连通孔数')}>
          <span className="font-mono text-xs text-foreground font-semibold">
            {channel.cavityIds.length} {_t('个孔腔相通')}
          </span>
        </PropertyRow>
      </FormSectionWrapper>

      {/* 2. 水力参数估算卡片 */}
      <FormSectionWrapper
        title={_t('水力参数与流速估算')}
        action={
          <span className="text-[10px] text-muted-foreground flex items-center gap-1">
            <Activity className="size-3 text-sky-500" />
            <span>ISO 4411</span>
          </span>
        }
      >
        <div className="rounded-md border border-border/60 bg-muted/20 p-2 space-y-2">
          <PropertyRow label={_t('最小通径 Deq')} unit="mm">
            <span className="font-mono text-xs text-foreground font-bold">
              Ø {minDeq} mm
            </span>
          </PropertyRow>

          <PropertyRow label={_t('流通截面 Amin')} unit="mm²">
            <span className="font-mono text-xs text-foreground">
              {minAreaMm2} mm²
            </span>
          </PropertyRow>

          <PropertyRow label={_t('设定流量 Q')} unit="L/min">
            <NumberInput
              value={flowRateQ}
              step={5}
              min={1}
              max={500}
              unit="L/min"
              onChange={setFlowRateQ}
            />
          </PropertyRow>

          <div className="border-t border-border/40 pt-2 space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground flex items-center gap-1">
                <Gauge className="size-3.5 text-primary" />
                {_t('计算流速 v')}:
              </span>
              <span
                className={cn(
                  'font-mono font-bold',
                  isVelocityHigh ? 'text-amber-500' : 'text-emerald-500'
                )}
              >
                {velocityMs} m/s
              </span>
            </div>

            {isVelocityHigh && (
              <div className="flex items-start gap-1 rounded bg-amber-500/10 p-1.5 text-[10px] text-amber-600 dark:text-amber-400 border border-amber-500/20">
                <AlertTriangle className="size-3.5 shrink-0 mt-0.5" />
                <span>
                  {_t('流速超过液压推荐经济流速(6.0 m/s)，建议加大相交直孔通径')}
                </span>
              </div>
            )}

            <div className="flex items-center justify-between text-xs pt-1">
              <span className="text-muted-foreground">{_t('估算压降 Δp')}:</span>
              <span className="font-mono text-foreground font-medium">
                ~ {estimatedDeltaPBar} bar
              </span>
            </div>
          </div>
        </div>
      </FormSectionWrapper>

      {/* 3. 相连孔腔成员列表 */}
      <FormSectionWrapper
        title={_t('包含孔腔成员')}
        action={
          <span className="text-[10px] text-muted-foreground font-mono">
            {memberCavities.length}
          </span>
        }
      >
        <div className="space-y-1">
          {memberCavities.map((cavity, idx) => (
            <div
              key={cavity.instanceId}
              onClick={() => selectFeature(projectId, { type: 'cavity', id: cavity.instanceId })}
              className="flex cursor-pointer items-center justify-between rounded-md border border-border/40 p-2 hover:border-primary/40 hover:bg-accent/60 transition-colors"
            >
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="text-[10px] font-mono text-muted-foreground">{idx + 1}.</span>
                <span className="truncate text-xs font-medium text-foreground">
                  {cavity.name}
                </span>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <span className="rounded bg-muted px-1 text-[9px] text-muted-foreground font-mono">
                  {cavity.faceId}
                </span>
                <button
                  type="button"
                  title={_t('在视口中对焦此孔')}
                  onClick={(e) => {
                    e.stopPropagation()
                    window.dispatchEvent(
                      new CustomEvent('sureflow:focus-cavity', { detail: cavity.instanceId })
                    )
                  }}
                  className="rounded p-0.5 text-muted-foreground hover:text-foreground"
                >
                  <Focus className="size-3" />
                </button>
              </div>
            </div>
          ))}
        </div>
      </FormSectionWrapper>
    </div>
  )
}
