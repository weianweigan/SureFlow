import React, { useState, useEffect, useCallback } from 'react'
import {
  Layers,
  Zap,
  Download,
  CheckCircle2,
  RefreshCw,
  ShieldCheck,
  Cpu,
  Monitor,
  Check,
  AlertCircle,
  Sparkles,
  Radio
} from 'lucide-react'
import { useLocale as _useLocale } from '@renderer/i18n/useLocale'
import { t } from '@shared/i18n'
import type {
  ConnectorItem,
  ConnectorRegistry,
  DetectedCadSoftware,
  CadDetectionResponse
} from '@shared/cad/cadBridgeTypes'
import { useCadBridgeStore } from '../connectors/cadBridgeStatusStore'
import { getCadConnectorIcon } from '@shared/cad/cadProjectLookup'
import { Button } from '@renderer/components/ui/button'

const REGISTRY_URL = 'https://sureflow-library.hy3d.space/connectors/connector-registry.json'

const FALLBACK_REGISTRY: ConnectorItem[] = [
  {
    id: 'solidworks',
    name: 'SolidWorks 协同连接器',
    cadType: 'SOLIDWORKS',
    vendor: 'SureFlow 官方团队',
    icon: 'solidworks',
    description: '提供 SolidWorks 2018 - 2026 全版本双向协同、零件内嵌设计与实体实时切削。',
    supportedCadVersions: ['2018', '2019', '2020', '2021', '2022', '2023', '2024', '2025', '2026'],
    platform: 'win32-x64',
    latestVersion: '1.0.0',
    releaseDate: '2026-09-24',
    packageUrl: 'packages/solidworks/1.0.0/SureFlow-SolidWorks-Connector-1.0.0.msi',
    sha256: '816409291d760e0d351e9b78137225637309ab711c3269765f4db9e5cf26e832',
    sizeBytes: 3330048,
    changelog: [
      '首发版本：支持 SolidWorks 2018-2026 零件级双向协同',
      '支持 xCAD 原生宏特征 (SureFlow Manifold) 与 PMP 属性面板',
      '支持 OLE 3rd Party Storage 原生内嵌 .sfb 文件',
      '支持 AP214 STEP 高精实体一键同步与几何体替换'
    ],
    status: 'RELEASED'
  },
  {
    id: 'creo',
    name: 'PTC Creo 协同连接器',
    cadType: 'CREO',
    vendor: 'SureFlow 官方团队',
    icon: 'creo',
    description: '针对 PTC Creo Parametric 7.0 - 11.0 的双向连接器插件。',
    supportedCadVersions: ['7.0', '8.0', '9.0', '10.0', '11.0'],
    platform: 'win32-x64',
    latestVersion: '0.5.0-beta',
    releaseDate: '2026-10-15',
    packageUrl: 'packages/creo/0.5.0-beta/SureFlow-Creo-Connector-0.5.0-beta.msi',
    changelog: ['二期开发规划中，基于 Creo Toolkit / .NET 原生开发'],
    status: 'COMING_SOON'
  },
  {
    id: 'nx',
    name: 'Siemens UG/NX 协同连接器',
    cadType: 'NX',
    vendor: 'SureFlow 官方团队',
    icon: 'nx',
    description: '针对 Siemens NX 1980+ 系列的原生 Open API 协同连接器。',
    supportedCadVersions: ['NX 1980+', 'NX 2007+', 'NX 2206+', 'NX 2306+'],
    platform: 'win32-x64',
    latestVersion: '0.1.0-alpha',
    releaseDate: '2026-11-20',
    packageUrl: 'packages/nx/0.1.0-alpha/SureFlow-NX-Connector-0.1.0-alpha.msi',
    changelog: ['三期开发规划中，基于 NXOpen .NET C# 原生开发'],
    status: 'COMING_SOON'
  }
]

export default function ConnectorsTabPanel(): React.ReactElement {
  _useLocale()
  const bridgeStatus = useCadBridgeStore((s) => s.status)
  const fetchBridgeStatus = useCadBridgeStore((s) => s.fetchStatus)

  const [connectors, setConnectors] = useState<ConnectorItem[]>(FALLBACK_REGISTRY)
  const [registryLoading, setRegistryLoading] = useState(false)
  const [lastRegistryUpdate, setLastRegistryUpdate] = useState<string | null>(null)

  const [installedList, setInstalledList] = useState<DetectedCadSoftware[]>([])
  const [detectedMap, setDetectedMap] = useState<Record<string, { installed: boolean; version?: string; connectorInstalled?: boolean }>>({})
  const [isDetecting, setIsDetecting] = useState(false)

  const [installingId, setInstallingId] = useState<string | null>(null)
  const [installMessage, setInstallMessage] = useState<{ text: string; isError?: boolean } | null>(null)

  // 1. 获取远程对象存储注册表真实数据
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

  // 2. 检测本地 CAD 软件
  const runCadDetection = useCallback(async () => {
    setIsDetecting(true)
    try {
      if (window.connectorApi?.detectCad) {
        const res = (await window.connectorApi.detectCad()) as CadDetectionResponse
        if (res && res.detectedMap) {
          setDetectedMap(res.detectedMap)
          setInstalledList(res.installedList || [])
        } else if (res && typeof res === 'object') {
          // 兼容旧格式 Record<string, { installed, version }>
          setDetectedMap(res as any)
        }
      }
    } catch (err) {
      console.warn('[Connectors] 本地 CAD 软件检测失败:', err)
    } finally {
      setIsDetecting(false)
    }
  }, [])

  useEffect(() => {
    void loadRegistry()
    void runCadDetection()
    void fetchBridgeStatus()
  }, [loadRegistry, runCadDetection, fetchBridgeStatus])

  // 执行 MSI 安装
  const handleInstallMsi = async (item: ConnectorItem) => {
    setInstallingId(item.id)
    setInstallMessage({ text: t('正在下载并静默安装 ') + item.name + '...' })

    try {
      if (window.connectorApi?.installMsi) {
        const res = await window.connectorApi.installMsi(item.packageUrl)
        if (res.success) {
          setInstallMessage({ text: res.message || t('安装成功！已自动完成 SolidWorks AddIn 注册。') })
          // 重新检测以更新状态
          await runCadDetection()
        } else {
          setInstallMessage({ text: t('安装失败: ') + (res.message || t('未知错误')), isError: true })
        }
      } else {
        // 演示环境
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
    <div className="h-full w-full overflow-y-auto bg-gradient-to-b from-background via-background to-muted/20 text-foreground p-6 sm:p-8 select-none">
      <div className="max-w-5xl mx-auto flex flex-col gap-6">
        {/* Header 面板头 */}
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 pb-4 border-b border-border/60">
          <div className="flex items-center gap-3.5">
            <div className="size-11 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0 shadow-sm">
              <img
                src={`${import.meta.env.BASE_URL}connector.svg`}
                alt={t('CAD 连接器')}
                className="size-6 object-contain"
                draggable={false}
              />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold tracking-tight text-foreground">
                  {t('CAD 协同连接器插件中心')}
                </h1>
                <span className="text-[10px] font-mono px-2 py-0.5 bg-primary/10 text-primary border border-primary/20 rounded-full font-medium">
                  {t('官方插件分发')}
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                {t('基于 WebSocket 双向长连接，将 SureFlow 原生嵌入 SolidWorks、Creo 与 UG/NX，实现零件级三维几何与阀块工程的双向实时同步')}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 self-stretch md:self-auto justify-end">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                void loadRegistry()
                void runCadDetection()
                void fetchBridgeStatus()
              }}
              disabled={isDetecting || registryLoading}
              className="h-8 gap-1.5 text-xs cursor-pointer"
            >
              <RefreshCw className={isDetecting || registryLoading ? 'size-3.5 animate-spin' : 'size-3.5'} />
              <span>{t('刷新检测')}</span>
            </Button>
          </div>
        </div>

        {/* 状态横幅：实时长连接监控 */}
        <div
          className={`rounded-xl border p-4.5 transition-all shadow-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 ${
            isConnected
              ? 'bg-emerald-500/5 border-emerald-500/30'
              : 'bg-card border-border/70'
          }`}
        >
          <div className="flex items-center gap-3.5">
            <div
              className={`size-10 rounded-lg flex items-center justify-center shrink-0 border ${
                isConnected
                  ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-600'
                  : 'bg-muted border-border text-muted-foreground'
              }`}
            >
              {isConnected && connectedCadIcon ? (
                <img
                  src={`${import.meta.env.BASE_URL}${connectedCadIcon}`}
                  alt={connectedCadType}
                  className="size-6 object-contain"
                  draggable={false}
                />
              ) : (
                <Radio className="size-5" />
              )}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-foreground">
                  {isConnected
                    ? t('已连接 ') + connectedCadType + t(' · 实时协同中')
                    : t('WebSocket 协同桥接就绪 · 等待宿主 CAD 接入')}
                </span>
                <span
                  className={`inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full ${
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
                  {isConnected ? t('在线通信中') : t('监听中')}
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                {isConnected
                  ? t('正在通过端口 ') + bridgeStatus.port + t(' 保持零件工程双向同步，关联工程数: ') + bridgeStatus.activeProjects
                  : t('桥接服务在端口 ') + bridgeStatus.port + t(' 运行，打开 CAD 并启用 SureFlow 插件后将自动握手建立长连接')}
              </p>
            </div>
          </div>

          <div className="text-right shrink-0">
            <span className="text-[11px] font-mono text-muted-foreground">
              {t('桥接端口')}: <strong className="text-foreground">{bridgeStatus.port}</strong>
            </span>
          </div>
        </div>

        {/* 全局提示消息 */}
        {installMessage && (
          <div
            className={`p-3.5 rounded-lg text-xs flex items-center justify-between border animate-in fade-in duration-150 ${
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

        {/* 模块 1：本地已安装的 CAD 软件环境列表 */}
        <section className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Monitor className="size-4 text-primary" />
              <h2 className="text-sm font-semibold text-foreground">
                {t('本地已安装的 CAD 软件环境')}
              </h2>
              <span className="text-[11px] font-mono px-2 py-0.5 bg-muted text-muted-foreground rounded-full">
                {installedList.length > 0
                  ? t('已检测到 ') + installedList.length + t(' 款 CAD')
                  : isDetecting
                  ? t('检测中...')
                  : t('未检测到主程序')}
              </span>
            </div>
          </div>

          {installedList.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
              {installedList.map((cad, idx) => {
                const iconName = getCadConnectorIcon(cad.cadType)
                const isConnectorInstalled =
                  cad.connectorInstalled || detectedMap[cad.id]?.connectorInstalled || false
                const isCurrentlyActiveCad = isConnected && bridgeStatus.currentCadType === cad.cadType

                return (
                  <div
                    key={`${cad.id}-${idx}`}
                    className={`bg-card border rounded-xl p-4 flex items-start gap-3.5 transition-all shadow-xs hover:border-border/90 ${
                      isCurrentlyActiveCad
                        ? 'border-emerald-500/50 bg-emerald-500/5 ring-1 ring-emerald-500/20'
                        : 'border-border'
                    }`}
                  >
                    <div className="size-10 rounded-lg bg-muted/70 border border-border flex items-center justify-center shrink-0">
                      <img
                        src={`${import.meta.env.BASE_URL}${iconName}`}
                        alt={cad.name}
                        className="size-6 object-contain"
                        draggable={false}
                      />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <h3 className="text-xs font-semibold text-foreground truncate" title={cad.name}>
                          {cad.name}
                        </h3>
                      </div>
                      <p className="text-[11px] font-mono text-muted-foreground truncate mt-0.5">
                        {t('版本: ')}{cad.version || t('已就绪')}
                      </p>

                      <div className="mt-2.5 flex items-center gap-1.5 flex-wrap">
                        {isCurrentlyActiveCad ? (
                          <span className="inline-flex items-center gap-1 text-[10px] font-medium text-emerald-600 bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20">
                            <span className="size-1 rounded-full bg-emerald-500 animate-pulse" />
                            {t('实时协同在线')}
                          </span>
                        ) : isConnectorInstalled ? (
                          <span className="inline-flex items-center gap-1 text-[10px] font-medium text-emerald-600 bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20">
                            <CheckCircle2 className="size-3" />
                            {t('插件已安装')}
                          </span>
                        ) : cad.connectorSupported ? (
                          <span className="inline-flex items-center text-[10px] font-medium text-primary bg-primary/10 px-2 py-0.5 rounded-full border border-primary/20">
                            {t('宿主就绪 · 可装插件')}
                          </span>
                        ) : (
                          <span className="inline-flex items-center text-[10px] font-medium text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                            {t('插件规划开发中')}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="bg-card border border-border rounded-xl p-5 text-center flex flex-col items-center justify-center gap-2">
              <Cpu className="size-6 text-muted-foreground/60" />
              <p className="text-xs text-muted-foreground">
                {isDetecting
                  ? t('正在扫描本地注册表与 CAD 安装环境...')
                  : t('未在常见安装路径或注册表中扫描到 SolidWorks / NX / Creo。若您已安装，可直接进行连接器安装。')}
              </p>
            </div>
          )}
        </section>

        {/* 模块 2：可用官方连接器 (RELEASED) */}
        <section className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sparkles className="size-4 text-amber-500" />
              <h2 className="text-sm font-semibold text-foreground">
                {t('可用官方连接器')}
              </h2>
              <span className="text-[11px] font-mono px-2 py-0.5 bg-primary/10 text-primary border border-primary/20 rounded-full font-medium">
                RELEASED
              </span>
            </div>
            {lastRegistryUpdate && (
              <span className="text-[11px] text-muted-foreground">
                {t('元数据更新于: ')}{new Date(lastRegistryUpdate).toLocaleDateString()}
              </span>
            )}
          </div>

          <div className="flex flex-col gap-4">
            {releasedConnectors.map((item) => {
              const detectedInfo = detectedMap[item.id]
              const isConnectorInstalledLocally =
                detectedInfo?.connectorInstalled || false
              const isInstalling = installingId === item.id
              const iconName = getCadConnectorIcon(item.cadType)

              return (
                <div
                  key={item.id}
                  className="bg-card border border-border rounded-xl p-5 sm:p-6 flex flex-col md:flex-row gap-6 shadow-sm hover:border-border/90 transition-all relative overflow-hidden"
                >
                  {/* 左侧品牌图标 */}
                  <div className="size-16 rounded-xl bg-gradient-to-br from-red-500/10 via-muted to-muted/80 border border-border flex items-center justify-center shrink-0 shadow-xs">
                    <img
                      src={`${import.meta.env.BASE_URL}${iconName}`}
                      alt={item.name}
                      className="size-10 object-contain drop-shadow-xs"
                      draggable={false}
                    />
                  </div>

                  {/* 中间详情介绍 */}
                  <div className="flex-1 flex flex-col gap-2.5 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-base font-bold text-foreground">
                        {item.name}
                      </h3>
                      <span className="text-[11px] font-mono px-2 py-0.5 bg-muted text-muted-foreground rounded font-medium">
                        v{item.latestVersion}
                      </span>

                      {isConnectorInstalledLocally ? (
                        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-600 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-full">
                          <CheckCircle2 className="size-3" />
                          {t('本机已安装')}
                        </span>
                      ) : (
                        <span className="inline-flex items-center text-[11px] font-medium text-primary bg-primary/10 border border-primary/20 px-2 py-0.5 rounded-full">
                          {t('就绪可安装')}
                        </span>
                      )}

                      {detectedInfo?.installed && (
                        <span className="text-[10px] font-medium text-sky-600 dark:text-sky-400 bg-sky-500/10 border border-sky-500/20 px-2 py-0.5 rounded">
                          {t('宿主环境: ')}{detectedInfo.version || t('已就绪')}
                        </span>
                      )}
                    </div>

                    <p className="text-xs text-muted-foreground leading-relaxed">
                      {item.description}
                    </p>

                    {/* 规格参数 */}
                    <div className="text-[11px] text-muted-foreground flex flex-wrap gap-x-4 gap-y-1.5 pt-1">
                      <span>
                        {t('支持宿主版本: ')}
                        <strong className="text-foreground">{item.supportedCadVersions.join(', ')}</strong>
                      </span>
                      <span>
                        {t('架构: ')}
                        <strong className="text-foreground">{item.platform}</strong>
                      </span>
                      {item.sizeBytes && (
                        <span>
                          {t('体积: ')}
                          <strong className="text-foreground">{(item.sizeBytes / 1024 / 1024).toFixed(2)} MB</strong>
                        </span>
                      )}
                      {item.sha256 && (
                        <span title={`SHA-256: ${item.sha256}`}>
                          {t('SHA-256: ')}
                          <code className="text-foreground font-mono text-[10px]">
                            {item.sha256.slice(0, 8)}...{item.sha256.slice(-6)}
                          </code>
                        </span>
                      )}
                    </div>

                    {/* Changelog 特性高光预览 */}
                    {item.changelog && item.changelog.length > 0 && (
                      <div className="mt-1 pt-2.5 border-t border-border/50 text-[11px] text-muted-foreground flex flex-col gap-1">
                        <span className="font-semibold text-foreground/80">{t('版本特性与集成亮点:')}</span>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                          {item.changelog.map((log, lidx) => (
                            <div key={lidx} className="flex items-center gap-1.5 truncate">
                              <span className="size-1 rounded-full bg-primary shrink-0" />
                              <span className="truncate">{log}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* 右侧动作按钮 */}
                  <div className="flex md:flex-col justify-end md:justify-center gap-2.5 shrink-0 border-t md:border-t-0 md:border-l border-border/60 pt-4 md:pt-0 md:pl-6">
                    <button
                      type="button"
                      disabled={isInstalling}
                      onClick={() => handleInstallMsi(item)}
                      className="flex items-center justify-center gap-1.5 px-4 py-2 bg-primary text-primary-foreground font-semibold text-xs rounded-lg hover:bg-primary/90 transition-all shadow-sm disabled:opacity-50 cursor-pointer active:scale-95"
                    >
                      {isInstalling ? (
                        <RefreshCw className="size-3.5 animate-spin" />
                      ) : (
                        <Zap className="size-3.5 fill-current" />
                      )}
                      <span>
                        {isInstalling
                          ? t('正在安装...')
                          : isConnectorInstalledLocally
                          ? t('重新安装插件')
                          : t('⚡ 一键自动安装')}
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleDownloadOnly(item)}
                      className="flex items-center justify-center gap-1.5 px-3 py-1.5 bg-muted hover:bg-accent text-foreground text-xs rounded-lg transition-colors cursor-pointer border border-border/60"
                      title={t('直接从对象存储下载 .msi 安装包')}
                    >
                      <Download className="size-3.5 text-muted-foreground" />
                      <span>{t('下载 MSI 安装包')}</span>
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </section>

        {/* 模块 3：规划开发中连接器 (COMING_SOON - 精简紧凑，不多做过多介绍) */}
        {comingSoonConnectors.length > 0 && (
          <section className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Layers className="size-4 text-muted-foreground" />
                <h2 className="text-sm font-semibold text-foreground">
                  {t('研发规划中连接器')}
                </h2>
                <span className="text-[11px] text-muted-foreground">
                  {t('(二/三期研发进行中)')}
                </span>
              </div>
            </div>

            {/* 精简紧凑的横向卡片列表，不展示繁冗的介绍 */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              {comingSoonConnectors.map((item) => {
                const iconName = getCadConnectorIcon(item.cadType)
                return (
                  <div
                    key={item.id}
                    className="bg-card/70 border border-border/70 rounded-xl p-3.5 flex items-center justify-between gap-3 shadow-xs"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="size-10 rounded-lg bg-muted/60 border border-border flex items-center justify-center shrink-0">
                        <img
                          src={`${import.meta.env.BASE_URL}${iconName}`}
                          alt={item.name}
                          className="size-6 object-contain opacity-80"
                          draggable={false}
                        />
                      </div>
                      <div className="min-w-0">
                        <h4 className="text-xs font-semibold text-foreground truncate">
                          {item.name}
                        </h4>
                        <p className="text-[11px] text-muted-foreground truncate">
                          {t('目标支持: ')}{item.supportedCadVersions.join(', ')}
                        </p>
                      </div>
                    </div>

                    <span className="text-[10px] font-medium px-2 py-1 bg-muted text-muted-foreground rounded shrink-0">
                      {t('规划中')}
                    </span>
                  </div>
                )
              })}
            </div>
          </section>
        )}

        {/* Footer 安全与构建说明 */}
        <div className="pt-4 border-t border-border/50 flex flex-col sm:flex-row items-center justify-between text-xs text-muted-foreground gap-2">
          <div className="flex items-center gap-2">
            <ShieldCheck className="size-4 text-emerald-500 shrink-0" />
            <span>{t('所有 MSI 安装包均由官方 WixSharp 流水线编译构建，并附带 SHA-256 完整性校验')}</span>
          </div>
          <span className="text-[11px]">SureFlow CAD Integration Protocol · v1.2</span>
        </div>
      </div>
    </div>
  )
}
