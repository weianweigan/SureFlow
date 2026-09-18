import { useLocale as _useLocale } from '@renderer/i18n/useLocale'
import { t as _t } from '@shared/i18n'
/**
 * 孔腔库表单各分区帮助 Popover 组件
 *
 * 在分区标题行或卡片标题后提供轻量「?」图标，点击后弹出参数说明与语法约定，
 * 避免在表单主界面堆叠过多注释文字，保持界面极简高效。
 */

import { useState } from 'react'
import { HelpCircle } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@renderer/components/ui/popover'
import { cn } from '@renderer/lib/utils'

/** 基础通用轻量帮助 Popover */
export function BaseHelpPopover({
  title,
  content,
  width = 'w-72'
}: {
  title: string
  content: React.ReactNode
  width?: string
}) {
  _useLocale()
  const [open, setOpen] = useState(false)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          title={title}
          onClick={(e) => {
            e.stopPropagation()
            setOpen((prev) => !prev)
          }}
          className="flex size-4.5 items-center justify-center rounded-full text-muted-foreground/70 transition-colors hover:bg-muted hover:text-foreground"
        >
          <HelpCircle className="size-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="bottom"
        sideOffset={6}
        className={cn(
          'z-50 p-3 text-xs leading-relaxed space-y-2 bg-background text-foreground shadow-lg border border-border outline-none',
          width
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="font-semibold text-foreground">{title}</div>
        {content}
      </PopoverContent>
    </Popover>
  )
}

/** 侧油口帮助说明 */
export function PortsHelpPopover() {
  _useLocale()
  return (
    <BaseHelpPopover
      title={_t("侧油口参数说明")}
      width="w-68"
      content={
        <div className="space-y-1.5 text-[11px] text-muted-foreground">
          <div>
            <span className="font-medium text-foreground">{_t("· 非通底：")}</span>
            {_t("深度代表中心轴线位置，孔径代表沿 Y 轴的上下开孔范围。")}</div>
          <div>
            <span className="font-medium text-foreground">{_t("· 通底：")}</span>
            {_t("深度代表起始线位置，自此深度直通孔底最深处，无需配置孔径。")}</div>
          <div className="text-[10px] text-muted-foreground/60 border-t border-border/50 pt-1.5 space-y-1">
            <div>{_t("所有侧油口均沿 Y 轴孔深方向浮动，与图形预览双向联动高亮。")}</div>
            <div className="text-primary/80 font-medium">{_t("注：钻孔类型无侧油口配置，默认整个钻孔均作为油口/通流通路使用。")}</div>
          </div>
        </div>
      }
    />
  )
}

/** 元件包围盒帮助说明 */
export function ComponentBoxesHelpPopover() {
  _useLocale()
  return (
    <BaseHelpPopover
      title={_t("元件包围盒说明")}
      width="w-72"
      content={
        <div className="space-y-1.5 text-[11px] text-muted-foreground">
          <div>
            <span className="font-medium text-foreground">{_t("· 作用：")}</span>
            {_t("描述孔腔所安装元件（如阀体、电磁铁线圈、接头）在安装面外的外形，用于 3D 碰撞检查与装配间隙验证。")}</div>
          <div>
            <span className="font-medium text-foreground">{_t("· 长方体 (Box)：")}</span>
            {_t("外形尺寸为长 X × 宽 Y × 悬伸高 Z，支持绕安装面法线设定 Z 轴旋转角。")}</div>
          <div>
            <span className="font-medium text-foreground">{_t("· 圆柱体 (Cylinder)：")}</span>
            {_t("外形尺寸为截面直径 φ × 悬伸高 H。")}</div>
          <div>
            <span className="font-medium text-foreground">{_t("· 基准偏移：")}</span>
            {_t("以孔腔中心为基准，在安装面坐标系内的 X / Y 轴偏移量。")}</div>
        </div>
      }
    />
  )
}

/** 标注模板语法说明 */
export function AnnotationHelpPopover() {
  _useLocale()
  return (
    <BaseHelpPopover
      title={_t("标注模板变量说明")}
      width="w-72"
      content={
        <div className="space-y-1 text-[11px] text-muted-foreground">
          <div><code className="rounded bg-muted px-1 py-0.5 font-mono text-[10px] text-foreground">&lt;MOD-DIAM&gt;</code> {_t("直径符号（φ）")}</div>
          <div><code className="rounded bg-muted px-1 py-0.5 font-mono text-[10px] text-foreground">&lt;D_start&gt;</code> {_t("起始台阶口径（mm）")}</div>
          <div><code className="rounded bg-muted px-1 py-0.5 font-mono text-[10px] text-foreground">&lt;D_end&gt;</code> {_t("末端收尾口径（mm）")}</div>
          <div><code className="rounded bg-muted px-1 py-0.5 font-mono text-[10px] text-foreground">&lt;HOLE-DEPTH&gt;</code> {_t("深度文字符号（深）")}</div>
          <div><code className="rounded bg-muted px-1 py-0.5 font-mono text-[10px] text-foreground">&lt;H_start&gt;</code> {_t("起始深度（0）")}</div>
          <div><code className="rounded bg-muted px-1 py-0.5 font-mono text-[10px] text-foreground">&lt;H_end&gt;</code> {_t("累计总孔深（mm）")}</div>
          <div><code className="rounded bg-muted px-1 py-0.5 font-mono text-[10px] text-foreground">&lt;HOLE-SPOT&gt;</code> {_t("锪孔/沉头符号（⌴）")}</div>
          <div className="text-[10px] text-muted-foreground/60 border-t border-border/50 pt-1.5">
            {_t("默认标准模板：")}<code className="font-mono text-foreground">&lt;MOD-DIAM&gt;&lt;D_end&gt; &lt;HOLE-DEPTH&gt;&lt;H_end&gt;</code>
          </div>
        </div>
      }
    />
  )
}

/** 3D 预览模型帮助说明 */
export function Model3dHelpPopover() {
  _useLocale()
  return (
    <BaseHelpPopover
      title={_t("3D 预览模型配置说明")}
      width="w-68"
      content={
        <div className="space-y-1.5 text-[11px] text-muted-foreground">
          <div>
            <span className="font-medium text-foreground">{_t("· 格式要求：")}</span>
            {_t("支持标准")}<code className="rounded bg-muted px-1 py-0.5 font-mono text-[10px] text-foreground">.glb</code> {_t("或")}<code className="rounded bg-muted px-1 py-0.5 font-mono text-[10px] text-foreground">.gltf</code> {_t("格式。")}</div>
          <div>
            <span className="font-medium text-foreground">{_t("· 存放约定：")}</span>
            {_t("模型文件需放置在当前孔腔库包根目录下的")}<code className="rounded bg-muted px-1 py-0.5 font-mono text-[10px] text-foreground">models/</code> {_t("子文件夹中。")}</div>
          <div>
            <span className="font-medium text-foreground">{_t("· 示例：")}</span>
            <code className="rounded bg-muted px-1 py-0.5 font-mono text-[10px] text-foreground">models/sample-valve.glb</code>
          </div>
        </div>
      }
    />
  )
}

/** 参考文档帮助说明 */
export function ReferencesHelpPopover() {
  _useLocale()
  return (
    <BaseHelpPopover
      title={_t("参考文档说明")}
      width="w-68"
      content={
        <div className="space-y-1.5 text-[11px] text-muted-foreground">
          <div>
            <span className="font-medium text-foreground">{_t("· 本地 PDF：")}</span>
            {_t("选择库包内的文档，可配置起始页和结束页。")}</div>
          <div>
            <span className="font-medium text-foreground">{_t("· 在线网址：")}</span>
            {_t("填写以")}<code className="rounded bg-muted px-1 py-0.5 font-mono text-[10px] text-foreground">https://</code> {_t("开头的技术样本或手册在线链接，可一键跳转浏览器查看。")}</div>
        </div>
      }
    />
  )
}
