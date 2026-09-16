/**
 * Windows 安装程序许可协议同步工具
 * 
 * 将根目录 LICENSE 转换为符合 Windows NSIS 规范的 UTF-8 with BOM 文本，
 * 并写入 build/license.txt，用于 NSIS 安装向导展示许可协议（EULA）与同意步骤。
 * 
 * 为什么需要该步骤：
 * 1. Windows NSIS MUI_PAGE_LICENSE 对纯文本文件若无 UTF-8 BOM，在非 UTF-8 ANSI 环境（如简体中文 CP936）
 *    下会将中文字符显示为乱码；带 UTF-8 BOM 可确保在任意 Windows 系统语言下中文字符均 100% 正确渲染。
 * 2. 统一将换行符格式化为 Windows 标准 CRLF (\r\n)，避免 Windows 控件文本折行错位。
 * 3. 随 prebuild 自动触发，保证安装包展示的协议永远与工程根目录 LICENSE 保持完全一致。
 */

const fs = require('node:fs')
const path = require('node:path')

const ROOT_DIR = path.resolve(__dirname, '..')
const SOURCE_LICENSE = path.join(ROOT_DIR, 'LICENSE')
const TARGET_LICENSE = path.join(ROOT_DIR, 'build', 'license.txt')

function syncLicense() {
  if (!fs.existsSync(SOURCE_LICENSE)) {
    console.warn('⚠️ [sync:license] 未找到根目录 LICENSE 文件，跳过同步。')
    return
  }

  const rawContent = fs.readFileSync(SOURCE_LICENSE, 'utf-8')

  // 标准化换行为 CRLF (\r\n)
  const normalized = rawContent.replace(/\r?\n/g, '\r\n')

  // UTF-8 BOM 头: 0xEF, 0xBB, 0xBF
  const bom = Buffer.from([0xef, 0xbb, 0xbf])
  const textBuffer = Buffer.from(normalized, 'utf-8')
  const finalBuffer = Buffer.concat([bom, textBuffer])

  fs.mkdirSync(path.dirname(TARGET_LICENSE), { recursive: true })
  fs.writeFileSync(TARGET_LICENSE, finalBuffer)

  console.log(`✅ [sync:license] 成功将 LICENSE 同步至 build/license.txt (UTF-8 with BOM, ${finalBuffer.length} bytes)`)
}

if (require.main === module) {
  syncLicense()
}

module.exports = { syncLicense }
