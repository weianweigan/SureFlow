import { useLocale as _useLocale } from '@renderer/i18n/useLocale'
import { t as _t } from '@shared/i18n'
/**
 * 网页内嵌浏览器组件
 * 提供紧凑地址栏、刷新控制以及系统外置浏览器打开
 */
import { useSettingsStore } from '../../settings/settingsStore'
import { FC, useState } from 'react'
import { Globe, RefreshCw, ExternalLink, ArrowRight, Copy, Check } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'

interface WebBrowserViewerProps {
  target: string
}

export const WebBrowserViewer: FC<WebBrowserViewerProps> = ({ target }) => {
  _useLocale()
  const [allowPopups] = useState(() => useSettingsStore.getState().values.webPopups)
  const [currentUrl, setCurrentUrl] = useState<string>(target)
  const [inputUrl, setInputUrl] = useState<string>(target)
  const [key, setKey] = useState<number>(0)
  const [copied, setCopied] = useState<boolean>(false)

  const handleNavigate = (e: React.FormEvent) => {
    e.preventDefault()
    let url = inputUrl.trim()
    if (!url) return
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = `https://${url}`
    }
    setCurrentUrl(url)
    setInputUrl(url)
    setKey((k) => k + 1)
  }

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(currentUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // 忽略
    }
  }

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-background">
      {/* 顶部紧凑地址栏 */}
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border/80 bg-muted/20 px-3">
        <Globe className="size-4 shrink-0 text-blue-500" />

        <form onSubmit={handleNavigate} className="relative flex-1 flex items-center">
          <input
            type="text"
            value={inputUrl}
            onChange={(e) => setInputUrl(e.target.value)}
            placeholder={_t("输入网址 (https://...)")}
            className="h-6 w-full rounded border border-input bg-background px-2 pr-6 text-xs text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
          <button
            type="submit"
            title={_t("跳转")}
            className="absolute right-1 text-muted-foreground hover:text-foreground"
          >
            <ArrowRight className="size-3" />
          </button>
        </form>

        <div className="flex items-center gap-1">
          <Button
            size="icon-sm"
            className="size-6"
            variant="ghost"
            title={_t("刷新")}
            onClick={() => setKey((k) => k + 1)}
          >
            <RefreshCw className="size-3.5" />
          </Button>
          <Button
            size="icon-sm"
            className="size-6"
            variant="ghost"
            title={copied ? _t("已复制") : _t("复制网址")}
            onClick={handleCopy}
          >
            {copied ? <Check className="size-3.5 text-emerald-500" /> : <Copy className="size-3.5" />}
          </Button>
          <Button
            size="icon-sm"
            className="size-6"
            variant="ghost"
            title={_t("在系统浏览器中打开")}
            onClick={() => window.open(currentUrl, '_blank')}
          >
            <ExternalLink className="size-3.5" />
          </Button>
        </div>
      </div>

      {/* 网页渲染容器 */}
      <div className="relative flex-1 min-h-0 w-full bg-white">
        <iframe
          key={key}
          src={currentUrl}
          title={_t("网页浏览")}
          sandbox={`allow-same-origin allow-scripts allow-forms${allowPopups ? ' allow-popups' : ''}`}
          className="h-full w-full border-0"
        />
      </div>
    </div>
  )
}
