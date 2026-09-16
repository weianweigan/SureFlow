/**
 * 安装轮廓（Outline）相关类型定义
 */

export type OutlineShapeType = 'none' | 'rect' | 'circle' | 'flange' | 'custom'

/** 矩形驱动参数 */
export interface RectParams extends Record<string, unknown> {
  width: number
  height: number
  cornerRadius: number
  offsetX: number
  offsetY: number
}

/** 圆形驱动参数 */
export interface CircleParams extends Record<string, unknown> {
  diameter: number
  offsetX: number
  offsetY: number
}

/** SAE 法兰驱动参数 */
export interface SaeFlangeParams extends Record<string, unknown> {
  /** 预设标准键名（如 'code61_1'，自定义为 'custom'） */
  standardKey: string
  /** 长向螺栓孔间距 mm (Dimension A) */
  a: number
  /** 短向螺栓孔间距 mm (Dimension B) */
  b: number
  /** 螺栓凸耳圆角半径 mm (Ear Radius R) */
  earRadius: number
  /** 腰部凹陷处宽度 mm (Waist Width) */
  waistWidth: number
  /** 螺栓孔参考直径 mm (供 CAD 预览绘制孔位) */
  boltDia: number
  /** 旋转角（0°：长轴垂直；90°：长轴水平） */
  rotation: 0 | 90
  /** 原点 X 偏移 */
  offsetX: number
  /** 原点 Y 偏移 */
  offsetY: number
}

/** 自定义图形参数 */
export interface CustomParams extends Record<string, unknown> {
  pathData: string
}

/** 轮廓解析与状态推断结果 */
export interface InferredOutlineState {
  type: OutlineShapeType
  rect?: RectParams
  circle?: CircleParams
  flange?: SaeFlangeParams
  custom?: CustomParams
}
