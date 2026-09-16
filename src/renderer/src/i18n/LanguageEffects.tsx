import { useEffect } from 'react'
import { t } from '@shared/i18n'
import { useLocale } from './useLocale'
import { useWorkspaceStore } from '../workspace/layout/layoutStore'

export function LanguageEffects() {
  const locale = useLocale()
  const api = useWorkspaceStore(s => s.api)
  useEffect(() => {
    document.documentElement.lang = locale
    document.title = t('SureFlow · 阀块设计')
    void window.settingsApi?.setLocale(locale).catch(console.error)
    const updateTitles = () => {
      for (const [id, title] of [['home', '主页'], ['library', '库管理'], ['settings', '设置']]) {
        api?.getPanel(id)?.api.setTitle(t(title))
      }
    }
    updateTitles()
    const subscription = api?.onDidAddPanel(updateTitles)
    return () => subscription?.dispose()
  }, [locale, api])
  return null
}
