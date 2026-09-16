import { useCallback, useEffect, useState } from 'react'
import { Button } from '@renderer/components/ui/button'
import type { AssociatedExtension, FileAssociationInfo } from '@shared/settings/fileAssociations'
import { t } from '@shared/i18n'
import { useLocale } from '@renderer/i18n/useLocale'
export function FileAssociationSettings() {
  useLocale()
  const [info, setInfo] = useState<FileAssociationInfo | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const refresh = useCallback(async () => {
    try { setInfo(await window.settingsApi.associations()); setError('') }
    catch { setError('无法读取文件关联状态。请重试。') }
  }, [])
  useEffect(() => { void refresh(); const onFocus = () => { void refresh() }; window.addEventListener('focus', onFocus); return () => window.removeEventListener('focus', onFocus) }, [refresh])
  const configure = async (extension: AssociatedExtension) => {
    setBusy(true)
    try { await window.settingsApi.configureAssociation(extension); await refresh() }
    catch { setError('未能更改关联。请在系统中完成默认应用选择后刷新状态。') }
    finally { setBusy(false) }
  }
  const statuses = { default: 'SureFlow 是默认应用', other: '当前由其他应用打开', unknown: '无法确认当前默认应用', development: '开发模式：请使用安装版配置关联', unsupported: '当前系统不支持配置关联' }
  return <section className="sf-settings__section" aria-labelledby="association-title">
    <div className="sf-settings__section-title"><div><h2 id="association-title" className="text-base font-semibold">{t('文件关联')}</h2>
      <p className="mt-1 text-xs text-muted-foreground">{t('仅关联 .sfb 工程和 .sfzip 库包。')}</p></div>
      <Button size="sm" variant="outline" onClick={() => void refresh()}>{t('刷新状态')}</Button></div>
    {error && <p role="alert" className="mb-3 text-xs text-destructive">{t(error)}</p>}
    <div className="sf-settings__card">{info?.entries.map(entry => <div className="sf-settings__row" key={entry.extension}>
      <div><span className="font-mono text-sm">.{entry.extension}</span><p className="mt-1 text-xs text-muted-foreground">{t(statuses[entry.state])}</p></div>
      <Button size="sm" variant="outline" disabled={busy || !info.packaged || entry.state === 'unsupported' || entry.state === 'default'} onClick={() => void configure(entry.extension)}>
        {t(info.platform === 'win32' ? '在系统中设置' : '设为默认应用')}</Button>
    </div>) ?? <p className="p-5 text-xs">{t('正在读取…')}</p>}</div>
    <p className="mt-3 text-xs text-muted-foreground">{t('系统可能要求确认；取消不会改变关联。双击库包时会先确认导入，已有工程会定位到对应 Tab。')}</p>
  </section>
}
