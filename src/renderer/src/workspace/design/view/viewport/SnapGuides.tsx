import { useLocale as _useLocale } from '@renderer/i18n/useLocale'
import { t as _t } from '@shared/i18n'
import { type ComponentType } from 'react'
import { Line } from '@react-three/drei'
import { ProximityDimensions } from './ProximityDimensions'
import { useSnapStore } from '../../model/snapStore'
import { Popover, PopoverContent, PopoverTrigger } from '@renderer/components/ui/popover'
import { Magnet, Target, Grid3X3, Layers, CircleDot, Ruler } from 'lucide-react'
import { cn } from '@renderer/lib/utils'

export function SnapGuides({ projectId }: { projectId: string }) {
  _useLocale()
  const matches = useSnapStore(s => s.matches[projectId]) ?? []
  return <group>
    {matches.map(m => <group key={m.id}>
      <Line points={[m.point, m.anchor]} color="#fbbf24" dashed dashSize={1.5} gapSize={1} lineWidth={1} depthTest={false} raycast={() => null} />
      <mesh position={m.point} renderOrder={1000} raycast={()=>null}>
        <sphereGeometry args={[0.25,8,6]} /><meshBasicMaterial color="#fbbf24" depthTest={false} depthWrite={false}/>
      </mesh>
    </group>)}
    <ProximityDimensions projectId={projectId} />
  </group>
}

const EMPTY_MATCHES: never[] = []
export function SnapStatusOverlay({projectId}:{projectId:string}) {
  const matches=useSnapStore(s=>s.matches[projectId]??EMPTY_MATCHES)
  if (!matches.length) return null
  return <div className="pointer-events-none absolute left-3 top-3 z-10 max-w-[min(28rem,60%)] text-[11px] text-amber-200" data-testid="snap-status">
    <div className="rounded bg-slate-900/85 px-2 py-1">
      {matches.slice(0,2).map(m=><div key={m.id} className="truncate">{m.locks==='depth'?'深度':m.locks?.toUpperCase()} · {m.label}</div>)}
    </div>
  </div>
}

interface SnapToggleItemProps {
  icon: ComponentType<{ className?: string }>
  label: string
  shortcut?: string
  checked: boolean
  onCheckedChange: () => void
}

function SnapToggleItem({
  icon: Icon,
  label,
  shortcut,
  checked,
  onCheckedChange
}: SnapToggleItemProps) {
  _useLocale()
  return (
    <button
      type="button"
      onClick={onCheckedChange}
      className={cn(
        'flex w-full items-center justify-between rounded-md px-2 py-1.5 text-xs transition-colors cursor-pointer select-none',
        checked
          ? 'bg-accent/70 text-foreground font-medium'
          : 'text-muted-foreground hover:bg-accent/40 hover:text-foreground'
      )}
    >
      <div className="flex items-center gap-2">
        <Icon className={cn('size-3.5 shrink-0', checked ? 'text-primary' : 'text-muted-foreground')} />
        <span>{_t(label)}</span>
      </div>
      <div className="flex items-center gap-1.5">
        {shortcut && (
          <span className="text-[10px] text-muted-foreground font-mono bg-muted/60 px-1 py-0.5 rounded leading-none">
            {shortcut}
          </span>
        )}
        <div
          className={cn(
            'relative inline-flex h-4 w-7 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-150 ease-in-out',
            checked ? 'bg-primary' : 'bg-muted-foreground/30'
          )}
        >
          <span
            className={cn(
              'pointer-events-none inline-block size-3 transform rounded-full bg-background shadow-xs ring-0 transition duration-150 ease-in-out',
              checked ? 'translate-x-3' : 'translate-x-0'
            )}
          />
        </div>
      </div>
    </button>
  )
}

export function SnapSettings() {
  _useLocale()
  const settings = useSnapStore((s) => s.settings)
  const toggle = useSnapStore((s) => s.toggle)

  const isAnyActive = settings.geometry || settings.grid || settings.crossFace || settings.showPorts || settings.nearbyDistances

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          title={_t("智能捕捉与对齐设置（Shift 暂时解除捕捉）")}
          className={cn(
            'flex size-7 items-center justify-center rounded-md border transition-colors cursor-pointer',
            isAnyActive
              ? 'border-primary/50 bg-primary/10 text-primary font-medium'
              : 'border-transparent text-muted-foreground hover:bg-accent hover:text-foreground'
          )}
        >
          <Magnet className="size-4" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-56 p-2 text-xs space-y-1">
        <div className="px-2 py-0.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
          {_t("捕捉与对齐")}</div>
        <SnapToggleItem
          icon={Target}
          label={_t("几何捕捉")}
          shortcut={_t("特征")}
          checked={settings.geometry}
          onCheckedChange={() => toggle('geometry')}
        />
        <SnapToggleItem
          icon={Grid3X3}
          label={_t("1mm 网格")}
          shortcut={_t("网格")}
          checked={settings.grid}
          onCheckedChange={() => toggle('grid')}
        />
        <SnapToggleItem
          icon={Layers}
          label={_t("跨面参考")}
          shortcut={_t("投影")}
          checked={settings.crossFace}
          onCheckedChange={() => toggle('crossFace')}
        />
        <SnapToggleItem
          icon={CircleDot}
          label={_t("侧油口标识")}
          shortcut={_t("紫色环")}
          checked={settings.showPorts}
          onCheckedChange={() => toggle('showPorts')}
        />

        <SnapToggleItem icon={Ruler} label={_t('附近距离')} checked={settings.nearbyDistances} onCheckedChange={()=>toggle('nearbyDistances')} />
        <div className="my-1 h-px bg-border/60" />

        <div className="px-2 py-1 text-[10px] text-muted-foreground leading-tight bg-muted/40 rounded">
          {_t("提示：拖拽孔时按住")}{' '}
          <kbd className="font-mono font-semibold text-foreground bg-background px-1 py-0.5 rounded border text-[9px]">
            Shift
          </kbd>{' '}
          {_t("临时解除捕捉；侧油口标识着色实际孔壁范围，不新增横孔。")}</div>
      </PopoverContent>
    </Popover>
  )
}
