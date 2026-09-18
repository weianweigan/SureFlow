const fs = require('fs')
const path = require('path')
const sharp = require('../node_modules/sharp')

async function generate() {
  const icons = {
    home: `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#2563eb" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
      <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
      <polyline points="9 22 9 12 15 12 15 22"/>
    </svg>`,
    recent: `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#4b5563" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/>
    </svg>`,
    project: `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#0284c7" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/>
      <polyline points="14 2 14 8 20 8"/>
    </svg>`,
    update: `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#059669" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
      <path d="M3 3v5h5"/>
      <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/>
      <path d="M16 16h5v5"/>
    </svg>`,
    quit: `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#dc2626" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
      <polyline points="16 17 21 12 16 7"/>
      <line x1="21" x2="9" y1="12" y2="12"/>
    </svg>`
  }

  // Also SureFlow app icon from build/icon.png
  const appIconBuffer = await sharp('build/icon.png')
    .resize(32, 32, { fit: 'contain' })
    .png()
    .toBuffer()

  const outDir = path.join('build', 'tray')
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true })
  }

  fs.writeFileSync(path.join(outDir, 'app.png'), appIconBuffer)

  const dataUrls = {
    app: `data:image/png;base64,${appIconBuffer.toString('base64')}`
  }

  for (const [key, svg] of Object.entries(icons)) {
    const buf = await sharp(Buffer.from(svg))
      .resize(32, 32, { fit: 'contain' })
      .png()
      .toBuffer()
    fs.writeFileSync(path.join(outDir, `${key}.png`), buf)
    dataUrls[key] = `data:image/png;base64,${buf.toString('base64')}`
  }

  const tsContent = `/**
 * 自动生成的托盘菜单图标（Base64 PNG，32x32 @2x 高清图）
 * 在所有平台与打包模式下无需文件系统寻址，开箱即用。
 */
import { nativeImage, type NativeImage } from 'electron'

const ICONS: Record<string, string> = ${JSON.stringify(dataUrls, null, 2)}

export function getTrayMenuIcon(name: 'home' | 'app' | 'recent' | 'project' | 'update' | 'quit'): NativeImage {
  const dataUrl = ICONS[name]
  if (!dataUrl) return nativeImage.createEmpty()
  const img = nativeImage.createFromDataURL(dataUrl)
  return img.resize({ width: 16, height: 16 })
}
`

  fs.writeFileSync(path.join('src', 'main', 'trayIcons.ts'), tsContent)
  console.log('Successfully generated tray icons in build/tray and src/main/trayIcons.ts!')
}

generate().catch((err) => {
  console.error(err)
  process.exit(1)
})
