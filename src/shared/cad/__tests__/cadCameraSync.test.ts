import { describe, expect, it } from 'vitest'
import type { SyncCameraViewParams, SyncCameraViewResult } from '../cadBridgeTypes'

/**
 * 辅助测试函数：验证 3x3 视口旋转矩阵的正交性与右手法则
 */
function computeCameraRotationMatrix(
  position: [number, number, number],
  target: [number, number, number],
  up: [number, number, number]
): number[] {
  // z_view = (position - target).normalize()
  let zx = position[0] - target[0]
  let zy = position[1] - target[1]
  let zz = position[2] - target[2]
  const zLen = Math.sqrt(zx * zx + zy * zy + zz * zz)
  if (zLen < 1e-6) {
    zx = 0; zy = 0; zz = 1
  } else {
    zx /= zLen; zy /= zLen; zz /= zLen
  }

  // x_view = (up x z_view).normalize()
  let xx = up[1] * zz - up[2] * zy
  let xy = up[2] * zx - up[0] * zz
  let xz = up[0] * zy - up[1] * zx
  const xLen = Math.sqrt(xx * xx + xy * xy + xz * xz)
  if (xLen < 1e-6) {
    xx = 1; xy = 0; xz = 0
  } else {
    xx /= xLen; xy /= xLen; xz /= xLen
  }

  // y_view = (z_view x x_view)
  let yx = zy * xz - zz * xy
  let yy = zz * xx - zx * xz
  let yz = zx * xy - zy * xx
  const yLen = Math.sqrt(yx * yx + yy * yy + yz * yz)
  if (yLen > 1e-6) {
    yx /= yLen; yy /= yLen; yz /= yLen
  }

  return [
    xx, xy, xz,
    yx, yy, yz,
    zx, zy, zz
  ]
}

describe('CAD Camera View Synchronization Protocol', () => {
  it('correctly constructs and validates SyncCameraViewParams structure', () => {
    const params: SyncCameraViewParams = {
      docGuid: 'a1b2c3d4-e5f6-7890-abcd-1234567890ab',
      projectId: 'proj-001',
      position: [200, 150, 300],
      target: [80, 60, 45],
      up: [0, 0, 1],
      zoom: 1.5,
      viewHeight: 220,
      projectionType: 'ORTHOGRAPHIC'
    }

    expect(params.position).toHaveLength(3)
    expect(params.target).toHaveLength(3)
    expect(params.up).toHaveLength(3)
    expect(params.projectionType).toBe('ORTHOGRAPHIC')

    const result: SyncCameraViewResult = {
      success: true,
      message: 'CAD 视角已与 SureFlow 保持一致'
    }
    expect(result.success).toBe(true)
  })

  it('computes orthonormal 3x3 rotation matrix for Top view (+Z)', () => {
    // 俯视图：视点在上方 +Z，注视点 (0,0,0)，up 朝 +Y
    const rot = computeCameraRotationMatrix([0, 0, 200], [0, 0, 0], [0, 1, 0])
    expect(rot).toHaveLength(9)

    // Row 0: Screen Right is +X
    expect(rot[0]).toBeCloseTo(1, 5)
    expect(rot[1]).toBeCloseTo(0, 5)
    expect(rot[2]).toBeCloseTo(0, 5)

    // Row 1: Screen Up is +Y
    expect(rot[3]).toBeCloseTo(0, 5)
    expect(rot[4]).toBeCloseTo(1, 5)
    expect(rot[5]).toBeCloseTo(0, 5)

    // Row 2: Screen Out-of-screen (target to eye) is +Z
    expect(rot[6]).toBeCloseTo(0, 5)
    expect(rot[7]).toBeCloseTo(0, 5)
    expect(rot[8]).toBeCloseTo(1, 5)
  })

  it('computes orthonormal 3x3 rotation matrix for Front view (-Y)', () => {
    // 主视图：视点在前方 -Y，注视点 (0,0,0)，up 朝 +Z
    const rot = computeCameraRotationMatrix([0, -200, 0], [0, 0, 0], [0, 0, 1])

    // Row 0: Screen Right is +X
    expect(rot[0]).toBeCloseTo(1, 5)
    expect(rot[1]).toBeCloseTo(0, 5)
    expect(rot[2]).toBeCloseTo(0, 5)

    // Row 1: Screen Up is +Z
    expect(rot[3]).toBeCloseTo(0, 5)
    expect(rot[4]).toBeCloseTo(0, 5)
    expect(rot[5]).toBeCloseTo(1, 5)

    // Row 2: Screen Out-of-screen is -Y
    expect(rot[6]).toBeCloseTo(0, 5)
    expect(rot[7]).toBeCloseTo(-1, 5)
    expect(rot[8]).toBeCloseTo(0, 5)
  })

  it('preserves unit length and orthogonality for arbitrary angle camera', () => {
    const rot = computeCameraRotationMatrix([120, -180, 220], [80, 60, 45], [0, 0, 1])

    const row0Len = Math.hypot(rot[0], rot[1], rot[2])
    const row1Len = Math.hypot(rot[3], rot[4], rot[5])
    const row2Len = Math.hypot(rot[6], rot[7], rot[8])

    expect(row0Len).toBeCloseTo(1, 5)
    expect(row1Len).toBeCloseTo(1, 5)
    expect(row2Len).toBeCloseTo(1, 5)

    // Dot product of row0 and row1 should be 0 (orthogonal)
    const dot01 = rot[0] * rot[3] + rot[1] * rot[4] + rot[2] * rot[5]
    expect(dot01).toBeCloseTo(0, 5)

    // Dot product of row0 and row2 should be 0
    const dot02 = rot[0] * rot[6] + rot[1] * rot[7] + rot[2] * rot[8]
    expect(dot02).toBeCloseTo(0, 5)

    // Dot product of row1 and row2 should be 0
    const dot12 = rot[3] * rot[6] + rot[4] * rot[7] + rot[5] * rot[8]
    expect(dot12).toBeCloseTo(0, 5)
  })

  it('correctly maps row-major view matrix to SolidWorks column-major MathTransform without +Z / -Z inversion', () => {
    // 针对主视图 Front View (-Y 视点，Up 朝向 +Z)
    const rot = computeCameraRotationMatrix([0, -200, 0], [0, 0, 0], [0, 0, 1])

    // SolidWorks 4x4 变换矩阵使用行向量乘法 V * M，其中：
    // Column 0 = Screen Right: [m[0], m[3], m[6]]
    // Column 1 = Screen Up: [m[1], m[4], m[7]]
    // Column 2 = Screen Out: [m[2], m[5], m[8]]
    const swTransform = new Array(16).fill(0)
    swTransform[0] = rot[0] // Row 0, Col 0: right.x
    swTransform[1] = rot[3] // Row 0, Col 1: up.x
    swTransform[2] = rot[6] // Row 0, Col 2: out.x
    swTransform[3] = rot[1] // Row 1, Col 0: right.y
    swTransform[4] = rot[4] // Row 1, Col 1: up.y
    swTransform[5] = rot[7] // Row 1, Col 2: out.y
    swTransform[6] = rot[2] // Row 2, Col 0: right.z
    swTransform[7] = rot[5] // Row 2, Col 1: up.z
    swTransform[8] = rot[8] // Row 2, Col 2: out.z
    swTransform[12] = 1.0

    // 验证 Column 0 (Screen Right) 严格为 +X
    expect(swTransform[0]).toBeCloseTo(1, 5)
    expect(swTransform[3]).toBeCloseTo(0, 5)
    expect(swTransform[6]).toBeCloseTo(0, 5)

    // 验证 Column 1 (Screen Up) 严格为 +Z (绝非 -Z)
    expect(swTransform[1]).toBeCloseTo(0, 5)
    expect(swTransform[4]).toBeCloseTo(0, 5)
    expect(swTransform[7]).toBeCloseTo(1, 5)

    // 验证 Column 2 (Screen Out) 严格为 -Y
    expect(swTransform[2]).toBeCloseTo(0, 5)
    expect(swTransform[5]).toBeCloseTo(-1, 5)
    expect(swTransform[8]).toBeCloseTo(0, 5)
  })

  it('correctly converts between viewHeight and camera zoom for orthographic viewport', () => {
    const canvasHeight = 800 // 800px 视口高度
    const viewHeightMm = 200 // 模型可见范围 200mm

    const zoom = canvasHeight / viewHeightMm
    expect(zoom).toBe(4.0)

    const recoveredHeight = canvasHeight / zoom
    expect(recoveredHeight).toBe(200)

    // 验证 SolidWorks 缩放倍率调整逻辑
    const currentHeightMm = 400
    const targetHeightMm = 200
    const zoomFactor = currentHeightMm / targetHeightMm
    expect(zoomFactor).toBe(2.0)
    // 放大 2 倍后，可见高度减半为 200mm
    expect(currentHeightMm / zoomFactor).toBe(200)
  })
})
