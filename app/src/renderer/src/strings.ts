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
    },
    install: {
      button: 'Cài Docker ngay',
      confirmTitle: 'Cài Docker trên VPS?',
      confirmBody:
        'OpsPilot chạy script cài chính thức của Docker trên máy chủ. Mất vài phút, không huỷ được giữa chừng.',
      confirm: 'Cài Docker',
      installing: 'Đang cài Docker trên máy chủ…',
      done: (version: string) => `Đã cài xong Docker ${version}. Bấm “Kiểm tra lại” để cập nhật.`,
      failed: 'Cài Docker thất bại. Bấm thử lại hoặc xem chi tiết kỹ thuật.',
      needSaveFirst: 'Lưu VPS lại trước rồi mở lại hộp thoại này để cài Docker.'
    }
  },
  deploy: {
    title: 'Deploy ứng dụng',
    description: 'Chọn thư mục source — app nhận diện framework rồi deploy lên VPS qua SSH.',
    noVps: 'Chưa có VPS nào. Thêm VPS ở màn VPS trước khi deploy.',
    steps: {
      source: 'Nguồn',
      detect: 'Nhận diện',
      config: 'Cấu hình',
      review: 'Kiểm tra & Deploy'
    },
    vpsLabel: 'VPS đích',
    sourceLabel: 'Thư mục source',
    pickFolder: 'Chọn thư mục',
    pickAgain: 'Chọn lại',
    next: 'Tiếp tục',
    back: 'Quay lại',
    detecting: 'Đang nhận diện framework…',
    detectError: 'Không đọc được thư mục source. Kiểm tra đường dẫn rồi thử lại.',
    detectView: 'Xem',
    detectLabels: {
      framework: 'Framework',
      version: 'Phiên bản',
      build: 'Build command',
      port: 'Cổng container',
      healthcheck: 'Healthcheck path',
      template: 'Dockerfile template',
      db: 'Cơ sở dữ liệu',
      dbYes: 'Postgres chạy kèm app — tool tự tạo',
      dbNo: 'Không cần',
      tree: 'Cây file (rút gọn)'
    },
    unmatchedTitle: 'Không nhận diện được framework',
    unmatchedHint:
      'App đã kiểm tra từng dấu hiệu dưới đây. Chọn lại thư mục source hoặc kiểm tra project.',
    signals: { title: 'Dấu hiệu đã kiểm tra', passed: 'Khớp', failed: 'Không khớp' },
    config: {
      appLabel: 'Ứng dụng trên VPS',
      newApp: 'Tạo ứng dụng mới',
      appNameLabel: 'Tên ứng dụng',
      appNameRule: 'Chữ thường a-z, số và dấu gạch ngang — bắt đầu bằng chữ.',
      envTitle: 'Biến môi trường',
      envRequired: 'Bắt buộc',
      envAddPlaceholder: 'Chọn biến tuỳ chọn',
      envAdd: 'Thêm',
      envRemove: (key: string) => `Bỏ ${key}`,
      envHint:
        'Giá trị secret được mã hoá ở máy, chỉ ghi dạng .env trên VPS và không hiện trong log.',
      dbUrlHint: 'DATABASE_URL: bỏ trống để tool tự tạo Postgres kèm mật khẩu ngẫu nhiên.',
      manualTitle: 'Cần làm tay sau deploy'
    },
    review: {
      title: 'Kiểm tra VPS trước deploy',
      checking: 'Đang precheck…',
      retry: 'Kiểm tra lại',
      urlLabel: 'URL sẽ dùng',
      deploy: 'Deploy',
      deployDisabled: 'Precheck chưa xanh — sửa trên VPS rồi bấm Kiểm tra lại.',
      error: 'Không chạy được precheck.'
    },
    log: {
      title: 'Deploy log',
      running: 'Đang deploy',
      success: (duration: string) => `Deploy thành công sau ${duration}`,
      failedStep: (step: string) => `Lỗi ở bước ${step}`,
      rolledBack: 'Healthcheck thất bại — đã tự rollback về bản đang chạy trước đó.',
      openApp: 'Mở app',
      cancel: 'Huỷ deploy',
      cancelConfirm: 'Dừng lại',
      cancelAsk:
        'Dừng deploy giữa chừng? Tuỳ bước đang chạy, app cũ sẽ được giữ nguyên hoặc dọn dẹp.',
      scrollDown: 'Xuống cuối',
      empty: 'Chưa có log. Đang chuẩn bị…',
      backToWizard: 'Quay lại wizard'
    }
  }
} as const
