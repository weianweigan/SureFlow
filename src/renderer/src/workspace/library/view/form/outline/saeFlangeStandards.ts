/**
 * SAE J518 / ISO 6162 四螺栓法兰标准尺寸表
 *
 * 涵盖：
 *  - Code 61：标准压力（3000 PSI / ISO 6162-1）
 *  - Code 62：高压（6000 PSI / ISO 6162-2）
 */

import type { SaeFlangeParams } from './outlineTypes'

export interface SaeStandardDef {
  key: string
  code: 'Code 61' | 'Code 62'
  size: string
  label: string
  pressure: string
  a: number
  b: number
  earRadius: number
  waistWidth: number
  boltDia: number
  /** 通径 / 主油口直径 (mm) */
  portDia: number
}

export const SAE_FLANGE_STANDARDS: SaeStandardDef[] = [
  // --- Code 61 (3000 PSI / ISO 6162-1) ---
  {
    key: 'code61_0.5',
    code: 'Code 61',
    size: '1/2"',
    label: 'SAE Code 61 - 1/2" (DN13)',
    pressure: '3000 PSI',
    a: 38.1,
    b: 17.5,
    earRadius: 7.95,
    waistWidth: 45.6,
    boltDia: 8.5,
    portDia: 13
  },
  {
    key: 'code61_0.75',
    code: 'Code 61',
    size: '3/4"',
    label: 'SAE Code 61 - 3/4" (DN19)',
    pressure: '3000 PSI',
    a: 47.6,
    b: 22.2,
    earRadius: 8.7,
    waistWidth: 51.8,
    boltDia: 10.5,
    portDia: 19
  },
  {
    key: 'code61_1.0',
    code: 'Code 61',
    size: '1"',
    label: 'SAE Code 61 - 1" (DN25)',
    pressure: '3000 PSI',
    a: 52.4,
    b: 26.2,
    earRadius: 8.8,
    waistWidth: 58.4,
    boltDia: 10.5,
    portDia: 25
  },
  {
    key: 'code61_1.25',
    code: 'Code 61',
    size: '1-1/4"',
    label: 'SAE Code 61 - 1-1/4" (DN32)',
    pressure: '3000 PSI',
    a: 58.7,
    b: 30.2,
    earRadius: 10.15,
    waistWidth: 72.6,
    boltDia: 11.5,
    portDia: 32
  },
  {
    key: 'code61_1.5',
    code: 'Code 61',
    size: '1-1/2"',
    label: 'SAE Code 61 - 1-1/2" (DN38)',
    pressure: '3000 PSI',
    a: 69.9,
    b: 35.7,
    earRadius: 12.05,
    waistWidth: 82.2,
    boltDia: 13.5,
    portDia: 38
  },
  {
    key: 'code61_2.0',
    code: 'Code 61',
    size: '2"',
    label: 'SAE Code 61 - 2" (DN51)',
    pressure: '3000 PSI',
    a: 77.8,
    b: 42.9,
    earRadius: 12.1,
    waistWidth: 96.4,
    boltDia: 13.5,
    portDia: 51
  },
  {
    key: 'code61_2.5',
    code: 'Code 61',
    size: '2-1/2"',
    label: 'SAE Code 61 - 2-1/2" (DN64)',
    pressure: '3000 PSI',
    a: 88.9,
    b: 50.8,
    earRadius: 12.55,
    waistWidth: 108.2,
    boltDia: 13.5,
    portDia: 64
  },
  {
    key: 'code61_3.0',
    code: 'Code 61',
    size: '3"',
    label: 'SAE Code 61 - 3" (DN76)',
    pressure: '3000 PSI',
    a: 106.4,
    b: 61.9,
    earRadius: 14.3,
    waistWidth: 130.6,
    boltDia: 16.75,
    portDia: 76
  },

  // --- Code 62 (6000 PSI / ISO 6162-2) ---
  {
    key: 'code62_0.5',
    code: 'Code 62',
    size: '1/2"',
    label: 'SAE Code 62 - 1/2" (DN13)',
    pressure: '6000 PSI',
    a: 40.5,
    b: 18.2,
    earRadius: 7.75,
    waistWidth: 47.2,
    boltDia: 8.5,
    portDia: 13
  },
  {
    key: 'code62_0.75',
    code: 'Code 62',
    size: '3/4"',
    label: 'SAE Code 62 - 3/4" (DN19)',
    pressure: '6000 PSI',
    a: 50.8,
    b: 23.8,
    earRadius: 10.1,
    waistWidth: 60.0,
    boltDia: 10.5,
    portDia: 19
  },
  {
    key: 'code62_1.0',
    code: 'Code 62',
    size: '1"',
    label: 'SAE Code 62 - 1" (DN25)',
    pressure: '6000 PSI',
    a: 57.2,
    b: 27.8,
    earRadius: 11.9,
    waistWidth: 69.6,
    boltDia: 13.5,
    portDia: 25
  },
  {
    key: 'code62_1.25',
    code: 'Code 62',
    size: '1-1/4"',
    label: 'SAE Code 62 - 1-1/4" (DN32)',
    pressure: '6000 PSI',
    a: 66.7,
    b: 31.8,
    earRadius: 14.15,
    waistWidth: 77.2,
    boltDia: 14.5,
    portDia: 32
  },
  {
    key: 'code62_1.5',
    code: 'Code 62',
    size: '1-1/2"',
    label: 'SAE Code 62 - 1-1/2" (DN38)',
    pressure: '6000 PSI',
    a: 79.4,
    b: 36.5,
    earRadius: 16.8,
    waistWidth: 95.0,
    boltDia: 16.75,
    portDia: 38
  },
  {
    key: 'code62_2.0',
    code: 'Code 62',
    size: '2"',
    label: 'SAE Code 62 - 2" (DN51)',
    pressure: '6000 PSI',
    a: 96.8,
    b: 44.5,
    earRadius: 18.1,
    waistWidth: 113.8,
    boltDia: 21.0,
    portDia: 51
  },
  {
    key: 'code62_2.5',
    code: 'Code 62',
    size: '2-1/2"',
    label: 'SAE Code 62 - 2-1/2" (DN64)',
    pressure: '6000 PSI',
    a: 123.8,
    b: 58.8,
    earRadius: 28.1,
    waistWidth: 150.2,
    boltDia: 26.0,
    portDia: 64
  },
  {
    key: 'code62_3.0',
    code: 'Code 62',
    size: '3"',
    label: 'SAE Code 62 - 3" (DN76)',
    pressure: '6000 PSI',
    a: 152.4,
    b: 71.6,
    earRadius: 31.3,
    waistWidth: 198.2,
    boltDia: 31.0,
    portDia: 76
  }
]

export const DEFAULT_SAE_FLANGE_STANDARD = SAE_FLANGE_STANDARDS[2] // Code 61 1"

export function getSaeStandard(key: string): SaeStandardDef | undefined {
  return SAE_FLANGE_STANDARDS.find((s) => s.key === key)
}

export function createDefaultSaeFlangeParams(standardKey = 'code61_1.0'): SaeFlangeParams {
  const std = getSaeStandard(standardKey) ?? DEFAULT_SAE_FLANGE_STANDARD
  return {
    standardKey: std.key,
    a: std.a,
    b: std.b,
    earRadius: std.earRadius,
    waistWidth: std.waistWidth,
    boltDia: std.boltDia,
    rotation: 0,
    offsetX: 0,
    offsetY: 0
  }
}
