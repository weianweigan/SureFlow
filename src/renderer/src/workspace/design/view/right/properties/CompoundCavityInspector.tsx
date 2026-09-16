import { useLocale as _useLocale } from '@renderer/i18n/useLocale'
import { t as _t } from '@shared/i18n'
import React, { useState, useMemo } from 'react'
import {
  FormSectionWrapper,
  PropertyRow,
  NumberInput
} from './PropertyFormComponents'
import { CoordinateDatumSection } from './CoordinateDatumSection'
import { QuickTemplatePickerModal } from './QuickTemplatePickerModal'
import { useDesignStore, type DesignState } from '../../../model/designStore'
import { TYPE_REGISTRY } from '@shared/cavity/cavityTypeRegistry'
import type { CavityGroup, CavityInstance } from '@shared/design/types'
import type { CavityTemplate } from '@shared/cavity/types'
import { RefreshCw, EyeOff, Eye, Trash2, Ungroup, ChevronRight, Box } from 'lucide-react'

interface CompoundCavityInspectorProps {
  projectId: string
  group: CavityGroup
}

export const CompoundCavityInspector: React.FC<CompoundCavityInspectorProps> = ({
  projectId,
  group
}) => {
  _useLocale()
  const session = useDesignStore((s: DesignState) => s.projects[projectId])
  const moveGroup = useDesignStore((s: DesignState) => s.moveGroup)
  const rotateGroup = useDesignStore((s: DesignState) => s.rotateGroup)
  const disbandGroup = useDesignStore((s: DesignState) => s.disbandGroup)
  const deleteGroup = useDesignStore((s: DesignState) => s.deleteGroup)
  const toggleGroupSuppressed = useDesignStore((s: DesignState) => s.toggleGroupSuppressed)
  const replaceGroup = useDesignStore((s: DesignState) => s.replaceGroup)
  const selectFeature = useDesignStore((s: DesignState) => s.selectFeature)

  const [templatePickerOpen, setTemplatePickerOpen] = useState(false)

  if (!session) return null
  const { doc } = session
  const [sx, sy, sz] = doc.baseBody.dimensions
  const activeScheme = doc.schemes.find((s) => s.id === doc.activeSchemeId) || doc.schemes[0]

  // 获取子孔列表
  const memberCavities = useMemo(() => {
    const ids = new Set(group.cavityIds)
    return (activeScheme?.cavities || []).filter(
      (c: CavityInstance) => ids.has(c.instanceId) || c.groupId === group.id
    )
  }, [activeScheme, group])

  const faceId = group.faceId || memberCavities[0]?.faceId || 'F1'
  const isZFace = faceId === 'F1' || faceId === 'F2'
  const isYFace = faceId === 'F3' || faceId === 'F4'
  const faceW = isZFace ? sx : isYFace ? sx : sy
  const faceH = isZFace ? sy : isYFace ? sz : sz

  const groupCenterU =
    group.u ??
    (memberCavities.length > 0
      ? memberCavities.reduce((acc, c) => acc + c.u, 0) / memberCavities.length
      : 0)

  const groupCenterV =
    group.v ??
    (memberCavities.length > 0
      ? memberCavities.reduce((acc, c) => acc + c.v, 0) / memberCavities.length
      : 0)

  const otherCavitiesOnFace = useMemo(() => {
    const memberIdSet = new Set(memberCavities.map((c) => c.instanceId))
    return (activeScheme?.cavities || []).filter(
      (c: CavityInstance) => c.faceId === faceId && !memberIdSet.has(c.instanceId)
    )
  }, [activeScheme, faceId, memberCavities])

  const typeMeta = group.cavityType ? TYPE_REGISTRY[group.cavityType] : undefined

  // 处理替换组合孔
  const handleReplaceGroup = (newTmpl: CavityTemplate) => {
    const cavitiesData = (newTmpl.holes || []).map((h, i) => ({
      templateId: h.ref?.templateId || `sub-${i}`,
      name: `${newTmpl.name}_${h.name || i + 1}`,
      subHoleName: h.name,
      cavityType: h.cavityType,
      offsetU: Number(h.x) || 0,
      offsetV: Number(h.y) || 0,
      steps: h.geometry?.steps,
      ports: h.geometry?.ports
    }))

    replaceGroup(projectId, group.id, {
      name: newTmpl.name,
      cavityType: newTmpl.cavityType,
      cavities: cavitiesData
    })
  }

  const anySuppressed = memberCavities.some((c) => c.suppressed)

  return (
    <div className="flex h-full flex-col select-none overflow-y-auto">
      {/* 1. 基本信息与替换 */}
      <FormSectionWrapper
        title={_t('组合孔基本信息')}
        isFirst
        action={
          <button
            type="button"
            onClick={() => setTemplatePickerOpen(true)}
            className="flex items-center gap-1 rounded border border-border/70 bg-background px-2 py-0.5 text-[11px] font-medium text-foreground hover:bg-accent hover:border-primary/40 transition-colors cursor-pointer"
          >
            <RefreshCw className="size-3 text-primary" />
            <span>{_t('替换组合孔')}</span>
          </button>
        }
      >
        <PropertyRow label={_t('组合名称')}>
          <div className="flex items-center gap-1.5 w-full">
            <Box className="size-3.5 text-primary shrink-0" />
            <span className="font-semibold text-foreground text-xs">{group.name}</span>
          </div>
        </PropertyRow>
        <PropertyRow label={_t('组合类型')}>
          <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
            {typeMeta?.label || group.cavityType || _t('标准组合孔')}
          </span>
        </PropertyRow>
        <PropertyRow label={_t('包含子孔')}>
          <span className="font-mono text-xs text-foreground font-semibold">
            {memberCavities.length} {_t('个孔腔')}
          </span>
        </PropertyRow>
      </FormSectionWrapper>

      {/* 2. 组合中心坐标定位独立组（平移驱动整组） */}
      <CoordinateDatumSection
        u={groupCenterU}
        v={groupCenterV}
        faceId={faceId}
        faceWidth={faceW}
        faceHeight={faceH}
        otherCavitiesOnFace={otherCavitiesOnFace}
        isGroup
        onUpdatePosition={(newU, newV) => {
          const du = newU - groupCenterU
          const dv = newV - groupCenterV
          moveGroup(projectId, group.id, du, dv)
        }}
      />

      {/* 3. 整组旋转角度 */}
      <FormSectionWrapper title={_t('整组姿态')}>
        <PropertyRow label={_t('整组旋转角')} unit="°">
          <NumberInput
            value={group.rotation || 0}
            step={15}
            min={0}
            max={360}
            unit="°"
            onChange={(val) => {
              const deltaAngle = val - (group.rotation || 0)
              rotateGroup(projectId, group.id, deltaAngle)
            }}
          />
        </PropertyRow>
      </FormSectionWrapper>

      {/* 4. 子孔特征清单（钻取） */}
      <FormSectionWrapper
        title={_t('包含子孔特征')}
        action={
          <span className="text-[10px] text-muted-foreground">
            {_t('点击进入子孔检查')}
          </span>
        }
      >
        <div className="space-y-1.5">
          {memberCavities.map((cav, idx) => (
            <div
              key={cav.instanceId}
              onClick={() => selectFeature(projectId, { type: 'cavity', id: cav.instanceId })}
              className="flex cursor-pointer items-center justify-between rounded border border-border/60 bg-card p-2 hover:border-primary/50 hover:bg-accent/60 transition-colors"
            >
              <div className="flex items-center gap-2 min-w-0">
                <span className="font-mono text-[10px] text-muted-foreground">{idx + 1}.</span>
                <div className="min-w-0">
                  <div className="font-medium text-xs text-foreground truncate">
                    {cav.name}
                  </div>
                  <div className="font-mono text-[10px] text-muted-foreground">
                    ΔU={(cav.u - groupCenterU).toFixed(1)}, ΔV={(cav.v - groupCenterV).toFixed(1)}
                  </div>
                </div>
              </div>
              <ChevronRight className="size-3.5 text-muted-foreground shrink-0" />
            </div>
          ))}
        </div>
      </FormSectionWrapper>

      {/* 5. 底部操作 */}
      <div className="p-3 mt-auto border-t border-border/70 grid grid-cols-3 gap-2">
        <button
          type="button"
          onClick={() => disbandGroup(projectId, group.id)}
          className="flex items-center justify-center gap-1 rounded border border-border bg-background py-1.5 text-xs text-foreground hover:bg-accent cursor-pointer"
        >
          <Ungroup className="size-3.5 text-muted-foreground" />
          <span>{_t('解散')}</span>
        </button>
        <button
          type="button"
          onClick={() => toggleGroupSuppressed(projectId, group.id)}
          className="flex items-center justify-center gap-1 rounded border border-border bg-background py-1.5 text-xs text-foreground hover:bg-accent cursor-pointer"
        >
          {anySuppressed ? (
            <Eye className="size-3.5 text-emerald-500" />
          ) : (
            <EyeOff className="size-3.5 text-muted-foreground" />
          )}
          <span>{anySuppressed ? _t('恢复') : _t('抑制')}</span>
        </button>
        <button
          type="button"
          onClick={() => deleteGroup(projectId, group.id)}
          className="flex items-center justify-center gap-1 rounded border border-destructive/30 bg-destructive/10 py-1.5 text-xs text-destructive hover:bg-destructive/20 cursor-pointer"
        >
          <Trash2 className="size-3.5" />
          <span>{_t('删除')}</span>
        </button>
      </div>

      {/* 替换组合孔弹窗 */}
      <QuickTemplatePickerModal
        open={templatePickerOpen}
        onClose={() => setTemplatePickerOpen(false)}
        isComboMode={true}
        onSelect={handleReplaceGroup}
      />
    </div>
  )
}
