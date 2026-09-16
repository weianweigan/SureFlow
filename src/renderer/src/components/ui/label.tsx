import { useLocale as _useLocale } from '@renderer/i18n/useLocale'
import * as React from 'react'
import { cn } from '@renderer/lib/utils'

function Label({ className, ...props }: React.ComponentProps<'label'>) {
  _useLocale()
  return (
    <label
      data-slot="label"
      className={cn(
        'text-[11px] font-medium leading-none text-muted-foreground select-none',
        className
      )}
      {...props}
    />
  )
}

export { Label }
