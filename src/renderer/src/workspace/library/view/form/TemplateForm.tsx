import { translateMessage } from '@shared/i18n'
import { useLocale as _useLocale } from '@renderer/i18n/useLocale'
import { t as _t, msg as _msg } from '@shared/i18n'
/**
 * 右栏属性表单（Figma 属性面板风格）
 *
 * 交互要点：
 * - 分组不含展开/折叠，所有 section 恒平铺显示（同左栏扁平分组语义）；
 * - 含校验错误的 group 在标题行以红色圆点与着色提示；
 * - 动态数组（台阶/油口/子孔）的「添加」按钮在扁平组标题行右侧；
 * - 字段级校验错误直接内联显示在对应输入下方；
 * - 数字输入支持 ↑/↓ 键盘步进，失焦时按 min/max/integer 钳制。
 */

import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CircleAlert, Plus } from 'lucide-react'
import { FieldRow, ToggleSwitch, useFieldBinding } from './FormRenderer'
import { StepsEditor } from './StepsEditor'
import { PortsEditor } from './PortsEditor'
import {
  ReferencesHelpPopover,
  Model3dHelpPopover,
  PortsHelpPopover,
  ComponentBoxesHelpPopover,
  AnnotationHelpPopover
} from './PortsHelpPopover'
import { MetaEditor } from './MetaEditor'
import { HolesEditor } from './HolesEditor'
import { OutlineEditor, OutlineHeaderButtons } from './outline/OutlineEditor'
import { ComponentBoxesEditor } from './ComponentBoxesEditor'
import { ReferencesEditor } from './ReferencesEditor'
import { Model3dEditor } from './Model3dEditor'
import { AnnotationEditor } from './AnnotationEditor'
import { InsertCmd, UpdateCmd } from '../../viewmodel/commands'
import { useLibraryStore } from '../../viewmodel/libraryStore'
import { ALL_CAVITY_TYPES, TYPE_REGISTRY } from '@shared/cavity/cavityTypeRegistry'
import { validateTemplate } from '@shared/cavity/validation'
import { defaultTemplate } from '@shared/cavity/types'
import { convertTemplate } from '@shared/cavity/unitConversion'
import { cn } from '@renderer/lib/utils'
import { TYPE_ICONS, assetUrl } from '../typeIcons'
import { UnitSwitchDialog, type UnitSwitchMode } from './UnitSwitchDialog'
import type { CavityTemplate, CavityType, ComponentBox, Hole, Port, Reference, Step } from '@shared/cavity/types'
import type { FieldDef, FormSection } from '@shared/cavity/cavityTypeRegistry'

/* ---------- 类型切换（整体替换几何，保持 id/名称/挂载） ---------- */

const NO_SUB_TYPES = ALL_CAVITY_TYPES.filter((t) => !TYPE_REGISTRY[t].isCombo)
const SUB_TYPES = ALL_CAVITY_TYPES.filter((t) => TYPE_REGISTRY[t].isCombo)

function TypeSelectRow({
  template,
  basePath,
  disabled
}: {
  template: CavityTemplate
  basePath: string
  disabled?: boolean
}) {
  _useLocale()
  const execute = useLibraryStore((s) => s.execute)
  const [hoveredType, setHoveredType] = useState<CavityType | null>(null)

  const handleSelect = (nextType: CavityType) => {
    if (disabled || nextType === template.cavityType) return
    if (!window.confirm(_t("切换类型将以新类型的默认几何替换当前几何（可撤销）。继续？"))) return
    const fresh = defaultTemplate(nextType, template.categoryId, template.name)
    const isCombo = TYPE_REGISTRY[nextType].isCombo
    const nextTemplate: CavityTemplate = {
      ...fresh,
      id: template.id,
      unit: template.unit ?? 'mm',
      meta: template.meta
    }
    if (!isCombo) {
      delete (nextTemplate as any).holes
    }
    if (!TYPE_REGISTRY[nextType].allowed.ports) {
      delete nextTemplate.geometry.ports
    }
    execute(
      new UpdateCmd(
        basePath,
        nextTemplate,
        template,
        _msg`切换类型为 ${TYPE_REGISTRY[nextType].label}`
      )
    )
  }

  const renderGroup = (label: string, types: CavityType[]) => (
    <div className="flex items-center gap-2">
      <span className="w-11 shrink-0 text-[11px] font-medium text-muted-foreground/80">
        {_t(label)}
      </span>
      <div className="flex flex-wrap items-center gap-1.5">
        {types.map((t) => {
          const isActive = t === template.cavityType
          const schema = TYPE_REGISTRY[t]
          return (
            <button
              key={t}
              type="button"
              disabled={disabled}
              title={`${_t(schema.label)}${isActive ? _t("（当前类型）") : ''}`}
              onClick={() => handleSelect(t)}
              onMouseEnter={() => setHoveredType(t)}
              onMouseLeave={() => setHoveredType(null)}
              className={cn(
                'group relative flex size-7 items-center justify-center rounded-md border transition-all',
                isActive
                  ? 'border-primary bg-primary/15 text-primary shadow-xs ring-1 ring-primary/40'
                  : 'border-border/60 bg-background hover:border-border hover:bg-accent hover:text-accent-foreground',
                disabled && 'cursor-not-allowed opacity-40'
              )}
            >
              <img
                src={assetUrl(TYPE_ICONS[t])}
                alt={_t(schema.label)}
                draggable={false}
                className={cn(
                  'size-[18px] shrink-0 select-none transition-transform',
                  isActive ? 'scale-105 opacity-100' : 'opacity-75 group-hover:scale-105 group-hover:opacity-100'
                )}
              />
              {isActive && (
                <span className="absolute -top-0.5 -right-0.5 size-1.5 rounded-full bg-primary ring-1 ring-background" />
              )}
            </button>
          )
        })}
      </div>
    </div>
  )

  const activeLabel = TYPE_REGISTRY[template.cavityType].label
  const previewLabel = hoveredType ? TYPE_REGISTRY[hoveredType].label : activeLabel

  return (
    <div className="space-y-1.5 py-0.5">
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium text-muted-foreground">{_t("类型")}</span>
        <span
          className={cn(
            'truncate text-xs font-semibold transition-colors',
            hoveredType && hoveredType !== template.cavityType ? 'text-primary' : 'text-foreground'
          )}
        >
          {previewLabel}
          {hoveredType && hoveredType !== template.cavityType && (
            <span className="ml-1 text-[10px] font-normal text-muted-foreground">{_t("（点击切换）")}</span>
          )}
        </span>
      </div>
      <div className="space-y-2 rounded-md border border-border/50 p-1">
        {renderGroup(_t("单孔"), NO_SUB_TYPES)}
        {renderGroup(_t("组合孔"), SUB_TYPES)}
      </div>
    </div>
  )
}

/* ---------- layout / outline 专用编辑器 ---------- */

function ToggleRow({ path, label, hint }: { path: string; label: string; hint?: string }) {
  _useLocale()
  const b = useFieldBinding(path)
  return (
    <div className="flex items-center justify-between py-1" title={hint}>
      <span className="text-xs font-medium text-muted-foreground">{_t(label)}</span>
      <ToggleSwitch checked={b.local === 'true'} onChange={() => b.commit(b.local === 'true' ? 'false' : 'true')} />
    </div>
  )
}

/* ---------- 子孔 Header 极坐标切换 ---------- */

function PolarHeaderToggle({ basePath, disabled }: { basePath: string; disabled?: boolean }) {
  _useLocale()
  const b = useFieldBinding(`${basePath}.geometry.layout.polar`)
  const isPolar = b.local === 'true'

  const toggle = () => {
    if (!disabled) b.commit(isPolar ? 'false' : 'true')
  }

  return (
    <div
      className="flex items-center gap-1.5 select-none mr-1"
      title={_t("极坐标存储（开启后子孔坐标为半径 r 与角度 θ）")}
    >
      <span
        className={cn(
          'text-xs cursor-pointer transition-colors',
          isPolar ? 'font-medium text-foreground' : 'text-muted-foreground hover:text-foreground'
        )}
        onClick={toggle}
      >
        {_t("极坐标")}</span>
      <ToggleSwitch
        checked={isPolar}
        disabled={disabled}
        onChange={toggle}
        className="scale-85 origin-center"
      />
    </div>
  )
}

/* ---------- Group header 添加按钮 ---------- */

export interface SectionAdd {
  label: string
  handler: () => void
}

/* ---------- 段落 body ---------- */

function SectionBody({
  section,
  template,
  basePath,
  disabled,
  issueFor
}: {
  section: FormSection
  template: CavityTemplate
  basePath: string
  disabled?: boolean
  issueFor?: (path: string) => { level: 'error' | 'warning'; message: string } | undefined
}) {
  _useLocale()
  switch (section.custom) {
    case 'steps':
      return (
        <StepsEditor
          basePath={basePath}
          stepsRelPath="geometry.steps"
          steps={template.geometry.steps ?? []}
          allowThread={TYPE_REGISTRY[template.cavityType].allowed.thread}
          disabled={disabled}
          showAddBtn={false}
          issueFor={issueFor}
        />
      )
    case 'ports':
      return (
        <PortsEditor
          basePath={basePath}
          ports={template.geometry.ports ?? []}
          unit={template.unit ?? 'mm'}
          disabled={disabled}
          showAddBtn={false}
          issueFor={issueFor}
        />
      )
    case 'holes':
      return (
        <HolesEditor
          basePath={basePath}
          holes={template.holes ?? []}
          polar={template.geometry.layout?.polar ?? false}
          unit={template.unit ?? 'mm'}
          disabled={disabled}
          issueFor={issueFor}
        />
      )
    case 'layout':
      return (
        <div className="space-y-2">
          <ToggleRow path={`${basePath}.geometry.layout.centerPosition`} label={_t("居中定位")} />
        </div>
      )
    case 'outline':
      return <OutlineEditor basePath={basePath} template={template} disabled={disabled} />
    case 'componentBoxes':
      return (
        <ComponentBoxesEditor
          basePath={basePath}
          boxes={template.componentBoxes ?? []}
          unit={template.unit ?? 'mm'}
          disabled={disabled}
          issueFor={issueFor}
        />
      )
    case 'references':
      return (
        <ReferencesEditor
          basePath={basePath}
          references={template.references ?? []}
          disabled={disabled}
          issueFor={issueFor}
        />
      )
    case 'model3ds':
      return (
        <Model3dEditor
          basePath={basePath}
          model3ds={template.model3ds ?? []}
          disabled={disabled}
          issueFor={issueFor}
        />
      )
    case 'annotation':
      return (
        <AnnotationEditor
          basePath={basePath}
          template={template}
          disabled={disabled}
        />
      )
    case 'meta':
      return (
        <MetaEditor
          basePath={basePath}
          properties={template.meta.properties ?? []}
          disabled={disabled}
        />
      )
    default:
      return (
        <div className="space-y-2">
          {section.fields?.map((f) => (
            <FieldRow
              key={f.key}
              label={_t(f.label)}
              path={`${basePath}.${f.key}`}
              widget={f.widget}
              options={f.options}
              min={f.min}
              max={f.max}
              step={f.step}
              unitSuffix={f.unitSuffix ? (template.unit ?? 'mm') : undefined}
              placeholder={f.placeholder}
              integer={f.integer}
              disabled={disabled}
              issueFor={issueFor}
            />
          ))}
        </div>
      )
  }
}

/* ---------- 主表单 ---------- */

export interface TemplateFormProps {
  template: CavityTemplate
  basePath: string
  readonly?: boolean
}

export function TemplateForm({ template, basePath, readonly }: TemplateFormProps) {
  _useLocale()
  const schema = TYPE_REGISTRY[template.cavityType]
  const execute = useLibraryStore((s) => s.execute)
  const [pendingUnit, setPendingUnit] = useState<'mm' | 'in' | null>(null)

  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({})

  useEffect(() => {
    setExpandedSections(prev => {
      const next = { ...prev }
      next['annotation'] = !!template.annotation
      next['meta'] = !!(template.meta?.properties && template.meta.properties.length > 0)
      return next
    })
  }, [template.id])

  const toggleSection = (key: string) => {
    setExpandedSections(prev => ({...prev, [key]: !prev[key]}))
  }

  // 防御：若当前为非组合孔但含有 holes 字段（无论空数组或非空），自动清理以消除校验阻塞
  useEffect(() => {
    if (!schema.allowed.holes && 'holes' in template && template.holes !== undefined) {
      const cleaned: CavityTemplate = { ...template }
      delete (cleaned as any).holes
      execute(new UpdateCmd(basePath, cleaned, template, _t("自动清理非组合孔子孔字段"), true, undefined))
    }
  }, [schema.allowed.holes, template, basePath, execute])

  const issues = useMemo(() => (readonly ? [] : validateTemplate(template)), [template, readonly])
  const errors = issues.filter((i) => i.level === 'error')
  const warnings = issues.filter((i) => i.level === 'warning')

  /** 依数据路径定位字段级错误/警告（path 形如 'geometry.steps[0].diameter'） */
  const issueFor = useMemo(() => {
    const map = new Map<string, { level: 'error' | 'warning'; message: string }>()
    for (const i of issues) {
      if (!i.path) continue
      const norm = i.path.replace(/\[(\d+)\]/g, '.$1')
      if (!map.has(norm) || i.level === 'error') map.set(norm, { level: i.level, message: i.message })
    }
    return (path: string) => map.get(path)
  }, [issues])

  /** 各段落是否包含错误（用于 header 高亮提示） */
  const sectionHasError = useMemo(() => {
    const m = new Map<string, boolean>()
    for (const e of errors) {
      const norm = e.path?.replace(/\[(\d+)\]/g, '.$1') ?? ''
      if (!norm) continue
      for (const s of schema.formSections) {
        if (m.get(s.key)) continue
        if (s.key === 'basic' && (norm.startsWith('name') || norm.startsWith('unit'))) m.set(s.key, true)
        else if (s.key === 'meta' && norm.startsWith('meta.')) m.set(s.key, true)
        else if (s.custom === 'steps' && norm.startsWith('geometry.steps')) m.set(s.key, true)
        else if (s.custom === 'ports' && norm.startsWith('geometry.ports')) m.set(s.key, true)
        else if (s.custom === 'holes' && norm.startsWith('holes')) m.set(s.key, true)
        else if (s.custom === 'layout' && norm.startsWith('geometry.layout')) m.set(s.key, true)
        else if (s.custom === 'outline' && norm.startsWith('geometry.outline')) m.set(s.key, true)
        else if (s.custom === 'componentBoxes' && norm.startsWith('componentBoxes')) m.set(s.key, true)
        else if (s.custom === 'references' && norm.startsWith('references')) m.set(s.key, true)
        else if (s.custom === 'model3ds' && norm.startsWith('model3ds')) m.set(s.key, true)
        else if (s.custom === 'annotation' && norm.startsWith('annotation')) m.set(s.key, true)
        else if (s.fields?.some((f) => norm.startsWith(f.key))) m.set(s.key, true)
      }
    }
    return m
  }, [errors, schema.formSections])

  const addFor = (section: FormSection): SectionAdd | undefined => {
    if (readonly) return undefined
    switch (section.custom) {
      case 'steps': {
        const steps = template.geometry.steps ?? []
        const last = steps[steps.length - 1]
        return {
          label: _t("添加台阶"),
          handler: () => {
            const item: Step = { type: 'straight', diameter: last?.diameter ?? 10, length: 10, thread: null }
            execute(new InsertCmd(`${basePath}.geometry.steps`, steps.length, item, _t("添加台阶")))
            useLibraryStore.getState().setSelectedStepIndex(steps.length)
          }
        }
      }
      case 'ports': {
        const ports = template.geometry.ports ?? []
        return {
          label: _t("添加侧油口"),
          handler: () => {
            const item: Port = { depth: 10, diameter: 8, isBottomPort: false }
            execute(new InsertCmd(`${basePath}.geometry.ports`, ports.length, item, _t("添加侧油口")))
            useLibraryStore.getState().setSelectedPortIndex(ports.length)
          }
        }
      }
      case 'holes': {
        const holes = template.holes ?? []
        return {
          label: _t("添加子孔"),
          handler: () => {
            const item: Hole = {
              name: `BH${holes.length + 1}`,
              x: 0,
              y: 0,
              tiltAngle: 0,
              azimuth: 0,
              cavityType: 'bolt-hole',
              geometry: {
                steps: [
                  {
                    type: 'straight',
                    diameter: 9,
                    length: 15,
                    thread: { family: 'METRIC', designation: 'M10x1.5-6H', depth: null, hand: 'right' }
                  }
                ]
              },
              ref: null
            }
            execute(new InsertCmd(`${basePath}.holes`, holes.length, item, _t("添加子孔")))
            useLibraryStore.getState().setSelectedHoleIndex(holes.length)
          }
        }
      }
      case 'componentBoxes': {
        const boxes = template.componentBoxes ?? []
        return {
          label: _t("添加元件包围盒"),
          handler: () => {
            const count = boxes.length + 1
            const item: ComponentBox = {
              name: count === 1 ? 'body' : `box-${count}`,
              shape: 'box',
              offsetX: 0,
              offsetY: 0,
              rotationZ: 0,
              size: { x: 50, y: 50, z: 40 }
            }
            execute(new InsertCmd(`${basePath}.componentBoxes`, boxes.length, item, _t("添加元件包围盒")))
          }
        }
      }
      case 'references': {
        const refs = template.references ?? []
        return {
          label: _t("添加参考文档"),
          handler: () => {
            const item: Reference = {
              kind: 'pdf',
              title: _t("技术样本参考"),
              path: 'docs/',
              pageStart: null,
              pageEnd: null,
              note: ''
            }
            execute(new InsertCmd(`${basePath}.references`, refs.length, item, _t("添加参考文档")))
          }
        }
      }
      case 'model3ds': {
        const models = template.model3ds ?? []
        return {
          label: _t("添加3D预览模型"),
          handler: () => {
            execute(new InsertCmd(`${basePath}.model3ds`, models.length, '', _t("添加3D预览模型")))
          }
        }
      }
      case 'meta': {
        const props = template.meta.properties ?? []
        return {
          label: _t("添加自定义属性"),
          handler: () => {
            const item = { name: '', value: '' }
            execute(new InsertCmd(`${basePath}.meta.properties`, props.length, item, _t("添加自定义属性")))
          }
        }
      }
      default:
        return undefined
    }
  }

  const handleUnitChange = (val: string) => {
    if (readonly || val === template.unit) return
    if (val === 'mm' || val === 'in') {
      setPendingUnit(val)
    }
  }

  const handleConfirmUnitSwitch = (mode: UnitSwitchMode) => {
    if (!pendingUnit || pendingUnit === template.unit) {
      setPendingUnit(null)
      return
    }
    const nextTemplate = convertTemplate(template, pendingUnit, mode)
    execute(
      new UpdateCmd(
        basePath,
        nextTemplate,
        template,
        _msg`切换单位为 ${pendingUnit}${mode === 'convert' ? _t("（换算尺寸）") : _t("（重新解释）")}`
      )
    )
    setPendingUnit(null)
  }

  const nameField: FieldDef | undefined = schema.formSections
    .find((s) => s.key === 'basic')
    ?.fields?.find((f) => f.key === 'name')

  return (
    <div className="flex h-full flex-col min-h-0">
      {/* 校验汇总（顶部，固定不参与滚动） */}
      {(errors.length > 0 || warnings.length > 0) && (
        <section className="shrink-0 border-b border-border bg-destructive/5 px-3 py-3">
          <h4 className="flex items-center gap-1.5 text-xs font-semibold text-destructive">
            <CircleAlert className="size-3.5" />
            {_t("校验（")}{errors.length} {_t("错误 /")}{warnings.length} {_t("警告）")}</h4>
          <ul className="mt-2 space-y-1.5 overflow-y-auto max-h-[160px]">
            {errors.map((iss, k) => (
              <li key={k} className="flex items-center justify-between gap-1.5 text-[11px] leading-relaxed text-destructive">
                <div className="flex min-w-0 items-start gap-1.5">
                  <span className="shrink-0 font-mono">{iss.rule}</span>
                  <span>{translateMessage(iss.message)}</span>
                </div>
                {iss.rule === 'V7' && !schema.allowed.holes && 'holes' in template && (
                  <button
                    type="button"
                    onClick={() => {
                      const cleaned: CavityTemplate = { ...template }
                      delete (cleaned as any).holes
                      execute(new UpdateCmd(basePath, cleaned, template, _t("清除非组合孔子孔字段")))
                    }}
                    className="shrink-0 rounded bg-destructive/10 px-1.5 py-0.5 text-[10px] font-medium text-destructive transition-colors hover:bg-destructive/20"
                  >
                    {_t("一键清除")}</button>
                )}
              </li>
            ))}
            {warnings.map((iss, k) => (
              <li key={k} className="flex gap-1.5 text-[11px] leading-relaxed text-amber-600">
                <AlertTriangle className="mt-0.5 size-2.5 shrink-0" />
                <span className="shrink-0 font-mono">{iss.rule}</span>
                <span>{translateMessage(iss.message)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* 表单区域（独立滚动） */}
      <div className="flex-1 overflow-y-auto">
        {schema.formSections.map((section, si) => {
        const hasError = sectionHasError.get(section.key) ?? false
        const add = addFor(section)
        
        const isToggleable = section.custom === 'annotation'
        const isExpanded = !isToggleable || expandedSections[section.key] !== false

        const isEmptyList = (() => {
          if (section.key === 'meta') return !template.meta?.properties || template.meta.properties.length === 0
          if (section.custom === 'model3ds') return !template.model3ds || template.model3ds.length === 0
          if (section.custom === 'references') return !template.references || template.references.length === 0
          if (section.custom === 'componentBoxes') return !template.componentBoxes || template.componentBoxes.length === 0
          if (section.custom === 'holes') return !template.holes || template.holes.length === 0
          if (section.custom === 'ports') return !template.geometry?.ports || template.geometry.ports.length === 0
          if (section.custom === 'steps') return !template.geometry?.steps || template.geometry.steps.length === 0
          return false
        })()

        return (
          <section key={section.key} className={cn('relative', si > 0 && 'border-t border-border')}>
            {/* 扁平组 header（参考 LibrarySidebar.GroupHeader：左侧标题、行尾动作） */}
            <div className="relative flex h-9 shrink-0 items-center gap-1 pr-2 pl-4">
              <h4
                className={cn(
                  'truncate text-xs font-semibold tracking-wide',
                  hasError ? 'text-destructive' : 'text-foreground'
                )}
              >
                {_t(section.label)}
              </h4>
              {section.custom === 'ports' && <PortsHelpPopover />}
              {section.custom === 'componentBoxes' && <ComponentBoxesHelpPopover />}
              {section.custom === 'annotation' && <AnnotationHelpPopover />}
              {section.custom === 'model3ds' && <Model3dHelpPopover />}
              {section.custom === 'references' && <ReferencesHelpPopover />}
              {hasError && <CircleAlert className="size-3 shrink-0 text-destructive" />}
              {section.custom === 'outline' && (
                <OutlineHeaderButtons
                  basePath={basePath}
                  template={template}
                  disabled={readonly}
                />
              )}
              <div className="ml-auto flex shrink-0 items-center gap-1.5">
                {section.custom === 'holes' && (
                  <PolarHeaderToggle basePath={basePath} disabled={readonly} />
                )}
                {isToggleable && (
                  <ToggleSwitch
                    checked={isExpanded}
                    onChange={() => toggleSection(section.key)}
                    className="scale-85 origin-center"
                  />
                )}
                {add && (
                  <button
                    type="button"
                    title={_t(add.label)}
                    className="flex size-6 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                    onClick={add.handler}
                  >
                    <Plus className="size-4" />
                  </button>
                )}
              </div>
            </div>

            {isExpanded && (
              <div className={cn("px-3", isEmptyList ? "pb-0" : "pb-3")}>
                {section.key === 'basic' ? (
                  <div className="space-y-2">
                    {nameField && (
                      <FieldRow
                        label={_t(nameField.label)}
                        path={`${basePath}.${nameField.key}`}
                        widget={nameField.widget}
                        placeholder={nameField.placeholder}
                        disabled={readonly}
                        issueFor={issueFor}
                      />
                    )}
                    <TypeSelectRow template={template} basePath={basePath} disabled={readonly} />
                    <div className="grid grid-cols-[76px_1fr] items-center gap-3">
                      <span className="truncate text-xs font-medium text-muted-foreground">{_t("单位")}</span>
                      <div className="flex items-center gap-1.5">
                        {(['mm', 'in'] as const).map((u) => {
                          const isActive = (template.unit ?? 'mm') === u
                          return (
                            <button
                              key={u}
                              type="button"
                              disabled={readonly}
                              title={_msg`单位：${u}${isActive ? _t("（当前）") : ''}`}
                              onClick={() => handleUnitChange(u)}
                              className={cn(
                                'flex h-7 min-w-10 items-center justify-center rounded-md border px-3 text-xs font-medium transition-all select-none',
                                isActive
                                  ? 'border-primary bg-primary/15 text-primary shadow-xs ring-1 ring-primary/40 font-semibold'
                                  : 'border-border/60 bg-background text-muted-foreground hover:border-border hover:bg-accent hover:text-foreground',
                                readonly && 'cursor-not-allowed opacity-40'
                              )}
                            >
                              {u}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  </div>
                ) : (
                  <SectionBody section={section} template={template} basePath={basePath} disabled={readonly} issueFor={issueFor} />
                )}
              </div>
            )}
          </section>
        )
      })}
      </div>

      {pendingUnit && (
        <UnitSwitchDialog
          open={Boolean(pendingUnit)}
          fromUnit={template.unit ?? 'mm'}
          targetUnit={pendingUnit}
          onConfirm={handleConfirmUnitSwitch}
          onCancel={() => setPendingUnit(null)}
        />
      )}
    </div>
  )
}
