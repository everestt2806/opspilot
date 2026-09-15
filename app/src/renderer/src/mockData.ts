/** Dữ liệu mẫu cho trang Apps (danh sách app còn đang dùng mock, sẽ nối IPC thật sau). */

export interface ProjectItem {
  id: string
  name: string
  framework: string
  currentVersion: string
  vpsHost: string
  status: 'online' | 'offline' | 'deploying'
  lastDeployedAt: string
}

export const mockProjects: ProjectItem[] = [
  {
    id: 'proj-1',
    name: 'e-commerce-backend',
    framework: 'Node.js / Express',
    currentVersion: 'v2.1.0',
    vpsHost: '192.168.1.10',
    status: 'online',
    lastDeployedAt: '10 minutes ago'
  },
  {
    id: 'proj-2',
    name: 'react-admin-dashboard',
    framework: 'React / Vite',
    currentVersion: 'v1.4.2',
    vpsHost: '192.168.1.10',
    status: 'online',
    lastDeployedAt: '2 hours ago'
  },
  {
    id: 'proj-3',
    name: 'python-ml-analytics',
    framework: 'Python / FastApi',
    currentVersion: 'v0.9.1',
    vpsHost: '192.168.1.12',
    status: 'offline',
    lastDeployedAt: '1 day ago'
  }
]
