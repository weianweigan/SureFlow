import { useLocale as _useLocale } from '@renderer/i18n/useLocale'
import { t as _t, msg as _msg } from '@shared/i18n'
/**
 * CAD 3D 模型视口（正交视图 + CAD 风格实体边线渲染）
 * 支持查看 STEP (.step, .stp) 以及 GLB / GLTF 格式模型
 */
import { useSettingsStore } from '../../settings/settingsStore'
import { FC, useEffect, useState, useMemo, useCallback } from 'react'
import * as THREE from 'three'
import { Canvas, useThree } from '@react-three/fiber'
import { OrbitControls, GizmoHelper, GizmoViewport, Grid } from '@react-three/drei'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import {
  RotateCcw,
  Maximize2,
  Box,
  Layers,
  AlertCircle,
  Loader2
} from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { parseStepToThreeGeometry } from './stepLoader'

export type CadViewPreset = 'iso' | 'top' | 'front' | 'right' | 'left' | 'bottom'

interface CadModelViewerProps {
  /** 目标路径（相对库目录或绝对路径）或 URL */
  target: string
  /** 库包根目录（若 target 为相对路径，用于拼接完整本地路径） */
  libraryDirPath?: string
}

interface LoadedModelData {
  rootGroup: THREE.Group
  bounds: {
    center: THREE.Vector3
    size: THREE.Vector3
    radius: number
  }
}

/** 相机视角控制器 */
function CameraController({
  preset,
  bounds,
  fitTrigger
}: {
  preset: CadViewPreset
  bounds: LoadedModelData['bounds'] | null
  fitTrigger: number
}) {
  const { camera, controls } = useThree()
  const orbit = controls as any

  const applyPreset = useCallback(
    (p: CadViewPreset) => {
      if (!bounds) return
      const c = bounds.center
      const r = Math.max(bounds.radius, 10)
      const dist = r * 2.5

      let targetPos = new THREE.Vector3()
      switch (p) {
        case 'top':
          targetPos.set(c.x, c.y + dist, c.z + 0.001)
          break
        case 'bottom':
          targetPos.set(c.x, c.y - dist, c.z + 0.001)
          break
        case 'front':
          targetPos.set(c.x, c.y, c.z + dist)
          break
        case 'right':
          targetPos.set(c.x + dist, c.y, c.z)
          break
        case 'left':
          targetPos.set(c.x - dist, c.y, c.z)
          break
        case 'iso':
        default:
          targetPos.set(c.x + dist * 0.8, c.y + dist * 0.7, c.z + dist * 0.8)
          break
      }

      camera.position.copy(targetPos)
      if (orbit) {
        orbit.target.copy(c)
        orbit.update()
      }
      camera.lookAt(c)

      // 在正交相机下计算合适的 zoom
      if ('zoom' in camera) {
        const orthoCam = camera as THREE.OrthographicCamera
        const viewSize = Math.max(bounds.size.x, bounds.size.y, bounds.size.z) * 1.6 || 100
        orthoCam.zoom = Math.min(800, 600) / viewSize
        orthoCam.updateProjectionMatrix()
      }
    },
    [bounds, camera, orbit]
  )

  useEffect(() => {
    applyPreset(preset)
  }, [preset, applyPreset, fitTrigger])

  return null
}

export const CadModelViewer: FC<CadModelViewerProps> = ({ target, libraryDirPath }) => {
  _useLocale()
  const [loading, setLoading] = useState<boolean>(true)
  const [error, setError] = useState<string | null>(null)
  const [modelData, setModelData] = useState<LoadedModelData | null>(null)
  const [viewPreset, setViewPreset] = useState<CadViewPreset>('iso')
  const [fitTrigger, setFitTrigger] = useState<number>(0)
  const [showEdges, setShowEdges] = useState<boolean>(() => useSettingsStore.getState().values.cadEdges)
  const [showGrid] = useState<boolean>(() => useSettingsStore.getState().values.cadGrid)

  // 计算安全的文件访问路径
  const fullFilePath = useMemo(() => {
    let raw = target.trim()
    if (raw.startsWith('http://') || raw.startsWith('https://')) {
      return raw
    }
    // 相对路径补全
    if (libraryDirPath && !raw.startsWith('/') && !/^[a-zA-Z]:/.test(raw)) {
      raw = `${libraryDirPath.replace(/\\/g, '/')}/${raw.replace(/\\/g, '/')}`
    }
    return raw
  }, [target, libraryDirPath])

  // 加载并解析模型
  useEffect(() => {
    let isCancelled = false
    setLoading(true)
    setError(null)
    setModelData(null)

    async function loadModel() {
      try {
        const cleanPath = fullFilePath.toLowerCase()
        const isStep = cleanPath.endsWith('.step') || cleanPath.endsWith('.stp')
        const isGlb = cleanPath.endsWith('.glb') || cleanPath.endsWith('.gltf')

        const rootGroup = new THREE.Group()

        if (isStep) {
          // 1. 解析 STEP
          let buffer: ArrayBuffer
          if (window.fileApi) {
            buffer = await window.fileApi.readBinary(fullFilePath)
          } else {
            const resp = await fetch(fullFilePath)
            buffer = await resp.arrayBuffer()
          }

          if (isCancelled) return

          const { solidGeometry, edgeGeometry } = await parseStepToThreeGeometry(buffer)

          // 实体 Mesh（CAD 浅灰哑光）
          const solidMat = new THREE.MeshStandardMaterial({
            color: '#cbd5e1',
            roughness: 0.35,
            metalness: 0.15,
            polygonOffset: true,
            polygonOffsetFactor: 1,
            polygonOffsetUnits: 1
          })
          const mesh = new THREE.Mesh(solidGeometry, solidMat)
          rootGroup.add(mesh)

          // CAD 边线
          if (edgeGeometry) {
            const lineMat = new THREE.LineBasicMaterial({
              color: '#0f172a',
              linewidth: 1
            })
            const lineSegments = new THREE.LineSegments(edgeGeometry, lineMat)
            lineSegments.name = 'cad-edges'
            rootGroup.add(lineSegments)
          }
        } else if (isGlb || cleanPath.startsWith('http')) {
          // 2. 解析 GLB / GLTF
          const loader = new GLTFLoader()
          const safeUrl =
            fullFilePath.startsWith('http') || !window.fileApi
              ? fullFilePath
              : window.fileApi.toSafeFileUrl(fullFilePath)

          const gltf = await new Promise<any>((resolve, reject) => {
            loader.load(safeUrl, resolve, undefined, reject)
          })

          if (isCancelled) return

          rootGroup.add(gltf.scene)

          // 遍历给每个 mesh 提取 EdgesGeometry 边线
          gltf.scene.traverse((child: any) => {
            if (child.isMesh && child.geometry) {
              // 增强材质防穿模
              if (child.material) {
                child.material.polygonOffset = true
                child.material.polygonOffsetFactor = 1
                child.material.polygonOffsetUnits = 1
              }
              const edgesGeom = new THREE.EdgesGeometry(child.geometry, 25)
              const lineMat = new THREE.LineBasicMaterial({
                color: '#1e293b',
                linewidth: 1
              })
              const edges = new THREE.LineSegments(edgesGeom, lineMat)
              edges.name = 'cad-edges'
              child.add(edges)
            }
          })
        } else {
          throw new Error(_msg`暂不支持的模型格式：${target}`)
        }

        // 计算包围盒
        const box = new THREE.Box3().setFromObject(rootGroup)
        const center = new THREE.Vector3()
        const size = new THREE.Vector3()
        box.getCenter(center)
        box.getSize(size)
        const sphere = new THREE.Sphere()
        box.getBoundingSphere(sphere)

        if (!isCancelled) {
          setModelData({
            rootGroup,
            bounds: {
              center,
              size,
              radius: Math.max(sphere.radius, 10)
            }
          })
          setLoading(false)
        }
      } catch (err: any) {
        if (!isCancelled) {
          console.error('[CadModelViewer] 加载失败:', err)
          setError(err?.message || _t("加载模型失败"))
          setLoading(false)
        }
      }
    }

    loadModel()
    return () => {
      isCancelled = true
    }
  }, [fullFilePath])

  // 控制边线显隐
  useEffect(() => {
    if (!modelData) return
    modelData.rootGroup.traverse((child) => {
      if (child.name === 'cad-edges') {
        child.visible = showEdges
      }
    })
  }, [showEdges, modelData])

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden bg-[#f8fafc]">
      {/* 顶部控制工具栏 */}
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-border/80 bg-background/95 px-3 backdrop-blur-sm">
        <div className="flex items-center gap-1.5">
          <Box className="size-4 text-indigo-500" />
          <span className="text-xs font-semibold text-foreground">{_t("CAD 正交视口")}</span>
          <span className="font-mono text-[11px] text-muted-foreground">
            {target.split(/[\\/]/).pop()}
          </span>
        </div>

        {/* 视角切换与功能按钮 */}
        <div className="flex items-center gap-1">
          <div className="flex items-center rounded-md border border-border bg-muted/30 p-0.5 text-xs">
            <button
              type="button"
              onClick={() => setViewPreset('iso')}
              className={`rounded px-1.5 py-0.5 text-[11px] font-medium transition-colors ${
                viewPreset === 'iso' ? 'bg-background text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {_t("轴测")}</button>
            <button
              type="button"
              onClick={() => setViewPreset('top')}
              className={`rounded px-1.5 py-0.5 text-[11px] font-medium transition-colors ${
                viewPreset === 'top' ? 'bg-background text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {_t("俯视")}</button>
            <button
              type="button"
              onClick={() => setViewPreset('front')}
              className={`rounded px-1.5 py-0.5 text-[11px] font-medium transition-colors ${
                viewPreset === 'front' ? 'bg-background text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {_t("主视")}</button>
            <button
              type="button"
              onClick={() => setViewPreset('right')}
              className={`rounded px-1.5 py-0.5 text-[11px] font-medium transition-colors ${
                viewPreset === 'right' ? 'bg-background text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {_t("右视")}</button>
          </div>

          <Button
            size="icon-sm"
            variant="ghost"
            title={showEdges ? _t("隐藏边线") : _t("显示边线")}
            className={`size-6 ${showEdges ? 'text-primary' : 'text-muted-foreground'}`}
            onClick={() => setShowEdges((v) => !v)}
          >
            <Layers className="size-3.5" />
          </Button>

          <Button
            size="icon-sm"
            variant="ghost"
            title={_t("复位居中 (或双击空白)")}
            className="size-6"
            onClick={() => setFitTrigger((k) => k + 1)}
          >
            <Maximize2 className="size-3.5" />
          </Button>
        </div>
      </div>

      {/* 主画布视口 */}
      <div
        className="relative flex-1 min-h-0 cursor-grab active:cursor-grabbing"
        onDoubleClick={() => setFitTrigger((k) => k + 1)}
      >
        {loading && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-2 bg-[#f8fafc]/80 backdrop-blur-xs">
            <Loader2 className="size-6 animate-spin text-primary" />
            <span className="text-xs text-muted-foreground">{_t("正在解析 CAD 拓扑与几何数据...")}</span>
          </div>
        )}

        {error && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 p-6 text-center">
            <div className="flex size-10 items-center justify-center rounded-full bg-destructive/10 text-destructive">
              <AlertCircle className="size-5" />
            </div>
            <div className="max-w-md">
              <p className="text-sm font-semibold text-foreground">{_t("无法加载模型")}</p>
              <p className="mt-1 text-xs text-muted-foreground break-all">{error}</p>
              <p className="mt-2 text-[11px] text-muted-foreground/70">
                {_t("文件路径：")}{fullFilePath}
              </p>
            </div>
            <Button size="sm" variant="outline" onClick={() => setFitTrigger((k) => k + 1)}>
              <RotateCcw className="size-3.5 mr-1" /> {_t("重试")}</Button>
          </div>
        )}

        <Canvas
          orthographic
          dpr={[1, Math.min(typeof window !== 'undefined' ? window.devicePixelRatio : 1, 1.5)]}
          camera={{
            position: [120, 100, 120],
            zoom: 5,
            near: 0.1,
            far: 20000
          }}
        >
          {/* 背景色浅灰工程色 */}
          <color attach="background" args={['#f8fafc']} />

          {/* 三点经典 CAD 工程光照 */}
          <ambientLight intensity={0.75} />
          <hemisphereLight args={['#ffffff', '#cbd5e1', 0.55]} />
          <directionalLight position={[150, 200, 120]} intensity={1.3} />
          <directionalLight position={[-150, -80, -100]} intensity={0.4} />

          {/* 地面网格 */}
          {showGrid && (
            <Grid
              position={[0, modelData ? modelData.bounds.center.y - modelData.bounds.size.y / 2 : 0, 0]}
              args={[20, 20]}
              cellSize={10}
              cellThickness={0.5}
              cellColor="#cbd5e1"
              sectionSize={50}
              sectionThickness={1}
              sectionColor="#94a3b8"
              fadeDistance={1000}
              fadeStrength={1.2}
              infiniteGrid
            />
          )}

          {/* 模型实体 */}
          {modelData && <primitive object={modelData.rootGroup} />}

          {/* 交互控制与预设视角 */}
          <OrbitControls makeDefault enableDamping dampingFactor={0.08} />
          <CameraController
            preset={viewPreset}
            bounds={modelData?.bounds || null}
            fitTrigger={fitTrigger}
          />

          {/* 3D 轴向指示器 */}
          <GizmoHelper alignment="bottom-right" margin={[64, 64]}>
            <GizmoViewport
              axisColors={['#ef4444', '#16a34a', '#2563eb']}
              labelColor="#000000"
            />
          </GizmoHelper>
        </Canvas>
      </div>
    </div>
  )
}
