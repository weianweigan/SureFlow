import { useLocale as _useLocale } from '@renderer/i18n/useLocale'
import { t as _t } from '@shared/i18n'
import React, { useState, useMemo } from 'react'
import { FormSectionWrapper, PropertyRow, NumberInput, CustomSelect } from './PropertyFormComponents'
import type { CavityInstance } from '@shared/design/types'
import { Crosshair, MapPin } from 'lucide-react'

interface CoordinateDatumSectionProps {
  u: number
  v: number
  onUpdatePosition: (newU: number, newV: number) => void
  faceId: string
  faceWidth?: number
  faceHeight?: number
  otherCavitiesOnFace?: CavityInstance[]
  disabled?: boolean
  isGroup?: boolean
}

export const CoordinateDatumSection: React.FC<CoordinateDatumSectionProps> = ({
  u,
  v,
  onUpdatePosition,
  faceId,
  faceWidth = 100,
  faceHeight = 100,
  otherCavitiesOnFace = [],
  disabled = false,
  isGroup = false
}) => {
  _useLocale()

  // 临时基准类型：'face-origin' | 'bottom-left' | 'bottom-right' | 'top-left' | 'top-right' | `cavity:${id}`
  const [datumId, setDatumId] = useState<string>('face-origin')

  // 计算当前选定基准在宿主面绝对坐标系下的 (datumU, datumV)
  const { datumU, datumV } = useMemo(() => {
    const halfW = faceWidth / 2
    const halfH = faceHeight / 2

    if (datumId === 'face-origin') {
      return { datumU: 0, datumV: 0 }
    }
    if (datumId === 'bottom-left') {
      return { datumU: -halfW, datumV: -halfH }
    }
    if (datumId === 'bottom-right') {
      return { datumU: halfW, datumV: -halfH }
    }
    if (datumId === 'top-left') {
      return { datumU: -halfW, datumV: halfH }
    }
    if (datumId === 'top-right') {
      return { datumU: halfW, datumV: halfH }
    }
    if (datumId.startsWith('cavity:')) {
      const cid = datumId.replace('cavity:', '')
      const targetCav = otherCavitiesOnFace.find((c) => c.instanceId === cid)
      if (targetCav) {
        return {
          datumU: targetCav.u,
          datumV: targetCav.v
        }
      }
    }
    return { datumU: 0, datumV: 0 }
  }, [datumId, faceWidth, faceHeight, otherCavitiesOnFace])

  // 当前相对该基准的相对偏移量
  const deltaU = Math.round((u - datumU) * 100) / 100
  const deltaV = Math.round((v - datumV) * 100) / 100

  // 构造基准选择下拉选项
  const datumOptions = useMemo(() => {
    const opts = [
      { label: _t('面中心原点 (0, 0)'), value: 'face-origin', hint: '标准' },
      { label: _t('左下角点 (X-, Y-)'), value: 'bottom-left' },
      { label: _t('右下角点 (X+, Y-)'), value: 'bottom-right' },
      { label: _t('左上角点 (X-, Y+)'), value: 'top-left' },
      { label: _t('右上角点 (X+, Y+)'), value: 'top-right' }
    ]

    if (otherCavitiesOnFace.length > 0) {
      opts.push({
        label: `── ${_t('面上孔腔参考')} ──`,
        value: '__divider__',
        hint: ''
      })
      otherCavitiesOnFace.forEach((c) => {
        opts.push({
          label: `${c.name || '孔腔'} (U=${c.u}, V=${c.v})`,
          value: `cavity:${c.instanceId}`
        })
      })
    }

    return opts.filter((o) => o.value !== '__divider__')
  }, [otherCavitiesOnFace])

  const handleDeltaUChange = (newDeltaU: number) => {
    const newAbsoluteU = Math.round((datumU + newDeltaU) * 10) / 10
    onUpdatePosition(newAbsoluteU, v)
  }

  const handleDeltaVChange = (newDeltaV: number) => {
    const newAbsoluteV = Math.round((datumV + newDeltaV) * 10) / 10
    onUpdatePosition(u, newAbsoluteV)
  }

  return (
    <FormSectionWrapper
      title={isGroup ? _t('组合中心坐标定位') : _t('坐标定位 (临时基准)')}
      action={
        <div className="flex items-center gap-1 text-[10px] text-muted-foreground font-mono">
          <MapPin className="size-3 text-primary/80" />
          <span>{faceId}</span>
        </div>
      }
    >
      {/* 基准选择 */}
      <PropertyRow label={_t('参考基准')} title={_t('选择偏移计算的临时参考点（纯交互辅助，不影响持久化模型）')}>
        <CustomSelect
          value={datumId}
          disabled={disabled}
          onChange={(val) => {
            if (val !== '__divider__') setDatumId(val)
          }}
          options={datumOptions}
        />
      </PropertyRow>

      {/* 相对基准的偏移输入 */}
      <PropertyRow label={datumId === 'face-origin' ? _t('位置 U') : _t('偏移 ΔU')} unit="mm">
        <NumberInput
          value={deltaU}
          disabled={disabled}
          step={1}
          unit="mm"
          onChange={handleDeltaUChange}
        />
      </PropertyRow>

      <PropertyRow label={datumId === 'face-origin' ? _t('位置 V') : _t('偏移 ΔV')} unit="mm">
        <NumberInput
          value={deltaV}
          disabled={disabled}
          step={1}
          unit="mm"
          onChange={handleDeltaVChange}
        />
      </PropertyRow>

      {/* 当处于非默认基准时，显示底层绝对坐标提示 */}
      {datumId !== 'face-origin' && (
        <div className="rounded border border-border/40 bg-muted/40 px-2 py-1 flex items-center justify-between text-[10px] text-muted-foreground">
          <span className="flex items-center gap-1">
            <Crosshair className="size-3 text-primary" />
            {_t('绝对坐标')}:
          </span>
          <span className="font-mono text-foreground font-medium">
            U = {u} mm, V = {v} mm
          </span>
        </div>
      )}
    </FormSectionWrapper>
  )
}
