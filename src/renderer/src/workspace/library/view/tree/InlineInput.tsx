import { useEffect, useRef, useState } from 'react'
import { cn } from '@renderer/lib/utils'

interface InlineInputProps {
  initialValue: string
  onCommit: (val: string) => void
  onCancel: () => void
  className?: string
}

export function InlineInput({ initialValue, onCommit, onCancel, className }: InlineInputProps) {
  const [val, setVal] = useState(initialValue)
  const isCanceledRef = useRef(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    e.stopPropagation()
    if (e.key === 'Enter') {
      e.preventDefault()
      const trimmed = val.trim()
      if (trimmed && trimmed !== initialValue) {
        onCommit(trimmed)
      } else {
        onCancel()
      }
    } else if (e.key === 'Escape') {
      e.preventDefault()
      isCanceledRef.current = true
      onCancel()
    }
  }

  const handleBlur = (): void => {
    if (isCanceledRef.current) return
    const trimmed = val.trim()
    if (trimmed && trimmed !== initialValue) {
      onCommit(trimmed)
    } else {
      onCancel()
    }
  }

  return (
    <input
      ref={inputRef}
      type="text"
      value={val}
      onChange={(e) => setVal(e.target.value)}
      onKeyDown={handleKeyDown}
      onBlur={handleBlur}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      className={cn(
        'h-5 w-full min-w-0 rounded border border-primary bg-background px-1 text-xs text-foreground outline-none ring-1 ring-primary/40',
        className
      )}
    />
  )
}
