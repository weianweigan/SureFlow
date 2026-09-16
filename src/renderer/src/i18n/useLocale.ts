import { useSyncExternalStore } from 'react'
import { getLocale, subscribeLocale, setLocale } from '@shared/i18n'
import { useSettingsStore } from '../workspace/settings/settingsStore'

setLocale(useSettingsStore.getState().values.locale)
useSettingsStore.subscribe(state => setLocale(state.values.locale))
export function useLocale() {
  return useSyncExternalStore(subscribeLocale, getLocale, getLocale)
}
