import { openDesignTab, openPanelByType } from './panelActions'
import { useLibraryStore } from '../library/viewmodel/libraryStore'
import { useWorkspaceStore } from '../layout/layoutStore'
import { t } from '@shared/i18n'

const importedPackages = new Map<string, string>()
/** Serial processing preserves dialog order and isolates individual failures. */
let processing = Promise.resolve()
export function consumeSystemFiles(): Promise<void> {
  processing = processing.catch(() => {}).then(async () => {
    if (!window.settingsApi) return
    const files = await window.settingsApi.drainFiles()
    for (const filePath of files) {
      try {
        if (/\.sfb$/i.test(filePath)) {
          const projectId = `project-${encodeURIComponent(filePath)}`
          const existing = useWorkspaceStore.getState().api?.getPanel(`design:${projectId}`)
          if (existing) { existing.api.setActive(); continue }
          const result = await window.projectApi.read(filePath)
          openDesignTab({ ...result, initialDoc: result.doc, initialCacheBuffer: result.cacheBuffer,
            initialGlbBuffer: result.glbBuffer, projectId,
            name: filePath.split(/[\\/]/).pop()?.replace(/\.sfb$/i, '') })
        } else if (/\.sfzip$/i.test(filePath)) {
          openPanelByType('library')
          await useLibraryStore.getState().init()
          const existingId = importedPackages.get(filePath)
          if (existingId && useLibraryStore.getState().libraries.some(library => library.id === existingId)) {
            await useLibraryStore.getState().openLibrary(existingId)
            continue
          }
          if (!window.confirm(`${t('导入此孔腔库包？将创建独立的用户库，不覆盖当前库。')}\n${filePath}`)) continue
          const summary = await window.libraryApi.import({ kind: 'sfzip', zipPath: filePath })
          importedPackages.set(filePath, summary.id)
          await useLibraryStore.getState().refreshList()
          // openLibrary owns the unsaved-change confirmation; cancellation preserves the active library.
          await useLibraryStore.getState().openLibrary(summary.id)
        }
      } catch (error) {
        window.alert(`${t('无法打开文件')}\n${filePath}\n${error instanceof Error ? error.message : String(error)}`)
      }
    }
  })
  return processing
}
