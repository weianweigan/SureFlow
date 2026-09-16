import { useLocale as _useLocale } from '@renderer/i18n/useLocale'
import { t as _t } from '@shared/i18n'
import React from 'react'
import { FormSectionWrapper, PropertyRow } from './PropertyFormComponents'
import { useDesignStore, type DesignState } from '../../../model/designStore'
import { Layers, Box } from 'lucide-react'

interface SchemeGlobalInspectorProps {
  projectId: string
}

export const SchemeGlobalInspector: React.FC<SchemeGlobalInspectorProps> = ({ projectId }) => {
  _useLocale()
  const session = useDesignStore((s: DesignState) => s.projects[projectId])

  if (!session) return null
  const { doc } = session
  const [sx, sy, sz] = doc.baseBody.dimensions
  const activeScheme = doc.schemes.find((s) => s.id === doc.activeSchemeId) || doc.schemes[0]

  const cavityCount = activeScheme?.cavities.length || 0
  const groupCount = activeScheme?.groups?.length || 0

  return (
    <div className="flex h-full flex-col select-none overflow-y-auto">
      {/* 方案概览信息 */}
      <FormSectionWrapper title={_t('设计方案概览')} isFirst>
        <PropertyRow label={_t('当前方案')}>
          <span className="font-semibold text-foreground text-xs">{activeScheme?.name}</span>
        </PropertyRow>

        <PropertyRow label={_t('孔腔特征总数')}>
          <div className="flex items-center gap-1.5 font-mono text-xs text-foreground font-medium">
            <Layers className="size-3.5 text-primary" />
            <span>{cavityCount} {_t('个孔腔')}</span>
          </div>
        </PropertyRow>

        <PropertyRow label={_t('组合特征')}>
          <div className="flex items-center gap-1.5 font-mono text-xs text-foreground">
            <Box className="size-3.5 text-primary" />
            <span>{groupCount} {_t('个组合孔组')}</span>
          </div>
        </PropertyRow>

        <PropertyRow label={_t('基体包围外形')}>
          <span className="font-mono text-xs text-foreground font-semibold">
            {sx} × {sy} × {sz} mm
          </span>
        </PropertyRow>

        <PropertyRow label={_t('形状类型')}>
          <span className="text-xs text-muted-foreground capitalize">
            {doc.baseBody.template || 'box'}
          </span>
        </PropertyRow>
      </FormSectionWrapper>
    </div>
  )
}

