import * as THREE from 'three'
import { SVGLoader } from 'three/examples/jsm/loaders/SVGLoader.js'
import type { Outline } from '@shared/cavity/types'

export interface OutlineGeometries {
  lineGeometry: THREE.BufferGeometry
  fillGeometry?: THREE.BufferGeometry
}

/**
 * 将孔腔安装轮廓（Outline）生成 Three.js 几何体（边框线与半透明面）
 * 坐标系：安装面局部 (U, V) 笛卡尔坐标，原点位于轮廓几何中心
 */
export function buildOutlineGeometry(
  outline?: Outline | null,
  unit: 'mm' | 'in' = 'mm'
): OutlineGeometries | null {
  if (!outline) return null

  const scale = unit === 'in' ? 25.4 : 1.0

  // 1. 优先使用 SVG path 数据
  if (outline.data && outline.data.trim().length > 0) {
    try {
      const loader = new SVGLoader()
      const svgStr = `<svg xmlns="http://www.w3.org/2000/svg"><path d="${outline.data}" /></svg>`
      const result = loader.parse(svgStr)
      if (result && result.paths && result.paths.length > 0) {
        const shapes: THREE.Shape[] = []
        for (const p of result.paths) {
          const sList = typeof (p as any).toShapes === 'function' ? (p as any).toShapes(true) : SVGLoader.createShapes(p)
          shapes.push(...sList)
        }

        if (shapes.length > 0) {
          const fillGeom = new THREE.ShapeGeometry(shapes)
          if (scale !== 1.0) {
            fillGeom.scale(scale, scale, 1)
          }

          // 居中轮廓几何，确保对称中心对齐到组合孔基准原点 (0, 0)
          fillGeom.center()

          // 尺度防护：若外部 SVG path 未设置单位导致尺寸极大（如 500~1000px 屏幕画布），缩放至合理工业阀件尺度 (≤ 160mm)
          fillGeom.computeBoundingBox()
          const bbox = fillGeom.boundingBox
          if (bbox) {
            const sizeX = bbox.max.x - bbox.min.x
            const sizeY = bbox.max.y - bbox.min.y
            const maxDim = Math.max(sizeX, sizeY)
            if (maxDim > 200) {
              const sFactor = 120 / maxDim
              fillGeom.scale(sFactor, sFactor, 1)
              fillGeom.computeBoundingBox()
            }
          }

          const edgesGeom = new THREE.EdgesGeometry(fillGeom, 15)
          return {
            lineGeometry: edgesGeom,
            fillGeometry: fillGeom
          }
        }
      }
    } catch (e) {
      console.warn('[OutlineBuilder] SVGLoader parse error:', e)
    }
  }

  // 2. 备选：根据 params 解析标准矩形 / 圆形
  const params = outline.params || {}
  const shape = new THREE.Shape()

  if (params.width != null && params.height != null) {
    const w = (Number(params.width) || 40) * scale
    const h = (Number(params.height) || 40) * scale
    const ox = (Number(params.offsetX) || 0) * scale
    const oy = (Number(params.offsetY) || 0) * scale
    const r = Math.min((Number(params.cornerRadius) || 0) * scale, w / 2, h / 2)

    if (r > 0.1) {
      // 带圆角的矩形
      const x0 = ox - w / 2
      const y0 = oy - h / 2
      shape.moveTo(x0 + r, y0)
      shape.lineTo(x0 + w - r, y0)
      shape.quadraticCurveTo(x0 + w, y0, x0 + w, y0 + r)
      shape.lineTo(x0 + w, y0 + h - r)
      shape.quadraticCurveTo(x0 + w, y0 + h, x0 + w - r, y0 + h)
      shape.lineTo(x0 + r, y0 + h)
      shape.quadraticCurveTo(x0, y0 + h, x0, y0 + h - r)
      shape.lineTo(x0, y0 + r)
      shape.quadraticCurveTo(x0, y0, x0 + r, y0)
    } else {
      // 直角矩形
      shape.moveTo(ox - w / 2, oy - h / 2)
      shape.lineTo(ox + w / 2, oy - h / 2)
      shape.lineTo(ox + w / 2, oy + h / 2)
      shape.lineTo(ox - w / 2, oy + h / 2)
      shape.closePath()
    }

    const fillGeom = new THREE.ShapeGeometry(shape)
    const edgesGeom = new THREE.EdgesGeometry(fillGeom, 15)
    return { lineGeometry: edgesGeom, fillGeometry: fillGeom }
  }

  if (params.diameter != null) {
    const d = (Number(params.diameter) || 30) * scale
    shape.absarc(0, 0, d / 2, 0, Math.PI * 2, false)
    const fillGeom = new THREE.ShapeGeometry(shape, 32)
    const edgesGeom = new THREE.EdgesGeometry(fillGeom, 15)
    return { lineGeometry: edgesGeom, fillGeometry: fillGeom }
  }

  return null
}
