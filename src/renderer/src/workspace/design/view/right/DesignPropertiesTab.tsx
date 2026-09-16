import { useLocale as _useLocale } from '@renderer/i18n/useLocale'
import type { FC } from 'react'
import { useDesignStore, getSelectedCavityIds } from '../../model/designStore'

// 模块化 Inspector 组件
import { BaseBodyInspector } from './properties/BaseBodyInspector'
import { HostFaceInspector } from './properties/HostFaceInspector'
import { SingleCavityInspector } from './properties/SingleCavityInspector'
import { CompoundCavityInspector } from './properties/CompoundCavityInspector'
import { SubCavityInspector } from './properties/SubCavityInspector'
import { MultiCavityInspector } from './properties/MultiCavityInspector'
import { FlowChannelInspector } from './properties/FlowChannelInspector'
import { SidePortInspector } from './properties/SidePortInspector'
import { SchemeGlobalInspector } from './properties/SchemeGlobalInspector'

interface DesignPropertiesTabProps {
  projectId: string
}

export const DesignPropertiesTab: FC<DesignPropertiesTabProps> = ({ projectId }) => {
  _useLocale()
  const session = useDesignStore((s) => s.projects[projectId])

  if (!session) return null
  const { doc, selected } = session
  const activeScheme = doc.schemes.find((s) => s.id === doc.activeSchemeId) || doc.schemes[0]

  // 1. 选中侧油口 (Side Port)
  if (selected?.type === 'port') {
    return (
      <SidePortInspector
        projectId={projectId}
        cavityId={selected.cavityId}
        portIndex={selected.portIndex}
      />
    )
  }

  // 2. 选中通道 (Flow Channel)
  if (selected?.type === 'channel') {
    return <FlowChannelInspector projectId={projectId} channelId={selected.id} />
  }

  // 3. 选中面基准 (Host Face)
  if (selected?.type === 'face') {
    return <HostFaceInspector projectId={projectId} faceId={selected.id} />
  }

  // 4. 选中组合孔 (Compound Cavity)
  if (selected?.type === 'group' && (!selected.extraIds || selected.extraIds.length === 0)) {
    const group = activeScheme?.groups?.find((g) => g.id === selected.id)
    if (group) {
      return <CompoundCavityInspector projectId={projectId} group={group} />
    }
  }

  // 5. 多孔选中判断 (Multiple Cavities)
  const selectedCavityIds = getSelectedCavityIds(selected, activeScheme)
  if (selectedCavityIds.length > 1) {
    const cavities = (activeScheme?.cavities || []).filter((c) =>
      selectedCavityIds.includes(c.instanceId)
    )
    if (cavities.length > 1) {
      return <MultiCavityInspector projectId={projectId} cavities={cavities} />
    }
  }

  // 6. 单孔选中判断 (Single Cavity or Sub-Cavity within Compound Cavity)
  if (selectedCavityIds.length === 1) {
    const targetCavityId = selectedCavityIds[0]
    const cavity = activeScheme?.cavities.find((c) => c.instanceId === targetCavityId)
    if (cavity) {
      // 检查是否属于某个组合孔组
      const parentGroup = cavity.groupId
        ? activeScheme?.groups?.find((g) => g.id === cavity.groupId)
        : null

      if (parentGroup) {
        return (
          <SubCavityInspector
            projectId={projectId}
            cavity={cavity}
            parentGroup={parentGroup}
          />
        )
      }

      return <SingleCavityInspector projectId={projectId} cavity={cavity} />
    }
  }

  // 7. 选中基体 (Base Body)
  if (selected?.type === 'base') {
    return <BaseBodyInspector projectId={projectId} />
  }

  // 8. 全局方案概览 (未选中或 scheme 模式)
  return <SchemeGlobalInspector projectId={projectId} />
}
