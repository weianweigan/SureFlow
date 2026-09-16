import { useEffect, useRef, useState } from 'react'
import { ArrowDown, Check, CircleAlert, RefreshCw } from 'lucide-react'
import { useLocale } from '@renderer/i18n/useLocale'
import { t } from '@shared/i18n'
import type { UpdateState } from '@shared/updater'
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover'
import { Button } from './ui/button'

export function useUpdateState() {
  const [state, setState] = useState<UpdateState>({ status: 'disabled', currentVersion: '' })
  useEffect(() => {
    let active = true
    let received = false
    const unsubscribe = window.updaterApi.onState((next) => {
      received = true
      if (active) setState(next)
    })
    void window.updaterApi.getState().then((next) => {
      if (active && !received) setState(next)
    }).catch((error: unknown) => {
      if (active) setState((previous) => ({ ...previous, status: 'error', error: String(error) }))
    })
    return () => { active = false; unsubscribe() }
  }, [])
  return state
}
export const labels = {
  manual: '发现新版本，请下载并手动安装',
  disabled: '开发环境不检查更新', idle: '等待检查更新', 'up-to-date': '当前已是最新版本', checking: '正在检查更新…',
  downloading: '正在后台下载更新', ready: '新版本已就绪，是否立即重启以完成更新？', error: '更新失败'
}
const mb = (bytes = 0) => (bytes / 1024 / 1024).toFixed(1)

export function UpdateDetails({ state, later }: { state: UpdateState; later?: () => void }) {
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  async function action(install: boolean) {
    setError(''); setBusy(true)
    try {
      if (install) {
        if (!await window.updaterApi.install()) setError(t('暂时无法安装，请重新检查更新。'))
      } else await window.updaterApi.check()
    } catch (cause) { setError(String(cause)) }
    finally { setBusy(false) }
  }
  return <div className="space-y-3 text-sm">
    <h2 className="font-semibold">{t('应用更新')}</h2>
    <p className="text-xs text-muted-foreground">SureFlow v{state.currentVersion}{state.version && ` → v${state.version}`}</p>
    {state.manualUpdate && <p className="text-xs text-muted-foreground">{t('此 macOS 版本使用手动更新，下载新版后替换应用即可。')}</p>}
    <p role="status">{t(labels[state.status])}</p>
    {state.status === 'downloading' && <>
      <progress className="w-full" max={100} value={state.percent ?? 0} aria-label={t('下载进度')} />
      <p className="text-xs text-muted-foreground">{(state.percent ?? 0).toFixed(0)}% · {mb(state.transferred)} / {mb(state.total)} MB · {mb(state.bytesPerSecond)} MB/s</p>
    </>}
    {(state.error || error) && <p role="alert" className="max-h-32 overflow-auto break-words text-destructive">{error || state.error}</p>}
    {state.releaseNotes && <div><h3 className="mb-1 font-medium">{t('更新日志')}</h3>
      <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words font-sans text-xs leading-relaxed">{state.releaseNotes}</pre></div>}
    {state.manualUpdate && <Button size="sm" variant="outline" onClick={() => {
      void window.updaterApi.openDownload().catch((cause: unknown) => setError(String(cause)))
    }}>{t('下载最新版本')}</Button>}
    {state.status === 'ready' ? <>
      <p className="text-xs text-muted-foreground">{t('请先保存工作。选择稍后，将在下次退出应用时安装更新。macOS 关闭窗口不会退出应用。')}</p>
      <div className="flex gap-2"><Button size="sm" disabled={busy} onClick={() => void action(true)}>{t('立即重启')}</Button>
        {later && <Button size="sm" variant="outline" onClick={later}>{t('稍后')}</Button>}</div>
    </> : <Button size="sm" variant="outline"
      disabled={busy || ['disabled', 'checking', 'downloading'].includes(state.status)}
      onClick={() => void action(false)}>{t(state.status === 'error' ? '重试更新' : '检查更新')}</Button>}
  </div>
}

export function UpdateControls() {
  useLocale()
  const state = useUpdateState()
  const [open, setOpen] = useState(false)
  const prompted = useRef<string | undefined>(undefined)
  useEffect(() => {
    if ((state.status === 'ready' || state.status === 'manual') && prompted.current !== state.version) {
      prompted.current = state.version
      setOpen(true)
    }
  }, [state.status, state.version])
  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger asChild><button className="sf-window-controls__btn" title={t(labels[state.status])} aria-label={t('应用更新')}>
      {state.status === 'downloading' ? <svg width="24" height="24" viewBox="0 0 24 24" role="progressbar"
        aria-label={t('下载进度')} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(state.percent ?? 0)}>
        <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2" opacity="0.2" />
        <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2" pathLength="100"
          strokeDasharray={`${state.percent ?? 0} 100`} transform="rotate(-90 12 12)" />
        <path d="M12 7v9m-3-3 3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.5" />
      </svg> : state.status === 'error' ? <CircleAlert size={16} className="text-destructive" /> :
        state.status === 'ready' ? <Check size={16} /> : state.status === 'checking' ?
          <RefreshCw size={16} className="animate-spin" /> : <ArrowDown size={16} />}
    </button></PopoverTrigger>
    <PopoverContent align="end" className="w-96 max-w-[calc(100vw-24px)] p-4" onOpenAutoFocus={(event) => event.preventDefault()}>
      <UpdateDetails state={state} later={() => setOpen(false)} />
    </PopoverContent>
  </Popover>
}

export function UpdateSettings() {
  useLocale()
  const state = useUpdateState()
  return <section className="sf-settings__section"><div className="sf-settings__card p-4"><UpdateDetails state={state} /></div></section>
}
