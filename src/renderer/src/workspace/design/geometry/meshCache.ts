/**
 * 网格二进制缓存与 GLB 导出器 (PRD-FR-04-07 §2)
 * 1. 紧凑二进制缓存 (.cache)：无损序列化顶点、法线、索引、CAD 边线与面元元数据，实现工程秒开 (<= 200ms)；
 * 2. 标准二进制模型 (.glb)：基于 Three.js GLTFExporter 导出独立 GLB 缓存；
 * 3. 模型预览位图 (.png)：离屏生成居中的实体预览图。
 */

import * as THREE from 'three'
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'
import { toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type { TriangleTag } from './meshClassifier'

const SFBC_MAGIC = 0x53464243 // 'SFBC'
const SFBC_VERSION = 1

export interface RawMeshData {
  positions: Float32Array
  normals: Float32Array
  indices: Uint32Array
  edgePositions: Float32Array
  triangleTags?: Record<number, TriangleTag>
}

/**
 * 将原始 CSG 几何体数据打包成紧凑的单块 ArrayBuffer
 */
export function packMeshCache(data: RawMeshData): ArrayBuffer {
  const { positions, normals, indices, edgePositions, triangleTags } = data

  const encoder = new TextEncoder()
  const tagsJson = triangleTags ? JSON.stringify(triangleTags) : ''
  const tagsBytes = encoder.encode(tagsJson)

  // Header 结构 (32 bytes):
  // [0..3]: Magic (0x53464243)
  // [4..7]: Version (1)
  // [8..11]: posCount (float32 elements)
  // [12..15]: normCount (float32 elements)
  // [16..19]: idxCount (uint32 elements)
  // [20..23]: edgeCount (float32 elements)
  // [24..27]: tagsByteLength (bytes)
  // [28..31]: reserved (0)
  const headerBytes = 32
  const posBytes = positions.byteLength
  const normBytes = normals.byteLength
  const idxBytes = indices.byteLength
  const edgeBytes = edgePositions.byteLength
  const tagBytesLen = tagsBytes.byteLength

  const totalLength = headerBytes + posBytes + normBytes + idxBytes + edgeBytes + tagBytesLen
  const buffer = new ArrayBuffer(totalLength)
  const view = new DataView(buffer)

  view.setUint32(0, SFBC_MAGIC, true)
  view.setUint32(4, SFBC_VERSION, true)
  view.setUint32(8, positions.length, true)
  view.setUint32(12, normals.length, true)
  view.setUint32(16, indices.length, true)
  view.setUint32(20, edgePositions.length, true)
  view.setUint32(24, tagBytesLen, true)
  view.setUint32(28, 0, true)

  let offset = headerBytes

  new Uint8Array(buffer, offset, posBytes).set(
    new Uint8Array(positions.buffer, positions.byteOffset, posBytes)
  )
  offset += posBytes

  new Uint8Array(buffer, offset, normBytes).set(
    new Uint8Array(normals.buffer, normals.byteOffset, normBytes)
  )
  offset += normBytes

  new Uint8Array(buffer, offset, idxBytes).set(
    new Uint8Array(indices.buffer, indices.byteOffset, idxBytes)
  )
  offset += idxBytes

  new Uint8Array(buffer, offset, edgeBytes).set(
    new Uint8Array(edgePositions.buffer, edgePositions.byteOffset, edgeBytes)
  )
  offset += edgeBytes

  if (tagBytesLen > 0) {
    new Uint8Array(buffer, offset, tagBytesLen).set(tagsBytes)
  }

  return buffer
}

/**
 * 从紧凑 ArrayBuffer 中零拷贝/极速还原几何体与分类元数据 (耗时通常 < 3ms)
 */
export function unpackMeshCache(buffer: ArrayBuffer): RawMeshData | null {
  if (buffer.byteLength < 32) return null
  const view = new DataView(buffer)

  const magic = view.getUint32(0, true)
  const version = view.getUint32(4, true)
  if (magic !== SFBC_MAGIC || version !== SFBC_VERSION) {
    return null
  }

  const posCount = view.getUint32(8, true)
  const normCount = view.getUint32(12, true)
  const idxCount = view.getUint32(16, true)
  const edgeCount = view.getUint32(20, true)
  const tagBytesLen = view.getUint32(24, true)

  let offset = 32

  const positions = new Float32Array(buffer.slice(offset, offset + posCount * 4))
  offset += posCount * 4

  const normals = new Float32Array(buffer.slice(offset, offset + normCount * 4))
  offset += normCount * 4

  const indices = new Uint32Array(buffer.slice(offset, offset + idxCount * 4))
  offset += idxCount * 4

  const edgePositions = new Float32Array(buffer.slice(offset, offset + edgeCount * 4))
  offset += edgeCount * 4

  let triangleTags: Record<number, TriangleTag> | undefined
  if (tagBytesLen > 0 && offset + tagBytesLen <= buffer.byteLength) {
    try {
      const tagBytes = new Uint8Array(buffer, offset, tagBytesLen)
      const decoder = new TextDecoder()
      triangleTags = JSON.parse(decoder.decode(tagBytes))
    } catch {
      // 容错
    }
  }

  return {
    positions,
    normals,
    indices,
    edgePositions,
    triangleTags
  }
}

/**
 * 导出当前三维实体与边线为标准 GLB 二进制缓存
 */
export function createPortableModel(
  solidGeom: THREE.BufferGeometry,
  edgeGeom?: THREE.BufferGeometry | null,
  materialColor: string = '#cbd5e1'
) {
  const root = new THREE.Group()
  root.name = 'SureFlowValveBlock'
  // Rebuild normals at actual creases, including hole floors and shoulders.
  // Work on a clone: exports must never modify the viewport's indexed picking mesh.
  const source = solidGeom.clone()
  const exportGeometry = toCreasedNormals(source, Math.PI / 6)
  if (exportGeometry !== source) source.dispose()

  // 基体外表面 PBR 材质
  const baseMat = new THREE.MeshStandardMaterial({
    color: materialColor,
    roughness: 0.35,
    metalness: 0.6
  })

  // 孔腔内壁机械加工铝质感材质（消除全同色导致的内孔对比度丧失）
  const cavityMat = new THREE.MeshStandardMaterial({
    color: '#e2e8f0',
    roughness: 0.38,
    metalness: 0.2
  })

  let mesh: THREE.Mesh
  if (solidGeom.groups && solidGeom.groups.length > 0) {
    // 映射组材质：Group 0, 1 -> baseMat, Group 2, 3 -> cavityMat (彻底消除 UI 临时选中高亮)
    const materials = [baseMat, baseMat, cavityMat, cavityMat]
    mesh = new THREE.Mesh(exportGeometry, materials)
  } else {
    mesh = new THREE.Mesh(exportGeometry, baseMat)
  }
  mesh.name = 'ValveBlockSolid'
  root.add(mesh)

  let lineMat: THREE.MeshBasicMaterial | undefined
  if (edgeGeom && edgeGeom.attributes.position && edgeGeom.attributes.position.count > 0) {
    // glTF 2.0 规范对线条推荐 MeshBasicMaterial，避免 LineBasicMaterial 导致第三方解析警告
    lineMat = new THREE.MeshBasicMaterial({ color: '#1e293b' })
    const lines = new THREE.LineSegments(edgeGeom, lineMat as any)
    lines.name = 'FeatureEdges'
    root.add(lines)
  }
  return {
    root,
    dispose: () => {
      exportGeometry.dispose()
      baseMat.dispose()
      cavityMat.dispose()
      lineMat?.dispose()
    }
  }
}

export async function exportToGlb(
  solidGeom: THREE.BufferGeometry,
  edgeGeom?: THREE.BufferGeometry | null,
  materialColor: string = '#cbd5e1'
): Promise<ArrayBuffer> {
  const model = createPortableModel(solidGeom, edgeGeom, materialColor)

  const exporter = new GLTFExporter()
  try {
    return await new Promise<ArrayBuffer>((resolve, reject) => {
      exporter.parse(
        model.root,
        (result) => {
          if (result instanceof ArrayBuffer) {
            resolve(result)
          } else if (result instanceof Uint8Array) {
            resolve(new Uint8Array(result).buffer)
          } else {
            // 若导出为 Object/JSON，转为 ArrayBuffer
            const str = JSON.stringify(result)
            resolve(new TextEncoder().encode(str).buffer)
          }
        },
        (error) => {
          reject(error)
        },
        { binary: true }
      )
    })
  } finally {
    model.dispose()
  }
}

/** Render a framed, opaque model, independent of dock visibility and cleared canvases. */
export function renderModelPreview(
  renderer: THREE.WebGLRenderer,
  solidGeom: THREE.BufferGeometry,
  edgeGeom?: THREE.BufferGeometry | null,
  materialColor = '#cbd5e1',
  viewCamera?: THREE.Camera,
  width = 960,
  height = 640
): string {
  const model = createPortableModel(solidGeom, edgeGeom, materialColor)
  const target = new THREE.WebGLRenderTarget(width, height, { depthBuffer: true })
  target.texture.colorSpace = THREE.SRGBColorSpace
  const previousTarget = renderer.getRenderTarget()
  const previousViewport = renderer.getViewport(new THREE.Vector4())
  const previousScissor = renderer.getScissor(new THREE.Vector4())
  const previousScissorTest = renderer.getScissorTest()
  const previousAutoClear = renderer.autoClear
  const previousClipping = renderer.clippingPlanes
  const previousClearColor = renderer.getClearColor(new THREE.Color())
  const previousClearAlpha = renderer.getClearAlpha()
  try {
    const scene = new THREE.Scene()
    scene.background = new THREE.Color('#e8edf3')
    scene.add(model.root, new THREE.HemisphereLight('#ffffff', '#8b95a5', 2))
    const sphere = new THREE.Box3().setFromObject(model.root).getBoundingSphere(new THREE.Sphere())
    if (!Number.isFinite(sphere.radius) || sphere.radius <= 0) throw new Error('预览网格为空')
    const halfHeight = sphere.radius * 1.15 * Math.max(1, height / width)
    const camera = new THREE.OrthographicCamera(-halfHeight * width / height, halfHeight * width / height, halfHeight, -halfHeight, 0.1, sphere.radius * 10 + 1)
    const direction = viewCamera
      ? viewCamera.getWorldDirection(new THREE.Vector3()).negate()
      : new THREE.Vector3(1.6, -1.4, 1.9).normalize()
    camera.up.copy(viewCamera?.up ?? new THREE.Vector3(0, 0, 1))
    camera.position.copy(sphere.center).addScaledVector(direction, sphere.radius * 3)
    camera.lookAt(sphere.center)
    camera.updateMatrixWorld(true)
    const light = new THREE.DirectionalLight('#ffffff', 2.5)
    light.position.copy(camera.position)
    light.target.position.copy(sphere.center)
    scene.add(light, light.target)
    // RenderTarget 的 viewport 使用物理像素，避免 setViewport 再次应用屏幕 DPR。
    target.viewport.set(0, 0, width, height)
    renderer.setRenderTarget(target)
    renderer.setScissorTest(false)
    renderer.clippingPlanes = []
    renderer.autoClear = true
    renderer.render(scene, camera)
    const pixels = new Uint8Array(width * height * 4)
    renderer.readRenderTargetPixels(target, 0, 0, width, height, pixels)
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('无法创建预览画布')
    const data = context.createImageData(width, height)
    for (let y = 0; y < height; y++) {
      data.data.set(pixels.subarray((height - 1 - y) * width * 4, (height - y) * width * 4), y * width * 4)
    }
    context.putImageData(data, 0, 0)
    return canvas.toDataURL('image/png')
  } finally {
    renderer.setRenderTarget(previousTarget)
    renderer.setViewport(previousViewport)
    renderer.setScissor(previousScissor)
    renderer.setScissorTest(previousScissorTest)
    renderer.autoClear = previousAutoClear
    renderer.clippingPlanes = previousClipping
    renderer.setClearColor(previousClearColor, previousClearAlpha)
    target.dispose()
    model.dispose()
  }
}
