import type { OpsPilotApi } from './index'

declare global {
  interface Window {
    api: OpsPilotApi
  }
}
