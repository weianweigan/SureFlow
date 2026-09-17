import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './lib/posthog'
// Design.md 字体替代：Inter（sans）/ JetBrains Mono（mono）
import '@fontsource-variable/inter'
import '@fontsource-variable/jetbrains-mono'
import 'dockview-react/dist/styles/dockview.css'
import './assets/workspace.css'
import './assets/main.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
