import posthog from 'posthog-js'

const posthogKey = import.meta.env.VITE_POSTHOG_KEY
const posthogHost = import.meta.env.VITE_POSTHOG_HOST

const isDev = import.meta.env.DEV
const isTest = import.meta.env.MODE === 'test'

if (!isTest && typeof window !== 'undefined') {
  if (!posthogKey) {
    if (isDev) {
      console.warn(
        '[PostHog] VITE_POSTHOG_KEY is not configured in .env. Event tracking is disabled.'
      )
    }
  } else if (!posthogHost) {
    if (isDev) {
      console.warn(
        '[PostHog] VITE_POSTHOG_HOST is not configured in .env. Event tracking is disabled.'
      )
    }
  } else {
    try {
      posthog.init(posthogKey, {
        api_host: posthogHost,
        autocapture: false,
        disable_session_recording: true,
        persistence: 'localStorage',
        // 开发模式下默认 opt-out，彻底阻止任何数据与日志上报远程
        opt_out_capturing_by_default: isDev,
        loaded: (ph) => {
          if (isDev) {
            ph.opt_out_capturing()
          }
        },
        capture_exceptions: {
          // 仅在正式打包/生产环境中上报未捕获崩溃，开发调试报错不上报
          capture_unhandled_errors: !isDev,
          capture_unhandled_rejections: !isDev,
          capture_console_errors: false
        }
      })

      // 开发模式下在控制台友好打印触发的事件，方便本地调试验证
      if (isDev) {
        const rawCapture = posthog.capture.bind(posthog)
        posthog.capture = ((eventName: string, properties?: Record<string, unknown>, options?: any) => {
          console.log(
            `%c[PostHog DEV] ${eventName}`,
            'background: #0f172a; color: #38bdf8; font-weight: bold; padding: 2px 6px; border-radius: 4px;',
            properties ?? {}
          )
          return rawCapture(eventName, properties, options)
        }) as typeof posthog.capture
      }
    } catch (e) {
      console.warn('[PostHog] Failed to initialize:', e)
    }
  }
}

export default posthog
