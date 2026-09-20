import { useLocale as _useLocale } from '@renderer/i18n/useLocale'
import { t as _t } from '@shared/i18n'
import React, { useRef, useState } from 'react'
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
  STANDARD_BOX_FACES,
  MATERIAL_PRESETS,
  resolveMaterialConfig
} from '@shared/design/types'
import { cn } from '@renderer/lib/utils'
import { FileCode, Loader2, AlertTriangle, RefreshCw, FolderOpen } from 'lucide-react'
import { assetUrl } from '../../../../library/view/typeIcons'
import { parseStepToThreeGeometry } from '@renderer/workspace/tabs/viewer/stepLoader'

interface BaseBodyInspectorProps {
  projectId: string
}

const TEMPLATE_OPTIONS: { id: BaseBodyTemplate | 'step'; name: string; icon: string }[] = [
  { id: 'box', name: '长方体', icon: 'Block.svg' },
  { id: 'l-shape', name: 'L型基体', icon: 'LBlock.svg' },
  { id: 't-shape', name: 'T型基体', icon: 'TBlock.svg' },
  { id: 'cross-shape', name: '十字型基体', icon: 'CrossBlock.svg' },
  { id: 'step', name: '自定义形状', icon: 'ImportStep.svg' }
]

export const BaseBodyInspector: React.FC<BaseBodyInspectorProps> = ({ projectId }) => {
  _useLocale()
  const session = useDesignStore((s: DesignState) => s.projects[projectId])
  const setBaseTemplate = useDesignStore((s: DesignState) => s.setBaseTemplate)
  const setBaseType = useDesignStore((s: DesignState) => s.setBaseType)
  const setBaseStepModel = useDesignStore((s: DesignState) => s.setBaseStepModel)
  const setBaseExtraParams = useDesignStore((s: DesignState) => s.setBaseExtraParams)
  const setBaseDimensions = useDesignStore((s: DesignState) => s.setBaseDimensions)
  const setBaseMaterial = useDesignStore((s: DesignState) => s.setBaseMaterial)
  const setBaseMaterialProperty = useDesignStore((s: DesignState) => s.setBaseMaterialProperty)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const [isImporting, setIsImporting] = useState(false)

  if (!session) return null
  const { doc } = session
  const [sx, sy, sz] = doc.baseBody.dimensions
  const matConfig = resolveMaterialConfig(doc.baseBody.material, doc.baseBody.materialConfig)
  const isStepType = doc.baseBody.type === 'step'
  const currentTemplate = doc.baseBody.template || 'box'
  const extraParams = doc.baseBody.extraParams || {}

  const handleStepFile = async (file: File) => {
    setIsImporting(true)
    try {
      const buffer = await file.arrayBuffer()
      const text = await file.text()
      const filePath = (file as any).path || ''
      const { faces: extractedFaces, dimensions: rawDims, stepMesh } = await parseStepToThreeGeometry(buffer)
      setBaseStepModel(projectId, {
        stepContent: text,
        stepFileName: file.name,
        stepFilePath: filePath,
        stepAssetRef: filePath || file.name,
        dimensions: rawDims,
        faces: extractedFaces && extractedFaces.length > 0 ? extractedFaces : [...STANDARD_BOX_FACES],
        stepMesh
      })
      window.dispatchEvent(new CustomEvent('sureflow:fit-view'))
    } catch (err: any) {
      console.error('[BaseBodyInspector] 解析导入 STEP 失败:', err)
      useDesignStore.getState().setBaseBodyError(projectId, _t('解析 STEP 文件失败: ') + (err?.message || String(err)))
      alert(_t('解析 STEP 文件失败: ') + (err?.message || String(err)))
    } finally {
      setIsImporting(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const handleRefreshFromSource = async () => {
    const filePath = doc.baseBody.stepFilePath
    if (!filePath) {
      fileInputRef.current?.click()
      return
    }
    setIsImporting(true)
    try {
      if (window.fileApi?.exists) {
        const exists = await window.fileApi.exists(filePath)
        if (!exists) {
          useDesignStore.getState().setBaseBodyError(
            projectId,
            _t('原始 STEP 源文件已丢失或无法访问: ') + filePath
          )
          alert(_t('原始 STEP 源文件不存在或已被移动，请点击“更换”重新选择文件！\n路径: ') + filePath)
          setIsImporting(false)
          return
        }
      }

      let buffer: ArrayBuffer
      if (window.fileApi?.readBinary) {
        buffer = await window.fileApi.readBinary(filePath)
      } else {
        fileInputRef.current?.click()
        return
      }
      const text = new TextDecoder().decode(buffer)
      const fileName = doc.baseBody.stepFileName || filePath.split('/').pop()?.split('\\').pop() || 'model.step'
      const { faces: extractedFaces, dimensions: rawDims, stepMesh } = await parseStepToThreeGeometry(buffer)
      setBaseStepModel(projectId, {
        stepContent: text,
        stepFileName: fileName,
        stepFilePath: filePath,
        stepAssetRef: filePath,
        dimensions: rawDims,
        faces: extractedFaces && extractedFaces.length > 0 ? extractedFaces : [...STANDARD_BOX_FACES],
        stepMesh
      })
      window.dispatchEvent(new CustomEvent('sureflow:fit-view'))
    } catch (err: any) {
      console.error('[BaseBodyInspector] 从源文件更新 STEP 失败:', err)
      useDesignStore.getState().setBaseBodyError(projectId, _t('从源文件更新 STEP 失败: ') + (err?.message || String(err)))
      alert(_t('从源文件更新 STEP 失败: ') + (err?.message || String(err)))
    } finally {
      setIsImporting(false)
    }
  }

  const handleShapeSelect = (optId: BaseBodyTemplate | 'step') => {
    if (optId === 'step') {
      if (doc.baseBody.stepContent) {
        setBaseType(projectId, 'step')
        window.dispatchEvent(new CustomEvent('sureflow:fit-view'))
      } else {
        fileInputRef.current?.click()
      }
    } else {
      setBaseTemplate(projectId, optId)
    }
  }

  return (
    <div className="flex h-full flex-col select-none overflow-y-auto">
      {/* 隐藏的文件上传 input 用于导入 STEP 文件 */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".step,.stp"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) {
            void handleStepFile(file)
          }
        }}
      />

      {/* 基体错误或降级警示横幅 */}
      {session.baseBodyError && (
        <div className="mx-2.5 mt-2 flex items-start gap-2 rounded-md border border-amber-500/50 bg-amber-500/10 p-2 text-xs text-amber-600 dark:text-amber-400">
          <AlertTriangle className="size-4 shrink-0 mt-0.5 text-amber-500" />
          <div className="min-w-0 flex-1 space-y-0.5">
            <div className="font-semibold text-foreground">{_t("基体模型降级警告")}</div>
            <div className="text-[11px] text-muted-foreground leading-tight">{session.baseBodyError}</div>
          </div>
        </div>
      )}

      {/* 1. 基本形状切换 */}
      <FormSectionWrapper title={_t('阀块基本形状')} isFirst={!session.baseBodyError}>
        <div className="space-y-2">
          <div className="grid grid-cols-4 gap-1.5">
            {TEMPLATE_OPTIONS.map((opt) => {
              const isActive = isStepType
                ? opt.id === 'step'
                : (opt.id as string) === currentTemplate

              return (
                <button
                  key={opt.id}
                  type="button"
                  title={_t(opt.name)}
                  onClick={() => handleShapeSelect(opt.id)}
                  className={cn(
                    'group relative flex flex-col items-center gap-1 rounded-md border p-1 text-center transition-all cursor-pointer',
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
                  <span className="text-[10px] truncate w-full">{_t(opt.name)}</span>
                  {isActive && (
                    <span className="absolute -top-0.5 -right-0.5 size-1.5 rounded-full bg-primary ring-1 ring-background" />
                  )}
                </button>
              )
            })}
          </div>

          {/* 自定义 STEP 导入面板 */}
          {isStepType && (
            <div className="rounded-md border border-border/70 bg-muted/20 p-2 space-y-2 text-xs">
              <div className="flex items-center justify-between gap-1">
                <div className="flex items-center gap-1.5 font-medium text-foreground truncate min-w-0">
                  <FileCode className="size-4 shrink-0 text-primary" />
                  <span className="truncate" title={doc.baseBody.stepFileName}>
                    {doc.baseBody.stepFileName || _t('已导入 STEP 实体')}
                  </span>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    disabled={isImporting}
                    title={doc.baseBody.stepFilePath ? _t('从源文件快速重新加载最新模型') : _t('重新选择文件')}
                    onClick={handleRefreshFromSource}
                    className="flex shrink-0 items-center gap-1 rounded border border-primary/40 bg-primary/10 px-2 py-1 text-[11px] font-medium text-primary hover:bg-primary/20 cursor-pointer transition-colors"
                  >
                    {isImporting ? (
                      <Loader2 className="size-3 animate-spin" />
                    ) : (
                      <RefreshCw className="size-3" />
                    )}
                    <span>{_t('从源文件更新')}</span>
                  </button>
                  <button
                    type="button"
                    disabled={isImporting}
                    title={_t('选择其他 STEP 文件')}
                    onClick={() => fileInputRef.current?.click()}
                    className="flex shrink-0 items-center gap-1 rounded border border-border/80 bg-background px-1.5 py-1 text-[11px] font-medium text-muted-foreground hover:text-foreground hover:bg-accent cursor-pointer transition-colors"
                  >
                    <FolderOpen className="size-3" />
                    <span>{_t('更换')}</span>
                  </button>
                </div>
              </div>

              {/* 源文件物理路径展示 */}
              <div className="flex items-center gap-1.5 rounded bg-background/60 px-2 py-1 text-[11px] text-muted-foreground border border-border/40 min-w-0">
                <span className="shrink-0 text-foreground/40 font-mono text-[10px]">{_t('源路径')}:</span>
                <span
                  className="truncate font-mono text-[10px] text-foreground/80 select-all"
                  title={doc.baseBody.stepFilePath || _t('未记录源文件路径 (可通过更换文件重新选择并绑定)')}
                >
                  {doc.baseBody.stepFilePath || _t('未绑定物理路径 (请点击更换文件绑定)')}
                </span>
              </div>

              <div className="grid grid-cols-3 gap-1 rounded bg-background/50 p-1.5 text-center font-mono text-[10px] text-muted-foreground border border-border/40">
                <div>
                  <span className="text-foreground/40 block">X</span>
                  <span className="font-semibold text-foreground">{sx}</span> mm
                </div>
                <div>
                  <span className="text-foreground/40 block">Y</span>
                  <span className="font-semibold text-foreground">{sy}</span> mm
                </div>
                <div>
                  <span className="text-foreground/40 block">Z</span>
                  <span className="font-semibold text-foreground">{sz}</span> mm
                </div>
              </div>
            </div>
          )}
        </div>
      </FormSectionWrapper>

      {/* 2. 外形包围尺寸与相关参数 */}
      <FormSectionWrapper title={_t('外形包围尺寸')}>
        <PropertyRow label={_t('跨度 X')} unit="mm">
          <NumberInput
            value={sx}
            step={5}
            min={10}
            unit="mm"
            disabled={isStepType}
            onChange={(val) => setBaseDimensions(projectId, [val, sy, sz])}
          />
        </PropertyRow>
        <PropertyRow label={_t('跨度 Y')} unit="mm">
          <NumberInput
            value={sy}
            step={5}
            min={10}
            unit="mm"
            disabled={isStepType}
            onChange={(val) => setBaseDimensions(projectId, [sx, val, sz])}
          />
        </PropertyRow>
        <PropertyRow label={_t('跨度 Z')} unit="mm">
          <NumberInput
            value={sz}
            step={5}
            min={10}
            unit="mm"
            disabled={isStepType}
            onChange={(val) => setBaseDimensions(projectId, [sx, sy, val])}
          />
        </PropertyRow>

        {/* L 型基体专属切削参数 */}
        {!isStepType && currentTemplate === 'l-shape' && (
          <>
            <PropertyRow label={_t('台阶切除宽 (X)')} unit="mm">
              <NumberInput
                value={extraParams.cutX ?? Math.round(sx * 0.4)}
                step={2}
                min={2}
                max={Math.max(2, sx - 5)}
                unit="mm"
                onChange={(val) => setBaseExtraParams(projectId, { cutX: val })}
              />
            </PropertyRow>
            <PropertyRow label={_t('台阶切除深 (Z)')} unit="mm">
              <NumberInput
                value={extraParams.cutZ ?? Math.round(sz * 0.5)}
                step={2}
                min={2}
                max={Math.max(2, sz - 5)}
                unit="mm"
                onChange={(val) => setBaseExtraParams(projectId, { cutZ: val })}
              />
            </PropertyRow>
          </>
        )}

        {/* T 型与十字型基体专属切削参数 */}
        {!isStepType && (currentTemplate === 't-shape' || currentTemplate === 'cross-shape') && (
          <>
            <PropertyRow label={currentTemplate === 'cross-shape' ? _t('角部凹槽宽 (X)') : _t('翼缘凹槽宽 (X)')} unit="mm">
              <NumberInput
                value={extraParams.cutX ?? Math.round(sx * 0.25)}
                step={2}
                min={2}
                max={Math.max(2, Math.floor(sx / 2) - 2)}
                unit="mm"
                onChange={(val) => setBaseExtraParams(projectId, { cutX: val })}
              />
            </PropertyRow>
            <PropertyRow label={currentTemplate === 'cross-shape' ? _t('角部凹槽高 (Z)') : _t('翼缘凹槽高 (Z)')} unit="mm">
              <NumberInput
                value={extraParams.cutZ ?? (currentTemplate === 'cross-shape' ? Math.round(sz * 0.25) : Math.round(sz * 0.5))}
                step={2}
                min={2}
                max={Math.max(2, Math.floor(sz / 2) - 2)}
                unit="mm"
                onChange={(val) => setBaseExtraParams(projectId, { cutZ: val })}
              />
            </PropertyRow>
          </>
        )}
      </FormSectionWrapper>

      {/* 3. 材质与视觉外观 (包含材料密度) */}
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
                  opacity: p.opacity,
                  density: p.density
                })
              }
            }}
            options={Object.entries(MATERIAL_PRESETS).map(([k, v]) => ({
              label: _t(v.label),
              value: k
            }))}
          />
        </PropertyRow>

        <PropertyRow label={_t('材料密度')} unit="g/cm³">
          <NumberInput
            value={matConfig.density ?? 7.85}
            step={0.01}
            min={0.01}
            max={30}
            unit="g/cm³"
            onChange={(val) => setBaseMaterialProperty(projectId, 'density', val)}
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
    </div>
  )
}

