import type { Locale } from 'antd/es/locale'
import enUS from 'antd/locale/en_US'
import jaJP from 'antd/locale/ja_JP'
import viVN from 'antd/locale/vi_VN'
import zhCN from 'antd/locale/zh_CN'

import type { LocaleMode } from '../store/uiState'

export const ANTD_LOCALES: Record<LocaleMode, Locale> = {
  vi: viVN,
  en: enUS,
  cn: zhCN,
  jp: jaJP
}

export interface LocaleStrings {
  navigation: {
    vps: string
    apps: string
    deploy: string
    dashboard: string
    migrate: string
    history: string
    settings: string
  }
  sections: {
    operations: string
    management: string
  }
  status: {
    ready: string
    local: string
    engine: string
  }
  settings: {
    language: string
    languageDescription: string
  }
}

export const LOCALES: Record<LocaleMode, LocaleStrings> = {
  vi: {
    navigation: {
      vps: 'VPS',
      apps: 'Ứng dụng',
      deploy: 'Triển khai',
      dashboard: 'Tổng quan',
      migrate: 'Di chuyển',
      history: 'Lịch sử',
      settings: 'Cài đặt'
    },
    sections: {
      operations: 'VẬN HÀNH',
      management: 'QUẢN TRỊ'
    },
    status: {
      ready: 'Sẵn sàng',
      local: 'LOCAL',
      engine: 'Local Engine'
    },
    settings: {
      language: 'Ngôn ngữ hiển thị',
      languageDescription: 'Chọn ngôn ngữ giao diện cho hệ thống OpsPilot'
    }
  },
  en: {
    navigation: {
      vps: 'VPS Fleet',
      apps: 'Applications',
      deploy: 'Deploy',
      dashboard: 'Dashboard',
      migrate: 'Migrate',
      history: 'Audit Log',
      settings: 'Settings'
    },
    sections: {
      operations: 'OPERATIONS',
      management: 'MANAGEMENT'
    },
    status: {
      ready: 'Ready',
      local: 'LOCAL',
      engine: 'Local Engine'
    },
    settings: {
      language: 'Display Language',
      languageDescription: 'Select user interface language for OpsPilot'
    }
  },
  cn: {
    navigation: {
      vps: 'VPS 集群',
      apps: '应用程序',
      deploy: '部署服务',
      dashboard: '运行总览',
      migrate: '数据迁移',
      history: '操作历史',
      settings: '系统设置'
    },
    sections: {
      operations: '运行运维',
      management: '系统管理'
    },
    status: {
      ready: '就绪',
      local: 'LOCAL',
      engine: '本地引擎'
    },
    settings: {
      language: '界面语言',
      languageDescription: '选择 OpsPilot 系统显示语言'
    }
  },
  jp: {
    navigation: {
      vps: 'VPS サーバー',
      apps: 'アプリ一覧',
      deploy: 'デプロイ',
      dashboard: 'ダッシュボード',
      migrate: 'サーバー移行',
      history: '操作履歴',
      settings: 'システム設定'
    },
    sections: {
      operations: '運用',
      management: '管理'
    },
    status: {
      ready: '準備完了',
      local: 'LOCAL',
      engine: 'ローカルエンジン'
    },
    settings: {
      language: '表示言語',
      languageDescription: 'OpsPilot の表示言語を選択してください'
    }
  }
}
