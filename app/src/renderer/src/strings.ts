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
    save: 'Lưu',
    saveError: 'Không lưu được VPS'
  },
  vps: {
    title: 'Danh sách VPS',
    description: 'Quản lý thông tin kết nối và trạng thái các máy chủ.',
    create: 'Thêm VPS',
    createFirst: 'Thêm VPS đầu tiên',
    empty: 'Chưa có VPS nào. Thêm VPS đầu tiên để bắt đầu deploy.',
    loadError: 'Không tải được danh sách VPS',
    checkResources: 'Kiểm tra lại',
    columns: {
      name: 'Tên',
      host: 'Host',
      status: 'Trạng thái',
      resources: 'CPU / RAM / Disk',
      provider: 'Provider / region',
      actions: 'Hành động'
    },
    status: {
      online: 'Online',
      offline: 'Offline',
      unknown: 'Chưa kiểm tra',
      checking: 'Đang kiểm tra'
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
      password: 'Nhập password SSH.',
      incomplete: 'Nhập đầy đủ thông tin trước khi kiểm tra.'
    },
    check: {
      button: 'Kiểm tra kết nối',
      retry: 'Kiểm tra lại',
      idleHint:
        'Nhập thông tin rồi bấm kiểm tra — app sẽ thử kết nối SSH và chỉ ra nguyên nhân kèm cách sửa nếu lỗi.',
      checking: 'Đang kiểm tra kết nối…',
      needCredential: 'App không đọc lại credential đã lưu. Nhập credential rồi bấm kiểm tra lại.',
      success: 'Kết nối thành công',
      successHint: 'Các bước đã kiểm tra trên máy chủ:',
      dockerMissing: 'Máy chủ chưa cài Docker',
      dockerMissingHint:
        'OpsPilot cần Docker để deploy ứng dụng. Cài Docker rồi bấm “Kiểm tra lại”.',
      workdirFail: 'Chưa ghi được thư mục làm việc /opt/opspilot',
      failUnknown: 'Không xác định được nguyên nhân cụ thể.',
      technicalLabel: 'Chi tiết kỹ thuật'
    },
    diagnosis: {
      causeLabel: 'Vì sao',
      fixesLabel: 'Cách khắc phục'
    },
    resources: {
      empty: 'Chưa kiểm tra',
      error: 'Không đọc được tài nguyên',
      retry: (name: string) => `Đọc lại tài nguyên của ${name}`,
      ram: 'RAM',
      disk: 'Disk',
      cpu: 'Tải CPU (1 phút)',
      cores: (count: number) => `${count} nhân`,
      usedOf: (used: string, total: string) => `Đã dùng ${used} / ${total}`
    }
  }
} as const
