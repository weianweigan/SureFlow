import { useLocale as _useLocale } from '@renderer/i18n/useLocale'
import * as React from 'react'
import { cn } from '@renderer/lib/utils'

function Skeleton({ className, ...props }: React.ComponentProps<'div'>) {
  _useLocale()
  return (
    <div
      data-slot="skeleton"
      className={cn('animate-pulse rounded-md bg-muted', className)}
      {...props}
    />
  )
}

export { Skeleton }
