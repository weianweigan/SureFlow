import type { CavityType } from '@shared/cavity/types'

/** 库节点 → public 图标资产的映射（public 下同名 32px 矢量图） */
export const TYPE_ICONS: Record<CavityType, string> = {
  'drill-hole': 'DrillHole.svg',
  'bolt-hole': 'BoltHole.svg',
  'port-cavity': 'Port.svg',
  'locating-pin-hole': 'LocatingPinHole.svg',
  'cartridge-valve': 'CartridgeValve.svg',
  'two-way-cartridge-valve': 'TwoWayCartridgeValve.svg',
  flange: 'Flange.svg',
  'pattern-valve': 'PatternValve.svg',
  'foot-print': 'FootPrint.svg'
}

export const CATEGORY_ICON = 'Category.svg'

/** public 资源绝对路径（BASE_URL 兼容 dev/build，并自动剥离前导斜杠防误用） */
export function assetUrl(file: string): string {
  const clean = file.startsWith('/') ? file.slice(1) : file
  return `${import.meta.env.BASE_URL}${clean}`
}
