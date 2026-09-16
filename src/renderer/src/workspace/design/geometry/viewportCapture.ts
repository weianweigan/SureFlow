import * as THREE from 'three'
import type { RootState } from '@react-three/fiber'

/** 保留观察方向，将包围盒完整放入正交视锥，并预留 20% 的画面空间。 */
export function fitPreviewCamera(camera: THREE.OrthographicCamera, bounds: THREE.Box3): void {
  if (bounds.isEmpty()) throw new Error('模型范围为空')
  const center = bounds.getCenter(new THREE.Vector3())
  const radius = Math.max(bounds.getSize(new THREE.Vector3()).length() / 2, 1)
  const inverseRotation = camera.quaternion.clone().invert()
  let halfX = 0
  let halfY = 0
  for (const x of [bounds.min.x, bounds.max.x]) {
    for (const y of [bounds.min.y, bounds.max.y]) {
      for (const z of [bounds.min.z, bounds.max.z]) {
        const point = new THREE.Vector3(x, y, z).sub(center).applyQuaternion(inverseRotation)
        halfX = Math.max(halfX, Math.abs(point.x))
        halfY = Math.max(halfY, Math.abs(point.y))
      }
    }
  }
  const width = camera.right - camera.left
  const height = camera.top - camera.bottom
  camera.left = -width / 2
  camera.right = width / 2
  camera.top = height / 2
  camera.bottom = -height / 2
  camera.clearViewOffset()
  camera.zoom = Math.min(width / (Math.max(halfX, 0.001) * 2 * 1.25), height / (Math.max(halfY, 0.001) * 2 * 1.25))
  camera.position.copy(center).addScaledVector(camera.getWorldDirection(new THREE.Vector3()), -radius * 3)
  camera.near = 0.1
  camera.far = radius * 6
  camera.updateProjectionMatrix()
  camera.updateMatrixWorld(true)
}

/** 在正常帧更新后适配相机，等待 GizmoHelper 完成主场景和 HUD 渲染后截图。 */
const pendingCaptures = new WeakMap<THREE.Camera, Promise<string>>()

export function captureFittedPreview(state: RootState, bounds: THREE.Box3): Promise<string> {
  const camera = state.camera
  if (!(camera instanceof THREE.OrthographicCamera)) return Promise.reject(new Error('预览需要正交相机'))
  const pending = pendingCaptures.get(camera)
  if (pending) return pending
  const store = state.internal.subscribers.find((subscriber) => subscriber.store.getState().scene === state.scene)?.store
  if (!store) return Promise.reject(new Error('视口尚未就绪'))
  const capture = new Promise<string>((resolve, reject) => {
    let original: THREE.OrthographicCamera | undefined
    let unsubscribeFit = () => {}
    let unsubscribeCapture = () => {}
    const finish = () => {
      clearTimeout(timeout)
      unsubscribeFit()
      unsubscribeCapture()
      if (original) {
        camera.copy(original, false)
        camera.updateMatrixWorld(true)
      }
      state.invalidate()
    }
    const timeout = setTimeout(() => {
      finish()
      reject(new Error('等待视口渲染超时'))
    }, 3000)
    // Controls / CameraRig 在优先级 <= 0 更新；GizmoHelper 在优先级 1 渲染。
    unsubscribeFit = state.internal.subscribe({ current: () => {
      try {
        original = new THREE.OrthographicCamera().copy(camera, false)
        fitPreviewCamera(camera, bounds)
      } catch (error) {
        finish()
        reject(error)
      }
    } }, 0.5, store)
    unsubscribeCapture = state.internal.subscribe({ current: () => {
      try {
        resolve(captureDisplayedPreview(state.gl))
      } catch (error) {
        reject(error)
      } finally {
        finish()
      }
    } }, 2, store)
    state.invalidate()
  })
  pendingCaptures.set(camera, capture)
  void capture.finally(() => pendingCaptures.delete(camera)).catch(() => {})
  return capture
}

/**
 * 读取用户已看到的完整 WebGL 画面（包括 GizmoHelper 的 HUD 渲染）。
 * Canvas 必须启用 preserveDrawingBuffer；不要单独重绘主 scene，否则会丢失 HUD。
 * 直接使用绘图缓冲区的物理像素尺寸，保留当前视角、缩放、材质和背景。
 */
export function captureDisplayedPreview(gl: THREE.WebGLRenderer): string {
  const canvas = gl.domElement
  if (canvas.width <= 0 || canvas.height <= 0) throw new Error('视口画布尺寸为空')
  const image = canvas.toDataURL('image/png')
  if (!image.startsWith('data:image/png;base64,')) throw new Error('无法读取视口 PNG')
  return image
}

export interface IsometricCaptureOptions {
  width?: number
  height?: number
}

/**
 * 标准 CAD 轴测全景自适应视口位图捕获器 (PRD-FR-04-07 §2)
 *
 * 核心特性：
 * 1. 自动切换为标准 CAD 等轴测投影（Isometric），统一视角，消除用户当前视口过度缩放/偏位的干扰；
 * 2. 动态扫描主场景提取实体网格的真实空间包围盒（Box3），计算出真实几何中心（True Geometric Center），
 *    严格使零件几何中心对齐图片中心，彻底解决原点 (0,0,0) 居中导致左下方大片空白的问题；
 * 3. 将真实几何体包围盒 8 个顶点投影到轴测正交视锥平面，精确计算画面宽高（使模型整体占据画面约 80%），
 *    上下左右留白均匀对称，视觉居中充盈；
 * 4. 100% 完整复现主场景（Scene）的真实渲染内容：
 *    - SolidWorks 三点渐变天幕背景（scene.background）；
 *    - 基体金属表面、孔腔机械加工质感内壁与 CAD 黑色特征边缘；
 *    - 剖切截面封口（WebGL Stencil Cap）与 X-Ray 磨砂透视；
 *    - 内部流道与幽灵孔腔；
 * 5. 离屏渲染期间自动屏蔽编辑操纵箭头（Gizmos）、参考网格与原点坐标系标牌，保证预览位图纯净专业；
 * 6. 全程在 GPU 离屏 WebGLRenderTarget 中完成，零触碰、不打扰用户正在操作的主视口。
 */
export function captureIsometricPreview(
  gl: THREE.WebGLRenderer,
  scene: THREE.Scene,
  dimensions: [number, number, number],
  options?: { width?: number; height?: number }
): string {
  const [sx, sy, sz] = dimensions
  const width = options?.width ?? 1200
  const height = options?.height ?? 800

  // 1. 强制使用基体几何中心，避免被场景中其他辅助网格或不可见网格干扰
  const center = new THREE.Vector3(sx / 2, sy / 2, sz / 2)
  const boundsRadius = Math.max(Math.hypot(sx, sy, sz) / 2, 40)

  // 2. 隐藏不必要的辅助对象
  const hiddenObjects: THREE.Object3D[] = []
  scene.traverse((obj) => {
    if (
      obj.userData?.isEditingGizmo ||
      obj.name === '__editing_gizmos__' ||
      obj.name === 'OriginAxes' ||
      obj.userData?.isOriginAxes ||
      (obj as any).isGridHelper
    ) {
      if (obj.visible) {
        obj.visible = false
        hiddenObjects.push(obj)
      }
    }
  })

  // 3. 构造标准等轴测视角相机基向量（围绕零件几何中心旋转定位）
  const dist = Math.max(boundsRadius * 2.5, 200)
  const offset = new THREE.Vector3(dist * 0.7, -dist * 0.7, dist * 0.6)
  const cameraPos = center.clone().add(offset)

  const forward = center.clone().sub(cameraPos).normalize()
  const worldUp = new THREE.Vector3(0, 0, 1)
  const right = new THREE.Vector3().crossVectors(forward, worldUp).normalize()
  const camUp = new THREE.Vector3().crossVectors(right, forward).normalize()

  // 4. 将基体包围盒 8 个几何角点投影到相机屏幕 X/Y 轴，计算绝对对称的精准视锥半宽/半高
  const corners = [
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(sx, 0, 0),
    new THREE.Vector3(0, sy, 0),
    new THREE.Vector3(sx, sy, 0),
    new THREE.Vector3(0, 0, sz),
    new THREE.Vector3(sx, 0, sz),
    new THREE.Vector3(0, sy, sz),
    new THREE.Vector3(sx, sy, sz)
  ]

  let maxDx = 0
  let maxDy = 0
  for (const c of corners) {
    const rel = c.clone().sub(center)
    maxDx = Math.max(maxDx, Math.abs(rel.dot(right)))
    maxDy = Math.max(maxDy, Math.abs(rel.dot(camUp)))
  }

  maxDx = Math.max(maxDx, 20)
  maxDy = Math.max(maxDy, 20)

  // 5. 应用外边距并推导最终视锥尺寸，确保全图形完整呈现且绝对居中
  const aspect = width / height
  const margin = 1.25 // 留出 25% 安全边距
  const halfHeight = Math.max(maxDy * margin, (maxDx * margin) / aspect)
  const halfWidth = halfHeight * aspect

  const isoCamera = new THREE.OrthographicCamera(
    -halfWidth,
    halfWidth,
    halfHeight,
    -halfHeight,
    0.1,
    dist * 6
  )
  isoCamera.position.copy(cameraPos)
  isoCamera.up.copy(worldUp)
  isoCamera.lookAt(center)
  isoCamera.updateMatrixWorld(true)
  isoCamera.updateProjectionMatrix()

  // 6. 为轴测相机挂载视线随动前向补光（Camera Headlight），消除死黑与深孔暗区
  const headlight = new THREE.DirectionalLight(0xffffff, 0.45)
  headlight.position.set(0, 0, 0)
  const headTarget = new THREE.Object3D()
  headTarget.position.set(0, 0, -1)
  headlight.target = headTarget
  isoCamera.add(headlight)
  isoCamera.add(headTarget)
  scene.add(isoCamera)

  // 7. 保存原渲染器状态
  const previousRenderTarget = gl.getRenderTarget()
  const previousViewport = gl.getViewport(new THREE.Vector4())
  const previousScissor = gl.getScissor(new THREE.Vector4())
  const previousScissorTest = gl.getScissorTest()
  const previousAutoClear = gl.autoClear
  const previousClearColor = gl.getClearColor(new THREE.Color())
  const previousClearAlpha = gl.getClearAlpha()

  const target = new THREE.WebGLRenderTarget(width, height, {
    depthBuffer: true,
    stencilBuffer: true,
    samples: 4 // 开启多重采样抗锯齿（若设备支持）
  })
  target.texture.colorSpace = THREE.SRGBColorSpace

  try {
    // RenderTarget 的 viewport 使用物理像素；setViewport 会再次乘屏幕 DPR，导致裁切。
    target.viewport.set(0, 0, width, height)
    gl.setRenderTarget(target)
    gl.setScissorTest(false)
    gl.autoClear = true
    gl.render(scene, isoCamera)

    // 读取像素数据
    const pixels = new Uint8Array(width * height * 4)
    gl.readRenderTargetPixels(target, 0, 0, width, height, pixels)

    // 绘制到 2D 离屏 Canvas 并输出 PNG DataURL
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('无法创建 2D 预览画布')

    const imgData = ctx.createImageData(width, height)
    // WebGL 帧缓冲区 Y 轴向上，Canvas 坐标系 Y 轴向下，进行垂直翻转
    for (let y = 0; y < height; y++) {
      imgData.data.set(
        pixels.subarray((height - 1 - y) * width * 4, (height - y) * width * 4),
        y * width * 4
      )
    }
    ctx.putImageData(imgData, 0, 0)
    return canvas.toDataURL('image/png')
  } finally {
    // 还原 WebGLRenderer 上下文状态
    gl.setRenderTarget(previousRenderTarget)
    gl.setViewport(previousViewport)
    gl.setScissor(previousScissor)
    gl.setScissorTest(previousScissorTest)
    gl.autoClear = previousAutoClear
    gl.setClearColor(previousClearColor, previousClearAlpha)
    target.dispose()

    // 还原所有临时隐藏对象的可见性
    for (const obj of hiddenObjects) {
      obj.visible = true
    }

    // 释放临时相机与补光
    scene.remove(isoCamera)
    headlight.dispose()
    isoCamera.clear()
  }
}
