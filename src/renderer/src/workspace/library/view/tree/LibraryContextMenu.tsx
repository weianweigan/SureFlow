import React, { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronRight } from 'lucide-react'
import { cn } from '@renderer/lib/utils'

export interface ContextMenuItemDef {
  type?: 'item'
  label: string
  icon?: React.ReactNode
  danger?: boolean
  disabled?: boolean
  onClick?: () => void
  children?: {
    label: string
    icon?: React.ReactNode
    onClick: () => void
  }[]
}

export interface ContextMenuSeparatorDef {
  type: 'separator'
}

export type ContextMenuEntry = ContextMenuItemDef | ContextMenuSeparatorDef

interface LibraryContextMenuProps {
  x: number
  y: number
  onClose: () => void
  items: ContextMenuEntry[]
}

export function LibraryContextMenu({ x, y, onClose, items }: LibraryContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ top: y, left: x })
  const [hoveredSubmenu, setHoveredSubmenu] = useState<number | null>(null)

  useEffect(() => {
    const el = menuRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    let left = x
    let top = y
    if (left + rect.width > window.innerWidth - 8) {
      left = Math.max(8, window.innerWidth - rect.width - 8)
    }
    if (top + rect.height > window.innerHeight - 8) {
      top = Math.max(8, window.innerHeight - rect.height - 8)
    }
    setPos({ top, left })
  }, [x, y])

  useEffect(() => {
    const handleMouseDown = (e: MouseEvent): void => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        onClose()
      }
    }
    const handleWheel = (): void => {
      onClose()
    }
    document.addEventListener('mousedown', handleMouseDown, true)
    document.addEventListener('keydown', handleKeyDown, true)
    document.addEventListener('wheel', handleWheel, true)
    return () => {
      document.removeEventListener('mousedown', handleMouseDown, true)
      document.removeEventListener('keydown', handleKeyDown, true)
      document.removeEventListener('wheel', handleWheel, true)
    }
  }, [onClose])

  const menu = (
    <div
      ref={menuRef}
      style={{ top: pos.top, left: pos.left }}
      className="fixed z-[9999] min-w-[160px] rounded-lg border border-border bg-popover/95 p-1 text-xs text-popover-foreground shadow-xl backdrop-blur-md animate-in fade-in zoom-in-95 duration-100"
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((item, idx) => {
        if (item.type === 'separator') {
          return <div key={idx} className="my-1 h-px bg-border/60" />
        }

        const hasSubmenu = Boolean(item.children && item.children.length > 0)
        const isHovered = hoveredSubmenu === idx

        return (
          <div
            key={idx}
            className="relative"
            onMouseEnter={() => {
              if (hasSubmenu) setHoveredSubmenu(idx)
              else setHoveredSubmenu(null)
            }}
          >
            <button
              type="button"
              disabled={item.disabled}
              onClick={(e) => {
                e.stopPropagation()
                if (item.disabled) return
                if (!hasSubmenu && item.onClick) {
                  item.onClick()
                  onClose()
                }
              }}
              className={cn(
                'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors',
                item.danger
                  ? 'text-destructive hover:bg-destructive/10'
                  : 'text-foreground hover:bg-accent hover:text-accent-foreground',
                isHovered && 'bg-accent text-accent-foreground',
                item.disabled && 'pointer-events-none opacity-40'
              )}
            >
              {item.icon && <span className="size-3.5 shrink-0 opacity-80">{item.icon}</span>}
              <span className="flex-1 truncate">{item.label}</span>
              {hasSubmenu && <ChevronRight className="size-3 shrink-0 text-muted-foreground" />}
            </button>

            {hasSubmenu && isHovered && item.children && (
              <div
                className="absolute left-full top-0 -ml-1 min-w-[170px] rounded-lg border border-border bg-popover/95 p-1 text-xs text-popover-foreground shadow-xl backdrop-blur-md animate-in fade-in duration-75"
              >
                {item.children.map((sub, sIdx) => (
                  <button
                    key={sIdx}
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      sub.onClick()
                      onClose()
                    }}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                  >
                    {sub.icon && <span className="size-3.5 shrink-0 opacity-80">{sub.icon}</span>}
                    <span className="flex-1 truncate">{sub.label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )

  return createPortal(menu, document.body)
}
