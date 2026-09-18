/**
 * 系统托盘管理模块（PRD-FR-06）
 *
 * 职责：创建系统托盘图标、构建右键菜单、处理交互事件。
 * Windows：单击/双击显示窗口，右键弹出菜单。
 * macOS：单击弹出菜单（系统标准行为）。
 */

import { Tray, Menu, nativeImage, app } from 'electron'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { t } from '../shared/i18n'
import { getTrayMenuIcon } from './trayIcons'

let tray: Tray | null = null

export interface TrayCallbacks {
  onShowWindow: () => void
  onGoHome: () => void
  getRecentProjects: () => Promise<{ name: string; filePath: string }[]>
  onOpenProject: (filePath: string) => void
  onCheckUpdate: () => void
  onQuit: () => void
}

let callbacks: TrayCallbacks | null = null

function getTrayIconPath(): string {
  if (process.platform === 'win32') {
    // Windows: use .ico
    const outPath = join(__dirname, 'icon.ico')
    if (existsSync(outPath)) return outPath
    const buildPath = join(app.getAppPath(), 'build', 'icon.ico')
    if (existsSync(buildPath)) return buildPath
    const cwdPath = join(process.cwd(), 'build', 'icon.ico')
    if (existsSync(cwdPath)) return cwdPath
    return outPath
  } else {
    // macOS / Linux: use .png
    const outPath = join(__dirname, 'icon.png')
    if (existsSync(outPath)) return outPath
    const buildPath = join(app.getAppPath(), 'build', 'icon.png')
    if (existsSync(buildPath)) return buildPath
    const cwdPath = join(process.cwd(), 'build', 'icon.png')
    if (existsSync(cwdPath)) return cwdPath
    return outPath
  }
}

async function buildContextMenu(): Promise<Menu> {
  const recentProjects = callbacks ? await callbacks.getRecentProjects() : []

  const recentSubmenu: Electron.MenuItemConstructorOptions[] =
    recentProjects.length > 0
      ? recentProjects.slice(0, 5).map((project) => ({
          label: project.name,
          icon: getTrayMenuIcon('project'),
          toolTip: project.filePath,
          click: () => callbacks?.onOpenProject(project.filePath)
        }))
      : [{ label: t('无最近工程'), enabled: false }]

  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: t('主页'),
      icon: getTrayMenuIcon('home'),
      click: () => callbacks?.onGoHome()
    },
    {
      label: t('显示 SureFlow'),
      icon: getTrayMenuIcon('app'),
      click: () => callbacks?.onShowWindow()
    },
    { type: 'separator' },
    {
      label: t('打开最近工程'),
      icon: getTrayMenuIcon('recent'),
      submenu: recentSubmenu
    },
    { type: 'separator' },
    {
      label: t('检查更新'),
      icon: getTrayMenuIcon('update'),
      click: () => callbacks?.onCheckUpdate()
    },
    { type: 'separator' },
    {
      label: t('退出 SureFlow'),
      icon: getTrayMenuIcon('quit'),
      click: () => callbacks?.onQuit()
    }
  ]

  return Menu.buildFromTemplate(template)
}

async function showContextMenu(): Promise<void> {
  if (!tray) return
  const menu = await buildContextMenu()
  tray.popUpContextMenu(menu)
}

export function initTray(cb: TrayCallbacks): void {
  callbacks = cb

  const iconPath = getTrayIconPath()

  // Windows: 直接使用 .ico 文件路径，让 Windows Shell 按当前屏幕 DPI 自动匹配多分辨率图标，避免 16x16 强制缩放导致的模糊
  // macOS / Linux: 使用 16x16 缩放图适应菜单栏
  if (process.platform === 'win32' && existsSync(iconPath)) {
    tray = new Tray(iconPath)
  } else {
    const icon = nativeImage.createFromPath(iconPath)
    const resized = icon.isEmpty() ? icon : icon.resize({ width: 16, height: 16 })
    tray = new Tray(resized)
  }

  tray.setToolTip(t('SureFlow · 阀块设计'))

  // Platform-specific click behavior
  if (process.platform === 'win32') {
    // Windows: single click / double click → show window
    tray.on('click', () => callbacks?.onShowWindow())
    tray.on('double-click', () => callbacks?.onShowWindow())
    // Right click → show context menu (handled automatically when setContextMenu is used,
    // but we build it dynamically for recent projects)
    tray.on('right-click', () => void showContextMenu())
  } else {
    // macOS: single click → show context menu (standard behavior)
    tray.on('click', () => void showContextMenu())
  }
}

export function destroyTray(): void {
  if (tray) {
    tray.destroy()
    tray = null
  }
}
