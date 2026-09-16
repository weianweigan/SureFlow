/**
 * 2D 预览的视口与度量工具（react-konva）
 *
 * Konva Stage 是像素舞台。我们用一个 mm 世界 <Group scale={k}> 承载全部几何，
 * 但线条/文字/箭头等装饰需要“像素恒定”（R6）：在会被祖先 scale=k 放大的
 * 世界中，把每个装饰尺寸折算回 mm 单位（px/k）再交给 Konva，即可得到恒定屏幕尺寸。
 * 这些纯函数是全部 Konva 组件的度量依据。
 */

export interface Viewport {
  /** 世界 mm → 屏幕 px 的缩放 */
  k: number
  /** 世界原点投到屏幕的平移（px） */
  tx: number
  /** 世界原点投到屏幕的平移（px） */
  ty: number
}

/** mm 世界坐标点 */
export type Pt = { x: number; y: number }

/** 屏幕 px → 世界 mm（用于祖先 Group 放大为 k 之后的装饰尺寸换算） */
export const toMm = (px: number, k: number): number => px / k

/** 世界 mm → 屏幕 px（少用；主要给投影坐标/碰撞判定读） */
export const toPx = (mm: number, k: number): number => mm * k

/* ---------- 文本度量（与 Konva 画布一致的 canvas 2d） ---------- */

let _ctx: CanvasRenderingContext2D | null = null

function textContext(): CanvasRenderingContext2D | null {
  if (_ctx) return _ctx
  try {
    const c = document.createElement('canvas').getContext('2d')
    _ctx = c
    return c
  } catch {
    return null
  }
}

/**
 * 以给定像素字号测量单行文本宽度（px）。fontFamily 使用与正文一致的字体族。
 * 返回负数表示环境无 canvas（调用方此时应退化为固定字号）。
 */
export function measureTextPx(text: string, fontSizePx: number, fontFamily: string): number {
  const ctx = textContext()
  if (!ctx) return -1
  ctx.font = `${fontSizePx}px ${fontFamily}`
  return ctx.measureText(text).width
}

/* ---------- 展示尺子的默认装饰常量（屏幕 px，选中标注用） ---------- */

export const DECOR = {
  /** 常规轮廓/剖面线的恒定线宽（px） */
  lineW: 1,
  /** 弱化线（轴线/十字/引导线）线宽 */
  weakW: 0.75,
  /** 高亮（选中、标注主段）线宽 */
  strongW: 1.4,
  /** 标注文本像素字号 */
  dimFont: 11,
  /** 名称标签基准像素字号（按孔径进一步微调） */
  nameFont: 10,
  /** 标注箭头总长（px） */
  arrowLen: 9,
  /** 标注箭头开口宽 */
  arrowWid: 4.5,
  /** 标注线与被测图元的留白（px） */
  dimGap: 5
} as const
