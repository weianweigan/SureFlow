/**
 * 画布配色：从文档 CSS 变量一次性解析为具体颜色（R1：配色与 SVG 时代一致）。
 *
 * 原 SVG 用 Tailwind 类（fill-accent/60、stroke-foreground 等）依赖 :root 定义、
 * 由浏览器按当前主题解析；Konva 需要具体颜色字符串。这里惰性读取一次并缓存，
 * 再将所有颜色规一到 #rrggbb，另提供 alpha()：由于本预览把图形绘制在白色
 * paper（--background：#fff）之上，半透明按“叠加到 paper”预先合成为不透明
 * rgb 字符串，即与原始 fills 在纸面上的观感一致。
 */

export interface CanvasPalette {
  /** 主墨色（前景 / primary / 选中主段） */
  ink: string
  /** 纸面底色（画布/视图背景，#fff） */
  paper: string
  /** 次级文字灰 */
  muted: string
  /** 错误/破坏性红 */
  bad: string
  /** 浅强调底色（accent / hairline-soft） */
  accent: string
  /** hairline 边框 */
  hair: string
  /** 粉彩薄荷块（选中朦胧高亮） */
  mint: string
}

/** rgb hex → [r,g,b] */
function parseRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  const full = h.length === 3 ? h.replace(/(.)/g, '$1$1') : h
  const n = parseInt(full, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function toRgb(hex: string): string {
  const [r, g, b] = parseRgb(hex)
  return `rgb(${r} ${g} ${b})`
}

/** 规一 CSS 颜色值 → '#rrggbb'（hex 直接收下；其他交给 canvas 2d 规一） */
function normalize(color: string): string {
  const c = color.trim()
  if (c.startsWith('#')) {
    return c.length === 4 ? `#${c[1]}${c[1]}${c[2]}${c[2]}${c[3]}${c[3]}` : c
  }
  try {
    const ctx = document.createElement('canvas').getContext('2d')
    if (ctx) {
      ctx.fillStyle = c
      const hex = ctx.fillStyle as string
      if (hex.startsWith('#')) return hex
    }
  } catch {
    /* ignore */
  }
  return '#000000'
}

function rootVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

let _palette: CanvasPalette | null = null

/** 惰性解析并缓存（须在 DOM/样式就绪后首次调用） */
export function palette(): CanvasPalette {
  if (_palette) return _palette
  _palette = {
    ink: normalize(rootVar('--foreground') || rootVar('--primary') || '#000000'),
    paper: normalize(rootVar('--background') || '#ffffff'),
    muted: normalize(rootVar('--muted-foreground') || 'hsl(0 0% 40%)'),
    bad: normalize(rootVar('--destructive') || '#dc2626'),
    accent: normalize(rootVar('--accent') || '#f1f1f1'),
    hair: normalize(rootVar('--border') || rootVar('--hairline') || '#D1D1D1'),
    mint: normalize(rootVar('--sf-block-mint') || '#c8e6cd')
  }
  return _palette
}

/**
 * 半透明效果：将 color 以 a ∈ [0,1] 的不透明度叠加到画布纸面（paper），
 * 预合成并返回不透明 'rgb(r g b)' 字符串（Konva rgb 空间串可直接作 fill/stroke）。
 */
export function withAlpha(color: string, a: number): string {
  if (a >= 1) return toRgb(color)
  const [pr, pg, pb] = parseRgb(palette().paper)
  const [r, g, b] = parseRgb(color)
  const mix = (f: number, t: number): number => Math.round(f + (t - f) * a)
  return `rgb(${mix(pr, r)} ${mix(pg, g)} ${mix(pb, b)})`
}

/** 直接把一个既有 hex 规一成完整 'rgb(r g b)'（供裸调用） */
export function rgb(hex: string): string {
  return toRgb(hex)
}

/** 别名：半透明叠加（= withAlpha），以纸面为底 */
export const alpha = withAlpha
