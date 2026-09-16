import { t as _t, msg as _msg } from '../../shared/i18n'
/**
 * 设计工程文件管理服务（.sfb 读写与系统文件对话框）
 */

import { dialog } from 'electron'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { SfbProject } from '../../shared/design/types'

export interface OpenProjectResult {
  filePath: string
  doc: SfbProject
  cacheBuffer?: ArrayBuffer | null
  glbBuffer?: ArrayBuffer | null
}

export interface SaveProjectPayload {
  filePath: string
  doc: SfbProject
  cacheBuffer?: ArrayBuffer | Uint8Array | null
  glbBuffer?: ArrayBuffer | Uint8Array | null
  previewImageBase64?: string | null
}

/** 读取并校验 .sfb 文件，并探测加载同目录配套的秒开缓存 */
export async function readProject(filePath: string): Promise<OpenProjectResult> {
  filePath = await fs.realpath(filePath)
  if (process.platform === 'win32') filePath = filePath.toLowerCase()
  const content = await fs.readFile(filePath, 'utf-8')
  const json = JSON.parse(content) as SfbProject
  if (!json.schemaVersion || !json.baseBody || !Array.isArray(json.schemes)) {
    throw new Error(_t("无效的 SureFlow 工程文件格式（缺少必要字段）"))
  }

  const dir = path.dirname(filePath)
  const base = path.basename(filePath)
  const cachePath = path.join(dir, `.${base}.cache`)
  const glbPath = path.join(dir, `.${base}.glb`)

  let cacheBuffer: ArrayBuffer | null = null
  let glbBuffer: ArrayBuffer | null = null

  try {
    const rawCache = await fs.readFile(cachePath)
    cacheBuffer = rawCache.buffer.slice(
      rawCache.byteOffset,
      rawCache.byteOffset + rawCache.byteLength
    )
  } catch {
    // 缓存不存在或损坏，平滑降级
  }

  try {
    const rawGlb = await fs.readFile(glbPath)
    glbBuffer = rawGlb.buffer.slice(
      rawGlb.byteOffset,
      rawGlb.byteOffset + rawGlb.byteLength
    )
  } catch {
    // glb 缓存不存在，平滑降级
  }

  return { filePath, doc: json, cacheBuffer, glbBuffer }
}

function toBuffer(data: ArrayBuffer | ArrayBufferView): Buffer {
  if (Buffer.isBuffer(data)) return data
  if (data instanceof ArrayBuffer) return Buffer.from(data)
  return Buffer.from(data.buffer, data.byteOffset, data.byteLength)
}

/** 读取并解析 .sfb 文件的元数据（用于快速提取预览图等） */
export async function readProjectMeta(filePath: string): Promise<import('../../shared/design/types').SfbProjectMeta | null> {
  try {
    filePath = await fs.realpath(filePath)
    const content = await fs.readFile(filePath, 'utf-8')
    const json = JSON.parse(content) as SfbProject
    return json.meta || null
  } catch {
    return null
  }
}

/** 写入 .sfb 文件，同时自动配套生成 .cache 二进制紧凑网格缓存 */
export async function writeProject(payload: SaveProjectPayload): Promise<string> {
  const { filePath, doc, cacheBuffer, previewImageBase64 } = payload
  const updatedDoc: SfbProject = {
    ...doc,
    meta: {
      ...doc.meta,
      modifiedAt: new Date().toISOString(),
      ...(previewImageBase64 ? { previewImage: previewImageBase64 } : {})
    }
  }

  // 1. 写入主工程 .sfb
  await fs.writeFile(filePath, JSON.stringify(updatedDoc, null, 2), 'utf-8')

  const dir = path.dirname(filePath)
  const base = path.basename(filePath)

  // 2. 配套写入 .cache 二进制紧凑网格缓存
  if (cacheBuffer) {
    const cachePath = path.join(dir, `.${base}.cache`)
    const buf = toBuffer(cacheBuffer)
    await fs.writeFile(cachePath, buf).catch((err) => {
      console.warn('[ProjectService] 写入 .cache 失败:', err)
    })
  }
  return updatedDoc.meta.modifiedAt
}

/** 弹出系统「打开文件」对话框，读取并返回解析后的工程与缓存 */
export async function openProjectDialog(): Promise<OpenProjectResult | null> {
  const result = await dialog.showOpenDialog({
    title: _t("打开 SureFlow 阀块设计工程"),
    properties: ['openFile'],
    filters: [
      { name: _t("SureFlow 工程文件 (*.sfb)"), extensions: ['sfb'] },
      { name: _t("所有文件 (*.*)"), extensions: ['*'] }
    ]
  })

  if (result.canceled || result.filePaths.length === 0) {
    return null
  }

  const filePath = result.filePaths[0]
  return readProject(filePath)
}

/** 弹出系统「另存为」对话框，返回目标文件路径 */
export async function saveProjectDialog(defaultName: string = _t("未命名工程")): Promise<string | null> {
  const cleanName = defaultName.replace(/[\\/:*?"<>|]/g, '_')
  const result = await dialog.showSaveDialog({
    title: _t("保存 SureFlow 阀块设计工程"),
    defaultPath: cleanName.endsWith('.sfb') ? cleanName : `${cleanName}.sfb`,
    filters: [
      { name: _t("SureFlow 工程文件 (*.sfb)"), extensions: ['sfb'] },
      { name: _t("所有文件 (*.*)"), extensions: ['*'] }
    ]
  })

  if (result.canceled || !result.filePath) {
    return null
  }

  return result.filePath
}

/** 弹出系统「导出 STEP」保存对话框并直接保存 .step 文件 (PRD-FR-04-07 §3) */
export async function saveStepDialog(
  defaultName: string = _t("未命名阀块"),
  stepContent: string
): Promise<string | null> {
  const cleanName = defaultName.replace(/[\\/:*?"<>|]/g, '_')
  const result = await dialog.showSaveDialog({
    title: _t("导出 STEP 实体模型"),
    defaultPath: cleanName.endsWith('.step') || cleanName.endsWith('.stp') ? cleanName : `${cleanName}.step`,
    filters: [
      { name: _t("STEP 实体文件 (*.step, *.stp)"), extensions: ['step', 'stp'] },
      { name: _t("所有文件 (*.*)"), extensions: ['*'] }
    ]
  })

  if (result.canceled || !result.filePath) {
    return null
  }

  await fs.writeFile(result.filePath, stepContent, 'utf-8')
  return result.filePath
}

/** 未保存修改关闭确认弹窗 */
export async function confirmCloseDialog(
  projectName: string
): Promise<'save' | 'dontsave' | 'cancel'> {
  const res = await dialog.showMessageBox({
    type: 'warning',
    title: _t("未保存的修改"),
    message: _msg`工程「${projectName}」有尚未保存的更改。`,
    detail: _t("关闭前是否要保存所做的修改？"),
    buttons: [_t("保存"), _t("不保存"), _t("取消")],
    defaultId: 0,
    cancelId: 2
  })

  if (res.response === 0) return 'save'
  if (res.response === 1) return 'dontsave'
  return 'cancel'
}

