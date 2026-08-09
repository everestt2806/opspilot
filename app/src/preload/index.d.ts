import type { DeployToolApi } from './index'

declare global {
  interface Window {
    api: DeployToolApi
  }
}
