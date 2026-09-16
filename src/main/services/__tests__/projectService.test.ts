import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import type { SfbProject } from '@shared/design/types'

vi.mock('electron', () => ({
  dialog: {
    showOpenDialog: vi.fn(),
    showSaveDialog: vi.fn(),
    showMessageBox: vi.fn()
  }
}))

import { writeProject, readProject } from '../projectService'

describe('projectService: writeProject & readProject', () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sureflow-test-'))
  })

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  const sampleDoc: SfbProject = {
    schemaVersion: '1.0.0',
    meta: {
      projectName: 'TestValve',
      createdAt: '2026-09-01T00:00:00Z',
      modifiedAt: '2026-09-01T00:00:00Z',
      author: 'Tester'
    },
    baseBody: {
      template: 'box',
      dimensions: [120, 100, 80],
      material: '铝合金 6061-T6'
    },
    schemes: [
      {
        id: 'scheme-1',
        name: '默认方案',
        cavities: [],
        groups: []
      }
    ],
    activeSchemeId: 'scheme-1'
  }

  it('writes embedded preview and sliced cache, and reads legacy GLB sidecars', async () => {
    const projectPath = path.join(tmpDir, 'MyValve.sfb')

    // 构造带有非零 byteOffset 的 Uint8Array 模拟跨 IPC 共享内存池的切片
    const sharedPool = new ArrayBuffer(512)
    const poolView = new Uint8Array(sharedPool)

    // 在偏移 0 处填入噪声脏数据
    poolView.set([0xff, 0xff, 0xff, 0xff], 0)

    // GLB 模拟数据：位于 offset 64，长度 16
    const mockGlbBytes = new Uint8Array([0x67, 0x6c, 0x54, 0x46, 0x02, 0x00, 0x00, 0x00, 0x10, 0x00, 0x00, 0x00, 0x01, 0x02, 0x03, 0x04])
    poolView.set(mockGlbBytes, 64)
    const glbSlice = new Uint8Array(sharedPool, 64, mockGlbBytes.length)

    // Cache 模拟数据：位于 offset 128，长度 12
    const mockCacheBytes = new Uint8Array([0x53, 0x46, 0x42, 0x43, 0x01, 0x00, 0x00, 0x00, 0x0a, 0x0b, 0x0c, 0x0d])
    poolView.set(mockCacheBytes, 128)
    const cacheSlice = new Uint8Array(sharedPool, 128, mockCacheBytes.length)

    // 模拟 1x1 像素 PNG 的 Base64 数据
    const mockPngBase64 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

    await writeProject({
      filePath: projectPath,
      doc: sampleDoc,
      cacheBuffer: cacheSlice,
      glbBuffer: glbSlice,
      previewImageBase64: mockPngBase64
    })

    // 1. 验证 .sfb 主工程文件
    const sfbExists = await fs.stat(projectPath).then(() => true).catch(() => false)
    expect(sfbExists).toBe(true)
    const sfbContent = JSON.parse(await fs.readFile(projectPath, 'utf-8'))
    expect(sfbContent.meta.projectName).toBe('TestValve')

    // 新格式不再写 GLB/PNG 侧文件；预览内嵌于工程元数据。
    expect(sfbContent.meta.previewImage).toBe(mockPngBase64)
    expect(await fs.readdir(tmpDir)).toEqual(expect.arrayContaining(['MyValve.sfb', '.MyValve.sfb.cache']))
    expect(await fs.readdir(tmpDir)).not.toContain('.MyValve.sfb.glb')
    expect(await fs.readdir(tmpDir)).not.toContain('.MyValve.sfb.png')
    // 老工程的 GLB 侧文件仍可读取，且不扩大共享内存切片。
    await fs.writeFile(path.join(tmpDir, '.MyValve.sfb.glb'), glbSlice)

    // 3. 验证 .cache 二进制缓存（文件名应为 .MyValve.sfb.cache）
    const cachePath = path.join(tmpDir, '.MyValve.sfb.cache')
    const cacheFileBuf = await fs.readFile(cachePath)
    expect(cacheFileBuf.length).toBe(mockCacheBytes.length)
    expect(Array.from(cacheFileBuf)).toEqual(Array.from(mockCacheBytes))

    // 5. 验证 readProject 能够平滑重新加载
    const readResult = await readProject(projectPath)
    const canonicalPath = await fs.realpath(projectPath)
    expect(readResult.filePath).toBe(process.platform === 'win32' ? canonicalPath.toLowerCase() : canonicalPath)
    expect(readResult.doc.meta.projectName).toBe('TestValve')
    expect(readResult.glbBuffer).not.toBeNull()
    expect(readResult.glbBuffer!.byteLength).toBe(mockGlbBytes.length)
    expect(new Uint8Array(readResult.glbBuffer!)).toEqual(mockGlbBytes)
    expect(readResult.cacheBuffer).not.toBeNull()
    expect(readResult.cacheBuffer!.byteLength).toBe(mockCacheBytes.length)
  })
})
