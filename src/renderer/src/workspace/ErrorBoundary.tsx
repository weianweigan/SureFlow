import { t as _t } from '@shared/i18n'
/**
 * 面板级错误边界：防止单个面板渲染异常导致整个应用白屏。
 *
 * 捕获后显示错误信息 + 重置按钮，不吞掉异常（打印到控制台便于定位）。
 */

import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
  /** 出错时显示的上下文（如「库管理」） */
  label?: string
}

interface State {
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // 不吞异常：输出到控制台供调试
    console.error(`[ErrorBoundary${this.props.label ? ` · ${this.props.label}` : ''}]`, error, info.componentStack)
  }

  private reset = (): void => this.setState({ error: null })

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div className="flex h-full w-full flex-col items-center justify-center gap-3 bg-background p-6 text-center">
          <p className="text-sm font-medium text-foreground">
            {this.props.label ?? _t("面板")} {_t("渲染出错")}</p>
          <pre className="max-h-40 max-w-md overflow-auto rounded-md border border-border bg-muted/40 p-3 text-left text-[11px] leading-relaxed text-destructive">
            {this.state.error.message}
          </pre>
          <button
            type="button"
            onClick={this.reset}
            className="h-7 rounded-md border border-input bg-background px-3 text-xs font-medium hover:bg-accent"
          >
            {_t("重试")}</button>
        </div>
      )
    }
    return this.props.children
  }
}
