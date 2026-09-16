import { useEffect, useMemo, useState, type FC } from 'react'
import * as THREE from 'three'
import { useThree } from '@react-three/fiber'

export type BackgroundPreset = 'pure-white' | 'solidworks' | 'neutral-gray' | 'dark-blueprint'

export const DEFAULT_BACKGROUND_PRESET: BackgroundPreset = 'pure-white'

export interface BackgroundPresetConfig {
  id: BackgroundPreset
  label: string
  description: string
  topColor: string
  midColor: string
  bottomColor: string
  isDark: boolean
  cssGradient: string
}

export const BACKGROUND_PRESETS: Record<BackgroundPreset, BackgroundPresetConfig> = {
  'pure-white': {
    id: 'pure-white',
    label: '纯白图纸',
    description: '纯白平整工程图背景，适合出图报告与文档截图',
    topColor: '#ffffff',
    midColor: '#ffffff',
    bottomColor: '#ffffff',
    isDark: false,
    cssGradient: '#ffffff'
  },
  solidworks: {
    id: 'solidworks',
    label: 'SolidWorks 经典',
    description: '天幕浅钢蓝到纯净近白三点自然渐变，工业 CAD 经典沉浸质感',
    topColor: '#b0c4de',
    midColor: '#e2e8f0',
    bottomColor: '#f8fafc',
    isDark: false,
    cssGradient: 'linear-gradient(180deg, #b0c4de 0%, #e2e8f0 50%, #f8fafc 100%)'
  },
  'neutral-gray': {
    id: 'neutral-gray',
    label: '工业中性灰',
    description: '冷灰中性极简渐变，色彩中立，适合排布密集彩色油口标注',
    topColor: '#cbd5e1',
    midColor: '#e2e8f0',
    bottomColor: '#f1f5f9',
    isDark: false,
    cssGradient: 'linear-gradient(180deg, #cbd5e1 0%, #e2e8f0 50%, #f1f5f9 100%)'
  },
  'dark-blueprint': {
    id: 'dark-blueprint',
    label: '暗夜深空',
    description: '暗色高对比工作站背景，强烈突显荧光青蓝管路与高光特征',
    topColor: '#0f172a',
    midColor: '#1e293b',
    bottomColor: '#334155',
    isDark: true,
    cssGradient: 'linear-gradient(180deg, #0f172a 0%, #1e293b 50%, #334155 100%)'
  }
}

const STORAGE_KEY = 'sureflow:viewport:background-preset'

export function getSavedBackgroundPreset(): BackgroundPreset {
  try {
    const saved = localStorage.getItem(STORAGE_KEY) as BackgroundPreset
    if (saved && BACKGROUND_PRESETS[saved]) {
      return saved
    }
  } catch {
    // 忽略本地存储异常
  }
  return DEFAULT_BACKGROUND_PRESET
}

export function saveBackgroundPreset(preset: BackgroundPreset): void {
  try {
    localStorage.setItem(STORAGE_KEY, preset)
  } catch {
    // 忽略本地存储异常
  }
}

/**
 * 动态创建 2x512 离屏 Canvas 三点垂直线性渐变纹理：
 * 显存占用不足 4KB，零额外 Shader 开销，且让 canvas.toDataURL 截取的离线位图天然保留渐变底衬。
 */
export function createGradientTexture(preset: BackgroundPreset): THREE.CanvasTexture {
  const config = BACKGROUND_PRESETS[preset] || BACKGROUND_PRESETS[DEFAULT_BACKGROUND_PRESET]
  const canvas = document.createElement('canvas')
  canvas.width = 2
  canvas.height = 512
  const ctx = canvas.getContext('2d')
  if (ctx) {
    if (config.topColor === config.bottomColor) {
      // 纯色背景
      ctx.fillStyle = config.topColor
      ctx.fillRect(0, 0, 2, 512)
    } else {
      // 三点垂直线性渐变：
      // Three.js 默认 flipY=true，Canvas y=0 对应视口顶部，y=512 对应视口底部
      const gradient = ctx.createLinearGradient(0, 0, 0, 512)
      gradient.addColorStop(0, config.topColor)
      gradient.addColorStop(0.5, config.midColor)
      gradient.addColorStop(1, config.bottomColor)
      ctx.fillStyle = gradient
      ctx.fillRect(0, 0, 2, 512)
    }
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.minFilter = THREE.LinearFilter
  texture.magFilter = THREE.LinearFilter
  texture.generateMipmaps = false
  texture.needsUpdate = true
  return texture
}

/**
 * R3F 视口背景同步组件：
 * 将渐变/纯色 Texture 赋给 scene.background，保证深度测试、透明度混合与截图 100% 同构。
 */
export const ViewportBackground: FC<{ preset: BackgroundPreset }> = ({ preset }) => {
  const scene = useThree((state) => state.scene)
  const texture = useMemo(() => createGradientTexture(preset), [preset])

  useEffect(() => {
    scene.background = texture
    return () => {
      if (scene.background === texture) {
        scene.background = null
      }
      texture.dispose()
    }
  }, [scene, texture])

  return null
}

/**
 * CAD 级视线随动前向补光（Camera Headlight）：
 * 紧随正交/透视相机视线方向微弱补光（intensity ~0.26），
 * 确保工程师无论将阀块旋转至何种角度，正对视线的深孔内部与孔底圆锥面均能清晰辨识，消除死黑。
 */
export const CameraHeadlight: FC<{ intensity?: number }> = ({ intensity = 0.26 }) => {
  const camera = useThree((state) => state.camera)
  const [lightObj] = useState(() => {
    const light = new THREE.DirectionalLight(0xffffff, intensity)
    light.position.set(0, 0, 0)
    const target = new THREE.Object3D()
    target.position.set(0, 0, -1)
    light.target = target
    const group = new THREE.Group()
    group.add(light)
    group.add(target)
    return { group, light }
  })

  useEffect(() => {
    lightObj.light.intensity = intensity
  }, [intensity, lightObj])

  useEffect(() => {
    camera.add(lightObj.group)
    return () => {
      camera.remove(lightObj.group)
      lightObj.light.dispose()
    }
  }, [camera, lightObj])

  return null
}
