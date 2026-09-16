import { Suspense, lazy, useEffect, useState } from 'react'
import { GESTURES, MOUSE_PRESETS, PRESET_NAMES, gestureLabel, validBindings, type Gesture, type MouseBindings, type MousePreset } from '@shared/settings/mouseBindings'
import { useSettingsStore } from './settingsStore'
import { Button } from '@renderer/components/ui/button'
import { t } from '@shared/i18n'
import { useLocale } from '@renderer/i18n/useLocale'
const MousePreview = lazy(() => import('./MousePreview'))

export function MouseHint() {
  useLocale()
  const preset = useSettingsStore(s => s.values.designMousePreset)
  const custom = useSettingsStore(s => s.values.designMouseCustomBindings)
  const bindings = preset === 'custom' ? custom : MOUSE_PRESETS[preset]
  return <>{t('左键选择 / 框选')} · {t(gestureLabel(bindings.rotate))} {t('旋转')} · {t(gestureLabel(bindings.pan))} {t('平移')} · {t('滚轮缩放')}</>
}

export function MouseSettings() {
  useLocale()
  const { values, update, reset, saveMouseBindings } = useSettingsStore()
  const bindings = values.designMousePreset === 'custom' ? values.designMouseCustomBindings : MOUSE_PRESETS[values.designMousePreset]
  const [draft, setDraft] = useState<MouseBindings>({ ...bindings })
  const [editing, setEditing] = useState(false)
  const [confirmReset, setConfirmReset] = useState(false)
  useEffect(() => { if (!editing) setDraft({ ...bindings }) }, [bindings, editing])
  const conflict = !validBindings(draft)
  return <section className="sf-settings__section" aria-labelledby="mouse-title">
    <div className="sf-settings__section-title"><div><h2 id="mouse-title" className="text-base font-semibold">{t('鼠标操作')}</h2>
      <p className="mt-1 text-xs text-muted-foreground">{t('设计 Tab 专用；键盘快捷键保持不变。')}</p></div>
      <Button size="sm" variant="ghost" onClick={() => setConfirmReset(true)}>{t('恢复鼠标默认')}</Button></div>
    {confirmReset && <div className="sf-settings__confirm"><span>{t('恢复 SureFlow 鼠标预设并清除自定义配置？')}</span>
      <Button size="sm" onClick={() => { reset(['designMousePreset', 'designMouseCustomBindings', 'designReverseWheel']); setEditing(false); setConfirmReset(false) }}>{t('确认恢复')}</Button>
      <Button size="sm" variant="outline" onClick={() => setConfirmReset(false)}>{t('取消')}</Button></div>}
    <div className="sf-settings__card">
      <div className="sf-settings__row"><label htmlFor="mouse-preset">{t('操作预设')}</label>
        <select id="mouse-preset" value={values.designMousePreset} onChange={e => { update('designMousePreset', e.target.value as MousePreset); setEditing(false) }}>
          {Object.entries(PRESET_NAMES).map(([id, label]) => <option value={id} key={id}>{t(label)}</option>)}
        </select></div>
      <div className="p-5 text-xs space-y-3">
        {(['rotate', 'pan', 'zoom'] as const).map((action, i) => <div className="flex items-center justify-between gap-4" key={action}>
          <label htmlFor={`mouse-${action}`}>{t(['旋转', '平移', '拖动缩放'][i])}</label>
          {editing ? <select className="rounded border border-border bg-background p-2" id={`mouse-${action}`} value={draft[action]}
            onChange={e => setDraft({ ...draft, [action]: e.target.value as Gesture })}>
            {GESTURES.map(gesture => <option key={gesture} value={gesture}>{t(gestureLabel(gesture))}</option>)}
          </select> : <span>{t(gestureLabel(bindings[action]))}</span>}
        </div>)}
        <p className="text-muted-foreground">{t('左键用于选择、框选和编辑手柄。Shift/Ctrl + 左键保留多选。')}</p>
        {editing ? <><p role="status" className={conflict ? 'text-destructive' : 'text-muted-foreground'}>{t(conflict ? '手势冲突：每个动作必须使用不同手势。' : '配置有效，保存后应用到所有设计 Tab。')}</p>
          <div className="flex gap-2"><Button size="sm" disabled={conflict} onClick={() => { if (saveMouseBindings(draft)) setEditing(false) }}>{t('保存自定义')}</Button>
            <Button size="sm" variant="outline" onClick={() => setEditing(false)}>{t('取消')}</Button></div></>
          : <Button size="sm" variant="outline" onClick={() => { setDraft({ ...bindings }); setEditing(true) }}>{t('基于此预设自定义')}</Button>}
      </div>
      <div className="sf-settings__row"><label htmlFor="reverse-wheel">{t('反转滚轮缩放方向')}</label>
        <input id="reverse-wheel" type="checkbox" role="switch" checked={values.designReverseWheel} onChange={e => update('designReverseWheel', e.target.checked)} /></div>
    </div>
    <p className="my-3 text-xs text-muted-foreground">{t('空闲时立即生效；拖动中的操作使用开始时的方案。下方可试用已保存的操作配置。')}</p>
    <Suspense fallback={<p>{t('加载预览…')}</p>}><MousePreview /></Suspense>
  </section>
}
