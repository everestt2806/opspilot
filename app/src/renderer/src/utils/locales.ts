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
    dashboard: string
    apps: string
    vps: string
    activity: string
    settings: string
    deploy: string
    deployAction: string
    migrate: string
    history: string
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
      dashboard: 'Tổng quan',
      apps: 'Ứng dụng',
      vps: 'Máy chủ',
      activity: 'Hoạt động',
      settings: 'Cài đặt',
      deploy: 'Triển khai',
      deployAction: '+ Triển khai',
      migrate: 'Di chuyển',
      history: 'Hoạt động'
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
      dashboard: 'Dashboard',
      apps: 'Applications',
      vps: 'Servers',
      activity: 'Activity',
      settings: 'Settings',
      deploy: 'Deploy',
      deployAction: '+ Deploy',
      migrate: 'Migrate',
      history: 'Activity'
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
      dashboard: '总览',
      apps: '应用',
      vps: '服务器',
      activity: '操作动态',
      settings: '系统设置',
      deploy: '部署',
      deployAction: '+ 部署',
      migrate: '迁移',
      history: '操作动态'
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
      dashboard: 'ダッシュボード',
      apps: 'アプリ',
      vps: 'サーバー',
      activity: 'アクティビティ',
      settings: 'システム設定',
      deploy: 'デプロイ',
      deployAction: '+ デプロイ',
      migrate: '移行',
      history: 'アクティビティ'
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
