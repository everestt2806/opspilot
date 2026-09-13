export const strings = {
  app: {
    name: 'OpsPilot',
    noSelection: 'Chưa chọn VPS',
    vpsSelected: (count: number) => `${count} VPS selected`
  },
  navigation: {
    vps: 'VPS',
    apps: 'Ứng dụng',
    deploy: 'Triển khai',
    dashboard: 'Tổng quan',
    migrate: 'Di chuyển',
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
    cancel: 'Hủy',
    notAvailable: 'Chưa có',
    refresh: 'Làm mới',
    retry: 'Thử lại',
    save: 'Lưu',
    close: 'Đóng',
    back: 'Quay lại',
    confirm: 'Xác nhận',
    saveError: 'Không thể lưu VPS'
  },
  pipeline: {
    title: 'Luồng triển khai',
    status: {
      completed: 'Hoàn tất',
      in_progress: 'Đang chạy',
      error: 'Thất bại',
      pending: 'Đang chờ'
    },
    steps: {
      PRECHECK: { title: 'Kiểm tra trước', desc: 'Kiểm tra RAM / đĩa / cổng VPS' },
      UPLOAD: { title: 'Tải lên', desc: 'Đẩy mã nguồn lên VPS' },
      RENDER: { title: 'Dựng cấu hình', desc: 'Tạo Dockerfile và Compose' },
      BUILD: { title: 'Biên dịch', desc: 'Chạy Docker build' },
      DEPLOY: { title: 'Triển khai', desc: 'Khởi động container và đổi cổng' },
      HEALTHCHECK: { title: 'Kiểm tra sống', desc: 'Xác minh HTTP GET' },
      RECORD: { title: 'Ghi nhận', desc: 'Lưu phiên bản vào cơ sở dữ liệu' }
    },
    banner: {
      success: (time: string) => `Deploy succeeded in ${time}`,
      openApp: 'Mở ứng dụng',
      viewDashboard: 'Xem tổng quan',
      error: (step: string) => `Deploy failed at step [${step}] — check the error log below`,
      rollback: 'Roll back to previous version'
    }
  },
  projects: {
    title: 'Ứng dụng và triển khai',
    description: 'Chọn ứng dụng để triển khai phiên bản mới hoặc theo dõi luồng hiện tại.',
    deployNew: 'Triển khai phiên bản mới',
    newProject: '+ Ứng dụng mới',
    searchPlaceholder: 'Tìm ứng dụng...',
    statusOnline: 'Đang hoạt động',
    statusOffline: 'Ngoại tuyến',
    statusDeploying: 'Đang triển khai'
  },
  wizard: {
    title: 'Trình triển khai — 4 bước',
    step1: '1. Nguồn',
    step2: '2. Nhận diện',
    step3: '3. Cấu hình',
    step4: '4. Kiểm tra và triển khai',
    detectSuccess: 'Đã nhận diện framework.',
    precheckOk: 'Đã đạt các kiểm tra RAM / đĩa / cổng. Sẵn sàng triển khai.',
    startDeploy: 'Xác nhận triển khai'
  },
  vps: {
    title: 'Máy chủ',
    description: 'Tổng quan đội máy và bảng điều khiển VPS của OpsPilot.',
    create: 'Thêm VPS',
    createFirst: 'Thêm VPS đầu tiên',
    listCardTitle: 'Danh sách VPS',
    empty: 'Chưa có VPS. Hãy thêm VPS đầu tiên để bắt đầu triển khai.',
    loadError: 'Không thể tải danh sách VPS',
    checkResources: 'Làm mới',
    backToList: 'Quay lại danh sách VPS',
    columns: {
      name: 'Name',
      ip: 'IP',
      status: 'Trạng thái',
      docker: 'Docker',
      resources: 'CPU / RAM / Disk',
      site: 'Site',
      lastConnection: 'Last connection',
      actions: 'Actions'
    },
    status: {
      online: 'Đang hoạt động',
      offline: 'Ngoại tuyến',
      unknown: 'Chưa kiểm tra',
      checking: 'Đang kiểm tra'
    },
    actions: {
      edit: (name: string) => `Sửa VPS ${name}`,
      delete: (name: string) => `Xóa VPS ${name}`
    },
    delete: {
      title: 'Xóa VPS?',
      description: (name: string) =>
        `VPS "${name}" will be removed from OpsPilot. Apps running on the server are not deleted.`,
      confirm: 'Xóa VPS'
    },
    fields: {
      name: 'VPS name',
      host: 'Host or IP',
      port: 'SSH port',
      username: 'Username',
      authType: 'Auth method',
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
      createTitle: 'Add VPS',
      editTitle: 'Edit VPS',
      hostPlaceholder: '203.0.113.10',
      keepCredentialHint: 'Leave blank to keep the current credential.'
    },
    validation: {
      name: 'Enter the VPS name.',
      host: 'Enter the host or IP address.',
      port: 'Enter an SSH port from 1 to 65535.',
      username: 'Enter the SSH username.',
      privateKey: 'Paste the SSH private key.',
      password: 'Enter the SSH password.',
      incomplete: 'Fill in all fields before checking.'
    },
    check: {
      button: 'Kiểm tra kết nối',
      retry: 'Kiểm tra lại',
      idleHint:
        'Fill in the details and click check — the app will try the SSH connection and explain the cause with a fix if it fails.',
      checking: 'Checking connection…',
      needCredential:
        'The app cannot read the saved credential back. Enter the credential and click check again.',
      success: 'Connection successful',
      successHint: 'Steps verified on the server:',
      dockerMissing: 'Docker is not installed on the server',
      dockerMissingHint:
        'OpsPilot needs Docker to deploy apps. Install Docker, then click "Check again".',
      workdirFail: 'Could not write the working directory /opt/opspilot',
      failUnknown: 'Could not determine the specific cause.',
      technicalLabel: 'Technical details'
    },
    diagnosis: {
      causeLabel: 'Why',
      fixesLabel: 'How to fix'
    },
    resources: {
      empty: 'Not checked',
      error: 'Could not read resources',
      retry: (name: string) => `Re-read resources of ${name}`,
      ram: 'RAM',
      disk: 'Disk',
      cpu: 'CPU load (1 min)',
      cores: (count: number) => `${count} cores`,
      usedOf: (used: string, total: string) => `${used} / ${total} used`
    },
    install: {
      button: 'Install Docker now',
      confirmTitle: 'Install Docker on this VPS?',
      confirmBody:
        'OpsPilot will run the official Docker install script on the server. It takes a few minutes and cannot be cancelled halfway.',
      confirm: 'Install Docker',
      installing: 'Installing Docker on the server…',
      done: (version: string) => `Docker ${version} installed. Click "Refresh" to update.`,
      failed: 'Docker installation failed. Try again or check the technical details.',
      needSaveFirst: 'Save the VPS first, then reopen this dialog to install Docker.'
    }
  },
  deploy: {
    title: 'Deploy an application',
    description:
      'Pick a source folder — the app detects the framework and deploys it to a VPS over SSH.',
    noVps: 'No VPS yet. Add a VPS on the VPS screen before deploying.',
    steps: {
      source: 'Source',
      detect: 'Detect',
      config: 'Configuration',
      review: 'Review & Deploy'
    },
    vpsLabel: 'Target VPS',
    sourceLabel: 'Source folder',
    pickFolder: 'Choose folder',
    pickAgain: 'Choose again',
    next: 'Next',
    back: 'Back',
    detecting: 'Detecting framework…',
    detectError: 'Could not read the source folder. Check the path and try again.',
    detectView: 'View',
    detectLabels: {
      framework: 'Framework',
      version: 'Version',
      build: 'Build command',
      port: 'Container port',
      healthcheck: 'Healthcheck path',
      template: 'Dockerfile template',
      db: 'Database',
      dbYes: 'Postgres runs alongside the app — created by the tool',
      dbNo: 'Not needed',
      tree: 'File tree (trimmed)'
    },
    unmatchedTitle: 'Framework not recognized',
    unmatchedHint:
      'The app checked every signal below. Pick a different source folder or check the project.',
    signals: { title: 'Signals checked', passed: 'Matched', failed: 'Not matched' },
    config: {
      appLabel: 'Application on VPS',
      newApp: 'Create a new application',
      appNameLabel: 'Application name',
      appNameRule: 'Lowercase a-z, digits and dashes — must start with a letter.',
      envTitle: 'Environment variables',
      envRequired: 'Required',
      envAddPlaceholder: 'Pick an optional variable',
      envAdd: 'Add',
      envRemove: (key: string) => `Remove ${key}`,
      envHint:
        'Secrets are encrypted locally, written only to the .env file on the VPS, and never shown in logs.',
      dbUrlHint:
        'DATABASE_URL: leave empty to let the tool create Postgres with a random password.',
      manualTitle: 'Manual steps after deploy'
    },
    review: {
      title: 'Check VPS before deploy',
      checking: 'Running precheck…',
      retry: 'Check again',
      urlLabel: 'URL to use',
      deploy: 'Deploy',
      deployDisabled: 'Precheck is not green — fix it on the VPS, then click Check again.',
      error: 'Could not run the precheck.'
    },
    log: {
      title: 'Deploy log',
      running: 'Deploying',
      success: (duration: string) => `Deploy succeeded in ${duration}`,
      failedStep: (step: string) => `Failed at step ${step}`,
      rolledBack: 'Healthcheck failed — automatically rolled back to the previous version.',
      openApp: 'Open app',
      viewDashboard: 'View dashboard',
      toolbar: {
        copy: 'Copy',
        search: 'Find',
        searchPlaceholder: 'Search in log…'
      },
      liveOutput: 'Live output',
      finished: 'Finished',
      cancel: 'Cancel deploy',
      cancelConfirm: 'Stop',
      cancelAsk:
        'Stop the deploy midway? Depending on the current step, the previous app is kept as-is or cleaned up.',
      scrollDown: 'Scroll to bottom',
      empty: 'No logs yet. Preparing…',
      backToWizard: 'Back to wizard'
    }
  },
  dashboard: {
    title: 'Tổng quan',
    summaryLabel: 'Tóm tắt hệ thống',
    refresh: 'Làm mới',
    stats: {
      vpsOnline: 'VPS đang hoạt động',
      appsRunning: 'Ứng dụng đang chạy',
      deploy24h: 'Lần triển khai trong 24 giờ',
      lastDeploy: 'Triển khai gần nhất'
    },
    recent: {
      title: 'Hoạt động gần đây',
      columnTime: 'Thời gian',
      columnAction: 'Tác vụ',
      columnVps: 'VPS',
      columnStatus: 'Trạng thái',
      columnMessage: 'Thông báo',
      empty: 'Chưa có hoạt động. Hãy triển khai ứng dụng đầu tiên để xem lịch sử.',
      deployNow: 'Triển khai ngay',
      unknownVps: 'VPS đã xóa',
      unknownAction: 'Khác'
    },
    actions: {
      deploy: 'Triển khai',
      rollback_auto: 'Khôi phục tự động',
      rollback_manual: 'Khôi phục thủ công'
    },
    statuses: {
      success: 'Thành công',
      failed: 'Thất bại',
      cancelled: 'Đã hủy'
    },
    emptyVps: 'Chưa có VPS. Hãy thêm VPS đầu tiên để bắt đầu triển khai.',
    addVps: 'Thêm VPS',
    loadFailed: 'Không thể tải dữ liệu tổng quan.',
    retry: 'Thử lại'
  },
  history: {
    title: 'Lịch sử',
    description: 'Xem các lần triển khai, khôi phục và cảnh báo.',
    filters: {
      action: 'Tác vụ',
      actionAll: 'Tất cả',
      vps: 'VPS',
      vpsAll: 'All VPS',
      timeRange: 'Khoảng thời gian'
    },
    columns: {
      time: 'Thời gian',
      action: 'Tác vụ',
      vps: 'VPS',
      status: 'Trạng thái',
      message: 'Thông báo'
    },
    detail: {
      title: 'Activity details',
      time: 'Time',
      vps: 'VPS',
      status: 'Status',
      message: 'Message',
      fields: 'Extra details',
      emptyFields: 'No extra details.'
    },
    empty: 'No activity matches this filter.',
    loadFailed: 'Could not load the history.',
    retry: 'Retry'
  },
  vpsControl: {
    tabs: {
      overview: 'Tổng quan',
      apps: 'Ứng dụng và triển khai',
      database: 'Cơ sở dữ liệu',
      activity: 'Hoạt động'
    },
    fleet: {
      totalVps: 'Total VPS',
      online: 'Đang hoạt động',
      offline: 'Ngoại tuyến',
      totalApps: 'Total apps'
    },
    selector: {
      searchPlaceholder: 'Search by name or host…',
      filterAll: 'All statuses',
      filterButton: 'Filter by status',
      filterUnknown: 'Not checked',
      copyIp: 'Copy IP',
      pageTotal: (from: number, to: number, total: number) => `${from}-${to} of ${total}`,
      noSelection: 'Select a VPS from the list on the left to view details.',
      dockerMissing: 'Chưa có Docker',
      appsCount: (count: number) => (count === 0 ? 'No apps' : `${count} apps`)
    },
    overview: {
      machineTitle: 'Machine info',
      resourcesTitle: 'Resources',
      actionsTitle: 'Quick actions',
      utilitiesTitle: 'Utilities',
      dangerTitle: 'Danger zone',
      host: 'Host',
      sshPort: 'SSH port',
      sshCommand: 'SSH command',
      username: 'Username',
      providerRegion: 'Provider / region',
      docker: 'Docker',
      dockerMissing: 'Docker not installed',
      createdAt: 'Added at',
      lastSeen: 'Last seen',
      neverSeen: 'Never connected',
      checkedAt: (time: string) => `Resources checked at ${time}`,
      checkConnection: 'Kiểm tra và chẩn đoán kết nối',
      copyCommand: 'Sao chép lệnh SSH',
      copied: 'Đã sao chép'
    },
    header: {
      mainIp: 'Main IP',
      sshPort: 'SSH port',
      sshCommand: 'SSH command'
    },
    sidebar: {
      title: 'Server info',
      cpu: 'CPU load',
      ram: 'RAM usage',
      cores: 'CPU cores',
      disk: 'Disk',
      ramTotal: 'Total RAM',
      loadAvg: 'Load avg (1m)',
      docker: 'Docker',
      lastSeen: 'Last seen',
      checking: 'Checking resources…',
      resourceError: 'Could not read server resources',
      retryResources: 'Retry'
    },
    apps: {
      title: 'Ứng dụng trên máy chủ',
      deployNew: 'Triển khai ứng dụng mới',
      redeploy: 'Triển khai lại',
      openApp: 'Mở ứng dụng',
      empty: 'Chưa có ứng dụng trên máy chủ này.',
      emptyHint: 'Hãy triển khai ứng dụng đầu tiên để bắt đầu quản lý tại đây.',
      loadFailed: 'Could not load apps on this server.',
      columns: {
        name: 'Name',
        framework: 'Framework',
        port: 'Port',
        url: 'URL',
        version: 'Version',
        status: 'Trạng thái',
        actions: 'Actions'
      },
      status: {
        running: 'Đang chạy',
        failed: 'Thất bại',
        building: 'Đang biên dịch',
        deploying: 'Đang triển khai',
        stopped: 'Đã dừng',
        rolled_back: 'Đã khôi phục',
        none: 'Chưa triển khai'
      }
    },
    activity: {
      title: 'Hoạt động gần đây',
      empty: 'Chưa có hoạt động trên máy chủ này.',
      emptyHint: 'Triển khai hoặc quản lý ứng dụng để xem nhật ký tại đây.',
      loadFailed: 'Could not load activity for this server.'
    },
    database: {
      usersTitle: 'Database users',
      usersEmpty: 'No database users on this server yet.',
      createUser: 'Create user',
      createUserTitle: 'Create database user',
      username: 'Username',
      usernameRequired: 'Enter a username.',
      usernameHint: 'Lowercase letters, digits and underscores.',
      password: 'Password',
      passwordRequired: 'Enter a password.',
      passwordHint: 'Sent over SSH — stored on the server only, never logged.',
      databasesTitle: 'Databases',
      databasesEmpty: 'No databases on this server yet.',
      createDatabase: 'Create database',
      createDatabaseTitle: 'Create database',
      databaseName: 'Database name',
      databaseNameRequired: 'Enter a database name.',
      databaseNameInvalid: 'Lowercase letters, digits and underscores only.',
      createUserFailed: 'Could not create the user on the server.',
      createDatabaseFailed: 'Could not create the database on the server.',
      loadUsersFailed: 'Could not load database users.',
      loadDatabasesFailed: 'Could not load databases.',
      columns: {
        id: 'ID',
        username: 'Username',
        name: 'Name',
        size: 'Size',
        tables: 'Tables'
      },
      backToDatabases: 'Back to databases',
      designerTitle: 'Schema designer',
      designerLocal:
        'Backend for this VPS database is not ready yet — you are editing locally. Import a file or add tables by hand; "Save schema" will work once the backend lands.',
      noTables: 'No tables yet. Click "Add table" or import a JSON/CSV file.',
      addTable: 'Add table',
      deleteTable: 'Delete table',
      addColumn: 'Add column',
      deleteColumn: 'Delete column',
      columnName: 'Column name',
      columnType: 'Type',
      nullable: 'Nullable',
      primaryKey: 'Primary key',
      foreignKey: 'Foreign key',
      connectHint: 'Linking: click a column, then click the target column on another table.',
      connectCancel: 'Press Esc or click the same icon again to stop linking.',
      sqlPreview: 'SQL preview',
      saveSchema: 'Save schema',
      schemaSaved: 'Schema sent to the server.',
      schemaSaveFailed: 'Could not apply the schema on the server.',
      importFile: 'Import file',
      importHint: 'JSON or CSV — rows are previewed below and tables are added to the designer.',
      importFailed: 'Could not read the file. Check the format and try again.',
      exportJson: 'Export JSON',
      exportCsv: 'Export CSV',
      exportSql: 'Export SQL',
      exportEmpty: 'Nothing to export yet — import a file or add a table first.',
      dataTitle: 'Imported data',
      dataCount: (count: number) => `${count} rows`,
      refresh: 'Refresh'
    },
    resourceBanner: {
      title: 'Could not refresh server resources',
      markRead: 'Dismiss'
    },
    scan: {
      title: 'Environment scan',
      scanAgain: 'Scan again',
      scanning: 'Scanning the server…',
      failed: 'Could not scan the server.',
      missing: 'Not installed',
      itemSsh: 'SSH connection',
      itemDocker: 'Docker',
      itemCompose: 'Docker Compose',
      itemNode: 'Node.js',
      itemGit: 'Git',
      itemWorkdir: 'Workspace /opt/opspilot'
    }
  },
  settings: {
    title: 'Cài đặt',
    description: 'Giao diện và trạng thái các tính năng đang phát triển.',
    appearance: 'Giao diện',
    appearanceDescription: 'Chọn giao diện cho phiên làm việc này.',
    categoriesLabel: 'Nhóm cài đặt',
    monitoringCategory: 'Giám sát',
    dark: 'Tối',
    light: 'Sáng',
    monitoring: 'Giám sát ML và rollback tự động',
    deferred: 'Đang phát triển, dự kiến sau 28/09'
  },
  appearance: {
    label: 'Appearance',
    light: 'Light',
    dark: 'Dark'
  }
} as const
