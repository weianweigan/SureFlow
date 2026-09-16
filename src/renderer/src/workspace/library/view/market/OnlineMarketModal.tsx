import { useState, useEffect, useMemo } from 'react'
import {
  X,
  Search,
  RefreshCw,
  Download,
  CheckCircle2,
  AlertCircle,
  Boxes,
  Package,
  Layers,
  ArrowUpCircle
} from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { cn } from '@renderer/lib/utils'
import { useLibraryStore } from '../../viewmodel/libraryStore'
import type {
  OnlinePackageItem,
  InstallProgressEvent
} from '@shared/cavity/registryTypes'
import { t as _t } from '@shared/i18n'
import { useLocale } from '@renderer/i18n/useLocale'

interface OnlineMarketModalProps {
  open: boolean
  onClose: () => void
}

export function OnlineMarketModal({ open, onClose }: OnlineMarketModalProps) {
  useLocale()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [packages, setPackages] = useState<OnlinePackageItem[]>([])
  const [search, setSearch] = useState('')
  const [selectedCategory, setSelectedCategory] = useState<string>('all')

  // 当前正在安装的包ID -> 进度事件
  const [installingMap, setInstallingMap] = useState<Record<string, InstallProgressEvent>>({})

  const loadPackages = async (forceRefresh = false) => {
    setLoading(true)
    setError(null)
    try {
      const list: OnlinePackageItem[] = await window.libraryApi.registryList(forceRefresh)
      setPackages(list)
    } catch (err) {
      setError((err as Error).message || _t('无法获取在线孔腔库列表'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (open) {
      loadPackages()
    }
  }, [open])

  // 监听安装进度事件
  useEffect(() => {
    if (!window.libraryApi?.onRegistryProgress) return
    const unsubscribe = window.libraryApi.onRegistryProgress((evt: InstallProgressEvent) => {
      setInstallingMap((prev) => {
        const next = { ...prev, [evt.packageId]: evt }
        return next
      })

      if (evt.step === 'completed' || evt.step === 'failed') {
        // 安装完成或失败，延迟刷新列表状态
        setTimeout(() => {
          setInstallingMap((prev) => {
            const next = { ...prev }
            delete next[evt.packageId]
            return next
          })
          if (evt.step === 'completed') {
            loadPackages(true)
            // 刷新主面板左侧库列表
            useLibraryStore.getState().init()
          }
        }, 1200)
      }
    })
    return () => unsubscribe()
  }, [])

  // 提取全部非重复分类
  const categories = useMemo(() => {
    const set = new Set<string>()
    packages.forEach((item) => {
      if (item.pkg.category) set.add(item.pkg.category)
    })
    return ['all', ...Array.from(set)]
  }, [packages])

  // 过滤包
  const filteredPackages = useMemo(() => {
    return packages.filter((item) => {
      const matchCat = selectedCategory === 'all' || item.pkg.category === selectedCategory
      const q = search.trim().toLowerCase()
      if (!q) return matchCat

      const matchName = item.pkg.name.toLowerCase().includes(q)
      const matchId = item.pkg.id.toLowerCase().includes(q)
      const matchDesc = item.pkg.description.toLowerCase().includes(q)
      const matchTags = item.pkg.tags?.some((t) => t.toLowerCase().includes(q))
      return matchCat && (matchName || matchId || matchDesc || matchTags)
    })
  }, [packages, search, selectedCategory])

  const handleInstall = async (pkgId: string, version: string) => {
    try {
      await window.libraryApi.registryInstall({ packageId: pkgId, version })
    } catch (err) {
      console.error('Install failed:', err)
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm animate-in fade-in-0 p-3 sm:p-4">
      <div className="relative flex h-[78vh] w-full max-w-3xl flex-col rounded-lg border border-border bg-card shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex h-11 shrink-0 items-center justify-between border-b border-border px-4">
          <div className="flex items-center gap-2">
            <div className="flex size-6 items-center justify-center rounded bg-primary/10 text-primary">
              <Boxes className="size-3.5" />
            </div>
            <div>
              <h2 className="text-xs font-semibold tracking-tight text-foreground flex items-center gap-1.5">
                {_t('官方在线孔腔库市场')}
                <span className="rounded bg-primary/10 px-1.5 py-0.2 text-[9px] font-medium text-primary">
                  {_t('官方源')}
                </span>
              </h2>
            </div>
          </div>
          <div className="flex items-center gap-0.5">
            <Button
              variant="ghost"
              size="icon"
              className="size-7 text-muted-foreground hover:text-foreground"
              onClick={() => loadPackages(true)}
              disabled={loading}
              title={_t('刷新市场')}
            >
              <RefreshCw className={cn('size-3.5', loading && 'animate-spin')} />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-7 text-muted-foreground hover:text-foreground"
              onClick={onClose}
              title={_t('关闭')}
            >
              <X className="size-3.5" />
            </Button>
          </div>
        </div>

        {/* Toolbar: Search + Categories */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-2 border-b border-border bg-muted/20 px-4 py-2">
          <div className="relative w-full sm:w-60">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={_t('搜索孔腔库名称、规格或标签...')}
              className="h-7 pl-7 text-xs bg-background"
            />
          </div>

          {/* Categories Tab */}
          <div className="flex items-center gap-1 overflow-x-auto w-full sm:w-auto pb-0.5 sm:pb-0">
            {categories.map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => setSelectedCategory(cat)}
                className={cn(
                  'rounded px-2 py-0.5 text-[11px] font-medium transition-colors whitespace-nowrap',
                  selectedCategory === cat
                    ? 'bg-primary text-primary-foreground shadow-xs'
                    : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                )}
              >
                {cat === 'all' ? _t('全部库') : cat}
              </button>
            ))}
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-3.5">
          {loading && packages.length === 0 ? (
            <div className="flex h-48 flex-col items-center justify-center gap-2.5 text-muted-foreground">
              <RefreshCw className="size-5 animate-spin text-primary" />
              <p className="text-xs">{_t('正在连接官方在线孔腔源...')}</p>
            </div>
          ) : error ? (
            <div className="flex h-48 flex-col items-center justify-center gap-2 text-center">
              <div className="flex size-8 items-center justify-center rounded-full bg-destructive/10 text-destructive">
                <AlertCircle className="size-4" />
              </div>
              <div>
                <p className="text-xs font-medium text-foreground">{_t('连接在线孔腔库失败')}</p>
                <p className="text-[11px] text-muted-foreground mt-0.5 max-w-sm">{error}</p>
              </div>
              <Button size="sm" variant="outline" className="h-7 mt-1 text-xs" onClick={() => loadPackages(true)}>
                {_t('重试连接')}
              </Button>
            </div>
          ) : filteredPackages.length === 0 ? (
            <div className="flex h-48 flex-col items-center justify-center gap-1.5 text-center text-muted-foreground">
              <Package className="size-7 opacity-40" />
              <p className="text-xs">{_t('未找到匹配的孔腔库')}</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-2.5">
              {filteredPackages.map((item) => {
                const pkg = item.pkg
                const progress = installingMap[pkg.id]
                const isInstalling = Boolean(progress)
                const versionInfo = pkg.versions[pkg.latestVersion]

                return (
                  <div
                    key={pkg.id}
                    className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2.5 rounded-md border border-border bg-card p-2.5 transition-all hover:border-primary/40 hover:shadow-xs"
                  >
                    <div className="flex items-start gap-2.5">
                      <div className="flex size-8 shrink-0 items-center justify-center rounded border border-border bg-muted/40 text-foreground/80">
                        {pkg.iconUrl ? (
                          <img src={pkg.iconUrl} alt={pkg.name} className="size-6 object-contain rounded" />
                        ) : (
                          <Layers className="size-4 text-primary/80" />
                        )}
                      </div>
                      <div className="space-y-0.5">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <h3 className="text-xs font-semibold text-foreground">{pkg.name}</h3>
                          <span className="rounded bg-muted px-1 py-0 text-[9px] font-mono text-muted-foreground">
                            v{pkg.latestVersion}
                          </span>
                          <span className="rounded-full bg-emerald-500/10 px-1.5 py-0 text-[9px] font-medium text-emerald-600 dark:text-emerald-400">
                            {pkg.author}
                          </span>
                        </div>
                        <p className="text-[11px] leading-relaxed text-muted-foreground line-clamp-1 max-w-lg">
                          {pkg.description || _t('暂无详细描述')}
                        </p>
                        <div className="flex flex-wrap items-center gap-2 pt-0.5 text-[10px] text-muted-foreground/80">
                          <span>
                            {_t('孔腔数')}: <strong className="text-foreground">{pkg.templateCount}</strong>
                          </span>
                          {versionInfo && (
                            <>
                              <span>•</span>
                              <span>
                                {_t('大小')}: {(versionInfo.fileSize / 1024 / 1024).toFixed(2)} MB
                              </span>
                              <span>•</span>
                              <span>
                                {_t('发布')}: {versionInfo.releaseDate}
                              </span>
                            </>
                          )}
                          {item.localVersion && (
                            <>
                              <span>•</span>
                              <span className="text-primary/90 font-medium">
                                {_t('已装')}: v{item.localVersion}
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex w-full sm:w-auto shrink-0 flex-col items-end gap-1.5">
                      {isInstalling ? (
                        <div className="w-full sm:w-36 space-y-1 text-right">
                          <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                            <span>
                              {progress.step === 'downloading'
                                ? `${_t('下载中')} ${progress.speedText || ''}`
                                : progress.step === 'verifying'
                                  ? _t('验证完整性...')
                                  : progress.step === 'extracting'
                                    ? _t('解压安装中...')
                                    : progress.step === 'completed'
                                      ? _t('完成！')
                                      : _t('失败')}
                            </span>
                            <span className="font-mono font-medium text-foreground">{progress.percent}%</span>
                          </div>
                          <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
                            <div
                              className="h-full bg-primary transition-all duration-200"
                              style={{ width: `${progress.percent}%` }}
                            />
                          </div>
                        </div>
                      ) : item.status === 'not-installed' ? (
                        <Button
                          size="sm"
                          className="h-7 gap-1 px-2.5 text-xs font-medium"
                          onClick={() => handleInstall(pkg.id, pkg.latestVersion)}
                        >
                          <Download className="size-3" />
                          {_t('一键安装')}
                        </Button>
                      ) : item.status === 'updatable' ? (
                        <Button
                          size="sm"
                          className="h-7 gap-1 px-2.5 text-xs font-medium bg-amber-600 hover:bg-amber-700 text-white"
                          onClick={() => handleInstall(pkg.id, pkg.latestVersion)}
                        >
                          <ArrowUpCircle className="size-3" />
                          {_t('更新至 v')}{pkg.latestVersion}
                        </Button>
                      ) : (
                        <div className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400 text-[11px] font-medium py-1 px-2 rounded bg-emerald-500/10">
                          <CheckCircle2 className="size-3" />
                          {_t('已是最新')}
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex h-8 shrink-0 items-center justify-between border-t border-border bg-muted/15 px-4 text-[10px] text-muted-foreground">
          <span>{_t('已收录 {count} 个官方标准孔腔库').replace('{count}', String(packages.length))}</span>
          <span>{_t('安装后可在“库管理”及“设计”面板直接调用')}</span>
        </div>
      </div>
    </div>
  )
}
