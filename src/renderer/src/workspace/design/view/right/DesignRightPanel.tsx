import { useLocale as _useLocale } from '@renderer/i18n/useLocale'
import { t as _t } from '@shared/i18n'
import { useState, useEffect, type FC } from 'react'
import { Library, SlidersHorizontal } from 'lucide-react'
import { CavityLibraryTab } from './CavityLibraryTab'
import { DesignPropertiesTab } from './DesignPropertiesTab'
import { cn } from '@renderer/lib/utils'

interface DesignRightPanelProps {
  projectId: string
}

export const DesignRightPanel: FC<DesignRightPanelProps> = ({ projectId }) => {
  _useLocale()
  const [activeTab, setActiveTab] = useState<'props' | 'library'>('props')

  useEffect(() => {
    const handleSwitch = (e: any) => {
      if (e.detail?.tab) {
        setActiveTab(e.detail.tab)
      }
    }
    window.addEventListener('sureflow:switch-right-tab', handleSwitch)
    return () => window.removeEventListener('sureflow:switch-right-tab', handleSwitch)
  }, [])

  return (
    <div className="flex h-full w-full flex-col bg-background select-none">
      {/* ── 顶部双 Tab 切换 Header（对齐库管理 h-10 border-b border-border px-3） ── */}
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-border px-3 bg-background">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setActiveTab('props')}
            className={cn(
              'flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors',
              activeTab === 'props'
                ? 'bg-accent text-accent-foreground font-semibold shadow-2xs'
                : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'
            )}
          >
            <SlidersHorizontal className="size-3.5" />
            <span>{_t("属性")}</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('library')}
            className={cn(
              'flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors',
              activeTab === 'library'
                ? 'bg-accent text-accent-foreground font-semibold shadow-2xs'
                : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'
            )}
          >
            <Library className="size-3.5" />
            <span>{_t("孔腔库")}</span>
          </button>
        </div>
      </div>

      {/* Tab 内容区 */}
      <div className="min-h-0 flex-1 overflow-auto">
        {activeTab === 'props' ? (
          <DesignPropertiesTab projectId={projectId} />
        ) : (
          <CavityLibraryTab projectId={projectId} />
        )}
      </div>
    </div>
  )
}
