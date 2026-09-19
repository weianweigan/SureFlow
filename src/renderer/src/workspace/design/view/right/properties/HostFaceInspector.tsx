import { useLocale as _useLocale } from '@renderer/i18n/useLocale'
import { t as _t } from '@shared/i18n'
import React, { useState } from 'react'
import {
  FormSectionWrapper,
  PropertyRow,
  NumberInput,
  ToggleSwitch
} from './PropertyFormComponents'
import { useDesignStore, type DesignState } from '../../../model/designStore'
import { getBoxFaceBasis } from '@shared/design/faceMath'
import type { CavityInstance, CavityGroup } from '@shared/design/types'
import { Eye, ArrowUpDown, PlusCircle, Focus, Box } from 'lucide-react'

interface HostFaceInspectorProps {
  projectId: string
  faceId: string
}

export const HostFaceInspector: React.FC<HostFaceInspectorProps> = ({ projectId, faceId }) => {
  _useLocale()
  const session = useDesignStore((s: DesignState) => s.projects[projectId])
  const selectFeature = useDesignStore((s: DesignState) => s.selectFeature)
  const extrudeFace = useDesignStore((s: DesignState) => s.extrudeFace)

  const [thicknessDelta, setThicknessDelta] = useState(0)
  const [cavitiesFollow, setCavitiesFollow] = useState(true)

  if (!session) return null
  const { doc } = session
  const [sx, sy, sz] = doc.baseBody.dimensions
  const activeScheme = doc.schemes.find((s) => s.id === doc.activeSchemeId) || doc.schemes[0]

  const faceBasis = getBoxFaceBasis(faceId, doc.baseBody.dimensions, doc.baseBody)
  const faceDef = doc.baseBody.faces?.find((f) => f.id.toLowerCase() === faceId.toLowerCase())

  // 计算面的长宽尺寸 (W × H)
  const isZFace = faceId === 'F1' || faceId === 'F2' || Math.abs(faceBasis.w[2]) > 0.8
  const isYFace = faceId === 'F3' || faceId === 'F4' || Math.abs(faceBasis.w[1]) > 0.8
  const faceW = isZFace ? sx : isYFace ? sx : sy
  const faceH = isZFace ? sy : isYFace ? sz : sz

  // 收集挂载在此面的特征：独立孔与组合孔组
  const faceCavities = (activeScheme?.cavities || []).filter((c: CavityInstance) => c.faceId === faceId)
  const groupsOnFace = (activeScheme?.groups || []).filter((g: CavityGroup) => g.faceId === faceId)
  const groupIdsOnFace = new Set(groupsOnFace.map((g) => g.id))

  // 过滤出未归属于组合孔的独立孔
  const independentCavities = faceCavities.filter(
    (c: CavityInstance) => !c.groupId || !groupIdsOnFace.has(c.groupId)
  )

  const totalItemCount = independentCavities.length + groupsOnFace.length

  // 执行正视于此面
  const handleNormalTo = () => {
    window.dispatchEvent(
      new CustomEvent('sureflow:face-normal-to', {
        detail: { faceId, normal: faceBasis.w }
      })
    )
  }

  // 执行面厚度推拉（统一走 B-Rep 参数化推拉与孔腔跟随机制）
  const handleApplyThickness = () => {
    if (thicknessDelta === 0) return
    extrudeFace(projectId, faceId, thicknessDelta, cavitiesFollow)
    setThicknessDelta(0)
  }

  // 在此面布孔
  const handlePlaceCavityOnFace = () => {
    window.dispatchEvent(
      new CustomEvent('sureflow:open-library-for-face', { detail: { faceId } })
    )
  }

  return (
    <div className="flex h-full flex-col select-none overflow-y-auto">
      {/* 1. 面基准基本信息 */}
      <FormSectionWrapper
        title={_t('宿主面属性')}
        isFirst
        action={
          <span className="font-mono text-xs font-bold text-primary bg-primary/10 px-1.5 py-0.5 rounded">
            {faceId}
          </span>
        }
      >
        <PropertyRow label={_t('法向矢量')}>
          <span className="font-mono text-xs text-foreground">
            [{faceBasis.w.join(', ')}]
          </span>
        </PropertyRow>
        <PropertyRow label={_t('原点坐标')}>
          <span className="font-mono text-xs text-foreground">
            [{faceBasis.origin.map((v) => v.toFixed(1)).join(', ')}]
          </span>
        </PropertyRow>
        <PropertyRow label={_t('U 轴方向')}>
          <span className="font-mono text-xs text-foreground flex items-center">
            <span className="inline-block size-2 rounded-full bg-red-500 mr-1.5" />
            [{faceBasis.u.join(', ')}]
          </span>
        </PropertyRow>
        <PropertyRow label={_t('V 轴方向')}>
          <span className="font-mono text-xs text-foreground flex items-center">
            <span className="inline-block size-2 rounded-full bg-emerald-500 mr-1.5" />
            [{faceBasis.v.join(', ')}]
          </span>
        </PropertyRow>
        <PropertyRow label={_t('截面尺寸')}>
          <span className="font-mono text-xs text-foreground font-semibold">
            {faceW} × {faceH} mm
          </span>
        </PropertyRow>
      </FormSectionWrapper>

      {/* 2. 快捷面操作 */}
      <FormSectionWrapper title={_t('面快捷动作')}>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={handleNormalTo}
            className="flex items-center justify-center gap-1.5 rounded-md border border-border/70 bg-background p-2 text-xs font-medium text-foreground hover:bg-accent hover:border-primary/50 transition-colors cursor-pointer"
          >
            <Eye className="size-3.5 text-primary" />
            <span>{_t('正视于此面')}</span>
          </button>
          <button
            type="button"
            onClick={handlePlaceCavityOnFace}
            className="flex items-center justify-center gap-1.5 rounded-md border border-primary/40 bg-primary/10 p-2 text-xs font-semibold text-primary hover:bg-primary/20 transition-colors cursor-pointer"
          >
            <PlusCircle className="size-3.5 text-primary" />
            <span>{_t('在此面布孔')}</span>
          </button>
        </div>

        {/* 厚度推拉展开 */}
        <div className="mt-2 rounded-md border border-border/60 bg-muted/20 p-2 space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium text-foreground flex items-center gap-1">
              <ArrowUpDown className="size-3 text-muted-foreground" />
              {_t('面厚度推拉')}
            </span>
            {faceDef?.paramBinding && (
              <span className="font-mono text-[10px] text-primary bg-primary/10 px-1.5 py-0.5 rounded">
                {faceDef.paramBinding.description || faceDef.paramBinding.key}
              </span>
            )}
          </div>
          <PropertyRow label={_t('厚度增量')} unit="mm">
            <div className="flex items-center gap-1.5 w-full">
              <NumberInput
                value={thicknessDelta}
                onChange={setThicknessDelta}
                step={1}
                unit="mm"
              />
              <button
                type="button"
                disabled={thicknessDelta === 0}
                onClick={handleApplyThickness}
                className="h-7 shrink-0 rounded bg-primary px-2 text-xs font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50 cursor-pointer"
              >
                {_t('应用')}
              </button>
            </div>
          </PropertyRow>
          <div className="flex items-center justify-between pt-1 text-[11px] text-muted-foreground">
            <span>{_t('相连孔腔跟随推拉')}</span>
            <ToggleSwitch checked={cavitiesFollow} onChange={setCavitiesFollow} />
          </div>
        </div>
      </FormSectionWrapper>

      {/* 3. 挂载孔腔清单 (组合孔合并显示单条) */}
      <FormSectionWrapper
        title={_t('挂载孔腔特征')}
        collapsible
        defaultCollapsed={false}
        action={
          <span className="text-[10px] text-muted-foreground font-mono">
            {totalItemCount} {_t('项')}
          </span>
        }
      >
        {totalItemCount > 0 ? (
          <div className="rounded-md border border-border/60 divide-y divide-border/60 bg-card overflow-hidden">
            {/* 组合孔条目 */}
            {groupsOnFace.map((grp) => (
              <div
                key={grp.id}
                onClick={() => selectFeature(projectId, { type: 'group', id: grp.id })}
                className="flex cursor-pointer items-center justify-between px-2.5 py-1.5 text-xs hover:bg-accent/60 transition-colors"
              >
                <div className="flex items-center gap-1.5 min-w-0">
                  <Box className="size-3.5 text-primary shrink-0" />
                  <span className="font-semibold text-foreground truncate">
                    {grp.name}
                  </span>
                  <span className="text-[10px] text-muted-foreground font-mono">
                    ({grp.cavityIds.length}孔)
                  </span>
                </div>
                <span className="font-mono text-[10px] text-muted-foreground shrink-0">
                  U={grp.u ?? 0} V={grp.v ?? 0}
                </span>
              </div>
            ))}

            {/* 独立单孔条目 */}
            {independentCavities.map((c, i) => (
              <div
                key={c.instanceId}
                onClick={() => selectFeature(projectId, { type: 'cavity', id: c.instanceId })}
                className="flex cursor-pointer items-center justify-between px-2.5 py-1.5 text-xs hover:bg-accent/60 transition-colors"
              >
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="text-[10px] text-foreground/40 font-mono">
                    {groupsOnFace.length + i + 1}.
                  </span>
                  <span className="truncate text-foreground font-medium">{c.name}</span>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <span className="font-mono text-[10px] text-muted-foreground">
                    U={c.u} V={c.v}
                  </span>
                  <button
                    type="button"
                    title={_t('在视口中对焦')}
                    onClick={(e) => {
                      e.stopPropagation()
                      window.dispatchEvent(
                        new CustomEvent('sureflow:focus-cavity', { detail: c.instanceId })
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
        ) : (
          <div className="text-center text-[10px] text-muted-foreground/60 py-3">
            {_t('暂无孔腔挂载在此面')}
          </div>
        )}
      </FormSectionWrapper>
    </div>
  )
}
