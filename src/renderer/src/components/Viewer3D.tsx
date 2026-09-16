import { useLocale as _useLocale } from '@renderer/i18n/useLocale'
import { useEffect } from 'react'
import * as THREE from 'three'
import { Canvas, useThree } from '@react-three/fiber'
import { Grid, GizmoHelper, GizmoViewport, OrbitControls } from '@react-three/drei'
import { ValveBlock } from './ValveBlock'
import type { FC } from 'react'

export type ViewPreset = 'perspective' | 'top' | 'front' | 'right'

interface CameraRigProps {
  preset: ViewPreset
}

/** 根据视图预设将相机定位到标准视角（类似 CAD 的俯视/主视/右视） */
function CameraRig({ preset }: CameraRigProps): null {
  const camera = useThree((s) => s.camera)
  // OrbitControls 通过 makeDefault 注册到 state.controls
  const controls = useThree((s) => s.controls) as { target: THREE.Vector3; update: () => void } | null

  useEffect(() => {
    const look = { x: 0, y: 12, z: 0 }
    switch (preset) {
      case 'top':
        camera.position.set(0, 340, 0.01)
        break
      case 'front':
        camera.position.set(0, 60, 340)
        break
      case 'right':
        camera.position.set(340, 60, 0)
        break
      default:
        camera.position.set(150, 120, 170)
    }
    controls?.target.set(look.x, look.y, look.z)
    controls?.update()
    camera.lookAt(look.x, look.y, look.z)
  }, [preset, camera, controls])

  return null
}

interface Viewer3DProps {
  viewPreset: ViewPreset
}

/**
 * 3D 工程视口：React Three Fiber 场景容器。
 * 承载阀块模型、轨道控制、网格地面与标准视图预设。
 */
export const Viewer3D: FC<Viewer3DProps> = ({ viewPreset }) => {
  _useLocale()
  return (
    <Canvas
      shadows
      dpr={[1, 2]}
      camera={{ position: [150, 120, 170], fov: 45, near: 0.1, far: 3000 }}
    >
      {/* 浅色工程背景，与全局主题一致（Design.md surface-soft） */}
      <color attach="background" args={['#E9E9E9']} />

      <ambientLight intensity={0.55} />
      <hemisphereLight args={['#ffffff', '#d9d9d6', 0.45]} />
      <directionalLight
        position={[120, 180, 100]}
        intensity={1.6}
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
      />

      <ValveBlock />

      {/* 网格地面 */}
      <Grid
        position={[0, -0.5, 0]}
        args={[10, 10]}
        cellSize={10}
        cellThickness={0.6}
        cellColor="#d6d6d3"
        sectionSize={50}
        sectionThickness={1}
        sectionColor="#a8a8a5"
        fadeDistance={500}
        fadeStrength={1.5}
        infiniteGrid
      />

      <CameraRig preset={viewPreset} />
      <OrbitControls makeDefault enableDamping target={[0, 12, 0]} />

      {/* 坐标系指示器（右下角） */}
      <GizmoHelper alignment="bottom-right" margin={[64, 64]}>
        <GizmoViewport
          axisColors={['#ef4444', '#16a34a', '#2563eb']}
          labelColor="#000000"
        />
      </GizmoHelper>
    </Canvas>
  )
}
