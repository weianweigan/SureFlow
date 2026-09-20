import { useLocale as _useLocale } from '@renderer/i18n/useLocale'
import { t as _t } from '@shared/i18n'
import React, { useState, useMemo } from 'react'
import {
  FormSectionWrapper,
  PropertyRow,
  NumberInput,
  TextInput,
  CustomSelect
} from './PropertyFormComponents'
import { CoordinateDatumSection } from './CoordinateDatumSection'
import { QuickTemplatePickerModal } from './QuickTemplatePickerModal'
import { Cavity2DPreview } from '../Cavity2DPreview'
import { useDesignStore, type DesignState } from '../../../model/designStore'
import { useLibraryStore, type LibraryState } from '../../../../library/viewmodel/libraryStore'
import { getCavitySteps } from '../../../geometry/cavityProfileBuilder'
import { TYPE_REGISTRY } from '@shared/cavity/cavityTypeRegistry'
import type { CavityInstance } from '@shared/design/types'
import type { CavityTemplate, Step } from '@shared/cavity/types'
import { RefreshCw, Copy, EyeOff, Eye, Trash2, ArrowRight } from 'lucide-react'
import { cn } from '@renderer/lib/utils'

interface SingleCavityInspectorProps {
  projectId: string
  cavity: CavityInstance
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

export const SingleCavityInspector: React.FC<SingleCavityInspectorProps> = ({
  projectId,
  cavity
}) => {
  _useLocale()
  const session = useDesignStore((s: DesignState) => s.projects[projectId])
  const updateCavity = useDesignStore((s: DesignState) => s.updateCavity)
  const updateCavityPosition = useDesignStore((s: DesignState) => s.updateCavityPosition)
  const duplicateCavity = useDesignStore((s: DesignState) => s.duplicateCavity)
  const deleteCavity = useDesignStore((s: DesignState) => s.deleteCavity)
  const toggleCavitySuppressed = useDesignStore((s: DesignState) => s.toggleCavitySuppressed)
  const replaceCavity = useDesignStore((s: DesignState) => s.replaceCavity)
  const selectFeature = useDesignStore((s: DesignState) => s.selectFeature)

  const libraryDoc = useLibraryStore((s: LibraryState) => s.doc)
  const [templatePickerOpen, setTemplatePickerOpen] = useState(false)
  const [activeStepIdx, setActiveStepIdx] = useState<number | null>(null)
  const [activePortIdx, setActivePortIdx] = useState<number | null>(null)

  if (!session) return null
  const { doc } = session
  const [sx, sy, sz] = doc.baseBody.dimensions
  const activeScheme = doc.schemes.find((s) => s.id === doc.activeSchemeId) || doc.schemes[0]

  // 获取宿主面尺寸
  const isZFace = cavity.faceId === 'F1' || cavity.faceId === 'F2'
  const isYFace = cavity.faceId === 'F3' || cavity.faceId === 'F4'
  const faceW = isZFace ? sx : isYFace ? sx : sy
  const faceH = isZFace ? sy : isYFace ? sz : sz

  // 当前面上的其他孔腔
  const otherCavitiesOnFace = useMemo(() => {
    return (activeScheme?.cavities || []).filter(
      (c: CavityInstance) => c.faceId === cavity.faceId && c.instanceId !== cavity.instanceId
    )
  }, [activeScheme, cavity])

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

  // 处理替换孔腔
  const handleReplaceTemplate = (newTmpl: CavityTemplate) => {
    replaceCavity(projectId, cavity.instanceId, {
      templateId: newTmpl.id,
      name: newTmpl.name,
      cavityType: newTmpl.cavityType,
      steps: newTmpl.geometry?.steps,
      ports: newTmpl.geometry?.ports
    })
  }

  return (
    <div className="flex h-full flex-col select-none overflow-y-auto">
      {/* 1. 顶部 2D 交互式剖面图 */}
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

      {/* 2. 基本信息与替换 */}
      <FormSectionWrapper
        title={_t('孔腔基本信息')}
        isFirst
        action={
          <button
            type="button"
            onClick={() => setTemplatePickerOpen(true)}
            className="flex items-center gap-1 rounded border border-border/70 bg-background px-2 py-0.5 text-[11px] font-medium text-foreground hover:bg-accent hover:border-primary/40 transition-colors cursor-pointer"
          >
            <RefreshCw className="size-3 text-primary" />
            <span>{_t('替换孔腔')}</span>
          </button>
        }
      >
        <PropertyRow label={_t('孔腔名称')}>
          <TextInput
            value={cavity.name}
            onChange={(val) => updateCavity(projectId, cavity.instanceId, { name: val })}
          />
        </PropertyRow>
        <PropertyRow label={_t('孔腔类型')}>
          <div className="flex items-center gap-1.5 text-xs text-foreground font-medium">
            <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
              {typeMeta?.label || cavity.cavityType}
            </span>
          </div>
        </PropertyRow>
      </FormSectionWrapper>

      {/* 3. 坐标定位独立组（临时基准） */}
      <CoordinateDatumSection
        u={cavity.u}
        v={cavity.v}
        faceId={cavity.faceId}
        faceWidth={faceW}
        faceHeight={faceH}
        otherCavitiesOnFace={otherCavitiesOnFace}
        onUpdatePosition={(newU, newV) =>
          updateCavityPosition(projectId, cavity.instanceId, newU, newV)
        }
      />

      {/* 4. 安装朝向与深度 */}
      <FormSectionWrapper title={_t('安装朝向与深度')}>
        <PropertyRow label={_t('旋转方位角')} unit="°">
          <NumberInput
            value={cavity.azimuth ?? cavity.rotation ?? 0}
            step={15}
            min={0}
            max={360}
            unit="°"
            onChange={(val) =>
              updateCavity(projectId, cavity.instanceId, { azimuth: val, rotation: val })
            }
          />
        </PropertyRow>

        {cavity.cavityType !== 'bolt-hole' && cavity.cavityType !== 'locating-pin-hole' && (
          <PropertyRow label={_t('倾斜角 (Tilt)')} unit="°">
            <NumberInput
              value={cavity.tiltAngle || 0}
              step={5}
              min={0}
              max={60}
              unit="°"
              onChange={(val) =>
                updateCavity(projectId, cavity.instanceId, { tiltAngle: val })
              }
            />
          </PropertyRow>
        )}

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

        {bottomStepIndex !== -1 &&
          cavity.cavityType !== 'bolt-hole' &&
          cavity.cavityType !== 'locating-pin-hole' && (
            <PropertyRow label={_t('底孔深度')} unit="mm">
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

      {/* 5. 台阶特征组（默认折叠，双向联动高亮） */}
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

      {/* 6. 侧油口卡片组（默认折叠，可独立聚焦） */}
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

      {/* 8. 底部快捷操作 */}
      <div className="p-3 mt-auto border-t border-border/70 grid grid-cols-3 gap-2">
        <button
          type="button"
          onClick={() => duplicateCavity(projectId, cavity.instanceId)}
          className="flex items-center justify-center gap-1 rounded border border-border bg-background py-1.5 text-xs text-foreground hover:bg-accent cursor-pointer"
        >
          <Copy className="size-3.5 text-muted-foreground" />
          <span>{_t('复制')}</span>
        </button>
        <button
          type="button"
          onClick={() => toggleCavitySuppressed(projectId, cavity.instanceId)}
          className="flex items-center justify-center gap-1 rounded border border-border bg-background py-1.5 text-xs text-foreground hover:bg-accent cursor-pointer"
        >
          {cavity.suppressed ? (
            <Eye className="size-3.5 text-emerald-500" />
          ) : (
            <EyeOff className="size-3.5 text-muted-foreground" />
          )}
          <span>{cavity.suppressed ? _t('启用') : _t('抑制')}</span>
        </button>
        <button
          type="button"
          onClick={() => deleteCavity(projectId, cavity.instanceId)}
          className="flex items-center justify-center gap-1 rounded border border-destructive/30 bg-destructive/10 py-1.5 text-xs text-destructive hover:bg-destructive/20 cursor-pointer"
        >
          <Trash2 className="size-3.5" />
          <span>{_t('删除')}</span>
        </button>
      </div>

      {/* 替换孔腔弹窗 */}
      <QuickTemplatePickerModal
        open={templatePickerOpen}
        onClose={() => setTemplatePickerOpen(false)}
        currentTemplateId={cavity.templateId}
        isComboMode={false}
        onSelect={handleReplaceTemplate}
      />
    </div>
  )
}
