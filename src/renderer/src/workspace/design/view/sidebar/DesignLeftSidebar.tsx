import { useLocale as _useLocale } from '@renderer/i18n/useLocale'
import { useState, useEffect, type FC } from 'react'
import { SchemesPanel } from './SchemesPanel'
import { FeatureTreePanel } from './FeatureTreePanel'
import { ChannelListPanel } from './ChannelListPanel'
import { HorizontalResizer } from '../common/Resizer'

const STORAGE_KEY_SCHEMES_HEIGHT = 'sureflow:design:schemes-height'
const SCHEMES_HEIGHT_DEFAULT = 175
const SCHEMES_HEIGHT_MIN = 100
const SCHEMES_HEIGHT_MAX = 380

const STORAGE_KEY_CHANNELS_HEIGHT = 'sureflow:design:channels-height'
const STORAGE_KEY_CHANNELS_COLLAPSED = 'sureflow:design:channels-collapsed'
const CHANNELS_HEIGHT_DEFAULT = 220
const CHANNELS_HEIGHT_MIN = 120
const CHANNELS_HEIGHT_MAX = 480

interface DesignLeftSidebarProps {
  projectId: string
}

export const DesignLeftSidebar: FC<DesignLeftSidebarProps> = ({ projectId }) => {
  _useLocale()
  const [schemesHeight, setSchemesHeight] = useState(() => {
    const saved = localStorage.getItem(STORAGE_KEY_SCHEMES_HEIGHT)
    return saved ? parseInt(saved, 10) : SCHEMES_HEIGHT_DEFAULT
  })

  const [channelsHeight, setChannelsHeight] = useState(() => {
    const saved = localStorage.getItem(STORAGE_KEY_CHANNELS_HEIGHT)
    return saved ? parseInt(saved, 10) : CHANNELS_HEIGHT_DEFAULT
  })

  const [channelsCollapsed, setChannelsCollapsed] = useState(() => {
    return localStorage.getItem(STORAGE_KEY_CHANNELS_COLLAPSED) === 'true'
  })

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_SCHEMES_HEIGHT, String(schemesHeight))
  }, [schemesHeight])

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_CHANNELS_HEIGHT, String(channelsHeight))
  }, [channelsHeight])

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_CHANNELS_COLLAPSED, String(channelsCollapsed))
  }, [channelsCollapsed])

  return (
    <div className="flex h-full w-full flex-col bg-background select-none">
      {/* 方案组部分 */}
      <div className="shrink-0 flex flex-col min-h-0" style={{ height: schemesHeight }}>
        <SchemesPanel projectId={projectId} />
      </div>

      {/* 方案组与特征树之间的水平拖拽分割线 */}
      <HorizontalResizer
        value={schemesHeight}
        onChange={setSchemesHeight}
        min={SCHEMES_HEIGHT_MIN}
        max={SCHEMES_HEIGHT_MAX}
        defaultValue={SCHEMES_HEIGHT_DEFAULT}
      />

      {/* 特征树部分 */}
      <div className="min-h-0 flex-1 flex flex-col">
        <FeatureTreePanel projectId={projectId} />
      </div>

      {/* 特征树与通道列表之间的单条水平分割线（未折叠时反向拖拽向上调高，折叠时固定为1px分割线） */}
      {!channelsCollapsed ? (
        <HorizontalResizer
          value={channelsHeight}
          onChange={setChannelsHeight}
          min={CHANNELS_HEIGHT_MIN}
          max={CHANNELS_HEIGHT_MAX}
          reverse={true}
          defaultValue={CHANNELS_HEIGHT_DEFAULT}
        />
      ) : (
        <div className="h-px w-full bg-border shrink-0" />
      )}

      {/* 通道列表部分（可折叠组） */}
      <div
        className="shrink-0 flex flex-col min-h-0"
        style={{ height: channelsCollapsed ? 36 : channelsHeight }}
      >
        <ChannelListPanel
          projectId={projectId}
          collapsed={channelsCollapsed}
          onToggleCollapse={() => setChannelsCollapsed((v) => !v)}
        />
      </div>
    </div>
  )
}

