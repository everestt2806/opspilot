import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

import type { ThemeMode } from '../utils/themeTokens'

export type PanelTabKey = 'overview' | 'apps' | 'database' | 'activity'

export interface DeployPreselect {
  vpsId: number
  appId?: number
}

/** Trạng thái phiên UI: lưu session người dùng (theme, trang, VPS đang chọn, tab,
 *  bộ lọc) để thoát ra vào lại vẫn khôi phục đúng chỗ cũ. Chỉ lưu *trạng thái UI*
 *  — số liệu (VPS/resources/apps/history) luôn fetch mới khi mở lại. */
interface UiState {
  theme: ThemeMode
  activePage: string
  selectedVpsId: number | null
  activePanelTab: PanelTabKey
  vpsSearch: string
  deployPreselect: DeployPreselect | null
  /** Các VPS người dùng đánh dấu ở cột checkbox Server list — để header chính đếm số máy đang chọn */
  selectedVpsIds: number[]
  setTheme: (theme: ThemeMode) => void
  setActivePage: (page: string) => void
  setSelectedVpsId: (vpsId: number | null) => void
  setActivePanelTab: (tab: PanelTabKey) => void
  setVpsSearch: (search: string) => void
  setDeployPreselect: (preselect: DeployPreselect | null) => void
  setSelectedVpsIds: (ids: number[]) => void
  clearDeployPreselect: () => void
}

export const useUiState = create<UiState>()(
  persist(
    (set) => ({
      theme: 'light',
      activePage: 'vps',
      selectedVpsId: null,
      activePanelTab: 'overview',
      vpsSearch: '',
      deployPreselect: null,
      selectedVpsIds: [],
      setTheme: (theme) => set({ theme }),
      setActivePage: (activePage) => set({ activePage }),
      setSelectedVpsId: (selectedVpsId) => set({ selectedVpsId }),
      setActivePanelTab: (activePanelTab) => set({ activePanelTab }),
      setVpsSearch: (vpsSearch) => set({ vpsSearch }),
      setDeployPreselect: (deployPreselect) => set({ deployPreselect }),
      setSelectedVpsIds: (selectedVpsIds) => set({ selectedVpsIds }),
      clearDeployPreselect: () => set({ deployPreselect: null })
    }),
    {
      name: 'opspilot-ui-session',
      storage: createJSONStorage(() => localStorage)
    }
  )
)
