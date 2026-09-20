import { useLocale as _useLocale } from '@renderer/i18n/useLocale'
import { t as _t } from '@shared/i18n'
import React, { useState, useMemo } from 'react'
import {
  FormSectionWrapper,
  PropertyRow,
  NumberInput,
  CustomSelect
} from './PropertyFormComponents'
import { Cavity2DPreview } from '../Cavity2DPreview'
import { useDesignStore, type DesignState } from '../../../model/designStore'
import { useLibraryStore, type LibraryState } from '../../../../library/viewmodel/libraryStore'
import { getCavitySteps } from '../../../geometry/cavityProfileBuilder'
import { TYPE_REGISTRY } from '@shared/cavity/cavityTypeRegistry'
import type { CavityInstance, CavityGroup } from '@shared/design/types'
import type { CavityTemplate, Step } from '@shared/cavity/types'
import { ArrowLeft, Lock, ArrowRight } from 'lucide-react'
import { cn } from '@renderer/lib/utils'

interface SubCavityInspectorProps {
  projectId: string
  cavity: CavityInstance
  parentGroup: CavityGroup
}

const PORT_SEMANTIC_OPTIONS = [
  { label: '无', value: '无' },
  { label: 'P (进油口)', value: 'P' },
  { label: 'T (回油口)', value: 'T' },
  { label: 'A (工作口A)', value: 'A' },
  { label: 'B (工作口B)', value: 'B' },
  { label: 'X (先导控制口)', value: 'X' },
  { label: 'Y (先导回油口)', value: 'Y' },
  { label: 'L (外泄油口)', value: 'L' }
]

const COLOR_MAP: Record<string, string> = {
  P: '#ef4444',
  T: '#3b82f6',
  A: '#10b981',
  B: '#f59e0b',
  X: '#8b5cf6',
  Y: '#06b6d4',
  L: '#64748b'
}

export const SubCavityInspector: React.FC<SubCavityInspectorProps> = ({
  projectId,
  cavity,
  parentGroup
}) => {
  _useLocale()
  const session = useDesignStore((s: DesignState) => s.projects[projectId])
  const updateCavity = useDesignStore((s: DesignState) => s.updateCavity)
  const moveGroup = useDesignStore((s: DesignState) => s.moveGroup)
  const selectFeature = useDesignStore((s: DesignState) => s.selectFeature)
  const libraryDoc = useLibraryStore((s: LibraryState) => s.doc)

  const [activeStepIdx, setActiveStepIdx] = useState<number | null>(null)
  const [activePortIdx, setActivePortIdx] = useState<number | null>(null)

  if (!session) return null

  // 相对组原点的偏移
  const groupU = parentGroup.u ?? 0
  const groupV = parentGroup.v ?? 0
  const relativeU = Math.round((cavity.u - groupU) * 10) / 10
  const relativeV = Math.round((cavity.v - groupV) * 10) / 10

  // 阶梯数据
  const cavitySteps = useMemo<Step[]>(() => {
    return cavity.steps && cavity.steps.length > 0
      ? cavity.steps
      : getCavitySteps(cavity, libraryDoc)
  }, [cavity, libraryDoc])

  const bottomStepIndex = useMemo(() => {
    if (!cavitySteps || cavitySteps.length === 0) return -1
    for (let i = cavitySteps.length - 1; i >= 0; i--) {
      if (cavitySteps[i].type === 'straight') return i
    }
    return cavitySteps.length - 1
  }, [cavitySteps])

  const currentBottomDepth =
    bottomStepIndex >= 0 && bottomStepIndex < cavitySteps.length
      ? cavitySteps[bottomStepIndex]?.length ?? 20
      : 20

  // 构造对应的 CavityTemplate 用于 2D 剖面
  const previewTemplate = useMemo<CavityTemplate>(() => {
    const rawTmpl = libraryDoc?.templates?.find((t: CavityTemplate) => t.id === cavity.templateId)
    return {
      id: cavity.templateId,
      name: cavity.name,
      cavityType: cavity.cavityType || 'cartridge-valve',
      unit: 'mm',
      categoryId: 'custom',
      meta: rawTmpl?.meta || { createdAt: '', updatedAt: '', revision: 1 },
      geometry: {
        steps: cavitySteps as any,
        ports: (cavity.ports || rawTmpl?.geometry?.ports || []) as any
      }
    }
  }, [cavity, cavitySteps, libraryDoc])

  const typeMeta = TYPE_REGISTRY[cavity.cavityType || 'cartridge-valve']

  return (
    <div className="flex h-full flex-col select-none overflow-y-auto">
      {/* 顶部父级面包屑导航 */}
      <div className="flex h-9 items-center gap-1.5 border-b border-border/70 px-3 bg-muted/40">
        <button
          type="button"
          onClick={() => selectFeature(projectId, { type: 'group', id: parentGroup.id })}
          className="flex items-center gap-1 text-xs text-primary font-medium hover:underline cursor-pointer"
        >
          <ArrowLeft className="size-3.5" />
          <span>{parentGroup.name}</span>
        </button>
        <span className="text-muted-foreground text-xs">/</span>
        <span className="text-xs font-semibold text-foreground truncate">{cavity.name}</span>
      </div>

      {/* 1. 2D 交互式剖面图 */}
      <div className="border-b border-border/70 bg-card/60 p-3">
        <div className="h-44 w-full rounded-md border border-border/60 bg-background/50 flex items-center justify-center overflow-hidden">
          <Cavity2DPreview
            template={previewTemplate}
            activeStepIndex={activeStepIdx}
            onSelectStep={(idx) => setActiveStepIdx(idx === activeStepIdx ? null : idx)}
            activePortIndex={activePortIdx}
            onSelectPort={(pIdx) => {
              setActivePortIdx(pIdx === activePortIdx ? null : pIdx)
              selectFeature(projectId, {
                type: 'port',
                cavityId: cavity.instanceId,
                portIndex: pIdx
              })
            }}
            className="size-full p-1"
          />
        </div>
      </div>

      {/* 2. 基本信息与相对组坐标（锁定） */}
      <FormSectionWrapper title={_t('子孔基本信息')} isFirst>
        <PropertyRow label={_t('子孔标识')}>
          <div className="flex items-center gap-1.5">
            <span className="font-semibold text-foreground text-xs">{cavity.name}</span>
            {cavity.subHoleName && (
              <span className="rounded bg-primary/15 text-primary text-[10px] font-mono px-1">
                {cavity.subHoleName}
              </span>
            )}
          </div>
        </PropertyRow>
        <PropertyRow label={_t('孔腔类型')}>
          <span className="text-xs text-muted-foreground">
            {typeMeta?.label || cavity.cavityType}
          </span>
        </PropertyRow>
      </FormSectionWrapper>

      {/* 3. 组合定位与只读提示 */}
      <FormSectionWrapper
        title={_t('组内相对坐标 (只读)')}
        action={
          <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
            <Lock className="size-3 text-amber-500" />
            <span>{_t('位置已锁定在组合孔中')}</span>
          </div>
        }
      >
        <PropertyRow label={_t('相对偏移 ΔU')} unit="mm">
          <span className="font-mono text-xs text-muted-foreground">{relativeU} mm</span>
        </PropertyRow>
        <PropertyRow label={_t('相对偏移 ΔV')} unit="mm">
          <span className="font-mono text-xs text-muted-foreground">{relativeV} mm</span>
        </PropertyRow>
        <div className="mt-1 rounded bg-muted/40 p-2 text-[10px] text-muted-foreground space-y-1">
          <div>
            {_t('提示：如需调整子孔位置，请修改绝对坐标，将驱动整组刚体平移：')}
          </div>
          <div className="grid grid-cols-2 gap-2 pt-1">
            <div>
              <span className="text-foreground/70">U: </span>
              <NumberInput
                value={cavity.u}
                step={1}
                unit="mm"
                onChange={(val) => {
                  const du = val - cavity.u
                  moveGroup(projectId, parentGroup.id, du, 0)
                }}
              />
            </div>
            <div>
              <span className="text-foreground/70">V: </span>
              <NumberInput
                value={cavity.v}
                step={1}
                unit="mm"
                onChange={(val) => {
                  const dv = val - cavity.v
                  moveGroup(projectId, parentGroup.id, 0, dv)
                }}
              />
            </div>
          </div>
        </div>
      </FormSectionWrapper>

      {/* 4. 底孔加深微调 */}
      <FormSectionWrapper title={_t('深度与加深微调')}>
        <PropertyRow label={_t('沉入偏置')} unit="mm">
          <NumberInput
            value={cavity.depthOffset || 0}
            step={1}
            unit="mm"
            onChange={(val) =>
              updateCavity(projectId, cavity.instanceId, { depthOffset: val })
            }
          />
        </PropertyRow>

        {bottomStepIndex !== -1 && (
          <PropertyRow label={_t('直孔段深度')} unit="mm">
            <NumberInput
              value={currentBottomDepth}
              step={1}
              min={1}
              unit="mm"
              onChange={(val) => {
                const newSteps = cavitySteps.map((s) => ({ ...s }))
                if (bottomStepIndex >= 0 && bottomStepIndex < newSteps.length) {
                  newSteps[bottomStepIndex] = {
                    ...newSteps[bottomStepIndex],
                    length: val
                  }
                  updateCavity(projectId, cavity.instanceId, { steps: newSteps })
                }
              }}
            />
          </PropertyRow>
        )}
      </FormSectionWrapper>

      {/* 5. 台阶特征列表 (折叠) */}
      <FormSectionWrapper
        title={_t('台阶特征列表')}
        collapsible
        defaultCollapsed
        action={
          <span className="text-[10px] text-muted-foreground font-mono">
            {cavitySteps.length} {_t('级')}
          </span>
        }
      >
        <div className="space-y-1">
          {cavitySteps.map((step, idx) => {
            const isStepActive = activeStepIdx === idx
            return (
              <div
                key={idx}
                onClick={() => setActiveStepIdx(isStepActive ? null : idx)}
                className={cn(
                  'flex items-center justify-between rounded border p-1.5 text-xs transition-colors cursor-pointer',
                  isStepActive
                    ? 'border-primary bg-primary/10 text-primary font-semibold'
                    : 'border-border/60 hover:bg-accent/60 text-foreground'
                )}
              >
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[10px] text-muted-foreground">{idx + 1}.</span>
                  <span className="truncate">{step.type === 'straight' ? _t('直孔台阶') : _t('锥台阶')}</span>
                </div>
                <div className="font-mono text-[11px] text-muted-foreground">
                  Ø{step.diameter} × {step.length}mm
                </div>
              </div>
            )
          })}
        </div>
      </FormSectionWrapper>

      {/* 6. 侧油口卡片 (折叠) */}
      <FormSectionWrapper
        title={_t('包含侧油口')}
        collapsible
        defaultCollapsed
        action={
          <span className="text-[10px] text-muted-foreground font-mono">
            {cavity.ports?.length || 0} {_t('个')}
          </span>
        }
      >
        {(cavity.ports || []).length > 0 ? (
          <div className="space-y-1">
            {(cavity.ports || []).map((port, pIdx) => {
              const isPortActive = activePortIdx === pIdx
              return (
                <div
                  key={pIdx}
                  onClick={() => {
                    setActivePortIdx(isPortActive ? null : pIdx)
                    selectFeature(projectId, {
                      type: 'port',
                      cavityId: cavity.instanceId,
                      portIndex: pIdx
                    })
                  }}
                  className={cn(
                    'flex items-center justify-between rounded border p-2 text-xs transition-colors cursor-pointer',
                    isPortActive
                      ? 'border-sky-500 bg-sky-500/10 text-sky-600 dark:text-sky-400 font-semibold'
                      : 'border-border/60 hover:bg-accent/60 text-foreground'
                  )}
                >
                  <div className="flex items-center gap-1.5">
                    <span className="size-2 rounded-full bg-sky-500 shrink-0" />
                    <span className="font-medium">P{pIdx + 1}</span>
                    <span className="font-mono text-[11px] text-muted-foreground">
                      {port.isBottomPort ? _t('通底') : `Ø${port.diameter && port.diameter > 0 ? port.diameter : 6} mm`}
                    </span>
                  </div>
                  <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                    <span>Z={port.depth}mm</span>
                    <ArrowRight className="size-3" />
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          <div className="text-center text-[10px] text-muted-foreground/60 py-2">
            {_t('该孔腔无侧向油口配置')}
          </div>
        )}
      </FormSectionWrapper>

      {/* 7. 油口语义标注 */}
      <FormSectionWrapper title={_t('油口功能语义')}>
        <PropertyRow label={_t('功能标记')}>
          <div className="flex items-center gap-2 w-full">
            <CustomSelect
              value={cavity.portSemantic?.label || '无'}
              onChange={(label) => {
                updateCavity(projectId, cavity.instanceId, {
                  portSemantic:
                    label === '无'
                      ? undefined
                      : { label, color: COLOR_MAP[label] || '#64748b' }
                })
              }}
              options={PORT_SEMANTIC_OPTIONS}
            />
            {cavity.portSemantic?.color && (
              <span
                className="size-4 rounded-full border border-border shrink-0 shadow-2xs"
                style={{ backgroundColor: cavity.portSemantic.color }}
              />
            )}
          </div>
        </PropertyRow>
      </FormSectionWrapper>
    </div>
  )
}
