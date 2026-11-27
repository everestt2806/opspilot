import { createContext, useContext, type ReactNode } from 'react'

export type ContextMenuItem =
  | {
      type: 'divider'
      key: string
    }
  | {
      type?: 'item'
      key: string
      label: string
      icon?: ReactNode
      shortcut?: string
      danger?: boolean
      disabled?: boolean
      onClick: () => void
    }

export interface ContextMenuApi {
  openContextMenu: (event: React.MouseEvent, items: ContextMenuItem[]) => void
  closeContextMenu: () => void
}

export const ContextMenuContext = createContext<ContextMenuApi>({
  openContextMenu: () => undefined,
  closeContextMenu: () => undefined
})

export function useContextMenu(): ContextMenuApi {
  return useContext(ContextMenuContext)
}
