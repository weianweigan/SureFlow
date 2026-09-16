import { useLocale as _useLocale } from '@renderer/i18n/useLocale'
import { t as _t } from '@shared/i18n'
import React, { useState } from 'react'
import {
  FormSectionWrapper,
  PropertyRow,
  NumberInput,
  CustomSelect
} from './PropertyFormComponents'
import { useDesignStore, type DesignState } from '../../../model/designStore'
import type { CavityInstance } from '@shared/design/types'
import {
  ChevronDown,
  ChevronRight,
  AlignLeft,
  AlignCenter,
  AlignRight,
  Link,
  Trash2,
  FolderPlus,
  ArrowUpDown,
  MoveHorizontal,
  GitCommit
} from 'lucide-react'

interface MultiCavityInspectorProps {
  projectId: string
  cavities: CavityInstance[]
}

export const MultiCavityInspector: React.FC<MultiCavityInspectorProps> = ({
  projectId,
  cavities
}) => {
  _useLocale()
  const session = useDesignStore((s: DesignState) => s.projects[projectId])
  const applyAlignment = useDesignStore((s: DesignState) => s.applyAlignment)
  const applyDistribution = useDesignStore((s: DesignState) => s.applyDistribution)
  const alignCavitiesCrossFace = useDesignStore((s: DesignState) => s.alignCavitiesCrossFace)
  const connectTwoCavities = useDesignStore((s: DesignState) => s.connectTwoCavities)
  const batchAdjustDepth = useDesignStore((s: DesignState) => s.batchAdjustDepth)
  const createGroupFromSelection = useDesignStore((s: DesignState) => s.createGroupFromSelection)
  const deleteCavity = useDesignStore((s: DesignState) => s.deleteCavity)

  const [listCollapsed, setListCollapsed] = useState(true)
  const [deltaDepth, setDeltaDepth] = useState(5)

  // 双孔快捷连接参数状态
  const [connectMode, setConnectMode] = useState<'cross' | 't-bottom' | 'bridge'>('cross')
  const [overtravel, setOvertravel] = useState(3)
  const [crossOffset, setCrossOffset] = useState(0)

  if (!session || cavities.length < 2) return null

  const cavityIds = cavities.map((c) => c.instanceId)
  const isTwoHoles = cavities.length === 2

  // 检查是否在同一面上
  const firstFace = cavities[0].faceId
  const allSameFace = cavities.every((c) => c.faceId === firstFace)

  const handleBatchDelete = () => {
    for (const cid of cavityIds) {
      deleteCavity(projectId, cid)
    }
  }

  const handleExecuteConnect = () => {
    if (!isTwoHoles) return
    connectTwoCavities(projectId, cavities[0].instanceId, cavities[1].instanceId, {
      mode: connectMode,
      overtravel,
      offset: crossOffset
    })
  }

  return (
    <div className="flex h-full flex-col select-none overflow-y-auto">
      {/* 1. 多选汇总徽章与折叠列表 */}
      <div className="border-b border-border/70 p-3 bg-muted/30">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="flex size-6 items-center justify-center rounded-full bg-primary/15 text-primary text-xs font-bold font-mono">
              {cavities.length}
            </span>
            <span className="text-xs font-semibold text-foreground">
              {_t('已选中多孔特征')}
            </span>
          </div>
          <button
            type="button"
            onClick={() => setListCollapsed(!listCollapsed)}
            className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground cursor-pointer"
          >
            <span>{listCollapsed ? _t('展开清单') : _t('收起')}</span>
            {listCollapsed ? <ChevronRight className="size-3" /> : <ChevronDown className="size-3" />}
          </button>
        </div>

        {/* 展开的清单列表 */}
        {!listCollapsed && (
          <div className="mt-2.5 max-h-36 overflow-y-auto rounded border border-border/60 bg-background divide-y divide-border/40">
            {cavities.map((c, i) => (
              <div key={c.instanceId} className="flex items-center justify-between p-1.5 text-[11px]">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="font-mono text-muted-foreground">{i + 1}.</span>
                  <span className="truncate text-foreground font-medium">{c.name}</span>
                </div>
                <span className="font-mono text-[10px] text-muted-foreground shrink-0">
                  {c.faceId} (U={c.u}, V={c.v})
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 2. 2孔特化：双孔快捷连接 */}
      {isTwoHoles && (
        <FormSectionWrapper
          title={_t('双孔快捷连接')}
          action={
            <span className="rounded bg-sky-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-sky-600 dark:text-sky-400">
              {_t('2孔特化')}
            </span>
          }
        >
          <PropertyRow label={_t('连接方式')}>
            <CustomSelect
              value={connectMode}
              onChange={(val) => setConnectMode(val as any)}
              options={[
                { label: _t('十字交叉相交 (Cross)'), value: 'cross', hint: '末端穿透相通' },
                { label: _t('T型触底连接 (T-Bottom)'), value: 't-bottom', hint: '副孔触碰主孔侧壁' },
                { label: _t('工艺孔桥接 (Bridge)'), value: 'bridge', hint: '相邻工艺直孔连接' }
              ]}
            />
          </PropertyRow>

          <PropertyRow label={_t('过冲量 (Over)')} unit="mm" title={_t('为避免相交不充分导致的节流，两孔相贯末端直孔通常增加 3~5mm 过冲深度')}>
            <NumberInput
              value={overtravel}
              step={1}
              min={0}
              max={20}
              unit="mm"
              onChange={setOvertravel}
            />
          </PropertyRow>

          <PropertyRow label={_t('偏心偏移')} unit="mm" title={_t('中心轴线对心相交或偏心切向相交偏移量')}>
            <NumberInput
              value={crossOffset}
              step={0.5}
              unit="mm"
              onChange={setCrossOffset}
            />
          </PropertyRow>

          <button
            type="button"
            onClick={handleExecuteConnect}
            className="mt-1 flex w-full items-center justify-center gap-1.5 rounded bg-sky-600 py-1.5 text-xs font-semibold text-white hover:bg-sky-500 transition-colors shadow-2xs cursor-pointer"
          >
            <Link className="size-3.5" />
            <span>{_t('执行相交通道连接')}</span>
          </button>
        </FormSectionWrapper>
      )}

      {/* 3. 同面对齐与分布 */}
      {allSameFace && (
        <FormSectionWrapper title={_t('同面对齐与均布')}>
          <div className="space-y-2">
            <div className="text-[11px] text-muted-foreground">{_t('位置对齐')}</div>
            <div className="grid grid-cols-6 gap-1">
              <button
                type="button"
                title={_t('左对齐')}
                onClick={() => applyAlignment(projectId, cavityIds, 'left')}
                className="flex h-7 items-center justify-center rounded border border-border/70 hover:bg-accent cursor-pointer"
              >
                <AlignLeft className="size-3.5 text-foreground" />
              </button>
              <button
                type="button"
                title={_t('水平居中')}
                onClick={() => applyAlignment(projectId, cavityIds, 'center-x')}
                className="flex h-7 items-center justify-center rounded border border-border/70 hover:bg-accent cursor-pointer"
              >
                <AlignCenter className="size-3.5 text-foreground" />
              </button>
              <button
                type="button"
                title={_t('右对齐')}
                onClick={() => applyAlignment(projectId, cavityIds, 'right')}
                className="flex h-7 items-center justify-center rounded border border-border/70 hover:bg-accent cursor-pointer"
              >
                <AlignRight className="size-3.5 text-foreground" />
              </button>
              <button
                type="button"
                title={_t('顶对齐')}
                onClick={() => applyAlignment(projectId, cavityIds, 'top')}
                className="flex h-7 items-center justify-center rounded border border-border/70 hover:bg-accent cursor-pointer"
              >
                <AlignLeft className="size-3.5 rotate-90 text-foreground" />
              </button>
              <button
                type="button"
                title={_t('垂直居中')}
                onClick={() => applyAlignment(projectId, cavityIds, 'center-y')}
                className="flex h-7 items-center justify-center rounded border border-border/70 hover:bg-accent cursor-pointer"
              >
                <AlignCenter className="size-3.5 rotate-90 text-foreground" />
              </button>
              <button
                type="button"
                title={_t('底对齐')}
                onClick={() => applyAlignment(projectId, cavityIds, 'bottom')}
                className="flex h-7 items-center justify-center rounded border border-border/70 hover:bg-accent cursor-pointer"
              >
                <AlignRight className="size-3.5 rotate-90 text-foreground" />
              </button>
            </div>

            {cavities.length >= 3 && (
              <>
                <div className="text-[11px] text-muted-foreground pt-1">{_t('间距均布')}</div>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => applyDistribution(projectId, cavityIds, 'horizontal')}
                    className="flex h-7 items-center justify-center gap-1 rounded border border-border/70 text-xs text-foreground hover:bg-accent cursor-pointer"
                  >
                    <MoveHorizontal className="size-3 text-muted-foreground" />
                    <span>{_t('水平等距')}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => applyDistribution(projectId, cavityIds, 'vertical')}
                    className="flex h-7 items-center justify-center gap-1 rounded border border-border/70 text-xs text-foreground hover:bg-accent cursor-pointer"
                  >
                    <ArrowUpDown className="size-3 text-muted-foreground" />
                    <span>{_t('垂直等距')}</span>
                  </button>
                </div>
              </>
            )}
          </div>
        </FormSectionWrapper>
      )}

      {/* 4. 异面/跨面空间剖面对齐 */}
      <FormSectionWrapper
        title={_t('跨面空间剖面对齐')}
        action={
          <span className="text-[10px] text-muted-foreground">
            {_t('轴线共面捕捉')}
          </span>
        }
      >
        <div className="grid grid-cols-3 gap-1.5">
          <button
            type="button"
            onClick={() => alignCavitiesCrossFace(projectId, cavityIds, 'x')}
            className="flex h-7 items-center justify-center gap-1 rounded border border-border/70 bg-background text-xs font-medium text-foreground hover:bg-accent cursor-pointer"
          >
            <GitCommit className="size-3 text-red-500" />
            <span>{_t('共 X 剖面')}</span>
          </button>
          <button
            type="button"
            onClick={() => alignCavitiesCrossFace(projectId, cavityIds, 'y')}
            className="flex h-7 items-center justify-center gap-1 rounded border border-border/70 bg-background text-xs font-medium text-foreground hover:bg-accent cursor-pointer"
          >
            <GitCommit className="size-3 text-emerald-500" />
            <span>{_t('共 Y 剖面')}</span>
          </button>
          <button
            type="button"
            onClick={() => alignCavitiesCrossFace(projectId, cavityIds, 'z')}
            className="flex h-7 items-center justify-center gap-1 rounded border border-border/70 bg-background text-xs font-medium text-foreground hover:bg-accent cursor-pointer"
          >
            <GitCommit className="size-3 text-blue-500" />
            <span>{_t('共 Z 剖面')}</span>
          </button>
        </div>
      </FormSectionWrapper>

      {/* 5. 批量深度增量微调 */}
      <FormSectionWrapper title={_t('批量深度加深')}>
        <div className="flex items-center gap-2">
          <NumberInput
            value={deltaDepth}
            step={1}
            unit="mm"
            onChange={setDeltaDepth}
          />
          <button
            type="button"
            onClick={() => batchAdjustDepth(projectId, cavityIds, deltaDepth)}
            className="h-7 shrink-0 rounded bg-primary px-3 text-xs font-semibold text-primary-foreground hover:bg-primary/90 cursor-pointer"
          >
            {_t('批量加深')}
          </button>
        </div>
      </FormSectionWrapper>

      {/* 6. 底部批量操作 */}
      <div className="p-3 mt-auto border-t border-border/70 flex items-center gap-2">
        <button
          type="button"
          onClick={() => createGroupFromSelection(projectId)}
          className="flex-1 flex items-center justify-center gap-1 rounded border border-border bg-background py-1.5 text-xs text-foreground hover:bg-accent cursor-pointer"
        >
          <FolderPlus className="size-3.5 text-primary" />
          <span>{_t('创建为组合孔')}</span>
        </button>
        <button
          type="button"
          onClick={handleBatchDelete}
          className="flex items-center justify-center gap-1 rounded border border-destructive/30 bg-destructive/10 px-3 py-1.5 text-xs text-destructive hover:bg-destructive/20 cursor-pointer"
        >
          <Trash2 className="size-3.5" />
          <span>{_t('批量删除')}</span>
        </button>
      </div>
    </div>
  )
}
