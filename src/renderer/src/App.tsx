import { useLocale as _useLocale } from '@renderer/i18n/useLocale'
import { LanguageEffects } from './i18n/LanguageEffects'
import { WorkspaceRoot } from './workspace/WorkspaceRoot'
// import { StatusBar } from './components/StatusBar'
import type { FC } from 'react'

/**
 * 应用外壳（M1 骨架）：
 *   Tab 管理条（dockview）→ 工作区 → 状态栏
 * 原 Toolbar/Viewer3D 演示内容已迁入设计 Tab 面板（DesignTabPanel）。
 */
const App: FC = () => {
  _useLocale()
  return (
    <div className="app-shell">
      <LanguageEffects />
      <WorkspaceRoot />
      {/* <StatusBar /> */}
    </div>
  )
}

export default App
