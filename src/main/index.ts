import { initAutoUpdater } from './updater'
import { initTray, destroyTray } from './tray'
import { app, BrowserWindow, shell, ipcMain, protocol, net, nativeImage, Menu, session } from 'electron'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { registerLibraryIpc } from './ipc/libraryIpc'
import { registerProjectIpc } from './ipc/projectIpc'
import { FileOpenQueue } from './services/fileOpenQueue'
import { queryFileAssociations, configureFileAssociation } from './services/fileAssociationService'
import type { AssociatedExtension } from '../shared/settings/fileAssociations'
import { setLocale, t } from '../shared/i18n'
import { resolveSfFilePath } from './services/safeFileProtocol'

const fileQueue = new FileOpenQueue()
let mainWindow: BrowserWindow | null = null
let isQuitting = false
const hasLock = app.requestSingleInstanceLock()
if (!hasLock) app.quit()
else fileQueue.enqueue(process.argv.slice(app.isPackaged ? 1 : 2), process.cwd())

function receiveFiles(files: string[], cwd: string): void {
  fileQueue.enqueue(files, cwd)
  if (!app.isReady()) return
  if (!mainWindow || mainWindow.isDestroyed()) createWindow()
  if (mainWindow!.isMinimized()) mainWindow!.restore()
  mainWindow!.show()
  mainWindow!.focus()
  mainWindow!.webContents.send('files:pending')
}
app.on('open-file', (event, filePath) => {
  event.preventDefault()
  if (hasLock) receiveFiles([filePath], process.cwd())
})
app.on('second-instance', (_event, argv, cwd) => receiveFiles(argv.slice(1), cwd))

function applyLanguage(locale: unknown): void {
  if (locale !== 'zh-CN' && locale !== 'en-US') return
  setLocale(locale)
  mainWindow?.setTitle(t('SureFlow · 阀块设计'))
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(process.platform === 'darwin' ? [{ label: 'SureFlow', submenu: [
      { role: 'about' as const, label: t('关于 SureFlow') }, { type: 'separator' as const },
      { role: 'hide' as const, label: t('隐藏 SureFlow') }, { role: 'quit' as const, label: t('退出') }
    ] }] : []),
    { label: t('编辑'), submenu: [
      { role: 'undo', label: t('撤销') }, { role: 'redo', label: t('重做') }, { type: 'separator' },
      { role: 'cut', label: t('剪切') }, { role: 'copy', label: t('复制') },
      { role: 'paste', label: t('粘贴') }, { role: 'selectAll', label: t('全选') }
    ] },
    { label: t('窗口'), submenu: [{ role: 'minimize', label: t('最小化') }, { role: 'close', label: t('关闭') }] }
  ]))
}

function getAppIconPath(fileName: string): string {
  const outPath = join(__dirname, fileName)
  if (existsSync(outPath)) return outPath
  const buildPath = join(app.getAppPath(), 'build', fileName)
  if (existsSync(buildPath)) return buildPath
  return outPath
}

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'sf-file',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      bypassCSP: true,
      stream: true
    }
  }
])

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    show: false,
    autoHideMenuBar: true,
    title: '阀块设计',
    backgroundColor: '#f5f7fa',
    // 窗口图标（Windows 任务栏/Alt-Tab；macOS 下窗口 icon 选项被系统忽略，需在 app.whenReady 中调用 app.dock.setIcon）
    icon: process.platform === 'win32'
      ? getAppIconPath('icon.ico')
      : getAppIconPath('icon.png'),
    // 无边框窗口：Tab 条与自定义窗口控制按钮同行（PRD-FR-03-01 §6）
    frame: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow = window
  window.on('closed', () => { if (mainWindow === window) mainWindow = null })

  // 系统托盘：Windows 关闭窗口 → 隐藏到托盘（PRD-FR-06-02）
  window.on('close', (event) => {
    if (!isQuitting && process.platform === 'win32') {
      event.preventDefault()
      window.hide()
    }
  })

  // 最大化状态变化通知渲染层（切换 最大化/还原 图标）
  window.on('maximize', () => {
    window.webContents.send('window:maximized-changed', true)
  })
  window.on('unmaximize', () => {
    window.webContents.send('window:maximized-changed', false)
  })

  window.on('ready-to-show', () => {
    window.show()
  })

  // 外部链接一律交给系统浏览器或默认程序打开，不在应用内导航
  window.webContents.setWindowOpenHandler((details) => {
    if (details.url.startsWith('sf-file:')) {
      try {
        const filePath = resolveSfFilePath(details.url)
        shell.openPath(filePath).catch(() => {})
      } catch {
        // ignore
      }
      return { action: 'deny' }
    }
    if (details.url.startsWith('https://') || details.url.startsWith('http://') || details.url.startsWith('mailto:')) {
      shell.openExternal(details.url).catch(() => {})
    }
    return { action: 'deny' }
  })

  // 开发模式加载 Vite Dev Server，生产模式加载构建产物
  if (process.env['ELECTRON_RENDERER_URL']) {
    window.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    window.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  if (!hasLock) return

  // 移除阻止 iframe 嵌套的响应头，以允许在软件内部浏览器 Tab 中加载外部网页参考资料
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const responseHeaders = { ...details.responseHeaders }
    const keys = Object.keys(responseHeaders)
    for (const key of keys) {
      const lowerKey = key.toLowerCase()
      if (lowerKey === 'x-frame-options') {
        delete responseHeaders[key]
      } else if (lowerKey === 'content-security-policy') {
        const csp = responseHeaders[key][0]?.toLowerCase() || ''
        if (csp.includes('frame-ancestors')) {
          responseHeaders[key][0] = responseHeaders[key][0].replace(/frame-ancestors[^;]+;?/gi, '')
        }
      }
    }
    callback({
      cancel: false,
      responseHeaders
    })
  })

  ipcMain.handle('files:drain', () => fileQueue.drain())
  ipcMain.handle('associations:query', () => queryFileAssociations())
  ipcMain.handle('associations:configure', (_e, extension: AssociatedExtension) => configureFileAssociation(extension))
  ipcMain.handle('app:locale', (_e, locale: unknown) => applyLanguage(locale))
  ipcMain.on('window:minimize', (e) => BrowserWindow.fromWebContents(e.sender)?.minimize())
  ipcMain.on('window:toggle-maximize', (e) => {
    const window = BrowserWindow.fromWebContents(e.sender)
    if (window?.isMaximized()) window.unmaximize(); else window?.maximize()
  })
  ipcMain.on('window:close', (e) => BrowserWindow.fromWebContents(e.sender)?.close())
  ipcMain.on('window:toggle-devtools', (e) => BrowserWindow.fromWebContents(e.sender)?.webContents.toggleDevTools())
  ipcMain.handle('window:is-maximized', (e) => BrowserWindow.fromWebContents(e.sender)?.isMaximized() ?? false)

  ipcMain.handle('app:open-external', async (_e, targetUrl: string) => {
    if (typeof targetUrl !== 'string') return
    if (targetUrl.startsWith('sf-file:')) {
      try {
        const filePath = resolveSfFilePath(targetUrl)
        await shell.openPath(filePath)
      } catch {
        // ignore
      }
    } else if (targetUrl.startsWith('https://') || targetUrl.startsWith('http://') || targetUrl.startsWith('mailto:')) {
      await shell.openExternal(targetUrl)
    } else {
      await shell.openPath(targetUrl)
    }
  })
  ipcMain.handle('shell:show-item-in-folder', async (_e, fullPath: string) => {
    if (typeof fullPath !== 'string' || !fullPath.trim()) return false
    let resolved = fullPath.trim()
    if (resolved.startsWith('file://')) {
      try {
        resolved = fileURLToPath(resolved)
      } catch {
        // ignore
      }
    } else if (resolved.startsWith('sf-file:')) {
      try {
        resolved = resolveSfFilePath(resolved)
      } catch {
        // ignore
      }
    }
    if (existsSync(resolved)) {
      shell.showItemInFolder(resolved)
      return true
    }
    if (process.platform === 'darwin' && !resolved.startsWith('/Volumes') && existsSync(`/Volumes${resolved}`)) {
      shell.showItemInFolder(`/Volumes${resolved}`)
      return true
    }
    return false
  })
  // 本地安全协议：支持通过 sf-file:// 绝对路径访问本地文档与 3D 模型
  protocol.handle('sf-file', async (request) => {
    try {
      const filePath = resolveSfFilePath(request.url)
      if (!existsSync(filePath)) {
        console.warn(`[sf-file] File not found: ${filePath} (from ${request.url})`)
        return new Response('File Not Found', { status: 404 })
      }
      return await net.fetch(pathToFileURL(filePath).toString())
    } catch (err) {
      console.error(`[sf-file] Error loading ${request.url}:`, err)
      return new Response('File Not Found', { status: 404 })
    }
  })

  // 二进制文件读取通用通道（供 3D 解析器调用）
  ipcMain.handle('file:read-binary', async (_event, filePath: string) => {
    const buffer = await readFile(filePath)
    return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
  })

  // macOS 开发及运行模式下需显式调用 app.dock.setIcon 设置 Dock 图标
  if (process.platform === 'darwin' && app.dock) {
    const iconPath = getAppIconPath('icon.png')
    const dockIcon = nativeImage.createFromPath(iconPath)
    if (!dockIcon.isEmpty()) {
      app.dock.setIcon(dockIcon)
    }
  }

  registerLibraryIpc()
  registerProjectIpc()
  createWindow()
  initAutoUpdater()

  // 系统托盘初始化（PRD-FR-06）
  initTray({
    onShowWindow: () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        if (mainWindow.isMinimized()) mainWindow.restore()
        mainWindow.show()
        mainWindow.focus()
      } else {
        createWindow()
      }
    },
    onGoHome: () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        if (mainWindow.isMinimized()) mainWindow.restore()
        mainWindow.show()
        mainWindow.focus()
        mainWindow.webContents.send('workspace:navigate-home')
      } else {
        createWindow()
      }
    },
    getRecentProjects: async () => {
      // 从渲染进程的 localStorage 读取最近工程列表
      if (!mainWindow || mainWindow.isDestroyed() || !mainWindow.webContents) return []
      try {
        const raw = await mainWindow.webContents.executeJavaScript(
          `localStorage.getItem('sureflow:recent-files') || '[]'`
        )
        const parsed = JSON.parse(raw)
        if (!Array.isArray(parsed)) return []
        return parsed
          .filter((e: unknown) =>
            typeof e === 'object' && e !== null &&
            typeof (e as { filePath: string }).filePath === 'string' &&
            typeof (e as { name: string }).name === 'string'
          )
          .map((e: { name: string; filePath: string }) => ({ name: e.name, filePath: e.filePath }))
      } catch {
        return []
      }
    },
    onOpenProject: (filePath: string) => {
      // 显示窗口并通过文件队列打开工程
      fileQueue.enqueue([filePath], process.cwd())
      if (mainWindow && !mainWindow.isDestroyed()) {
        if (mainWindow.isMinimized()) mainWindow.restore()
        mainWindow.show()
        mainWindow.focus()
        mainWindow.webContents.send('files:pending')
      } else {
        createWindow()
      }
    },
    onCheckUpdate: () => {
      // 触发手动更新检查（通过现有 IPC 通道机制）
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.show()
        mainWindow.focus()
      }
    },
    onQuit: () => {
      isQuitting = true
      app.quit()
    }
  })

  // 真正退出前设置标记、销毁托盘
  app.on('before-quit', () => {
    isQuitting = true
    destroyTray()
  })

  app.on('activate', () => {
    // macOS：点击 Dock 图标时恢复或重建窗口
    if (!mainWindow || mainWindow.isDestroyed()) {
      createWindow()
    } else {
      mainWindow.show()
      mainWindow.focus()
    }
  })
})

app.on('window-all-closed', () => {
  // 系统托盘驻留：两平台关闭所有窗口后均不退出（PRD-FR-06-02）
  // 用户通过托盘菜单「退出 SureFlow」或 macOS Cmd+Q 完全退出
})
