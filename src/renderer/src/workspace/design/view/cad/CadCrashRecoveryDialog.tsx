import React, { useEffect, useState } from 'react'
import { useDesignStore } from '../../model/designStore'
import { useWorkspaceStore } from '@renderer/workspace/layout/layoutStore'
import { useLocale } from '@renderer/i18n/useLocale'
import { AlertTriangle, Download, Trash2, X } from 'lucide-react'
import type { CadDisconnectedEvent } from '@shared/cad/cadBridgeTypes'
import { t } from '@shared/i18n'

export const CadCrashRecoveryDialog: React.FC = () => {
  useLocale()
  const [activeEvent, setActiveEvent] = useState<CadDisconnectedEvent | null>(null)
  const [targetProjectId, setTargetProjectId] = useState<string | null>(null)

  useEffect(() => {
    const handleCrashAlert = (e: Event) => {
      const customEvent = e as CustomEvent<CadDisconnectedEvent>
      const event = customEvent.detail
      const projects = useDesignStore.getState().projects

      // 查找对应绑定的工程
      const matched = Object.entries(projects).find(
        ([, p]) =>
          (event.docGuid && p.cadIntegration?.docGuid === event.docGuid) ||
          p.cadIntegration?.processId === event.pid
      )

      if (matched) {
        setTargetProjectId(matched[0])
        setActiveEvent(event)
      }
    }

    window.addEventListener('sureflow:cad-crash-alert', handleCrashAlert)
    return () => window.removeEventListener('sureflow:cad-crash-alert', handleCrashAlert)
  }, [])

  const handleIgnore = () => {
    setActiveEvent(null)
    setTargetProjectId(null)
  }

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && activeEvent) {
        handleIgnore()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [activeEvent])

  if (!activeEvent || !targetProjectId) return null

  const project = useDesignStore.getState().projects[targetProjectId]
  const cadName = activeEvent.cadType || 'CAD'

  const handleSaveAsIndependent = async () => {
    const store = useDesignStore.getState()
    const success = await store.saveAsProject(targetProjectId)
    if (success) {
      store.detachCadIntegration(targetProjectId)
      setActiveEvent(null)
      setTargetProjectId(null)
    }
  }

  const handleDiscardAndClose = () => {
    if (targetProjectId) {
      try {
        const api = useWorkspaceStore.getState().api
        const panel = api?.getPanel(`design:${targetProjectId}`) ?? api?.getPanel(targetProjectId)
        if (api && panel) {
          api.removePanel(panel)
        }
      } catch (err) {
        console.warn('[CadCrashRecoveryDialog] 关闭工程面板失败:', err)
      }
      useDesignStore.getState().removeProject(targetProjectId)
    }
    setActiveEvent(null)
    setTargetProjectId(null)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 select-none">
      <div className="relative w-full max-w-md bg-background border border-destructive/40 rounded-xl shadow-2xl p-6 flex flex-col gap-5 animate-in fade-in zoom-in-95 duration-200">
        {/* 右上角关闭按钮，支持主动忽略连接中断 */}
        <button
          type="button"
          className="absolute top-4 right-4 p-1.5 text-muted-foreground hover:text-foreground rounded-lg hover:bg-muted transition-colors cursor-pointer"
          onClick={handleIgnore}
          aria-label={t('关闭')}
          title={t('忽略连接中断并关闭窗口')}
        >
          <X className="size-4" />
        </button>

        <div className="flex items-start gap-4 pr-6">
          <div className="p-3 bg-destructive/10 text-destructive rounded-xl shrink-0">
            <AlertTriangle className="size-6" />
          </div>
          <div className="flex flex-col gap-1">
            <h3 className="text-base font-semibold text-foreground">
              {t('检测到 ')}{cadName}{t(' 异常退出 / 连接中断')}
            </h3>
            <p className="text-xs text-muted-foreground leading-relaxed">
              {t('与宿主 CAD 进程 (PID: ')}{activeEvent.pid}{t(') 的通信已意外断开。当前正在设计的工程「')}{project?.doc?.meta?.projectName || t('未命名工程')}{t('」存在未同步状态，请选择处理方式：')}
            </p>
          </div>
        </div>

        <div className="bg-muted/40 border border-border/60 rounded-lg p-3 text-xs flex flex-col gap-1.5">
          <div className="flex justify-between text-muted-foreground">
            <span>{t('关联 CAD 文档：')}</span>
            <span className="font-mono text-foreground truncate max-w-[200px]" title={project?.cadIntegration?.docPath}>
              {project?.cadIntegration?.docPath?.split(/[\\/]/).pop() || project?.cadIntegration?.docGuid}
            </span>
          </div>
          <div className="flex justify-between text-muted-foreground">
            <span>{t('当前几何孔数：')}</span>
            <span className="font-semibold text-foreground">
              {project?.doc?.schemes[0]?.cavities?.length || 0}
            </span>
          </div>
        </div>

        <div className="flex flex-col gap-2 pt-2">
          <button
            type="button"
            className="flex items-center justify-center gap-2 w-full py-2.5 px-4 bg-primary text-primary-foreground font-medium text-xs rounded-lg hover:bg-primary/90 transition-colors shadow-sm cursor-pointer"
            onClick={handleSaveAsIndependent}
          >
            <Download className="size-4" />
            <span>{t('另存为独立 .sfb 文件 (推荐保留现场)')}</span>
          </button>

          <button
            type="button"
            className="flex items-center justify-center gap-2 w-full py-2 px-4 bg-muted hover:bg-destructive/10 hover:text-destructive text-muted-foreground font-medium text-xs rounded-lg transition-colors cursor-pointer"
            onClick={handleDiscardAndClose}
          >
            <Trash2 className="size-3.5" />
            <span>{t('放弃未保存修改并关闭当前工程')}</span>
          </button>

          <button
            type="button"
            className="flex items-center justify-center gap-2 w-full py-2 px-4 text-xs text-muted-foreground hover:text-foreground hover:bg-muted font-medium rounded-lg transition-colors cursor-pointer"
            onClick={handleIgnore}
          >
            <span>{t('忽略连接中断并继续编辑')}</span>
          </button>
        </div>
      </div>
    </div>
  )
}

