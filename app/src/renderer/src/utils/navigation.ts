export type NavPageKey = 'dashboard' | 'apps' | 'vps' | 'activity' | 'settings'
export type ActivePageKey = NavPageKey | 'deploy' | 'migrate'

/** Chuẩn hóa an toàn activePage lưu trong session (kể cả lịch sử cũ) */
export function resolveActivePage(rawPage: string): ActivePageKey {
  if (rawPage === 'history') return 'activity'
  const validPages: ActivePageKey[] = [
    'dashboard',
    'apps',
    'vps',
    'activity',
    'settings',
    'deploy',
    'migrate'
  ]
  if (validPages.includes(rawPage as ActivePageKey)) {
    return rawPage as ActivePageKey
  }
  return 'apps'
}
