import { create } from 'zustand'

import type { Vps } from '@shared/ipc'

import type { RowResourceState } from '../vpsResources'

interface VpsStore {
  items: Vps[]
  loading: boolean
  loadError: string | null
  resources: Record<number, RowResourceState | undefined>
  load: () => Promise<void>
  refreshResources: (ids?: number[]) => Promise<void>
}

/** State màn VPS List (dữ liệu từ IPC) — quy ước docs/10 mục 8: state máy chủ để trong store. */
export const useVpsStore = create<VpsStore>((set, get) => ({
  items: [],
  loading: false,
  loadError: null,
  resources: {},

  async load(): Promise<void> {
    set({ loading: true, loadError: null })
    const result = await window.api.invoke('vps:list')
    if (!result.ok) {
      set({ loading: false, loadError: result.error.message })
      return
    }
    set({ loading: false, items: result.data })
    await get().refreshResources(result.data.map((vps) => vps.id))
  },

  async refreshResources(ids?: number[]): Promise<void> {
    const target = ids ?? get().items.map((vps) => vps.id)
    const patch: Record<number, RowResourceState> = {}
    for (const id of target) {
      patch[id] = { status: 'loading' }
    }
    set((state) => ({ resources: { ...state.resources, ...patch } }))

    await Promise.all(
      target.map(async (id) => {
        const result = await window.api.invoke('vps:get-resources', id)
        const entry: RowResourceState = result.ok
          ? { status: 'success', data: result.data }
          : { status: 'error', message: result.error.message }
        set((state) => ({ resources: { ...state.resources, [id]: entry } }))
      })
    )
  }
}))
