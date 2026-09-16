/**
 * 客户端内置标准库预构建拉取脚本
 * 
 * 确保在客户端执行打包前，resources/builtin-libraries/ 包含基础官方标准库：
 * 1. 如果本地 libraries/sureflow-standard-library 存在，直接优先复制同步到 resources/builtin-libraries
 * 2. 如果不存在，则从 Cloudflare R2 官方源下载指定版本的 .sfzip 并解压
 */

const fs = require('node:fs')
const path = require('node:path')
const https = require('node:https')
const AdmZip = require('adm-zip')

const ROOT_DIR = path.resolve(__dirname, '..')
const BUILTIN_TARGET_DIR = path.join(ROOT_DIR, 'resources', 'builtin-libraries', 'sureflow-standard-library')
const LOCAL_DEV_DIR = path.join(ROOT_DIR, 'libraries', 'sureflow-standard-library')

const BASELINE_VERSION = '1.0.0'
const BASELINE_ZIP_URL = `https://sureflow-library.hy3d.space/library/packages/sureflow-standard-library/${BASELINE_VERSION}/sureflow-standard-library-${BASELINE_VERSION}.sfzip`

async function main() {
  // 1. 如果目标已存在 library.sflib，跳过
  if (fs.existsSync(path.join(BUILTIN_TARGET_DIR, 'library.sflib'))) {
    console.log('✅ [sync:builtin] resources/builtin-libraries 中已存在标准库，无需拉取。')
    return
  }

  // 2. 如果本地工程的 libraries/ 下存在开发库，直接复制过去
  if (fs.existsSync(path.join(LOCAL_DEV_DIR, 'library.sflib'))) {
    console.log('🔄 [sync:builtin] 检测到本地 libraries/ 仓库，直接同步到 resources/builtin-libraries...')
    fs.mkdirSync(BUILTIN_TARGET_DIR, { recursive: true })
    fs.cpSync(LOCAL_DEV_DIR, BUILTIN_TARGET_DIR, { recursive: true })
    console.log('✅ [sync:builtin] 本地库同步完成！')
    return
  }

  // 3. 否则从 Cloudflare R2 下载
  console.log(`🌐 [sync:builtin] 正在从 Cloudflare R2 下载官方基线标准库 (v${BASELINE_VERSION})...`)
  console.log(`   URL: ${BASELINE_ZIP_URL}`)

  const tempDir = path.join(ROOT_DIR, '.download-cache')
  fs.mkdirSync(tempDir, { recursive: true })
  const tempZipPath = path.join(tempDir, `baseline-${Date.now()}.sfzip`)

  try {
    await downloadFile(BASELINE_ZIP_URL, tempZipPath)
    console.log('   解压中...')
    const zip = new AdmZip(tempZipPath)
    fs.mkdirSync(BUILTIN_TARGET_DIR, { recursive: true })
    zip.extractAllTo(BUILTIN_TARGET_DIR, true)
    console.log('✅ [sync:builtin] 基线标准库已就绪！')
  } catch (err) {
    console.warn(`⚠️ [sync:builtin] 从远端拉取失败: ${err.message}。将创建空目录作为降级兜底。`)
    fs.mkdirSync(BUILTIN_TARGET_DIR, { recursive: true })
  } finally {
    if (fs.existsSync(tempZipPath)) {
      fs.unlinkSync(tempZipPath)
    }
  }
}

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest)
    https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        // 跟随重定向
        return downloadFile(res.headers.location, dest).then(resolve).catch(reject)
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP 状态码异常: ${res.statusCode}`))
      }
      res.pipe(file)
      file.on('finish', () => {
        file.close(resolve)
      })
    }).on('error', (err) => {
      fs.unlink(dest, () => {})
      reject(err)
    })
  })
}

main().catch((err) => {
  console.error('❌ [sync:builtin] 执行失败:', err)
  process.exit(1)
})
