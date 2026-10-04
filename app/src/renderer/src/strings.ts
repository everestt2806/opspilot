import { useUiState, type LocaleMode } from './store/uiState'

const BASE_EN_STRINGS = {
  app: {
    name: 'OpsPilot',
    noSelection: 'No VPS selected',
    vpsSelected: (count: number) => `${count} VPS selected`
  },
  navigation: {
    vps: 'VPS',
    apps: 'Applications',
    deploy: 'Deploy',
    dashboard: 'Dashboard',
    migrate: 'Migrate',
    history: 'Audit Log',
    settings: 'Settings'
  },
  status: {
    ssh: 'SSH',
    mlService: 'ML service',
    running: 'Running',
    stopped: 'Stopped',
    unknown: 'Not connected'
  },
  common: {
    cancel: 'Cancel',
    notAvailable: 'N/A',
    refresh: 'Refresh',
    retry: 'Retry',
    save: 'Save',
    close: 'Close',
    back: 'Back',
    confirm: 'Confirm',
    saveError: 'Could not save VPS'
  },
  pipeline: {
    title: 'Deploy pipeline',
    status: {
      completed: 'Completed',
      in_progress: 'In progress',
      error: 'Failed',
      pending: 'Pending'
    },
    steps: {
      PRECHECK: { title: 'Precheck', desc: 'Check RAM / disk / port on VPS' },
      UPLOAD: { title: 'Upload', desc: 'Push source code to VPS' },
      RENDER: { title: 'Render', desc: 'Create Dockerfile and Compose' },
      BUILD: { title: 'Build', desc: 'Run Docker build' },
      DEPLOY: { title: 'Deploy', desc: 'Start container and assign port' },
      HEALTHCHECK: { title: 'Healthcheck', desc: 'Verify HTTP GET' },
      RECORD: { title: 'Record', desc: 'Save deployment record to DB' }
    },
    banner: {
      success: (time: string) => `Deploy succeeded in ${time}`,
      openApp: 'Open app',
      viewDashboard: 'View dashboard',
      error: (step: string) => `Deploy failed at step [${step}] — check the error log below`,
      rollback: 'Roll back to previous version'
    }
  },
  projects: {
    title: 'Applications & Deployments',
    description: 'Select an application to deploy a new version or monitor runtime status.',
    deployNew: 'Deploy new version',
    newProject: '+ New application',
    searchPlaceholder: 'Search applications…',
    statusOnline: 'Online',
    statusOffline: 'Offline',
    statusDeploying: 'Deploying'
  },
  wizard: {
    title: 'Deploy wizard — 4 steps',
    step1: '1. Source',
    step2: '2. Detect',
    step3: '3. Configure',
    step4: '4. Review & Deploy',
    detectSuccess: 'Framework detected.',
    precheckOk: 'RAM / disk / port checks passed. Ready to deploy.',
    startDeploy: 'Confirm deploy'
  },
  vps: {
    title: 'Servers',
    description: 'Overview of server fleet and VPS control in OpsPilot.',
    create: 'Add VPS',
    createFirst: 'Add first VPS',
    listCardTitle: 'VPS Fleet',
    empty: 'No VPS registered yet. Add your first VPS to start deploying.',
    loadError: 'Could not load VPS list',
    checkResources: 'Refresh',
    backToList: 'Back to VPS list',
    columns: {
      name: 'Name',
      ip: 'IP',
      status: 'Status',
      docker: 'Docker',
      resources: 'CPU / RAM / Disk',
      site: 'Site',
      lastConnection: 'Last connection',
      actions: 'Actions'
    },
    status: {
      online: 'Online',
      offline: 'Offline',
      unknown: 'Not checked',
      checking: 'Checking'
    },
    actions: {
      edit: (name: string) => `Edit VPS ${name}`,
      delete: (name: string) => `Delete VPS ${name}`
    },
    delete: {
      title: 'Delete VPS?',
      description: (name: string) =>
        `VPS "${name}" will be removed from OpsPilot. Apps running on the server are not deleted.`,
      confirm: 'Delete VPS'
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
      button: 'Check connection',
      retry: 'Check again',
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
      error: 'Could not run the precheck.',
      columns: {
        check: 'Check',
        required: 'Required',
        actual: 'Actual',
        result: 'Result'
      }
    },
    exposure: {
      degradedTitle: 'External port degraded / unreachable',
      blockedHint:
        'External port may be blocked by firewall. Run Doctor to diagnose and auto-fix safely.',
      reachable: 'External port reachable'
    },
    doctor: {
      diagnose: 'Diagnose with Doctor',
      autoFix: 'Safe auto-fix'
    },
    domain: {
      title: 'Domain configuration',
      placeholder: 'app.example.com',
      directPort: 'Direct port (:port)',
      sharedIngress: 'Shared ingress (HTTPS)',
      namedTunnelDisabled: 'Named tunnel (requires configured CNAME tunnel)',
      generateRecord: 'Generate DNS record',
      verifyPropagation: 'Verify propagation',
      cfTokenPlaceholder: 'Cloudflare API token (one-time use)',
      cfZonePlaceholder: 'Cloudflare Zone ID',
      cfUpdate: 'Update Cloudflare DNS',
      recordLabel: 'Record',
      targetUrlLabel: 'Target URL',
      instructionsLabel: 'Instructions',
      modeLabel: 'Domain mode',
      cfTokenLabel: 'Cloudflare API token',
      cfZoneLabel: 'Cloudflare Zone ID',
      namedTunnelError:
        'Mode named_tunnel requires an existing CNAME tunnel target; creating named tunnels from VPS IP is not supported yet.',
      generatedHint:
        'Record generated. Provider API/Domain Connect required for auto-upsert; if not available, copy the record and verify propagation.',
      cfMissing: 'Cloudflare API token and Zone ID are required to auto-update DNS.',
      currentStatus: (msg: string, status: string) => `${msg} Current status: ${status}.`,
      dnsStatus: (status: string, observed: string[]) =>
        `DNS: ${status}${observed.length ? ` — ${observed.join(', ')}` : ''}`
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
  apps: {
    title: 'Applications',
    description: 'Manage runtimes and deployed versions.',
    count: (count: number) => `${count} apps`,
    searchPlaceholder: 'Search applications…',
    empty: 'No applications',
    emptyHint: 'Deploy your first application to manage it here.',
    emptySearch: 'No matching applications found',
    selectAppHint: 'Select an application from the list to view details',
    runtime: 'Runtime',
    healthy: 'Running · Healthy',
    unhealthy: 'Needs attention',
    lastDeploy: 'Last deploy',
    vpsHost: 'VPS host',
    connectedLocal: 'Connected locally',
    tabs: {
      overview: 'Overview',
      versions: 'Version history'
    },
    runtimeInfo: 'Runtime information',
    runtimeSync: 'Synced from latest deployment',
    appName: 'Application name',
    framework: 'Framework',
    vps: 'Target VPS',
    runtimeStatus: 'Runtime status',
    version: 'Version',
    url: 'App URL',
    port: 'Container port',
    healthcheck: 'Healthcheck path',
    db: 'Database',
    dbYes: 'Required',
    dbNo: 'Not needed',
    exposureTitle: 'Exposure status',
    exposureStatus: {
      reachable: 'Reachable',
      degraded: 'Degraded',
      tunnel_only: 'Tunnel only',
      not_checked: 'Not checked'
    },
    exposureDegradedAlert: 'External port is degraded or not accessible from the Internet.',
    doctorDiagnose: 'Diagnose with Doctor',
    doctorAutoFix: 'Safe auto-fix',
    doctorFixSuccess: 'Exposure verified and resolved successfully.',
    versionHistory: 'Deployed versions',
    versionCount: (count: number) => `${count} records`,
    rollback: 'Rollback',
    rollbackTitle: 'Confirm rollback',
    rollbackConfirm: 'Confirm rollback',
    rollbackWarning: (from: string, to: string) =>
      `Current version ${from} will be replaced with ${to}.`,
    rollbackHint:
      'Healthcheck will run after rollback. If it fails, OpsPilot retains evidence for inspection.',
    rollbackInputPrompt: 'Type the exact application name to confirm this runtime operation.',
    rollbackSuccess: 'Rollback completed successfully',
    rollbackFailed: 'Rollback failed',
    offlineConfirmHint: 'Application is offline so you can confirm immediately.',
    openApp: 'Open app',
    detailAria: (name: string) => `Details for ${name}`,
    emptyDeployments: 'No deployments yet',
    buildDuration: (duration: string) => `Build ${duration}`,
    imageTag: (tag: string) => `Tag ${tag}`,
    portBinding: (host: number, container: number) => `host:${host} → container:${container}`,
    loadingVersions: 'Loading versions…'
  },
  dashboard: {
    title: 'Dashboard',
    summaryLabel: 'System summary',
    refresh: 'Refresh',
    stats: {
      vpsOnline: 'Online VPS',
      appsRunning: 'Running applications',
      deploy24h: 'Deploys in last 24h',
      lastDeploy: 'Last deployment'
    },
    recent: {
      title: 'Recent activity',
      columnTime: 'Time',
      columnAction: 'Action',
      columnVps: 'VPS',
      columnStatus: 'Status',
      columnMessage: 'Message',
      empty: 'No activity yet. Deploy your first application to see audit history.',
      deployNow: 'Deploy now',
      unknownVps: 'Deleted VPS',
      unknownAction: 'Other'
    },
    actions: {
      deploy: 'Deploy',
      rollback_auto: 'Auto rollback',
      rollback_manual: 'Manual rollback'
    },
    statuses: {
      success: 'Success',
      failed: 'Failed',
      cancelled: 'Cancelled'
    },
    emptyVps: 'No VPS registered. Add your first VPS to start deploying.',
    addVps: 'Add VPS',
    loadFailed: 'Could not load dashboard data.',
    retry: 'Retry'
  },
  history: {
    title: 'Audit Log',
    description: 'View deployments, rollbacks, and alerts.',
    filters: {
      action: 'Action',
      actionAll: 'All',
      vps: 'VPS',
      vpsAll: 'All VPS',
      timeRange: 'Time range'
    },
    columns: {
      time: 'Time',
      action: 'Action',
      vps: 'VPS',
      status: 'Status',
      message: 'Message'
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
      overview: 'Overview',
      apps: 'Applications & Deployments',
      database: 'Database',
      activity: 'Activity'
    },
    fleet: {
      totalVps: 'Total VPS',
      online: 'Online',
      offline: 'Offline',
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
      dockerMissing: 'Docker missing',
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
      checkConnection: 'Check & diagnose connection',
      copyCommand: 'Copy SSH command',
      copied: 'Copied'
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
      title: 'Apps on this server',
      deployNew: 'Deploy new application',
      redeploy: 'Redeploy',
      openApp: 'Open app',
      empty: 'No applications on this server yet.',
      emptyHint: 'Deploy your first application to start managing it here.',
      loadFailed: 'Could not load apps on this server.',
      columns: {
        name: 'Name',
        framework: 'Framework',
        port: 'Port',
        url: 'URL',
        version: 'Version',
        status: 'Status',
        actions: 'Actions'
      },
      status: {
        running: 'Running',
        failed: 'Failed',
        building: 'Building',
        deploying: 'Deploying',
        stopped: 'Stopped',
        rolled_back: 'Rolled back',
        none: 'Not deployed'
      }
    },
    activity: {
      title: 'Recent activity',
      empty: 'No activity on this server yet.',
      emptyHint: 'Deploy or manage applications to see logs here.',
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
    title: 'Settings',
    description: 'Appearance and preview of upcoming features.',
    appearance: 'Appearance',
    appearanceDescription: 'Select theme for this session.',
    language: 'Display Language',
    languageDescription: 'Select user interface language for OpsPilot.',
    categoriesLabel: 'Settings categories',
    monitoringCategory: 'Monitoring',
    dark: 'Dark',
    light: 'Light',
    monitoring: 'ML monitoring and auto rollback',
    deferred: 'Under development, expected after Sep 28',
    languages: {
      en: 'English',
      vi: 'Tiếng Việt',
      cn: '简体中文',
      jp: '日本語'
    }
  },
  appearance: {
    label: 'Appearance',
    light: 'Light',
    dark: 'Dark'
  }
}

const VI_OVERRIDES: Partial<typeof BASE_EN_STRINGS> = {
  navigation: {
    vps: 'Máy chủ',
    apps: 'Ứng dụng',
    deploy: 'Triển khai',
    dashboard: 'Tổng quan',
    migrate: 'Di chuyển',
    history: 'Hoạt động',
    settings: 'Cài đặt'
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
  deploy: {
    ...BASE_EN_STRINGS.deploy,
    title: 'Triển khai ứng dụng',
    description:
      'Chọn thư mục mã nguồn — ứng dụng tự nhận diện framework và triển khai lên VPS qua SSH.',
    vpsLabel: 'Máy chủ VPS triển khai',
    sourceLabel: 'Thư mục mã nguồn',
    noVps: 'Chưa có VPS nào. Hãy thêm VPS ở màn hình Máy chủ trước khi triển khai.',
    pickFolder: 'Chọn thư mục',
    pickAgain: 'Chọn lại',
    next: 'Tiếp tục',
    back: 'Quay lại',
    steps: {
      source: 'Nguồn',
      detect: 'Nhận diện',
      config: 'Cấu hình',
      review: 'Kiểm tra & Chạy'
    },
    review: {
      ...BASE_EN_STRINGS.deploy.review,
      title: 'Kiểm tra VPS trước khi triển khai',
      checking: 'Đang kiểm tra trước…',
      retry: 'Kiểm tra lại',
      urlLabel: 'URL dự kiến',
      deploy: 'Bắt đầu triển khai',
      deployDisabled: 'Kiểm tra chưa đạt — hãy xử lý trên VPS rồi bấm Kiểm tra lại.',
      error: 'Không thể chạy kiểm tra trước.',
      columns: {
        check: 'Kiểm tra',
        required: 'Yêu cầu',
        actual: 'Thực tế',
        result: 'Kết quả'
      }
    },
    exposure: {
      degradedTitle: 'Cổng ngoài bị suy giảm hoặc chưa truy cập được',
      blockedHint:
        'Cổng ngoài có thể đang bị firewall chặn. Chạy Doctor để chẩn đoán và khắc phục an toàn.',
      reachable: 'Cổng ngoài sẵn sàng và có thể truy cập'
    },
    doctor: {
      diagnose: 'Chẩn đoán với Doctor',
      autoFix: 'Khắc phục an toàn'
    },
    domain: {
      ...BASE_EN_STRINGS.deploy.domain,
      title: 'Trỏ domain cho ứng dụng',
      directPort: 'Direct port (có :port)',
      sharedIngress: 'Shared ingress (HTTPS)',
      namedTunnelDisabled: 'Named tunnel (cần CNAME tunnel - chưa hỗ trợ)',
      generateRecord: 'Sinh record',
      verifyPropagation: 'Kiểm tra propagation',
      cfTokenPlaceholder: 'Cloudflare API token (chỉ dùng một lần)',
      cfZonePlaceholder: 'Cloudflare Zone ID',
      cfUpdate: 'Tự cập nhật Cloudflare',
      recordLabel: 'Record',
      targetUrlLabel: 'URL dự kiến',
      instructionsLabel: 'Hướng dẫn',
      modeLabel: 'Chế độ domain',
      cfTokenLabel: 'Cloudflare API token',
      cfZoneLabel: 'Cloudflare Zone ID',
      namedTunnelError:
        'Mode named_tunnel yêu cầu CNAME target của tunnel đã được thiết lập; chưa hỗ trợ tự tạo named tunnel từ IP VPS.',
      generatedHint:
        'Đã sinh record. Cần provider API/Domain Connect để tự upsert; nếu chưa có, copy record và kiểm tra lại propagation.',
      cfMissing: 'Cần nhập Cloudflare API token và Zone ID để tự cập nhật DNS.',
      currentStatus: (msg: string, status: string) => `${msg} Trạng thái hiện tại: ${status}.`,
      dnsStatus: (status: string, observed: string[]) =>
        `DNS: ${status}${observed.length ? ` — ${observed.join(', ')}` : ''}`
    },
    log: {
      ...BASE_EN_STRINGS.deploy.log,
      title: 'Nhật ký triển khai',
      openApp: 'Mở ứng dụng',
      viewDashboard: 'Xem tổng quan',
      cancel: 'Hủy triển khai',
      cancelConfirm: 'Dừng',
      cancelAsk:
        'Dừng triển khai giữa chừng? Tùy bước hiện tại, ứng dụng cũ được giữ nguyên hoặc dọn dẹp.',
      backToWizard: 'Quay lại wizard'
    }
  },
  apps: {
    title: 'Ứng dụng',
    description: 'Vận hành runtime và phiên bản deploy.',
    count: (count: number) => `${count} ứng dụng`,
    searchPlaceholder: 'Tìm ứng dụng...',
    empty: 'Chưa có ứng dụng',
    emptyHint: 'Hãy triển khai ứng dụng đầu tiên để bắt đầu quản lý tại đây.',
    emptySearch: 'Không tìm thấy ứng dụng phù hợp',
    selectAppHint: 'Chọn một ứng dụng từ danh sách để xem chi tiết',
    runtime: 'Runtime',
    healthy: 'Đang chạy · Healthy',
    unhealthy: 'Cần kiểm tra',
    lastDeploy: 'Deploy gần nhất',
    vpsHost: 'VPS host',
    connectedLocal: 'Đang kết nối local',
    tabs: {
      overview: 'Tổng quan',
      versions: 'Lịch sử phiên bản'
    },
    runtimeInfo: 'Thông tin runtime',
    runtimeSync: 'Đồng bộ từ lần deploy gần nhất',
    appName: 'Tên ứng dụng',
    framework: 'Framework',
    vps: 'Máy chủ VPS',
    runtimeStatus: 'Trạng thái runtime',
    version: 'Phiên bản',
    url: 'Địa chỉ URL',
    port: 'Cổng container',
    healthcheck: 'Đường dẫn healthcheck',
    db: 'Cơ sở dữ liệu',
    dbYes: 'Có sử dụng',
    dbNo: 'Không cần',
    exposureTitle: 'Trạng thái Exposure',
    exposureStatus: {
      reachable: 'Reachable (Có thể truy cập ngoài)',
      degraded: 'Degraded (Bị chặn/suy giảm)',
      tunnel_only: 'Tunnel only',
      not_checked: 'Chưa kiểm tra'
    },
    exposureDegradedAlert: 'Cổng ngoài đang bị suy giảm hoặc chưa truy cập được từ Internet.',
    doctorDiagnose: 'Chẩn đoán với Doctor',
    doctorAutoFix: 'Tự sửa lỗi an toàn',
    doctorFixSuccess: 'Đã sửa và xác minh exposure thành công.',
    versionHistory: 'Phiên bản đã triển khai',
    versionCount: (count: number) => `${count} bản ghi`,
    rollback: 'Rollback',
    rollbackTitle: 'Xác nhận rollback',
    rollbackConfirm: 'Xác nhận rollback',
    rollbackWarning: (from: string, to: string) =>
      `Phiên bản hiện tại ${from} sẽ được thay bằng ${to}.`,
    rollbackHint:
      'Healthcheck sẽ chạy sau khi rollback. Nếu không đạt, OpsPilot giữ lại evidence để bạn kiểm tra.',
    rollbackInputPrompt:
      'Nhập chính xác tên ứng dụng để xác nhận thao tác có ảnh hưởng đến runtime.',
    rollbackSuccess: 'Đã rollback thành công',
    rollbackFailed: 'Rollback thất bại',
    offlineConfirmHint: 'Ứng dụng đang ngoại tuyến nên có thể xác nhận ngay.',
    openApp: 'Mở ứng dụng',
    detailAria: (name: string) => `Chi tiết ${name}`,
    emptyDeployments: 'Chưa có deployment nào',
    buildDuration: (duration: string) => `Build ${duration}`,
    imageTag: (tag: string) => `Tag ${tag}`,
    portBinding: (host: number, container: number) => `host:${host} → container:${container}`,
    loadingVersions: 'Đang tải danh sách phiên bản…'
  },
  settings: {
    title: 'Cài đặt',
    description: 'Giao diện và trạng thái các tính năng đang phát triển.',
    appearance: 'Giao diện',
    appearanceDescription: 'Chọn giao diện cho phiên làm việc này.',
    language: 'Ngôn ngữ hiển thị',
    languageDescription: 'Chọn ngôn ngữ giao diện cho hệ thống OpsPilot.',
    categoriesLabel: 'Nhóm cài đặt',
    monitoringCategory: 'Giám sát',
    dark: 'Tối',
    light: 'Sáng',
    monitoring: 'Giám sát ML và rollback tự động',
    deferred: 'Đang phát triển, dự kiến sau 28/09',
    languages: {
      en: 'English',
      vi: 'Tiếng Việt',
      cn: '简体中文',
      jp: '日本語'
    }
  }
}

const CN_OVERRIDES: Partial<typeof BASE_EN_STRINGS> = {
  navigation: {
    vps: '服务器',
    apps: '应用',
    deploy: '部署',
    dashboard: '总览',
    migrate: '迁移',
    history: '操作动态',
    settings: '系统设置'
  },
  common: {
    cancel: '取消',
    notAvailable: '暂无',
    refresh: '刷新',
    retry: '重试',
    save: '保存',
    close: '关闭',
    back: '返回',
    confirm: '确认',
    saveError: '无法保存 VPS'
  },
  deploy: {
    ...BASE_EN_STRINGS.deploy,
    title: '部署应用程序',
    description: '选择源码文件夹 — 系统将自动识别框架并通过 SSH 部署到 VPS。',
    vpsLabel: '目标 VPS',
    sourceLabel: '源码文件夹',
    noVps: '暂无可用的 VPS。部署前请先在 VPS 页面添加。',
    pickFolder: '选择文件夹',
    pickAgain: '重新选择',
    next: '下一步',
    back: '上一步',
    steps: {
      source: '源码',
      detect: '框架识别',
      config: '应用配置',
      review: '检查并运行'
    },
    review: {
      ...BASE_EN_STRINGS.deploy.review,
      title: '部署前检查 VPS',
      checking: '正在进行预检…',
      retry: '重新检查',
      urlLabel: '访问地址',
      deploy: '开始部署',
      deployDisabled: '预检未通过 — 请先在 VPS 上处理问题后重试。',
      error: '无法执行预检。',
      columns: {
        check: '检查项',
        required: '要求',
        actual: '实际',
        result: '结果'
      }
    },
    exposure: {
      degradedTitle: '外部端口降级或无法访问',
      blockedHint: '外部端口可能被防火墙拦截。运行 Doctor 进行诊断并安全修复。',
      reachable: '外部端口正常可访问'
    },
    doctor: {
      diagnose: '使用 Doctor 诊断',
      autoFix: '安全自动修复'
    },
    domain: {
      ...BASE_EN_STRINGS.deploy.domain,
      title: '域名解析配置',
      directPort: '直连端口 (:port)',
      sharedIngress: '共享入口 (HTTPS)',
      namedTunnelDisabled: 'Named tunnel (需要已配置的 CNAME tunnel)',
      generateRecord: '生成 DNS 记录',
      verifyPropagation: '验证传播状态',
      cfTokenPlaceholder: 'Cloudflare API 令牌 (一次性使用)',
      cfZonePlaceholder: 'Cloudflare 区域 ID',
      cfUpdate: '更新 Cloudflare',
      recordLabel: 'DNS记录',
      targetUrlLabel: '预期 URL',
      instructionsLabel: '指引',
      modeLabel: '域名模式',
      cfTokenLabel: 'Cloudflare API 令牌',
      cfZoneLabel: 'Cloudflare 区域 ID',
      namedTunnelError: 'Named tunnel 模式需要已配置的 CNAME 目标；暂不支持直接从 VPS IP 创建。',
      generatedHint:
        '已生成 DNS 记录。自动更新需配置 Provider API；若未配置，请手动添加并验证传播。',
      cfMissing: '需填写 Cloudflare API 令牌与区域 ID 以自动更新 DNS。',
      currentStatus: (msg: string, status: string) => `${msg} 当前状态: ${status}。`,
      dnsStatus: (status: string, observed: string[]) =>
        `DNS 状态: ${status}${observed.length ? ` — ${observed.join(', ')}` : ''}`
    },
    log: {
      ...BASE_EN_STRINGS.deploy.log,
      title: '部署日志',
      openApp: '打开应用',
      viewDashboard: '查看总览',
      cancel: '取消部署',
      cancelConfirm: '停止',
      cancelAsk: '确定中途停止部署吗？根据当前步骤，旧应用将被保留或清理。',
      backToWizard: '返回向导'
    }
  },
  apps: {
    title: '应用程序',
    description: '管理运行状态与已部署版本。',
    count: (count: number) => `${count} 个应用`,
    searchPlaceholder: '搜索应用…',
    empty: '暂无应用',
    emptyHint: '部署首个应用以在此处开始管理。',
    emptySearch: '未找到匹配的应用',
    selectAppHint: '从列表中选择一个应用以查看详情',
    runtime: '运行环境',
    healthy: '运行中 · 正常',
    unhealthy: '需检查',
    lastDeploy: '最近部署',
    vpsHost: 'VPS 主机',
    connectedLocal: '本地引擎已连接',
    tabs: {
      overview: '运行总览',
      versions: '版本历史'
    },
    runtimeInfo: '运行时信息',
    runtimeSync: '同步自最近一次部署',
    appName: '应用名称',
    framework: '框架',
    vps: '目标 VPS',
    runtimeStatus: '运行状态',
    version: '当前版本',
    url: '访问地址',
    port: '容器端口',
    healthcheck: '健康检查路径',
    db: '数据库',
    dbYes: '需要',
    dbNo: '无需',
    exposureTitle: '暴露状态',
    exposureStatus: {
      reachable: '正常可访问 (Reachable)',
      degraded: '降级/受阻 (Degraded)',
      tunnel_only: '仅隧道模式',
      not_checked: '未检查'
    },
    exposureDegradedAlert: '外部端口受阻或无法从公网访问。',
    doctorDiagnose: '使用 Doctor 诊断',
    doctorAutoFix: '安全自动修复',
    doctorFixSuccess: '已修复并成功验证可达性。',
    versionHistory: '已部署版本',
    versionCount: (count: number) => `${count} 条记录`,
    rollback: '回滚',
    rollbackTitle: '确认回滚',
    rollbackConfirm: '确认回滚',
    rollbackWarning: (from: string, to: string) => `当前版本 ${from} 将被替换为 ${to}。`,
    rollbackHint: '回滚后将运行健康检查。如未通过，OpsPilot 会保留现场证据供排查。',
    rollbackInputPrompt: '请输入完整的应用名称以确认此运行时变更。',
    rollbackSuccess: '回滚成功',
    rollbackFailed: '回滚失败',
    offlineConfirmHint: '应用处于离线状态，可直接确认回滚。',
    openApp: '打开应用',
    detailAria: (name: string) => `${name} 详情`,
    emptyDeployments: '暂无部署记录',
    buildDuration: (duration: string) => `构建用时 ${duration}`,
    imageTag: (tag: string) => `标签 ${tag}`,
    portBinding: (host: number, container: number) => `主机:${host} → 容器:${container}`,
    loadingVersions: '正在加载版本列表…'
  },
  settings: {
    title: '系统设置',
    description: '界面外观及正在开发的功能状态。',
    appearance: '界面外观',
    appearanceDescription: '选择当前会话的主题。',
    language: '界面语言',
    languageDescription: '选择 OpsPilot 系统显示语言。',
    categoriesLabel: '设置分类',
    monitoringCategory: '系统监控',
    dark: '深色',
    light: '浅色',
    monitoring: 'ML 监控与自动回滚',
    deferred: '开发中，预计 9月28日 后上线',
    languages: {
      en: 'English',
      vi: 'Tiếng Việt',
      cn: '简体中文',
      jp: '日本語'
    }
  }
}

const JP_OVERRIDES: Partial<typeof BASE_EN_STRINGS> = {
  navigation: {
    vps: 'サーバー',
    apps: 'アプリ',
    deploy: 'デプロイ',
    dashboard: 'ダッシュボード',
    migrate: '移行',
    history: 'アクティビティ',
    settings: 'システム設定'
  },
  common: {
    cancel: 'キャンセル',
    notAvailable: 'なし',
    refresh: '更新',
    retry: '再試行',
    save: '保存',
    close: '閉じる',
    back: '戻る',
    confirm: '確認',
    saveError: 'VPSを保存できませんでした'
  },
  deploy: {
    ...BASE_EN_STRINGS.deploy,
    title: 'アプリケーションデプロイ',
    description:
      'ソースフォルダを選択 — フレームワークを自動検出してSSH経由でVPSにデプロイします。',
    vpsLabel: '対象 VPS',
    sourceLabel: 'ソースフォルダ',
    noVps: 'VPSがありません。デプロイ前にVPS画面で追加してください。',
    pickFolder: 'フォルダを選択',
    pickAgain: '再選択',
    next: '次へ',
    back: '戻る',
    steps: {
      source: 'ソース',
      detect: 'フレームワーク検出',
      config: '環境設定',
      review: '確認と実行'
    },
    review: {
      ...BASE_EN_STRINGS.deploy.review,
      title: 'デプロイ前 VPS チェック',
      checking: '事前チェック実行中…',
      retry: '再チェック',
      urlLabel: 'アクセスURL',
      deploy: 'デプロイ開始',
      deployDisabled: '事前チェック未通過 — VPSで問題を解消して再チェックしてください。',
      error: '事前チェックを実行できませんでした。',
      columns: {
        check: 'チェック項目',
        required: '必要条件',
        actual: '実測値',
        result: '結果'
      }
    },
    exposure: {
      degradedTitle: '外部ポートが劣化またはアクセス不能',
      blockedHint:
        '外部ポートがファイアウォールでブロックされている可能性があります。Doctorで診断し安全に自動修復してください。',
      reachable: '外部ポートは正常にアクセス可能'
    },
    doctor: {
      diagnose: 'Doctor で診断',
      autoFix: '安全な自動修復'
    },
    domain: {
      ...BASE_EN_STRINGS.deploy.domain,
      title: 'ドメイン設定',
      directPort: '直接ポート (:port)',
      sharedIngress: '共有インプレス (HTTPS)',
      namedTunnelDisabled: 'Named tunnel (設定済みCNAME tunnelが必要)',
      generateRecord: 'DNSレコード生成',
      verifyPropagation: '伝播状況を確認',
      cfTokenPlaceholder: 'Cloudflare API トークン (1回限り)',
      cfZonePlaceholder: 'Cloudflare ゾーン ID',
      cfUpdate: 'Cloudflare 更新',
      recordLabel: 'レコード',
      targetUrlLabel: '予定 URL',
      instructionsLabel: '手順',
      modeLabel: 'ドメインモード',
      cfTokenLabel: 'Cloudflare API トークン',
      cfZoneLabel: 'Cloudflare ゾーン ID',
      namedTunnelError:
        'named_tunnel モードには設定済み CNAME tunnel が必要です。VPS IP からの自動作成は未対応です。',
      generatedHint:
        'レコードを生成しました。自動更新には Provider API が必要です。未設定の場合はコピーして伝播を確認してください。',
      cfMissing: 'DNS を自動更新するには Cloudflare API トークンとゾーン ID を入力してください。',
      currentStatus: (msg: string, status: string) => `${msg} 現在のステータス: ${status}。`,
      dnsStatus: (status: string, observed: string[]) =>
        `DNS: ${status}${observed.length ? ` — ${observed.join(', ')}` : ''}`
    },
    log: {
      ...BASE_EN_STRINGS.deploy.log,
      title: 'デプロイログ',
      openApp: 'アプリを開く',
      viewDashboard: 'ダッシュボードを表示',
      cancel: 'デプロイを中止',
      cancelConfirm: '中止',
      cancelAsk:
        '途中でデプロイを中止しますか？ステップに応じて、既存アプリが保持またはクリーンアップされます。',
      backToWizard: 'ウィザードに戻る'
    }
  },
  apps: {
    title: 'アプリ一覧',
    description: 'ランタイムおよびデプロイバージョンの管理。',
    count: (count: number) => `${count} 個のアプリ`,
    searchPlaceholder: 'アプリを検索…',
    empty: 'アプリがありません',
    emptyHint: '最初のアプリをデプロイしてここで管理を開始します。',
    emptySearch: '該当するアプリが見つかりません',
    selectAppHint: '詳細を表示するアプリを選択してください',
    runtime: 'ランタイム',
    healthy: '実行中 · 正常',
    unhealthy: '要確認',
    lastDeploy: '最終デプロイ',
    vpsHost: 'VPS ホスト',
    connectedLocal: 'ローカル接続済み',
    tabs: {
      overview: '概要',
      versions: 'バージョン履歴'
    },
    runtimeInfo: 'ランタイム情報',
    runtimeSync: '最新デプロイから同期',
    appName: 'アプリ名',
    framework: 'フレームワーク',
    vps: '対象 VPS',
    runtimeStatus: 'ランタイム状態',
    version: 'バージョン',
    url: 'アプリURL',
    port: 'コンテナポート',
    healthcheck: 'ヘルスチェックパス',
    db: 'データベース',
    dbYes: '必要',
    dbNo: '不要',
    exposureTitle: '公開ステータス',
    exposureStatus: {
      reachable: 'アクセス可能 (Reachable)',
      degraded: '劣化/ブロック中 (Degraded)',
      tunnel_only: 'トンネルのみ',
      not_checked: '未確認'
    },
    exposureDegradedAlert: '外部ポートが劣化しているか、インターネットからアクセスできません。',
    doctorDiagnose: 'Doctor で診断',
    doctorAutoFix: '安全な自動修復',
    doctorFixSuccess: '修復と到達性の検証が完了しました。',
    versionHistory: 'デプロイ済みバージョン',
    versionCount: (count: number) => `${count} 件`,
    rollback: 'ロールバック',
    rollbackTitle: 'ロールバックの確認',
    rollbackConfirm: 'ロールバックの確認',
    rollbackWarning: (from: string, to: string) =>
      `現在のバージョン ${from} が ${to} に置き換えられます。`,
    rollbackHint:
      'ロールバック後にヘルスチェックが実行されます。失敗した場合、原因調査用の証拠が保持されます。',
    rollbackInputPrompt:
      'ランタイムに影響を与える操作を確認するため、正確なアプリ名を入力してください。',
    rollbackSuccess: 'ロールバックが完了しました',
    rollbackFailed: 'ロールバック失敗',
    offlineConfirmHint: 'アプリはオフラインのため、すぐに確認できます。',
    openApp: 'アプリを開く',
    detailAria: (name: string) => `${name} の詳細`,
    emptyDeployments: 'デプロイ履歴がありません',
    buildDuration: (duration: string) => `ビルド時間 ${duration}`,
    imageTag: (tag: string) => `タグ ${tag}`,
    portBinding: (host: number, container: number) => `ホスト:${host} → コンテナ:${container}`,
    loadingVersions: 'バージョン一覧を読み込み中…'
  },
  settings: {
    title: 'システム設定',
    description: '外観および開発中の機能ステータス。',
    appearance: '外観',
    appearanceDescription: 'このセッションのテーマを選択します。',
    language: '表示言語',
    languageDescription: 'OpsPilot の表示言語を選択してください。',
    categoriesLabel: '設定カテゴリー',
    monitoringCategory: 'モニタリング',
    dark: 'ダーク',
    light: 'ライト',
    monitoring: 'ML監視および自動ロールバック',
    deferred: '開発中、9月28日以降提供予定',
    languages: {
      en: 'English',
      vi: 'Tiếng Việt',
      cn: '简体中文',
      jp: '日本語'
    }
  }
}

const LOCALIZED_DICTIONARIES: Record<LocaleMode, typeof BASE_EN_STRINGS> = {
  en: BASE_EN_STRINGS,
  vi: {
    ...BASE_EN_STRINGS,
    ...VI_OVERRIDES,
    common: { ...BASE_EN_STRINGS.common, ...VI_OVERRIDES.common },
    navigation: { ...BASE_EN_STRINGS.navigation, ...VI_OVERRIDES.navigation },
    apps: { ...BASE_EN_STRINGS.apps, ...VI_OVERRIDES.apps },
    deploy: {
      ...BASE_EN_STRINGS.deploy,
      ...VI_OVERRIDES.deploy,
      steps: { ...BASE_EN_STRINGS.deploy.steps, ...VI_OVERRIDES.deploy?.steps },
      exposure: { ...BASE_EN_STRINGS.deploy.exposure, ...VI_OVERRIDES.deploy?.exposure },
      doctor: { ...BASE_EN_STRINGS.deploy.doctor, ...VI_OVERRIDES.deploy?.doctor },
      domain: { ...BASE_EN_STRINGS.deploy.domain, ...VI_OVERRIDES.deploy?.domain },
      review: {
        ...BASE_EN_STRINGS.deploy.review,
        ...VI_OVERRIDES.deploy?.review,
        columns: {
          ...BASE_EN_STRINGS.deploy.review.columns,
          ...VI_OVERRIDES.deploy?.review?.columns
        }
      },
      log: { ...BASE_EN_STRINGS.deploy.log, ...VI_OVERRIDES.deploy?.log }
    },
    settings: {
      ...BASE_EN_STRINGS.settings,
      ...VI_OVERRIDES.settings,
      languages: { ...BASE_EN_STRINGS.settings.languages, ...VI_OVERRIDES.settings?.languages }
    }
  },
  cn: {
    ...BASE_EN_STRINGS,
    ...CN_OVERRIDES,
    common: { ...BASE_EN_STRINGS.common, ...CN_OVERRIDES.common },
    navigation: { ...BASE_EN_STRINGS.navigation, ...CN_OVERRIDES.navigation },
    apps: { ...BASE_EN_STRINGS.apps, ...CN_OVERRIDES.apps },
    deploy: {
      ...BASE_EN_STRINGS.deploy,
      ...CN_OVERRIDES.deploy,
      steps: { ...BASE_EN_STRINGS.deploy.steps, ...CN_OVERRIDES.deploy?.steps },
      exposure: { ...BASE_EN_STRINGS.deploy.exposure, ...CN_OVERRIDES.deploy?.exposure },
      doctor: { ...BASE_EN_STRINGS.deploy.doctor, ...CN_OVERRIDES.deploy?.doctor },
      domain: { ...BASE_EN_STRINGS.deploy.domain, ...CN_OVERRIDES.deploy?.domain },
      review: {
        ...BASE_EN_STRINGS.deploy.review,
        ...CN_OVERRIDES.deploy?.review,
        columns: {
          ...BASE_EN_STRINGS.deploy.review.columns,
          ...CN_OVERRIDES.deploy?.review?.columns
        }
      },
      log: { ...BASE_EN_STRINGS.deploy.log, ...CN_OVERRIDES.deploy?.log }
    },
    settings: {
      ...BASE_EN_STRINGS.settings,
      ...CN_OVERRIDES.settings,
      languages: { ...BASE_EN_STRINGS.settings.languages, ...CN_OVERRIDES.settings?.languages }
    }
  },
  jp: {
    ...BASE_EN_STRINGS,
    ...JP_OVERRIDES,
    common: { ...BASE_EN_STRINGS.common, ...JP_OVERRIDES.common },
    navigation: { ...BASE_EN_STRINGS.navigation, ...JP_OVERRIDES.navigation },
    apps: { ...BASE_EN_STRINGS.apps, ...JP_OVERRIDES.apps },
    deploy: {
      ...BASE_EN_STRINGS.deploy,
      ...JP_OVERRIDES.deploy,
      steps: { ...BASE_EN_STRINGS.deploy.steps, ...JP_OVERRIDES.deploy?.steps },
      exposure: { ...BASE_EN_STRINGS.deploy.exposure, ...JP_OVERRIDES.deploy?.exposure },
      doctor: { ...BASE_EN_STRINGS.deploy.doctor, ...JP_OVERRIDES.deploy?.doctor },
      domain: { ...BASE_EN_STRINGS.deploy.domain, ...JP_OVERRIDES.deploy?.domain },
      review: {
        ...BASE_EN_STRINGS.deploy.review,
        ...JP_OVERRIDES.deploy?.review,
        columns: {
          ...BASE_EN_STRINGS.deploy.review.columns,
          ...JP_OVERRIDES.deploy?.review?.columns
        }
      },
      log: { ...BASE_EN_STRINGS.deploy.log, ...JP_OVERRIDES.deploy?.log }
    },
    settings: {
      ...BASE_EN_STRINGS.settings,
      ...JP_OVERRIDES.settings,
      languages: { ...BASE_EN_STRINGS.settings.languages, ...JP_OVERRIDES.settings?.languages }
    }
  }
}

export function getStrings(locale: LocaleMode = 'en'): typeof BASE_EN_STRINGS {
  return LOCALIZED_DICTIONARIES[locale] || LOCALIZED_DICTIONARIES.en
}

export function useStrings(): typeof BASE_EN_STRINGS {
  const locale = useUiState((state) => state.locale)
  return getStrings(locale)
}

export const strings: typeof BASE_EN_STRINGS = new Proxy({} as typeof BASE_EN_STRINGS, {
  get(_target, prop) {
    const locale = useUiState.getState().locale || 'en'
    const dict = getStrings(locale)
    return (dict as Record<string | symbol, unknown>)[prop]
  }
})
