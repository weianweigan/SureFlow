import { Canvas } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { MouseNavigation } from '../design/interaction/MouseNavigation'
import { t } from '@shared/i18n'
import { useLocale } from '@renderer/i18n/useLocale'
export default function MousePreview() {
  useLocale()
  return <div className="h-56 overflow-hidden rounded-xl border border-border bg-muted/20" aria-label={t('鼠标操作预览')}>
    <Canvas camera={{ position: [4, 3, 5] }}>
      <ambientLight intensity={1.5} /><directionalLight position={[4, 5, 6]} intensity={2} />
      <mesh><boxGeometry args={[2, 1.6, 1.2]} /><meshStandardMaterial color="#a8c8ba" /></mesh>
      <gridHelper args={[12, 12]} position={[0, -0.9, 0]} />
      <OrbitControls makeDefault enableDamping={false} mouseButtons={{ LEFT: undefined, MIDDLE: undefined, RIGHT: undefined }} />
      <MouseNavigation />
    </Canvas>
  </div>
}
