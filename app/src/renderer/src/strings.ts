export const strings = {
  app: {
    name: 'OpsPilot',
    noSelection: 'No VPS selected',
    vpsSelected: (count: number) => `${count} VPS selected`
  },
  navigation: {
    vps: 'VPS',
    apps: 'Apps',
    deploy: 'Deploy',
    dashboard: 'Dashboard',
    migrate: 'Migrate',
    history: 'History',
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
    notAvailable: 'Not available',
    refresh: 'Refresh',
    retry: 'Retry',
    save: 'Save',
    close: 'Close',
    back: 'Back',
    confirm: 'Confirm',
    saveError: 'Could not save the VPS'
  },
  pipeline: {
    title: 'Deploy Pipeline (Dynamic)',
    status: {
      completed: 'Completed',
      in_progress: 'Running',
      error: 'Failed',
      pending: 'Pending'
    },
    steps: {
      PRECHECK: { title: 'Precheck', desc: 'Check VPS RAM / Disk / Port' },
      UPLOAD: { title: 'Upload', desc: 'Push source code to the VPS' },
      RENDER: { title: 'Render', desc: 'Generate Dockerfile & Compose' },
      BUILD: { title: 'Build', desc: 'Run Docker build' },
      DEPLOY: { title: 'Deploy', desc: 'Start container & swap port' },
      HEALTHCHECK: { title: 'Healthcheck', desc: 'Verify HTTP GET live' },
      RECORD: { title: 'Record', desc: 'Save version info to DB' }
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
    title: 'Projects & Deploy Launcher',
    description: 'Pick a project to deploy a new version or watch the current pipeline.',
    deployNew: 'Deploy new version',
    newProject: '+ New project',
    searchPlaceholder: 'Search projects...',
    statusOnline: 'Online',
    statusOffline: 'Offline',
    statusDeploying: 'Deploying'
  },
  wizard: {
    title: 'Deploy Wizard — 4 Steps',
    step1: '1. Source',
    step2: '2. Detect',
    step3: '3. Configuration',
    step4: '4. Precheck & Deploy',
    detectSuccess: 'Framework detected successfully!',
    precheckOk: 'All RAM / Disk / Port checks passed. Ready to deploy.',
    startDeploy: 'Confirm Deploy'
  },
  vps: {
    title: 'Servers',
    description: 'Fleet overview and server control panel for OpsPilot.',
    create: 'Add VPS',
    createFirst: 'Add your first VPS',
    listCardTitle: 'Server list',
    empty: 'No VPS yet. Add your first VPS to start deploying.',
    loadError: 'Could not load the VPS list',
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
    title: 'Overview',
    refresh: 'Refresh',
    stats: {
      vpsOnline: 'VPS online',
      appsRunning: 'Apps running',
      deploy24h: 'Deploys in 24h',
      lastDeploy: 'Last deploy'
    },
    recent: {
      title: 'Recent activity',
      columnTime: 'Time',
      columnAction: 'Action',
      columnVps: 'VPS',
      columnStatus: 'Status',
      columnMessage: 'Message',
      empty: 'No activity yet. Deploy your first app to see history here.',
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
      success: 'Succeeded',
      failed: 'Failed',
      cancelled: 'Cancelled'
    },
    emptyVps: 'No VPS yet. Add your first VPS to start deploying.',
    addVps: 'Add VPS',
    loadFailed: 'Could not load the dashboard data.',
    retry: 'Retry'
  },
  history: {
    title: 'History',
    description: 'Browse deploys, rollbacks and alerts.',
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
      apps: 'Apps & deploy',
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
      dockerMissing: 'No Docker',
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
      deployNew: 'Deploy new app',
      redeploy: 'Redeploy',
      openApp: 'Open app',
      empty: 'No apps on this server yet.',
      emptyHint: 'Deploy your first app to start monitoring and managing it here.',
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
        none: 'No deployment'
      }
    },
    activity: {
      title: 'Recent activity',
      empty: 'No activity on this server yet.',
      emptyHint: 'Deploy or manage apps to see actions logged here.',
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
  appearance: {
    label: 'Appearance',
    light: 'Light',
    dark: 'Dark'
  }
} as const
