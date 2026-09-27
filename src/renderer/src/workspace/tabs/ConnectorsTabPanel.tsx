import React, { useState, useEffect, useCallback } from 'react'
import {
  Layers,
  Download,
  RefreshCw,
  ShieldCheck,
  Check,
  AlertCircle,
  Sparkles,
  Radio,
  Box,
  Bot,
  CircuitBoard,
  ChevronDown,
  ChevronRight
} from 'lucide-react'
import { useLocale as _useLocale } from '@renderer/i18n/useLocale'
import { t, msg } from '@shared/i18n'
import type {
  ConnectorItem,
  ConnectorRegistry
} from '@shared/cad/cadBridgeTypes'
import { useCadBridgeStore } from '../connectors/cadBridgeStatusStore'
import { getCadConnectorIcon } from '@shared/cad/cadProjectLookup'
import { Button } from '@renderer/components/ui/button'
import { Separator } from '@renderer/components/ui/separator'

const REGISTRY_URL = 'https://sureflow-library.hy3d.space/connectors/connector-registry.json'

// 简化并过滤技术底层细节，呈现给用户友好、清晰的特性与说明
const USER_FRIENDLY_DESCRIPTIONS: Record<string, string> = {
  solidworks: '支持 SolidWorks 2018 到最新版本，实现模型双向同步与实体自动更新。',
  creo: '针对 PTC Creo Parametric 的双向协同连接器插件。',
  nx: '针对 Siemens UG/NX 系列的双向协同连接器插件。'
}

const USER_FRIENDLY_HIGHLIGHTS: Record<string, string[]> = {
  solidworks: [
    '支持 SolidWorks 零件双向实时协同',
    '支持阀块实体一键同步与自动重构',
    '在 SolidWorks 内部直接保存 SureFlow 工程'
  ],
  creo: [
    '支持 Creo 零件双向实时协同',
    '支持实体模型一键同步'
  ],
  nx: [
    '支持 UG/NX 零件双向实时协同',
    '支持实体模型一键同步'
  ]
}

const FALLBACK_REGISTRY: ConnectorItem[] = [
  {
    id: 'solidworks',
    name: 'SolidWorks 协同连接器',
    cadType: 'SOLIDWORKS',
    vendor: 'SureFlow 官方团队',
    icon: 'solidworks',
    description: '支持 SolidWorks 2018 到最新版本，实现模型双向同步与实体自动更新。',
    supportedCadVersions: ['2018', '2019', '2020', '2021', '2022', '2023', '2024', '2025', '2026'],
    platform: 'win32-x64',
    latestVersion: '1.0.0',
    releaseDate: '2026-09-24',
    packageUrl: 'packages/solidworks/1.0.0/SureFlow-SolidWorks-Connector-1.0.0.msi',
    sha256: '816409291d760e0d351e9b78137225637309ab711c3269765f4db9e5cf26e832',
    sizeBytes: 3330048,
    changelog: [
      '支持 SolidWorks 零件双向实时协同',
      '支持阀块实体一键同步与自动重构',
      '在 SolidWorks 内部直接保存 SureFlow 工程'
    ],
    status: 'RELEASED'
  },
  {
    id: 'creo',
    name: 'PTC Creo 协同连接器',
    cadType: 'CREO',
    vendor: 'SureFlow 官方团队',
    icon: 'creo',
    description: '针对 PTC Creo Parametric 的双向协同连接器插件。',
    supportedCadVersions: ['7.0', '8.0', '9.0', '10.0', '11.0'],
    platform: 'win32-x64',
    latestVersion: '0.5.0-beta',
    releaseDate: '2026-10-15',
    packageUrl: 'packages/creo/0.5.0-beta/SureFlow-Creo-Connector-0.5.0-beta.msi',
    changelog: ['规划开发中，支持主流 Creo 版本'],
    status: 'COMING_SOON'
  },
  {
    id: 'nx',
    name: 'Siemens UG/NX 协同连接器',
    cadType: 'NX',
    vendor: 'SureFlow 官方团队',
    icon: 'nx',
    description: '针对 Siemens UG/NX 系列的双向协同连接器插件。',
    supportedCadVersions: ['NX 1980+', 'NX 2007+', 'NX 2206+', 'NX 2306+'],
    platform: 'win32-x64',
    latestVersion: '0.1.0-alpha',
    releaseDate: '2026-11-20',
    packageUrl: 'packages/nx/0.1.0-alpha/SureFlow-NX-Connector-0.1.0-alpha.msi',
    changelog: ['规划开发中，支持主流 NX 版本'],
    status: 'COMING_SOON'
  }
]

type ConnectorCategory = 'cad' | 'agent' | 'schematic'

export default function ConnectorsTabPanel(): React.ReactElement {
  _useLocale()
  const bridgeStatus = useCadBridgeStore((s) => s.status)
  const fetchBridgeStatus = useCadBridgeStore((s) => s.fetchStatus)

  const [activeCategory, setActiveCategory] = useState<ConnectorCategory>('cad')
  const [showMoreCad, setShowMoreCad] = useState(false)

  const [connectors, setConnectors] = useState<ConnectorItem[]>(FALLBACK_REGISTRY)
  const [registryLoading, setRegistryLoading] = useState(false)
  const [lastRegistryUpdate, setLastRegistryUpdate] = useState<string | null>(null)


  const [installingId, setInstallingId] = useState<string | null>(null)
  const [installMessage, setInstallMessage] = useState<{ text: string; isError?: boolean } | null>(null)

  // 1. 获取远程对象存储注册表数据
  const loadRegistry = useCallback(async () => {
    setRegistryLoading(true)
    try {
      const resp = await fetch(REGISTRY_URL, { cache: 'no-cache' })
      if (resp.ok) {
        const data = (await resp.json()) as ConnectorRegistry
        if (data.connectors && Array.isArray(data.connectors)) {
          setConnectors(data.connectors)
          setLastRegistryUpdate(data.lastUpdated)
        }
      }
    } catch (err) {
      console.warn('[Connectors] 获取远程连接器列表失败，使用本地备用数据:', err)
    } finally {
      setRegistryLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadRegistry()
    void fetchBridgeStatus()
  }, [loadRegistry, fetchBridgeStatus])

  // 执行 MSI 安装
  const handleInstallMsi = async (item: ConnectorItem) => {
    setInstallingId(item.id)
    setInstallMessage({ text: msg`正在下载并静默安装 ${t(item.name)}...` })

    try {
      if (window.connectorApi?.installMsi) {
        const res = await window.connectorApi.installMsi(item.packageUrl)
        if (res.success) {
          setInstallMessage({ text: res.message || t('安装成功！已自动完成插件注册。') })
        } else {
          setInstallMessage({ text: t('安装失败: ') + (res.message || t('未知错误')), isError: true })
        }
      } else {
        setTimeout(() => {
          setInstallMessage({ text: t('模拟安装完成！') })
          setInstallingId(null)
        }, 1500)
        return
      }
    } catch (err: any) {
      setInstallMessage({ text: t('安装异常: ') + (err?.message || String(err)), isError: true })
    } finally {
      setInstallingId(null)
    }
  }

  const handleDownloadOnly = (item: ConnectorItem) => {
    const fullUrl = `https://sureflow-library.hy3d.space/connectors/${item.packageUrl}`
    window.open(fullUrl, '_blank')
  }

  const isConnected = bridgeStatus.connected && Boolean(bridgeStatus.currentCadType)
  const connectedCadType = bridgeStatus.currentCadType || 'CAD'
  const connectedCadIcon = isConnected ? getCadConnectorIcon(bridgeStatus.currentCadType) : null

  // 分类连接器
  const releasedConnectors = connectors.filter((c) => c.status !== 'COMING_SOON')
  const comingSoonConnectors = connectors.filter((c) => c.status === 'COMING_SOON')

  return (
    <div className="h-full w-full flex overflow-hidden bg-background text-foreground select-none">
      {/* ── 左侧 Tab 导航栏 (紧凑) ── */}
      <aside className="w-44 sm:w-48 border-r border-border bg-card/30 flex flex-col shrink-0 select-none">
        <div className="p-3 border-b border-border/60">
          <h2 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
            {t('连接中心')}
          </h2>
        </div>

        <nav className="p-1.5 space-y-1 flex-1">
          {/* 1. CAD 连接 */}
          <button
            type="button"
            onClick={() => setActiveCategory('cad')}
            className={`w-full flex items-center justify-between p-2 rounded-lg text-left transition-all cursor-pointer ${
              activeCategory === 'cad'
                ? 'bg-primary/10 text-primary font-medium shadow-2xs'
                : 'text-foreground/80 hover:bg-muted/60'
            }`}
          >
            <div className="flex items-center gap-2 min-w-0">
              <Box className="size-3.5 shrink-0 text-primary" />
              <div className="min-w-0">
                <div className="text-xs font-semibold truncate">{t('CAD 连接')}</div>
                <div className="text-[10px] text-muted-foreground truncate">{t('SolidWorks 等')}</div>
              </div>
            </div>
            {isConnected ? (
              <span
                className="size-2 rounded-full bg-emerald-500 animate-pulse shrink-0"
                title={t('已连接')}
              />
            ) : (
              <span className="text-[9px] px-1 py-0.2 rounded bg-muted text-muted-foreground font-mono shrink-0">
                {releasedConnectors.length}
              </span>
            )}
          </button>

          {/* 2. Agent 连接 */}
          <button
            type="button"
            onClick={() => setActiveCategory('agent')}
            className={`w-full flex items-center justify-between p-2 rounded-lg text-left transition-all cursor-pointer ${
              activeCategory === 'agent'
                ? 'bg-primary/10 text-primary font-medium shadow-2xs'
                : 'text-foreground/80 hover:bg-muted/60'
            }`}
          >
            <div className="flex items-center gap-2 min-w-0">
              <Bot className="size-3.5 shrink-0 text-amber-500" />
              <div className="min-w-0">
                <div className="text-xs font-semibold truncate">{t('Agent 连接')}</div>
                <div className="text-[10px] text-muted-foreground truncate">{t('Codex / Claude')}</div>
              </div>
            </div>
            <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-600 dark:text-amber-400 font-medium shrink-0">
              {t('开发中')}
            </span>
          </button>

          {/* 3. 原理图插件 */}
          <button
            type="button"
            onClick={() => setActiveCategory('schematic')}
            className={`w-full flex items-center justify-between p-2 rounded-lg text-left transition-all cursor-pointer ${
              activeCategory === 'schematic'
                ? 'bg-primary/10 text-primary font-medium shadow-2xs'
                : 'text-foreground/80 hover:bg-muted/60'
            }`}
          >
            <div className="flex items-center gap-2 min-w-0">
              <CircuitBoard className="size-3.5 shrink-0 text-sky-500" />
              <div className="min-w-0">
                <div className="text-xs font-semibold truncate">{t('原理图插件')}</div>
                <div className="text-[10px] text-muted-foreground truncate">{t('AutoCAD / 浩辰')}</div>
              </div>
            </div>
            <span className="text-[9px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-medium shrink-0">
              {t('规划中')}
            </span>
          </button>
        </nav>

        {/* 侧边栏底部状态指示 */}
        <div className="p-2.5 border-t border-border/60 text-[10px] text-muted-foreground flex items-center gap-1.5">
          <span
            className={`size-1.5 rounded-full shrink-0 ${
              isConnected ? 'bg-emerald-500 animate-pulse' : 'bg-muted-foreground/40'
            }`}
          />
          <span className="truncate">
            {isConnected ? t('CAD 通道已连接') : t('协同服务就绪')}
          </span>
        </div>
      </aside>

      {/* ── 右侧主内容区域 (紧凑) ── */}
      <main className="flex-1 h-full overflow-y-auto bg-gradient-to-b from-background via-background to-muted/20 p-4 sm:p-6">
        <div className="max-w-3xl mx-auto flex flex-col gap-4">

          {/* ──────────────── TAB 1: CAD 连接 ──────────────── */}
          {activeCategory === 'cad' && (
            <>
              {/* Header 面板头 */}
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pb-3 border-b border-border/60">
                <div className="flex items-center gap-3">
                  <div className="size-9 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0 shadow-2xs">
                    <img
                      src={`${import.meta.env.BASE_URL}connector.svg`}
                      alt={t('CAD 连接器')}
                      className="size-5 object-contain"
                      draggable={false}
                    />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h1 className="text-base font-bold tracking-tight text-foreground">
                        {t('CAD 协同连接器')}
                      </h1>
                      <span className="text-[9px] font-mono px-1.5 py-0.2 bg-primary/10 text-primary border border-primary/20 rounded-full font-medium">
                        {t('官方插件')}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {t('连接主流 3D CAD 建模软件，实现阀块三维几何体与设计数据的双向实时同步')}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      void loadRegistry()
                      void fetchBridgeStatus()
                    }}
                    disabled={registryLoading}
                    className="h-7 gap-1.5 text-xs px-2.5 cursor-pointer"
                  >
                    <RefreshCw className={registryLoading ? 'size-3 animate-spin' : 'size-3'} />
                    <span>{t('刷新列表')}</span>
                  </Button>
                </div>
              </div>

              {/* 状态横幅：实时连接监控 */}
              <div
                className={`rounded-lg border p-3 transition-all shadow-2xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 ${
                  isConnected
                    ? 'bg-emerald-500/5 border-emerald-500/30'
                    : 'bg-card border-border/70'
                }`}
              >
                <div className="flex items-center gap-3">
                  <div
                    className={`size-8 rounded-md flex items-center justify-center shrink-0 border ${
                      isConnected
                        ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-600'
                        : 'bg-muted border-border text-muted-foreground'
                    }`}
                  >
                    {isConnected && connectedCadIcon ? (
                      <img
                        src={`${import.meta.env.BASE_URL}${connectedCadIcon}`}
                        alt={connectedCadType}
                        className="size-5 object-contain"
                        draggable={false}
                      />
                    ) : (
                      <Radio className="size-4" />
                    )}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-foreground">
                        {isConnected
                          ? `${t('已连接')} ${connectedCadType} · ${t('实时协同中')}`
                          : t('CAD 协同服务就绪 · 等待接入')}
                      </span>
                      <span
                        className={`inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.2 rounded-full ${
                          isConnected
                            ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                            : 'bg-muted text-muted-foreground'
                        }`}
                      >
                        <span
                          className={`size-1.5 rounded-full ${
                            isConnected ? 'bg-emerald-500 animate-pulse' : 'bg-muted-foreground/60'
                          }`}
                        />
                        {isConnected ? t('在线协同中') : t('就绪监听中')}
                      </span>
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      {isConnected
                        ? t('阀块三维模型与工程参数正在实时双向同步中')
                        : t('启动 CAD 软件并打开 SureFlow 插件，即可自动建立实时双向同步连接')}
                    </p>
                  </div>
                </div>
              </div>

              {/* 全局提示消息 */}
              {installMessage && (
                <div
                  className={`p-3 rounded-lg text-xs flex items-center justify-between border animate-in fade-in duration-150 ${
                    installMessage.isError
                      ? 'bg-destructive/10 border-destructive/20 text-destructive'
                      : 'bg-primary/10 border-primary/20 text-primary'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    {installMessage.isError ? <AlertCircle className="size-4 shrink-0" /> : <Check className="size-4 shrink-0" />}
                    <span>{installMessage.text}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setInstallMessage(null)}
                    className="text-muted-foreground hover:text-foreground cursor-pointer p-1"
                  >
                    ✕
                  </button>
                </div>
              )}

              {/* 可用官方连接器 (RELEASED - 主展示模块) */}
              <section className="flex flex-col gap-2.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Sparkles className="size-3.5 text-amber-500" />
                    <h2 className="text-xs font-semibold text-foreground">
                      {t('可用官方连接器')}
                    </h2>
                    <span className="text-[10px] font-mono px-1.5 py-0.2 bg-primary/10 text-primary border border-primary/20 rounded-full font-medium">
                      RELEASED
                    </span>
                  </div>
                  {lastRegistryUpdate && (
                    <span className="text-[10px] text-muted-foreground">
                      {t('更新于: ')}{new Date(lastRegistryUpdate).toLocaleDateString()}
                    </span>
                  )}
                </div>

                <div className="flex flex-col">
                  {releasedConnectors.map((item, index) => {
                    const isInstalling = installingId === item.id
                    const iconName = getCadConnectorIcon(item.cadType)
                    const cleanDesc = USER_FRIENDLY_DESCRIPTIONS[item.id] || item.description
                    const highlights = USER_FRIENDLY_HIGHLIGHTS[item.id] || item.changelog || []
                    const supportedVerText = item.id === 'solidworks' ? t('2018 - 最新') : item.supportedCadVersions.join(', ')

                    return (
                      <React.Fragment key={item.id}>
                      <div
                        className="py-4 sm:py-5 flex flex-col md:flex-row gap-4 relative overflow-hidden"
                      >
                        {/* 左侧品牌图标 */}
                        <div className="size-13 rounded-lg bg-gradient-to-br from-red-500/10 via-muted to-muted/80 border border-border flex items-center justify-center shrink-0 shadow-2xs">
                          <img
                            src={`${import.meta.env.BASE_URL}${iconName}`}
                            alt={t(item.name)}
                            className="size-8 object-contain drop-shadow-2xs"
                            draggable={false}
                          />
                        </div>

                        {/* 中间详情介绍 */}
                        <div className="flex-1 flex flex-col gap-2 min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="text-sm font-bold text-foreground">
                              {t(item.name)}
                            </h3>
                            <span className="text-[10px] font-mono px-1.5 py-0.2 bg-muted text-muted-foreground rounded font-medium">
                              v{item.latestVersion}
                            </span>

                          </div>

                          <p className="text-xs text-muted-foreground leading-relaxed">
                            {t(cleanDesc)}
                          </p>

                          {/* 简明规格参数 */}
                          <div className="text-[11px] text-muted-foreground flex flex-wrap gap-x-4 gap-y-1">
                            <span>
                              {t('支持版本: ')}
                              <strong className="text-foreground">{supportedVerText}</strong>
                            </span>
                            <span>
                              {t('平台: ')}
                              <strong className="text-foreground">Windows x64</strong>
                            </span>
                            {item.sizeBytes && (
                              <span>
                                {t('大小: ')}
                                <strong className="text-foreground">{(item.sizeBytes / 1024 / 1024).toFixed(2)} MB</strong>
                              </span>
                            )}
                          </div>

                          {/* 特性要点 */}
                          {highlights.length > 0 && (
                          <div className="pt-2 text-[11px] text-muted-foreground flex flex-wrap gap-x-4 gap-y-1">
                              {highlights.map((log, lidx) => (
                                <div key={lidx} className="flex items-center gap-1.5">
                                  <span className="size-1 rounded-full bg-primary shrink-0" />
                                  <span>{t(log)}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>

                        {/* 右侧动作按钮 (简化为 安装 / 下载) */}
                        <div className="flex md:flex-col justify-end md:justify-center gap-2 shrink-0 border-t md:border-t-0 md:border-l border-border/60 pt-3 md:pt-0 md:pl-4">
                          <button
                            type="button"
                            disabled={isInstalling}
                            onClick={() => handleInstallMsi(item)}
                            className="flex items-center justify-center gap-1.5 px-3.5 py-1.5 bg-primary text-primary-foreground font-semibold text-xs rounded-md hover:bg-primary/90 transition-all shadow-xs disabled:opacity-50 cursor-pointer active:scale-95"
                          >
                            {isInstalling && <RefreshCw className="size-3 animate-spin" />}
                            <span>
                              {isInstalling
                                ? t('正在安装...')
                                : t('安装')}
                            </span>
                          </button>

                          <button
                            type="button"
                            onClick={() => handleDownloadOnly(item)}
                            className="flex items-center justify-center gap-1.5 px-3 py-1.5 bg-muted hover:bg-accent text-foreground text-xs rounded-md transition-colors cursor-pointer border border-border/60"
                            title={t('下载安装包')}
                          >
                            <Download className="size-3 text-muted-foreground" />
                            <span>{t('下载')}</span>
                          </button>
                        </div>
                      </div>
                      {index < releasedConnectors.length - 1 && <Separator />}
                      </React.Fragment>
                    )
                  })}
                </div>
              </section>

              {/* 折叠项 2：规划开发中连接器 (COMING_SOON) */}
              {comingSoonConnectors.length > 0 && (
                <section className="flex flex-col gap-2">
                  <button
                    type="button"
                    onClick={() => setShowMoreCad((v) => !v)}
                    className="w-full flex items-center justify-between py-2 px-3 rounded-lg bg-card/50 hover:bg-card border border-border/60 text-xs transition-colors cursor-pointer"
                  >
                    <div className="flex items-center gap-2">
                      <Layers className="size-3.5 text-muted-foreground" />
                      <span className="font-medium text-foreground">{t('更多 CAD 连接器')}</span>
                      <span className="text-[10px] text-muted-foreground">{t('(Creo / NX 规划中)')}</span>
                    </div>
                    <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                      <span>{showMoreCad ? t('收起') : t('展开')}</span>
                      {showMoreCad ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
                    </div>
                  </button>

                  {showMoreCad && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1 animate-in fade-in duration-150">
                      {comingSoonConnectors.map((item) => {
                        const iconName = getCadConnectorIcon(item.cadType)
                        return (
                          <div
                            key={item.id}
                            className="bg-card/70 border border-border/70 rounded-lg p-3 flex items-center justify-between gap-3 shadow-2xs"
                          >
                            <div className="flex items-center gap-2.5 min-w-0">
                              <div className="size-8 rounded bg-muted/60 border border-border flex items-center justify-center shrink-0">
                                <img
                                  src={`${import.meta.env.BASE_URL}${iconName}`}
                                  alt={item.name}
                                  className="size-5 object-contain opacity-80"
                                  draggable={false}
                                />
                              </div>
                              <div className="min-w-0">
                                <h4 className="text-xs font-semibold text-foreground truncate">
                                  {t(item.name)}
                                </h4>
                                <p className="text-[10px] text-muted-foreground truncate">
                                  {t('目标版本: ')}{item.supportedCadVersions.join(', ')}
                                </p>
                              </div>
                            </div>

                            <span className="text-[9px] font-medium px-1.5 py-0.5 bg-muted text-muted-foreground rounded shrink-0">
                              {t('规划中')}
                            </span>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </section>
              )}

              {/* Footer 安全说明 */}
              <div className="pt-2 border-t border-border/50 flex flex-col sm:flex-row items-center justify-between text-[11px] text-muted-foreground gap-2">
                <div className="flex items-center gap-1.5">
                  <ShieldCheck className="size-3.5 text-emerald-500 shrink-0" />
                  <span>{t('官方认证安装包，安全可靠，支持静默自动安装与版本更新')}</span>
                </div>
              </div>
            </>
          )}

          {/* ──────────────── TAB 2: Agent 连接 (简短介绍) ──────────────── */}
          {activeCategory === 'agent' && (
            <>
              {/* Header 面板头 */}
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pb-3 border-b border-border/60">
                <div className="flex items-center gap-3">
                  <div className="size-9 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center shrink-0 shadow-2xs text-amber-500">
                    <Bot className="size-5" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h1 className="text-base font-bold tracking-tight text-foreground">
                        {t('Agent 连接')}
                      </h1>
                      <span className="text-[9px] font-mono px-1.5 py-0.2 bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 rounded-full font-medium">
                        {t('开发中')}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {t('支持接入主流 AI 智能体，辅助自动化脚本建模与设计校验')}
                    </p>
                  </div>
                </div>
              </div>

              {/* 简短介绍卡片 */}
              <div className="bg-card border border-border rounded-xl p-6 flex flex-col items-center justify-center text-center gap-3 shadow-2xs max-w-lg mx-auto my-4">
                <div className="size-10 rounded-full bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-500">
                  <Sparkles className="size-5" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-foreground">
                    {t('AI Agent 协同通道开发中')}
                  </h3>
                  <p className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto leading-relaxed">
                    {t('功能正在研发中。后期将支持与 Codex、Claude、Workbuddy 等智能体工具双向联动，实现基于 AI 的脚本自动化建模与流道方案设计辅助。')}
                  </p>
                </div>

                <div className="flex flex-wrap items-center justify-center gap-1.5 pt-1">
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-muted border border-border text-muted-foreground font-medium">
                    Codex
                  </span>
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-muted border border-border text-muted-foreground font-medium">
                    Claude
                  </span>
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-muted border border-border text-muted-foreground font-medium">
                    Workbuddy
                  </span>
                </div>
              </div>
            </>
          )}

          {/* ──────────────── TAB 3: 原理图插件 (简短介绍) ──────────────── */}
          {activeCategory === 'schematic' && (
            <>
              {/* Header 面板头 */}
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pb-3 border-b border-border/60">
                <div className="flex items-center gap-3">
                  <div className="size-9 rounded-lg bg-sky-500/10 border border-sky-500/20 flex items-center justify-center shrink-0 shadow-2xs text-sky-500">
                    <CircuitBoard className="size-5" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h1 className="text-base font-bold tracking-tight text-foreground">
                        {t('原理图插件')}
                      </h1>
                      <span className="text-[9px] font-mono px-1.5 py-0.2 bg-muted text-muted-foreground border border-border rounded-full font-medium">
                        {t('规划中')}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {t('预计支持 AutoCAD、浩辰 CAD 与中望 CAD，实现液压原理图与三维阀块的位号映射与流道校验')}
                    </p>
                  </div>
                </div>
              </div>

              {/* 简短介绍卡片 (与 Agent 一致) */}
              <div className="bg-card border border-border rounded-xl p-6 flex flex-col items-center justify-center text-center gap-3 shadow-2xs max-w-lg mx-auto my-4">
                <div className="size-10 rounded-full bg-sky-500/10 border border-sky-500/20 flex items-center justify-center text-sky-500">
                  <CircuitBoard className="size-5" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-foreground">
                    {t('液压原理图插件规划中')}
                  </h3>
                  <p className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto leading-relaxed">
                    {t('预计支持 AutoCAD、浩辰 CAD 与中望 CAD 等主流二维平台，实现原理图符号识别、位号映射以及与三维阀块流道的连通性智能核验。')}
                  </p>
                </div>

                <div className="flex flex-wrap items-center justify-center gap-1.5 pt-1">
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-muted border border-border text-muted-foreground font-medium">
                    AutoCAD
                  </span>
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-muted border border-border text-muted-foreground font-medium">
                    {t('浩辰 CAD (GstarCAD)')}
                  </span>
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-muted border border-border text-muted-foreground font-medium">
                    {t('中望 CAD (ZWCAD)')}
                  </span>
                </div>
              </div>
            </>
          )}

        </div>
      </main>
    </div>
  )
}
