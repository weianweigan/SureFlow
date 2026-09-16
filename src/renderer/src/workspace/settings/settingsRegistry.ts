import type { SettingKey } from './settingsStore'

interface SettingDefinition {
  key: SettingKey
  label: string
  description: string
  options?: readonly { value: string; label: string }[]
}
const speeds = [
  { value: 'slow', label: '慢速' },
  { value: 'normal', label: '标准' },
  { value: 'fast', label: '快速' }
]
export const SETTINGS_SECTIONS: {
  id: string; title: string; subtitle: string; items: SettingDefinition[]
}[] = [
  { id: 'general', title: '通用', subtitle: '软件启动与使用记录', items: [
    { key: 'locale', label: '界面语言', description: '立即切换界面语言，用户命名和文档内容保持原样。', options: [
      { value: 'zh-CN', label: '简体中文' }, { value: 'en-US', label: 'English' }
    ] },
    { key: 'startupPage', label: '启动页面', description: '下次启动软件时自动激活的页面。', options: [
      { value: 'home', label: '主页' }, { value: 'library', label: '库管理' }
    ] },
    { key: 'recordRecent', label: '记录最近工程', description: '立即生效。关闭后不再记录之后打开的工程，已有记录保留。' }
  ] },
  { id: 'design', title: '设计工程', subtitle: '.sfb · 三维设计视口', items: [
    { key: 'designOrigin', label: '默认显示原点坐标轴', description: '新打开的设计 Tab 生效，可在视口中临时调整。' },
    { key: 'designGrid', label: '默认显示网格', description: '新打开的设计 Tab 生效，辅助空间定位。' },
    { key: 'designPerformance', label: '默认显示性能面板', description: '新打开的设计 Tab 生效，查看渲染性能。' }
  ] },
  { id: 'library', title: '孔腔库', subtitle: '库管理 · 二维预览', items: [
    { key: 'libraryZoom', label: '二维预览缩放速度', description: '立即生效。调整孔腔预览中滚轮缩放的幅度。', options: speeds }
  ] },
  { id: 'image', title: '图片', subtitle: 'PNG / JPG / JPEG / WEBP / SVG', items: [
    { key: 'imageWheelZoom', label: '滚轮缩放', description: '立即生效。关闭后仍可使用工具栏放大和缩小。' },
    { key: 'imageZoom', label: '缩放速度', description: '立即生效，适用于图片滚轮及工具栏缩放。', options: speeds }
  ] },
  { id: 'pdf', title: 'PDF 文档', subtitle: 'PDF · 参考资料阅读', items: [
    { key: 'pdfRecommendedPage', label: '打开时定位推荐起始页', description: '新打开的 PDF Tab 生效。关闭后从第 1 页开始，仍可手动定位推荐页。' }
  ] },
  { id: 'cad', title: 'CAD 模型', subtitle: 'STEP / STP / GLB / GLTF', items: [
    { key: 'cadGrid', label: '默认显示网格', description: '新打开的 CAD 模型 Tab 生效。' },
    { key: 'cadEdges', label: '默认显示边线', description: '新打开的 CAD 模型 Tab 生效，可在工具栏临时调整。' }
  ] },
  { id: 'web', title: '网页', subtitle: 'HTTP / HTTPS · 内嵌浏览', items: [
    { key: 'webPopups', label: '允许网页弹窗', description: '新打开的网页 Tab 生效。关闭后阻止内嵌网页创建弹出窗口。' }
  ] }
]
