import { useLocale as _useLocale } from '@renderer/i18n/useLocale'
import { t as _t } from '@shared/i18n'
import React, { useMemo } from 'react'
import { produce } from 'immer'
import {
  FormSectionWrapper,
  PropertyRow,
  NumberInput,
  CustomSelect,
  RangeSlider
} from './PropertyFormComponents'
import { useDesignStore, type DesignState } from '../../../model/designStore'
import {
  type BaseBodyTemplate,
  type ChamferMode,
  type CavityInstance,
  MATERIAL_PRESETS,
  resolveMaterialConfig
} from '@shared/design/types'
import { cn } from '@renderer/lib/utils'
import { Scale, ShieldAlert, Layers } from 'lucide-react'
import { assetUrl } from '../../../../library/view/typeIcons'

interface BaseBodyInspectorProps {
  projectId: string
}

const TEMPLATE_OPTIONS: { id: BaseBodyTemplate; name: string; icon: string }[] = [
  { id: 'box', name: '长方体', icon: 'Block.svg' },
  { id: 'l-shape', name: 'L型基体', icon: 'LBlock.svg' },
  { id: 't-shape', name: 'T型基体', icon: 'TBlock.svg' }
]

// 材料密度表 (g/cm³ = kg/dm³)
const DENSITY_MAP: Record<string, number> = {
  '45-steel': 7.85,
  '6061-al': 2.70,
  'qt450': 7.10,
  '304-ss': 7.93,
  'custom': 7.85
}

export const BaseBodyInspector: React.FC<BaseBodyInspectorProps> = ({ projectId }) => {
  _useLocale()
  const session = useDesignStore((s: DesignState) => s.projects[projectId])
  const setBaseTemplate = useDesignStore((s: DesignState) => s.setBaseTemplate)
  const setBaseDimensions = useDesignStore((s: DesignState) => s.setBaseDimensions)
  const setBaseMaterial = useDesignStore((s: DesignState) => s.setBaseMaterial)
  const setBaseMaterialProperty = useDesignStore((s: DesignState) => s.setBaseMaterialProperty)
  const setBaseChamfer = useDesignStore((s: DesignState) => s.setBaseChamfer)
  const selectFeature = useDesignStore((s: DesignState) => s.selectFeature)

  if (!session) return null
  const { doc } = session
  const [sx, sy, sz] = doc.baseBody.dimensions
  const matConfig = resolveMaterialConfig(doc.baseBody.material, doc.baseBody.materialConfig)
  const activeScheme = doc.schemes.find((s) => s.id === doc.activeSchemeId) || doc.schemes[0]

  // 计算理论净质量 (kg)
  const estimatedMassKg = useMemo(() => {
    const density = DENSITY_MAP[matConfig.presetId || '45-steel'] || 7.85
    // 粗略毛坯体积 (cm³)
    const volumeCm3 = (sx * sy * sz) / 1000
    // 扣除孔腔减重 (粗略估算每个孔平均减重 15cm³)
    const cavityCount = activeScheme?.cavities.length || 0
    const netVolumeCm3 = Math.max(10, volumeCm3 - cavityCount * 15)
    return Math.round((netVolumeCm3 * density) / 1000 * 100) / 100
  }, [sx, sy, sz, matConfig.presetId, activeScheme])

  return (
    <div className="flex h-full flex-col select-none overflow-y-auto">
      {/* 1. 基本形状切换 */}
      <FormSectionWrapper title={_t('阀块基本形状')} isFirst>
        <div className="space-y-1.5">
          <div className="grid grid-cols-3 gap-1.5">
            {TEMPLATE_OPTIONS.map((opt) => {
              const isActive = (doc.baseBody.template || 'box') === opt.id
              return (
                <button
                  key={opt.id}
                  type="button"
                  title={_t(opt.name)}
                  onClick={() => setBaseTemplate(projectId, opt.id)}
                  className={cn(
                    'group relative flex flex-col items-center gap-1 rounded-md border p-1.5 text-center transition-all cursor-pointer',
                    isActive
                      ? 'border-primary bg-primary/15 text-primary shadow-2xs ring-1 ring-primary/40 font-semibold'
                      : 'border-border/60 bg-background text-muted-foreground hover:border-border hover:bg-accent hover:text-foreground'
                  )}
                >
                  <img
                    src={assetUrl(opt.icon)}
                    alt={_t(opt.name)}
                    className={cn(
                      'size-5 shrink-0 object-contain transition-transform',
                      isActive ? 'scale-105 opacity-100' : 'opacity-70 group-hover:opacity-100'
                    )}
                  />
                  <span className="text-[10px]">{_t(opt.name)}</span>
                  {isActive && (
                    <span className="absolute -top-0.5 -right-0.5 size-1.5 rounded-full bg-primary ring-1 ring-background" />
                  )}
                </button>
              )
            })}
          </div>
        </div>
      </FormSectionWrapper>

      {/* 2. 外形包围尺寸 */}
      <FormSectionWrapper title={_t('外形包围尺寸')}>
        <PropertyRow label={_t('跨度 X')} unit="mm">
          <NumberInput
            value={sx}
            step={5}
            min={10}
            unit="mm"
            onChange={(val) => setBaseDimensions(projectId, [val, sy, sz])}
          />
        </PropertyRow>
        <PropertyRow label={_t('跨度 Y')} unit="mm">
          <NumberInput
            value={sy}
            step={5}
            min={10}
            unit="mm"
            onChange={(val) => setBaseDimensions(projectId, [sx, val, sz])}
          />
        </PropertyRow>
        <PropertyRow label={_t('跨度 Z')} unit="mm">
          <NumberInput
            value={sz}
            step={5}
            min={10}
            unit="mm"
            onChange={(val) => setBaseDimensions(projectId, [sx, sy, val])}
          />
        </PropertyRow>
      </FormSectionWrapper>

      {/* 3. 质量与安全壁厚卡片 */}
      <FormSectionWrapper title={_t('物理与安全阈值')}>
        <div className="rounded-md border border-border/60 bg-muted/30 p-2 space-y-2">
          <div className="flex items-center justify-between text-xs">
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <Scale className="size-3.5 text-primary" />
              <span>{_t('理论净质量估算')}</span>
            </div>
            <span className="font-mono font-bold text-foreground">
              ~ {estimatedMassKg} kg
            </span>
          </div>
          <div className="flex items-center justify-between text-xs border-t border-border/40 pt-1.5">
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <ShieldAlert className="size-3.5 text-amber-500" />
              <span>{_t('安全壁厚警告阈值')}</span>
            </div>
            <div className="w-20">
              <NumberInput
                value={(doc as any).settings?.minWallThickness ?? 3.0}
                min={0.5}
                max={20}
                step={0.5}
                unit="mm"
                onChange={(val) => {
                  useDesignStore.setState(
                    produce((state: DesignState) => {
                      const p = state.projects[projectId]
                      if (p) {
                        if (!(p.doc as any).settings) (p.doc as any).settings = { minWallThickness: 3.0 }
                        ;(p.doc as any).settings.minWallThickness = val
                        p.dirty = true
                      }
                    })
                  )
                }}
              />
            </div>
          </div>
        </div>
      </FormSectionWrapper>

      {/* 4. 边缘倒角 */}
      <FormSectionWrapper title={_t('基体边缘处理')}>
        <PropertyRow label={_t('边缘处理')}>
          <div className="grid grid-cols-2 gap-1 w-full">
            {(
              [
                { mode: 'sharp' as ChamferMode, label: _t('锐边') },
                { mode: 'chamfer-1mm' as ChamferMode, label: '1mm×45°' }
              ] as const
            ).map(({ mode, label }) => {
              const currentChamfer = doc.baseBody.chamfer || 'sharp'
              const active = currentChamfer === mode
              return (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setBaseChamfer(projectId, mode)}
                  className={cn(
                    'h-7 rounded border text-xs font-medium transition-all cursor-pointer',
                    active
                      ? 'border-primary bg-primary/10 text-primary font-semibold'
                      : 'border-border/60 bg-background text-muted-foreground hover:bg-accent'
                  )}
                >
                  {label}
                </button>
              )
            })}
          </div>
        </PropertyRow>
      </FormSectionWrapper>

      {/* 5. 材质与视觉外观 */}
      <FormSectionWrapper title={_t('材质与渲染')}>
        <PropertyRow label={_t('材质预设')}>
          <CustomSelect
            value={matConfig.presetId || '45-steel'}
            onChange={(presetKey) => {
              const p = MATERIAL_PRESETS[presetKey]
              if (p) {
                setBaseMaterial(projectId, {
                  presetId: p.presetId,
                  color: p.color,
                  metalness: p.metalness,
                  roughness: p.roughness,
                  opacity: p.opacity
                })
              }
            }}
            options={Object.entries(MATERIAL_PRESETS).map(([k, v]) => ({
              label: _t(v.label),
              value: k
            }))}
          />
        </PropertyRow>

        <PropertyRow label={_t('基体底色')}>
          <div className="flex items-center gap-2 w-full">
            <input
              type="color"
              value={matConfig.color}
              onChange={(e) => setBaseMaterialProperty(projectId, 'color', e.target.value)}
              className="size-7 rounded border border-border cursor-pointer bg-transparent p-0"
            />
            <span className="font-mono text-xs uppercase text-muted-foreground">
              {matConfig.color}
            </span>
          </div>
        </PropertyRow>

        <PropertyRow label={_t('金属度')}>
          <RangeSlider
            value={matConfig.metalness}
            onChange={(val) => setBaseMaterialProperty(projectId, 'metalness', val)}
          />
        </PropertyRow>

        <PropertyRow label={_t('粗糙度')}>
          <RangeSlider
            value={matConfig.roughness}
            onChange={(val) => setBaseMaterialProperty(projectId, 'roughness', val)}
          />
        </PropertyRow>

        <PropertyRow label={_t('半透明度')}>
          <RangeSlider
            value={matConfig.opacity}
            onChange={(val) => setBaseMaterialProperty(projectId, 'opacity', val)}
          />
        </PropertyRow>
      </FormSectionWrapper>

      {/* 6. 基体各面概览 (可折叠) */}
      <FormSectionWrapper
        title={_t('基体安装面概览')}
        collapsible
        defaultCollapsed
        action={
          <span className="text-[10px] text-muted-foreground font-mono">
            {doc.baseBody.faces.length} {_t('个面')}
          </span>
        }
      >
        <div className="space-y-1">
          {doc.baseBody.faces.map((f) => {
            const count = (activeScheme?.cavities || []).filter((c: CavityInstance) => c.faceId === f.id).length
            return (
              <div
                key={f.id}
                onClick={() => selectFeature(projectId, { type: 'face', id: f.id })}
                className="flex cursor-pointer items-center justify-between rounded border border-border/50 p-1.5 hover:bg-accent/60 text-xs"
              >
                <div className="flex items-center gap-1.5 font-mono">
                  <Layers className="size-3 text-muted-foreground" />
                  <span className="font-semibold text-foreground">{f.id}</span>
                  <span className="text-[10px] text-muted-foreground">[{f.normal.join(',')}]</span>
                </div>
                <span className="text-[10px] text-muted-foreground">
                  {count > 0 ? `${count} ${_t('个孔')}` : _t('空')}
                </span>
              </div>
            )
          })}
        </div>
      </FormSectionWrapper>
    </div>
  )
}
