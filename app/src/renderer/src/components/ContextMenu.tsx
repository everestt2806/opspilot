import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

import { ContextMenuContext, type ContextMenuItem } from './contextMenuContext'

interface MenuState {
  x: number
  y: number
  items: ContextMenuItem[]
}

interface ContextMenuProviderProps {
  children: ReactNode
  fallbackItems?: (selectedText: string) => ContextMenuItem[]
}

export function ContextMenuProvider({
  children,
  fallbackItems
}: ContextMenuProviderProps): React.JSX.Element {
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [coords, setCoords] = useState<{ left: number; top: number }>({ left: 0, top: 0 })
  const menuRef = useRef<HTMLDivElement | null>(null)

  const closeContextMenu = useCallback(() => {
    setMenu(null)
  }, [])

  const openContextMenu = useCallback((event: React.MouseEvent, items: ContextMenuItem[]) => {
    if (event.shiftKey || items.length === 0) return
    event.preventDefault()
    event.stopPropagation()
    setCoords({ left: event.clientX, top: event.clientY })
    setMenu({ x: event.clientX, y: event.clientY, items })
  }, [])

  useLayoutEffect(() => {
    if (!menu || !menuRef.current) return
    const rect = menuRef.current.getBoundingClientRect()
    const pad = 10
    const maxLeft = Math.max(pad, window.innerWidth - rect.width - pad)
    const maxTop = Math.max(pad, window.innerHeight - rect.height - pad)
    setCoords({
      left: Math.min(Math.max(pad, menu.x), maxLeft),
      top: Math.min(Math.max(pad, menu.y), maxTop)
    })
  }, [menu])

  useEffect(() => {
    if (!menu) return
    const handlePointerDown = (event: MouseEvent): void => {
      if (
        menuRef.current &&
        event.target instanceof Node &&
        menuRef.current.contains(event.target)
      ) {
        return
      }
      setMenu(null)
    }
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setMenu(null)
      }
    }
    const handleScrollOrBlur = (): void => setMenu(null)

    window.addEventListener('mousedown', handlePointerDown, true)
    window.addEventListener('keydown', handleKeyDown, true)
    window.addEventListener('blur', handleScrollOrBlur)
    window.addEventListener('resize', handleScrollOrBlur)
    window.addEventListener('scroll', handleScrollOrBlur, true)
    return () => {
      window.removeEventListener('mousedown', handlePointerDown, true)
      window.removeEventListener('keydown', handleKeyDown, true)
      window.removeEventListener('blur', handleScrollOrBlur)
      window.removeEventListener('resize', handleScrollOrBlur)
      window.removeEventListener('scroll', handleScrollOrBlur, true)
    }
  }, [menu])

  const handleRootContextMenu = (event: React.MouseEvent<HTMLDivElement>): void => {
    if (event.shiftKey || event.defaultPrevented || !fallbackItems) return
    const target = event.target as HTMLElement | null
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) {
      return
    }
    const selectedText = window.getSelection?.()?.toString().trim() ?? ''
    const items = fallbackItems(selectedText)
    if (items.length === 0) return
    openContextMenu(event, items)
  }

  return (
    <ContextMenuContext.Provider value={{ openContextMenu, closeContextMenu }}>
      <div className="app-context-root" onContextMenu={handleRootContextMenu}>
        {children}
      </div>
      {menu &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            className="desktop-context-menu"
            style={{ left: coords.left, top: coords.top }}
            onContextMenu={(e) => e.preventDefault()}
          >
            {menu.items.map((item) => {
              if (item.type === 'divider') {
                return <div key={item.key} role="separator" className="desktop-context-divider" />
              }
              return (
                <button
                  key={item.key}
                  type="button"
                  role="menuitem"
                  disabled={item.disabled}
                  className={`desktop-context-item${item.danger ? ' desktop-context-item-danger' : ''}`}
                  onClick={() => {
                    if (item.disabled) return
                    setMenu(null)
                    item.onClick()
                  }}
                >
                  <span className="desktop-context-item-icon">{item.icon}</span>
                  <span className="desktop-context-item-label">{item.label}</span>
                  {item.shortcut && (
                    <span className="desktop-context-item-shortcut">{item.shortcut}</span>
                  )}
                </button>
              )
            })}
          </div>,
          document.body
        )}
    </ContextMenuContext.Provider>
  )
}
