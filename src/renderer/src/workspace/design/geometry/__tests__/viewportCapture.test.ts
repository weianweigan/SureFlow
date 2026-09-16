import { afterEach, describe, it, expect, vi } from 'vitest'
import * as THREE from 'three'
import { captureDisplayedPreview, captureIsometricPreview, fitPreviewCamera } from '../viewportCapture'
import { renderModelPreview } from '../meshCache'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('captureDisplayedPreview', () => {
  it('returns the composed viewport without rebuilding or rerendering the scene', () => {
    const png = 'data:image/png;base64,currentFrameWithHud'
    const gl = {
      domElement: { width: 1800, height: 900, toDataURL: vi.fn(() => png) },
      render: vi.fn(), setViewport: vi.fn(), setRenderTarget: vi.fn()
    } as unknown as THREE.WebGLRenderer
    expect(captureDisplayedPreview(gl)).toBe(png)
    expect(gl.domElement.toDataURL).toHaveBeenCalledWith('image/png')
    expect(gl.render).not.toHaveBeenCalled()
    expect(gl.setViewport).not.toHaveBeenCalled()
    expect(gl.setRenderTarget).not.toHaveBeenCalled()
    expect(gl.domElement.width).toBe(1800)
    expect(gl.domElement.height).toBe(900)
  })

  it('rejects an empty canvas instead of embedding an invalid preview', () => {
    const gl = { domElement: { width: 0, height: 0 } } as THREE.WebGLRenderer
    expect(() => captureDisplayedPreview(gl)).toThrow('视口画布尺寸为空')
  })
})

describe('fitPreviewCamera', () => {
  it.each([0.5, 1, 2.5])('fits every model corner at aspect ratio %s without changing direction', (aspect: number) => {
    const camera = new THREE.OrthographicCamera(-300 * aspect, 300 * aspect, 300, -300, 10, 20)
    camera.position.set(400, -700, 200)
    camera.up.set(0, 0, 1)
    camera.lookAt(new THREE.Vector3(900, 50, -300))
    camera.zoom = 100
    const rotation = camera.quaternion.clone()
    const bounds = new THREE.Box3(new THREE.Vector3(), new THREE.Vector3(120, 100, 80))
    fitPreviewCamera(camera, bounds)
    expect(camera.quaternion.equals(rotation)).toBe(true)
    const center = bounds.getCenter(new THREE.Vector3()).project(camera)
    expect(Math.abs(center.x)).toBeLessThan(1e-6)
    expect(Math.abs(center.y)).toBeLessThan(1e-6)
    for (const x of [0, 120]) for (const y of [0, 100]) for (const z of [0, 80]) {
      const p = new THREE.Vector3(x, y, z).project(camera)
      expect(Math.abs(p.x)).toBeLessThanOrEqual(0.800001)
      expect(Math.abs(p.y)).toBeLessThanOrEqual(0.800001)
      expect(Math.abs(p.z)).toBeLessThan(1)
    }
  })
})

describe('captureIsometricPreview', () => {
  it.each([1, 1.25, 1.5, 2])('captures the complete image at DPR %s and restores the viewport', (dpr: number) => {
    let renderedCamera!: THREE.Camera
    let activeViewport = new THREE.Vector4()

    const mockGl = {
      getRenderTarget: vi.fn(() => null),
      setRenderTarget: vi.fn((target: THREE.WebGLRenderTarget | null) => {
        activeViewport.copy(target?.viewport ?? new THREE.Vector4(0, 0, 800 * dpr, 600 * dpr))
      }),
      getViewport: vi.fn(() => new THREE.Vector4(0, 0, 800, 600)),
      setViewport: vi.fn((x: number | THREE.Vector4, y?: number, w?: number, h?: number) => {
        if (x instanceof THREE.Vector4) activeViewport.copy(x)
        else activeViewport.set(x, y!, w!, h!)
        activeViewport.multiplyScalar(dpr).round()
      }),
      getClearColor: vi.fn(() => new THREE.Color()),
      getClearAlpha: vi.fn(() => 1),
      setClearColor: vi.fn(),
      getScissor: vi.fn(() => new THREE.Vector4(0, 0, 800, 600)),
      setScissor: vi.fn(),
      getScissorTest: vi.fn(() => false),
      setScissorTest: vi.fn(),
      autoClear: true,
      render: vi.fn((_scene: THREE.Scene, camera: THREE.Camera) => {
        renderedCamera = camera
        expect(activeViewport.toArray()).toEqual([0, 0, 960, 640])
      }),
      readRenderTargetPixels: vi.fn((_target: THREE.WebGLRenderTarget, _x: number, _y: number, _width: number, _height: number, pixels: Uint8Array) => {
        // 区分底部和顶部，验证 PNG 左下角像素也被完整读取且方向正确。
        pixels.fill(200)
        pixels.set([11, 22, 33, 255], 0)
      })
    } as unknown as THREE.WebGLRenderer

    // 构造测试场景：阀块位于 [0, 0, 0] 到 [120, 100, 80]
    const scene = new THREE.Scene()
    const boxGeom = new THREE.BoxGeometry(120, 100, 80)
    boxGeom.translate(60, 50, 40) // 几何体从原点向正向拉伸

    const blockMesh = new THREE.Mesh(boxGeom, new THREE.MeshBasicMaterial())
    blockMesh.name = 'ValveBlockSolid'
    blockMesh.userData = { selectionMesh: true }
    scene.add(blockMesh)

    // 添加模拟编辑手柄与坐标轴
    const gizmoGroup = new THREE.Group()
    gizmoGroup.name = '__editing_gizmos__'
    gizmoGroup.userData = { isEditingGizmo: true }
    gizmoGroup.visible = true
    scene.add(gizmoGroup)

    const originAxes = new THREE.Group()
    originAxes.name = 'OriginAxes'
    originAxes.visible = true
    scene.add(originAxes)

    // 模拟 document.createElement('canvas')
    const mockContext = {
      createImageData: vi.fn((w: number, h: number) => ({
        width: w,
        height: h,
        data: new Uint8ClampedArray(w * h * 4)
      })),
      putImageData: vi.fn((_image: { data: Uint8ClampedArray }, _x: number, _y: number) => {})
    }
    const mockCanvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => mockContext),
      toDataURL: vi.fn(() => 'data:image/png;base64,mockPngPreviewString')
    }
    vi.stubGlobal('document', { createElement: vi.fn(() => mockCanvas) })

    const dataUrl = captureIsometricPreview(mockGl, scene, [120, 100, 80], {
      width: 960,
      height: 640
    })

    // 验证返回值
    expect(dataUrl).toBe('data:image/png;base64,mockPngPreviewString')

    // 验证渲染是否被调用
    expect(mockGl.render).toHaveBeenCalledTimes(1)
    expect(renderedCamera).toBeInstanceOf(THREE.OrthographicCamera)

    const isoCam = renderedCamera as THREE.OrthographicCamera
    // 轴测相机的 up 向量应为 Z 轴
    expect(isoCam.up.x).toBe(0)
    expect(isoCam.up.y).toBe(0)
    expect(isoCam.up.z).toBe(1)

    // 关键验证：相机严格对准阀块真实几何中心 (60, 50, 40)，而不是世界原点 (0, 0, 0)
    const expectedCenter = new THREE.Vector3(60, 50, 40)
    const lookDir = new THREE.Vector3()
    isoCam.getWorldDirection(lookDir)
    const toCenter = expectedCenter.clone().sub(isoCam.position).normalize()
    expect(lookDir.dot(toCenter)).toBeGreaterThan(0.99)

    // 关键验证：真实几何中心投影在相机中必须精确居中于 (0, 0)
    const projectedCenter = expectedCenter.clone().project(isoCam)
    expect(Math.abs(projectedCenter.x)).toBeLessThan(1e-6)
    expect(Math.abs(projectedCenter.y)).toBeLessThan(1e-6)
    for (const x of [0, 120]) for (const y of [0, 100]) for (const z of [0, 80]) {
      const corner = new THREE.Vector3(x, y, z).project(isoCam)
      expect(Math.abs(corner.x)).toBeLessThan(1)
      expect(Math.abs(corner.y)).toBeLessThan(1)
      expect(Math.abs(corner.z)).toBeLessThan(1)
    }
    const imageData = mockContext.putImageData.mock.calls[0][0] as { data: Uint8ClampedArray }
    expect(Array.from(imageData.data.slice(639 * 960 * 4, 639 * 960 * 4 + 4))).toEqual([11, 22, 33, 255])
    expect(activeViewport.toArray()).toEqual([0, 0, 800 * dpr, 600 * dpr])

    // 验证编辑手柄与坐标轴在离屏渲染结束后恢复可见性
    expect(gizmoGroup.visible).toBe(true)
    expect(originAxes.visible).toBe(true)

    // 同样覆盖保存时的降级导出路径。
    expect(renderModelPreview(mockGl, boxGeom)).toBe(dataUrl)
    expect(activeViewport.toArray()).toEqual([0, 0, 800 * dpr, 600 * dpr])
    boxGeom.dispose()
    ;(blockMesh.material as THREE.Material).dispose()
  })
})
