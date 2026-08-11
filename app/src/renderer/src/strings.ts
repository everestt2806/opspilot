export const strings = {
  app: {
    name: 'OpsPilot',
    noSelection: 'Chưa chọn VPS / ứng dụng'
  },
  navigation: {
    vps: 'VPS',
    apps: 'Ứng dụng',
    deploy: 'Deploy',
    dashboard: 'Dashboard',
    migrate: 'Migrate',
    history: 'Lịch sử',
    settings: 'Cài đặt'
  },
  status: {
    ssh: 'SSH',
    mlService: 'ML service',
    running: 'Đang chạy',
    stopped: 'Đã dừng',
    unknown: 'Chưa kết nối'
  },
  common: {
    cancel: 'Huỷ',
    notAvailable: 'Chưa có',
    refresh: 'Làm mới',
    retry: 'Thử lại',
    save: 'Lưu'
  },
  vps: {
    title: 'Danh sách VPS',
    description: 'Quản lý thông tin kết nối và trạng thái các máy chủ.',
    create: 'Thêm VPS',
    createFirst: 'Thêm VPS đầu tiên',
    empty: 'Chưa có VPS nào. Thêm VPS đầu tiên để bắt đầu deploy.',
    loadError: 'Không tải được danh sách VPS',
    columns: {
      name: 'Tên',
      host: 'Host',
      status: 'Trạng thái',
      provider: 'Provider / region',
      actions: 'Hành động'
    },
    status: {
      online: 'Online',
      offline: 'Offline',
      unknown: 'Chưa kiểm tra'
    },
    actions: {
      edit: (name: string) => `Sửa VPS ${name}`,
      delete: (name: string) => `Xoá VPS ${name}`
    },
    delete: {
      title: 'Xoá VPS?',
      description: (name: string) =>
        `VPS “${name}” sẽ bị xoá khỏi OpsPilot. Ứng dụng đang chạy trên máy chủ không bị xoá.`,
      confirm: 'Xoá VPS'
    },
    fields: {
      name: 'Tên VPS',
      host: 'Host hoặc IP',
      port: 'Cổng SSH',
      username: 'Username',
      authType: 'Cách xác thực',
      privateKey: 'Private key',
      password: 'Password',
      provider: 'Provider',
      region: 'Region'
    },
    authType: {
      key: 'SSH key',
      password: 'Password'
    },
    form: {
      createTitle: 'Thêm VPS',
      editTitle: 'Sửa VPS',
      hostPlaceholder: '203.0.113.10',
      keepCredentialHint: 'Để trống nếu muốn giữ credential hiện tại.'
    },
    validation: {
      name: 'Nhập tên VPS.',
      host: 'Nhập host hoặc địa chỉ IP.',
      port: 'Nhập cổng SSH từ 1 đến 65535.',
      username: 'Nhập username SSH.',
      privateKey: 'Dán private key SSH.',
      password: 'Nhập password SSH.'
    }
  }
} as const
