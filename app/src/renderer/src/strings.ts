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
  vpsStatus: {
    checking: 'Checking…',
    checkedNow: 'Checked just now',
    checkFailed: 'Check failed',
    stale: 'Not checked recently',
    unknown: 'Unknown',
    recentPast: 'Checked recently',
    reportedOffline: 'Offline (previous check)'
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
      online: 'Checked now',
      offline: 'Check failed',
      unknown: 'Unknown',
      checking: 'Checking…',
      checkedNow: 'Checked now',
      checkFailed: 'Check failed',
      stale: 'Not checked recently',
      recentPast: 'Checked recently'
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
    vpsLoading: 'Loading VPS list…',
    vpsLoadError: 'Could not load VPS list',
    appLoadError: 'Could not load applications for this VPS',
    appLoading: 'Loading applications…',
    preselectVpsNotFound: 'Preselected VPS was not found or has been removed.',
    preselectAppNotFound: 'Preselected application is no longer associated with this VPS.',
    chooseAvailableVps: 'Select available VPS',
    switchToNewApp: 'Deploy as new app',
    targetApp: {
      title: 'Target application',
      mode: 'Deployment target',
      new: 'New application',
      existing: 'Existing application',
      selectApp: 'Select application',
      selectAppPlaceholder: 'Select an application…',
      noApps: 'No applications found on this VPS (will deploy as a new application)',
      appName: 'Application name',
      appNameRule: 'Lowercase a-z, digits and dashes — must start with a letter.'
    },
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
      manualTitle: 'Manual steps after deploy',
      missingRequired: (keys: string[]) => `Missing required variables: ${keys.join(', ')}.`
    },
    review: {
      summaryTitle: 'Deployment summary',
      targetVps: 'Target VPS',
      targetApp: 'Target application',
      sourcePath: 'Source folder',
      envList: 'Environment variables',
      noEnv: 'None',
      envConfigured: 'Configured',
      checksTitle: 'Precheck results',
      title: 'Check VPS before deploy',
      checking: 'Running precheck…',
      retry: 'Check again',
      urlLabel: 'URL to use',
      deploy: 'Deploy',
      starting: 'Starting deploy…',
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
      runtimeRunning: 'Runtime container is running',
      reachableTitle: 'Runtime running — External port reachable',
      reachableDesc: 'Application is deployed and reachable from external network.',
      degradedTitle: 'External port degraded / unreachable',
      blockedHint:
        'External port may be blocked by firewall. Run Doctor to diagnose and auto-fix safely.',
      tunnelOnlyTitle: 'Runtime running — Private tunnel only',
      tunnelOnlyDesc:
        'Application is running securely via internal network or Cloudflare Tunnel without public host ports.',
      notCheckedTitle: 'Runtime running — External reachability not checked',
      notCheckedDesc:
        'Container is running. External connectivity check to host port has not been performed.',
      reachableTag: 'External: Reachable',
      degradedTag: 'External: Degraded',
      tunnelOnlyTag: 'External: Tunnel only',
      notCheckedTag: 'External: Not checked',
      runtimeTag: 'Runtime: Running',
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
      steps: {
        PRECHECK: 'Precheck',
        UPLOAD: 'Upload source',
        RENDER: 'Render templates',
        BUILD: 'Build image',
        DEPLOY: 'Start container',
        HEALTHCHECK: 'Healthcheck',
        RECORD: 'Record status'
      },
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
    statusRecordedDeployed: 'Recorded',
    statusNotDeployed: 'Not deployed',
    recordedTitle: 'Recorded deployment',
    recordedStatus: (status: string, version: number) => `Recorded: ${status} (v${version})`,
    currentDeploymentNotFound: 'Current deployment not found in history',
    currentDeploymentMismatchDesc: (id: number) =>
      `Deployment record #${id} could not be found in version history.`,
    vpsStaleNotice: 'Server not checked recently (>24h)',
    inspectLive: 'Live inspect',
    recheckLive: 'Recheck',
    liveUnverified: 'Unverified',
    liveRunning: 'Live: Running',
    liveState: (state: string) => `Live: ${state}`,
    exposurePublishResult: 'Exposure (publish record)',
    runtime: 'Runtime',
    healthy: 'Running · Healthy',
    unhealthy: 'Needs attention',
    lastDeploy: 'Last deploy',
    vpsHost: 'VPS host',
    connectedLocal: 'Connected locally',
    tabs: {
      overview: 'Overview',
      history: 'History & Rollback',
      doctor: 'Doctor & Exposure',
      versions: 'History & Rollback'
    },
    backToList: 'Back to applications',
    allVps: 'All VPS hosts',
    viewDetail: 'Details',
    deployAction: 'Deploy',
    viewVps: 'View target VPS',
    deployNewVersion: 'Deploy new version',
    activeVersion: 'Active',
    countDisplay: (filtered: number, total: number) =>
      `Showing ${filtered} / ${total} applications`,
    doctorExposureTitle: 'Doctor & Exposure',
    doctorDesc: 'Diagnose network reachability, socket bindings, and safe auto-fix configuration.',
    doctorDiagnosticEvidence: 'Diagnostic evidence',
    doctorCheckItem: 'Check item',
    doctorResult: 'Result',
    doctorEvidence: 'Observed evidence',
    doctorNotRunYet:
      'Click "Diagnose with Doctor" to run network reachability and configuration checks.',
    runtimeInfo: 'Runtime information',
    runtimeSync: 'Synced from latest deployment',
    appName: 'Application name',
    framework: 'Framework',
    vps: 'Target VPS',
    runtimeStatus: 'Runtime status',
    version: 'Version',
    deploymentIdTitle: 'Deployment ID',
    loadError: 'Failed to load applications',
    versionsLoadError: 'Failed to load version history',
    recordMismatch: (id: number) => `Record not found (#${id})`,
    noDeploymentsYet: 'No deployments recorded yet',
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
    description: 'System overview, managed applications, and recent activities.',
    summaryLabel: 'System summary',
    refresh: 'Refresh',
    viewApps: 'View applications',
    viewVps: 'View servers',
    deployAction: '+ Deploy',
    stats: {
      vpsOnline: 'VPS checked now',
      appsRunning: 'Recorded deployments',
      deploy24h: 'Deploys in last 24h',
      lastDeploy: 'Last deployment'
    },
    apps: {
      title: 'Managed applications',
      description: 'Applications deployed across infrastructure nodes.',
      viewAll: 'View all',
      columnName: 'Application',
      columnPort: 'Port',
      columnVps: 'Server',
      columnStatus: 'Recorded status',
      empty: 'No applications deployed yet.',
      deployApp: 'Deploy application',
      openApp: 'Open app',
      statusDeployed: 'Recorded: Deployed',
      statusNotDeployed: 'Not deployed'
    },
    recent: {
      title: 'Recent activity',
      description: 'Audit log of operations across all servers.',
      viewAll: 'View audit log',
      columnTime: 'Time',
      columnAction: 'Action',
      columnVps: 'Server',
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
      actionAll: 'All actions',
      vps: 'Server',
      vpsAll: 'All servers',
      timeRange: 'Time range',
      startDate: 'Start date',
      endDate: 'End date'
    },
    columns: {
      time: 'Time',
      action: 'Action',
      vps: 'Server',
      status: 'Status',
      message: 'Message'
    },
    actions: {
      deploy: 'Deploy',
      rollback_auto: 'Auto rollback',
      rollback_manual: 'Manual rollback',
      scan: 'Environment scan',
      install_docker: 'Install Docker',
      restart: 'Restart app',
      stop: 'Stop app',
      migrate_start: 'Start migration',
      migrate_confirm: 'Confirm migration',
      migrate_abort: 'Abort migration',
      ssh_error: 'SSH connection error'
    },
    statuses: {
      success: 'Success',
      failed: 'Failed',
      cancelled: 'Cancelled'
    },
    detail: {
      title: 'Activity details',
      time: 'Time',
      vps: 'Server',
      action: 'Action',
      status: 'Status',
      message: 'Message',
      fields: 'Extra details',
      emptyFields: 'No extra details.'
    },
    empty: 'No activity matches this filter.',
    emptyPage: 'This page has no records.',
    loadFailed: 'Could not load the history.',
    retry: 'Retry',
    pagination: {
      prev: 'Previous page',
      next: 'Next page',
      prevPageAction: 'Go back to previous page',
      page: (page: number) => `Page ${page}`,
      pageTotal: (from: number, to: number, total: number) => `${from}–${to} of ${total}`,
      pageMore: (from: number, to: number) => `${from}–${to} (more records available)`
    }
  },
  vpsControl: {
    tabs: {
      overview: 'Overview & Resources',
      apps: 'Server Applications',
      database: 'Database',
      activity: 'Activity'
    },
    fleet: {
      totalVps: 'Total VPS',
      checkedNow: 'Checked now',
      checkFailed: 'Check failed',
      online: 'Checked now',
      offline: 'Check failed',
      totalApps: 'Total apps'
    },
    selector: {
      searchPlaceholder: 'Search by name or host…',
      filterAll: 'All statuses',
      filterButton: 'Filter by status',
      filterCheckedNow: 'Checked now',
      filterCheckFailed: 'Check failed',
      filterStale: 'Not checked recently',
      filterUnknown: 'Unknown',
      copyIp: 'Copy IP',
      pageTotal: (from: number, to: number, total: number) => `${from}-${to} of ${total}`,
      noSelection: 'Select a VPS from the list on the left to view details.',
      dockerMissing: 'Docker missing',
      appsCount: (count: number) => (count === 0 ? 'No apps' : `${count} apps`)
    },
    overview: {
      machineTitle: 'Machine info',
      resourcesTitle: 'System resources (CPU / RAM / Disk)',
      resourcesEmpty: 'Resources have not been checked in this session yet.',
      resourcesRefresh: 'Read resources',
      gaugesTitle: 'Resource usage',
      specsTitle: 'Resource specifications',
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
      actionsTitle: 'Server actions',
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
      notSupportedTitle: 'Database management not supported',
      notSupportedDesc: 'Database management for this server is not yet available in OpsPilot.',
      notSupported: 'Database management is not supported yet on this server.',
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
  vpsStatus: {
    checking: 'Đang kiểm tra…',
    checkedNow: 'Vừa kiểm tra',
    checkFailed: 'Không thể kiểm tra',
    stale: 'Chưa kiểm tra gần đây',
    unknown: 'Chưa rõ',
    recentPast: 'Đã kiểm tra gần đây',
    reportedOffline: 'Ngoại tuyến (lần kiểm tra trước)'
  },
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
  vps: {
    ...BASE_EN_STRINGS.vps,
    status: {
      online: 'Vừa kiểm tra',
      offline: 'Không thể kiểm tra',
      unknown: 'Chưa rõ',
      checking: 'Đang kiểm tra…',
      checkedNow: 'Vừa kiểm tra',
      checkFailed: 'Không thể kiểm tra',
      stale: 'Chưa kiểm tra gần đây',
      recentPast: 'Đã kiểm tra gần đây'
    }
  },
  vpsControl: {
    ...BASE_EN_STRINGS.vpsControl,
    tabs: {
      overview: 'Tổng quan & Tài nguyên',
      apps: 'Ứng dụng trên máy chủ',
      database: 'Cơ sở dữ liệu',
      activity: 'Hoạt động'
    },
    fleet: {
      totalVps: 'Tổng VPS',
      checkedNow: 'Vừa kiểm tra',
      checkFailed: 'Không thể kiểm tra',
      online: 'Vừa kiểm tra',
      offline: 'Không thể kiểm tra',
      totalApps: 'Tổng ứng dụng'
    },
    selector: {
      searchPlaceholder: 'Tìm theo tên hoặc host…',
      filterAll: 'Tất cả trạng thái',
      filterButton: 'Lọc theo trạng thái',
      filterCheckedNow: 'Vừa kiểm tra',
      filterCheckFailed: 'Không thể kiểm tra',
      filterStale: 'Chưa kiểm tra gần đây',
      filterUnknown: 'Chưa rõ',
      copyIp: 'Sao chép IP',
      pageTotal: (from: number, to: number, total: number) => `${from}-${to} trong ${total}`,
      noSelection: 'Chọn một VPS từ danh sách bên trái để xem chi tiết.',
      dockerMissing: 'Chưa cài Docker',
      appsCount: (count: number) => (count === 0 ? 'Chưa có app' : `${count} ứng dụng`)
    },
    header: {
      mainIp: 'IP chính',
      sshPort: 'Cổng SSH',
      sshCommand: 'Lệnh SSH'
    },
    sidebar: {
      title: 'Thông tin máy chủ',
      cpu: 'Tải CPU',
      ram: 'Mức dùng RAM',
      cores: 'Số nhân CPU',
      disk: 'Ổ đĩa',
      ramTotal: 'Tổng RAM',
      loadAvg: 'Tải trung bình (1m)',
      docker: 'Docker',
      lastSeen: 'Lần kiểm tra cuối',
      checking: 'Đang đọc tài nguyên hệ thống…',
      resourceError: 'Không thể đọc tài nguyên máy chủ',
      retryResources: 'Thử lại'
    },
    overview: {
      ...BASE_EN_STRINGS.vpsControl.overview,
      machineTitle: 'Thông tin máy chủ',
      resourcesTitle: 'Tài nguyên hệ thống (CPU / RAM / Disk)',
      resourcesEmpty: 'Chưa đọc tài nguyên trong phiên này.',
      resourcesRefresh: 'Đọc tài nguyên',
      gaugesTitle: 'Mức sử dụng tài nguyên',
      specsTitle: 'Thông số tài nguyên',
      checkedAt: (time: string) => `Đã kiểm tra tài nguyên: ${time}`,
      dockerMissing: 'Chưa cài Docker',
      neverSeen: 'Chưa từng kết nối',
      host: 'Máy chủ',
      sshPort: 'Cổng SSH',
      username: 'Tài khoản',
      providerRegion: 'Nhà cung cấp / Khu vực',
      docker: 'Docker',
      createdAt: 'Thời điểm thêm',
      lastSeen: 'Lần kiểm tra cuối',
      checkConnection: 'Kiểm tra & chẩn đoán kết nối',
      actionsTitle: 'Thao tác máy chủ',
      copyCommand: 'Sao chép lệnh SSH',
      copied: 'Đã sao chép'
    },
    apps: {
      title: 'Ứng dụng trên máy chủ',
      deployNew: 'Triển khai ứng dụng mới',
      redeploy: 'Triển khai lại',
      openApp: 'Mở app',
      empty: 'Chưa có ứng dụng nào trên máy chủ này.',
      emptyHint: 'Triển khai ứng dụng đầu tiên để quản lý tại đây.',
      loadFailed: 'Không thể tải danh sách ứng dụng trên máy chủ.',
      columns: {
        name: 'Tên',
        framework: 'Framework',
        port: 'Cổng',
        url: 'URL',
        version: 'Phiên bản',
        status: 'Trạng thái',
        actions: 'Thao tác'
      },
      status: {
        running: 'Đang chạy',
        failed: 'Thất bại',
        building: 'Đang đóng gói',
        deploying: 'Đang triển khai',
        stopped: 'Đã dừng',
        rolled_back: 'Đã khôi phục',
        none: 'Chưa triển khai'
      }
    },
    activity: {
      title: 'Hoạt động gần đây',
      empty: 'Chưa có hoạt động nào trên máy chủ này.',
      emptyHint: 'Triển khai hoặc quản lý ứng dụng để xem nhật ký tại đây.',
      loadFailed: 'Không thể tải nhật ký hoạt động cho máy chủ này.'
    },
    database: {
      ...BASE_EN_STRINGS.vpsControl.database,
      notSupportedTitle: 'Chưa hỗ trợ cơ sở dữ liệu',
      notSupportedDesc:
        'Tính năng quản lý cơ sở dữ liệu trên máy chủ hiện chưa khả dụng trong OpsPilot.',
      notSupported: 'Chưa hỗ trợ quản lý cơ sở dữ liệu trên máy chủ này.'
    }
  },
  dashboard: {
    ...BASE_EN_STRINGS.dashboard,
    title: 'Tổng quan hệ thống',
    description: 'Theo dõi tình trạng ứng dụng, máy chủ hạ tầng và các phiên triển khai gần nhất.',
    summaryLabel: 'Tóm tắt hệ thống',
    refresh: 'Làm mới',
    viewApps: 'Xem ứng dụng',
    viewVps: 'Xem máy chủ',
    deployAction: '+ Triển khai',
    stats: {
      vpsOnline: 'VPS vừa kiểm tra',
      appsRunning: 'Bản ghi triển khai',
      deploy24h: 'Lượt triển khai 24h qua',
      lastDeploy: 'Lần triển khai gần nhất'
    },
    apps: {
      title: 'Ứng dụng đang quản lý',
      description: 'Danh sách ứng dụng được triển khai trên các cụm máy chủ.',
      viewAll: 'Xem tất cả',
      columnName: 'Ứng dụng',
      columnPort: 'Cổng',
      columnVps: 'Máy chủ',
      columnStatus: 'Trạng thái ghi nhận',
      empty: 'Chưa có ứng dụng nào được triển khai.',
      deployApp: 'Triển khai ứng dụng',
      openApp: 'Mở ứng dụng',
      statusDeployed: 'Đã ghi nhận triển khai',
      statusNotDeployed: 'Chưa triển khai'
    },
    recent: {
      title: 'Hoạt động gần đây',
      description: 'Nhật ký các thao tác triển khai và bảo trì hệ thống.',
      viewAll: 'Xem toàn bộ hoạt động',
      columnTime: 'Thời gian',
      columnAction: 'Thao tác',
      columnVps: 'Máy chủ',
      columnStatus: 'Trạng thái',
      columnMessage: 'Thông điệp',
      empty: 'Chưa có hoạt động nào. Hãy triển khai ứng dụng đầu tiên để xem nhật ký.',
      deployNow: 'Triển khai ngay',
      unknownVps: 'VPS đã xóa',
      unknownAction: 'Khác'
    },
    actions: {
      deploy: 'Triển khai',
      rollback_auto: 'Tự động khôi phục',
      rollback_manual: 'Khôi phục thủ công'
    },
    statuses: {
      success: 'Thành công',
      failed: 'Thất bại',
      cancelled: 'Đã hủy'
    },
    emptyVps: 'Chưa có VPS nào được đăng ký. Hãy thêm VPS đầu tiên để bắt đầu triển khai.',
    addVps: 'Thêm VPS',
    loadFailed: 'Không thể tải dữ liệu tổng quan.',
    retry: 'Thử lại'
  },
  history: {
    ...BASE_EN_STRINGS.history,
    title: 'Nhật ký hoạt động',
    description: 'Xem các lần triển khai, khôi phục và cảnh báo.',
    filters: {
      action: 'Thao tác',
      actionAll: 'Tất cả thao tác',
      vps: 'Máy chủ',
      vpsAll: 'Tất cả máy chủ',
      timeRange: 'Khoảng thời gian',
      startDate: 'Từ ngày',
      endDate: 'Đến ngày'
    },
    columns: {
      time: 'Thời gian',
      action: 'Thao tác',
      vps: 'Máy chủ',
      status: 'Trạng thái',
      message: 'Thông điệp'
    },
    actions: {
      deploy: 'Triển khai',
      rollback_auto: 'Tự động khôi phục',
      rollback_manual: 'Khôi phục thủ công',
      scan: 'Quét môi trường',
      install_docker: 'Cài đặt Docker',
      restart: 'Khởi động lại',
      stop: 'Dừng ứng dụng',
      migrate_start: 'Bắt đầu di chuyển',
      migrate_confirm: 'Xác nhận di chuyển',
      migrate_abort: 'Hủy di chuyển',
      ssh_error: 'Lỗi kết nối SSH'
    },
    statuses: {
      success: 'Thành công',
      failed: 'Thất bại',
      cancelled: 'Đã hủy'
    },
    detail: {
      title: 'Chi tiết hoạt động',
      time: 'Thời gian',
      vps: 'Máy chủ',
      action: 'Thao tác',
      status: 'Trạng thái',
      message: 'Thông điệp',
      fields: 'Chi tiết bổ sung',
      emptyFields: 'Không có chi tiết bổ sung.'
    },
    empty: 'Không có hoạt động nào khớp với bộ lọc.',
    emptyPage: 'Trang này không có bản ghi nào.',
    loadFailed: 'Không thể tải lịch sử hoạt động.',
    retry: 'Thử lại',
    pagination: {
      prev: 'Trang trước',
      next: 'Trang kế',
      prevPageAction: 'Quay về trang trước',
      page: (page: number) => `Trang ${page}`,
      pageTotal: (from: number, to: number, total: number) => `${from}–${to} trong ${total}`,
      pageMore: (from: number, to: number) => `${from}–${to} (còn bản ghi)`
    }
  },
  deploy: {
    ...BASE_EN_STRINGS.deploy,
    title: 'Triển khai ứng dụng',
    description:
      'Chọn thư mục mã nguồn — ứng dụng tự nhận diện framework và triển khai lên VPS qua SSH.',
    vpsLabel: 'Máy chủ VPS triển khai',
    vpsLoading: 'Đang tải danh sách máy chủ…',
    vpsLoadError: 'Không thể tải danh sách máy chủ',
    appLoadError: 'Không thể tải danh sách ứng dụng của máy chủ này',
    appLoading: 'Đang tải danh sách ứng dụng…',
    preselectVpsNotFound: 'Máy chủ được chọn trước không tồn tại hoặc đã bị xóa.',
    preselectAppNotFound: 'Ứng dụng được chọn trước không còn thuộc máy chủ này.',
    chooseAvailableVps: 'Chọn máy chủ có sẵn',
    switchToNewApp: 'Chuyển sang ứng dụng mới',
    targetApp: {
      title: 'Ứng dụng đích',
      mode: 'Đích triển khai',
      new: 'Ứng dụng mới',
      existing: 'Ứng dụng hiện có',
      selectApp: 'Chọn ứng dụng',
      selectAppPlaceholder: 'Chọn một ứng dụng…',
      noApps: 'Chưa có ứng dụng nào trên VPS này (sẽ triển khai dưới dạng ứng dụng mới)',
      appName: 'Tên ứng dụng',
      appNameRule: 'Chữ thường a-z, chữ số và dấu gạch ngang — phải bắt đầu bằng chữ cái.'
    },
    config: {
      ...BASE_EN_STRINGS.deploy.config,
      appNameRule: 'Chữ thường a-z, chữ số và dấu gạch ngang — phải bắt đầu bằng chữ cái.',
      missingRequired: (keys: string[]) => `Thiếu các biến môi trường bắt buộc: ${keys.join(', ')}.`
    },
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
      summaryTitle: 'Tóm tắt cấu hình triển khai',
      targetVps: 'Máy chủ VPS',
      targetApp: 'Ứng dụng đích',
      sourcePath: 'Thư mục mã nguồn',
      envList: 'Biến môi trường',
      noEnv: 'Không có',
      envConfigured: 'Đã cấu hình',
      checksTitle: 'Kết quả kiểm tra',
      title: 'Kiểm tra VPS trước khi triển khai',
      checking: 'Đang kiểm tra trước…',
      retry: 'Kiểm tra lại',
      urlLabel: 'URL dự kiến',
      deploy: 'Bắt đầu triển khai',
      starting: 'Đang bắt đầu triển khai…',
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
      ...BASE_EN_STRINGS.deploy.exposure,
      runtimeRunning: 'Container ứng dụng đang chạy',
      reachableTitle: 'Ứng dụng đang chạy — Truy cập ngoài bình thường',
      reachableDesc:
        'Ứng dụng đã được triển khai thành công và sẵn sàng nhận kết nối từ bên ngoài.',
      degradedTitle: 'Cổng ngoài bị suy giảm hoặc chưa truy cập được',
      blockedHint:
        'Cổng ngoài có thể đang bị firewall chặn. Chạy Doctor để chẩn đoán và khắc phục an toàn.',
      tunnelOnlyTitle: 'Ứng dụng đang chạy — Chế độ đường hầm riêng (Tunnel only)',
      tunnelOnlyDesc:
        'Ứng dụng đang chạy an toàn qua mạng nội bộ hoặc Cloudflare Tunnel, không mở cổng public trực tiếp.',
      notCheckedTitle: 'Ứng dụng đang chạy — Chưa kiểm tra truy cập ngoài',
      notCheckedDesc:
        'Container đang chạy. Chưa thực hiện kiểm tra kết nối từ Internet tới cổng máy chủ.',
      reachableTag: 'Truy cập ngoài: Đạt',
      degradedTag: 'Truy cập ngoài: Bị chặn',
      tunnelOnlyTag: 'Truy cập ngoài: Tunnel riêng',
      notCheckedTag: 'Truy cập ngoài: Chưa kiểm tra',
      runtimeTag: 'Runtime: Đang chạy',
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
      steps: {
        PRECHECK: 'Kiểm tra trước',
        UPLOAD: 'Tải mã nguồn',
        RENDER: 'Dựng cấu hình',
        BUILD: 'Đóng gói ảnh',
        DEPLOY: 'Chạy container',
        HEALTHCHECK: 'Kiểm tra dịch vụ',
        RECORD: 'Lưu trạng thái'
      },
      openApp: 'Mở ứng dụng',
      viewDashboard: 'Xem tổng quan',
      running: 'Đang triển khai',
      success: (duration: string) => `Triển khai thành công trong ${duration}`,
      failedStep: (step: string) => `Thất bại ở bước ${step}`,
      rolledBack: 'Kiểm tra dịch vụ thất bại — đã tự động rollback về phiên bản trước.',
      toolbar: {
        copy: 'Sao chép',
        search: 'Tìm kiếm',
        searchPlaceholder: 'Tìm trong nhật ký…'
      },
      liveOutput: 'Nhật ký trực tiếp',
      finished: 'Hoàn tất',
      cancel: 'Hủy triển khai',
      cancelConfirm: 'Dừng',
      cancelAsk:
        'Dừng triển khai giữa chừng? Tùy bước hiện tại, ứng dụng cũ được giữ nguyên hoặc dọn dẹp.',
      scrollDown: 'Cuộn xuống dưới',
      empty: 'Chưa có nhật ký. Đang chuẩn bị…',
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
    statusRecordedDeployed: 'Đã ghi nhận',
    statusNotDeployed: 'Chưa triển khai',
    recordedTitle: 'Bản triển khai ghi nhận',
    recordedStatus: (status: string, version: number) => `Ghi nhận: ${status} (v${version})`,
    currentDeploymentNotFound: 'Bản triển khai hiện tại không có trong lịch sử',
    currentDeploymentMismatchDesc: (id: number) =>
      `Bản ghi triển khai #${id} không tìm thấy trong lịch sử phiên bản.`,
    vpsStaleNotice: 'Máy chủ chưa kiểm tra gần đây (>24h)',
    inspectLive: 'Kiểm tra runtime',
    recheckLive: 'Kiểm tra lại',
    liveUnverified: 'Chưa xác minh',
    liveRunning: 'Live: Đang chạy',
    liveState: (state: string) => `Live: ${state}`,
    exposurePublishResult: 'Exposure (lần publish)',
    runtime: 'Runtime',
    healthy: 'Đang chạy · Healthy',
    unhealthy: 'Cần kiểm tra',
    lastDeploy: 'Deploy gần nhất',
    vpsHost: 'VPS host',
    connectedLocal: 'Đang kết nối local',
    tabs: {
      overview: 'Tổng quan',
      history: 'Lịch sử & Rollback',
      doctor: 'Bác sĩ & Exposure',
      versions: 'Lịch sử & Rollback'
    },
    backToList: 'Quay lại danh sách ứng dụng',
    allVps: 'Tất cả Máy chủ VPS',
    viewDetail: 'Chi tiết',
    deployAction: 'Triển khai',
    viewVps: 'Xem máy chủ VPS',
    deployNewVersion: 'Triển khai phiên bản mới',
    activeVersion: 'Đang kích hoạt',
    countDisplay: (filtered: number, total: number) => `Hiển thị ${filtered} / ${total} ứng dụng`,
    doctorExposureTitle: 'Bác sĩ & Exposure',
    doctorDesc:
      'Chẩn đoán kết nối mạng, khả năng truy cập cổng và tự động sửa lỗi cấu hình an toàn.',
    doctorDiagnosticEvidence: 'Bằng chứng chẩn đoán',
    doctorCheckItem: 'Hạng mục kiểm tra',
    doctorResult: 'Kết quả',
    doctorEvidence: 'Bằng chứng quan sát',
    doctorNotRunYet:
      'Bấm "Chẩn đoán với Doctor" để kiểm tra khả năng truy cập mạng và cấu hình cổng.',
    runtimeInfo: 'Thông tin runtime',
    runtimeSync: 'Đồng bộ từ lần deploy gần nhất',
    appName: 'Tên ứng dụng',
    framework: 'Framework',
    vps: 'Máy chủ VPS',
    runtimeStatus: 'Trạng thái runtime',
    version: 'Phiên bản',
    deploymentIdTitle: 'ID bản triển khai',
    loadError: 'Không thể tải danh sách ứng dụng',
    versionsLoadError: 'Lỗi tải lịch sử phiên bản',
    recordMismatch: (id: number) => `Không tìm thấy (#${id})`,
    noDeploymentsYet: 'Chưa có bản triển khai nào được ghi nhận',
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
  vpsStatus: {
    checking: '正在检查…',
    checkedNow: '刚刚检查',
    checkFailed: '无法检查',
    stale: '近期未检查',
    unknown: '未知',
    recentPast: '近期已检查',
    reportedOffline: '离线（上次检查）'
  },
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
  vps: {
    ...BASE_EN_STRINGS.vps,
    status: {
      online: '刚刚检查',
      offline: '无法检查',
      unknown: '未知',
      checking: '正在检查…',
      checkedNow: '刚刚检查',
      checkFailed: '无法检查',
      stale: '近期未检查',
      recentPast: '近期已检查'
    }
  },
  vpsControl: {
    ...BASE_EN_STRINGS.vpsControl,
    tabs: {
      overview: '概览与资源',
      apps: '服务器应用',
      database: '数据库',
      activity: '活动记录'
    },
    fleet: {
      totalVps: 'VPS 总数',
      checkedNow: '刚刚检查',
      checkFailed: '无法检查',
      online: '刚刚检查',
      offline: '无法检查',
      totalApps: '应用总数'
    },
    selector: {
      searchPlaceholder: '按名称或主机搜索…',
      filterAll: '全部状态',
      filterButton: '按状态筛选',
      filterCheckedNow: '刚刚检查',
      filterCheckFailed: '无法检查',
      filterStale: '近期未检查',
      filterUnknown: '未知',
      copyIp: '复制 IP',
      pageTotal: (from: number, to: number, total: number) => `${from}-${to} / 共 ${total}`,
      noSelection: '从左侧列表中选择 VPS 以查看详情。',
      dockerMissing: '未安装 Docker',
      appsCount: (count: number) => (count === 0 ? '无应用' : `${count} 个应用`)
    },
    header: {
      mainIp: '主 IP',
      sshPort: 'SSH 端口',
      sshCommand: 'SSH 命令'
    },
    sidebar: {
      title: '服务器信息',
      cpu: 'CPU 负载',
      ram: '内存使用',
      cores: 'CPU 核心数',
      disk: '磁盘',
      ramTotal: '总内存',
      loadAvg: '平均负载 (1m)',
      docker: 'Docker',
      lastSeen: '最后检查',
      checking: '正在读取系统资源…',
      resourceError: '无法读取服务器资源',
      retryResources: '重试'
    },
    overview: {
      ...BASE_EN_STRINGS.vpsControl.overview,
      machineTitle: '机器信息',
      resourcesTitle: '系统资源 (CPU / 内存 / 磁盘)',
      resourcesEmpty: '当前会话尚未检查资源。',
      resourcesRefresh: '读取资源',
      gaugesTitle: '资源使用率',
      specsTitle: '资源规格',
      checkedAt: (time: string) => `资源检查时间：${time}`,
      dockerMissing: '未安装 Docker',
      neverSeen: '从未连接',
      host: '主机',
      sshPort: 'SSH 端口',
      username: '用户名',
      providerRegion: '服务商 / 区域',
      docker: 'Docker',
      createdAt: '添加时间',
      lastSeen: '最后检查',
      checkConnection: '检查并诊断连接',
      actionsTitle: '服务器操作',
      copyCommand: '复制 SSH 命令',
      copied: '已复制'
    },
    apps: {
      title: '服务器上的应用',
      deployNew: '部署新应用',
      redeploy: '重新部署',
      openApp: '打开应用',
      empty: '此服务器上暂无应用。',
      emptyHint: '部署第一个应用以在此开始管理。',
      loadFailed: '无法加载此服务器上的应用。',
      columns: {
        name: '名称',
        framework: '框架',
        port: '端口',
        url: 'URL',
        version: '版本',
        status: '状态',
        actions: '操作'
      },
      status: {
        running: '运行中',
        failed: '失败',
        building: '构建中',
        deploying: '部署中',
        stopped: '已停止',
        rolled_back: '已回滚',
        none: '未部署'
      }
    },
    activity: {
      title: '近期活动',
      empty: '此服务器上暂无活动。',
      emptyHint: '部署或管理应用以在此查看日志。',
      loadFailed: '无法加载此服务器的活动日志。'
    },
    database: {
      ...BASE_EN_STRINGS.vpsControl.database,
      notSupportedTitle: '暂不支持数据库',
      notSupportedDesc: 'OpsPilot 目前尚未支持此服务器的数据库管理功能。',
      notSupported: '此服务器暂不支持数据库管理。'
    }
  },
  dashboard: {
    ...BASE_EN_STRINGS.dashboard,
    title: '系统总览',
    description: '监控应用状态、基础设施服务器和最新部署情况。',
    summaryLabel: '系统摘要',
    refresh: '刷新',
    viewApps: '查看应用',
    viewVps: '查看服务器',
    deployAction: '+ 部署',
    stats: {
      vpsOnline: '刚刚检查的 VPS',
      appsRunning: '已记录的部署',
      deploy24h: '过去 24 小时部署',
      lastDeploy: '最近部署'
    },
    apps: {
      title: '管理的应用',
      description: '部署在基础设施服务器节点上的应用。',
      viewAll: '查看全部',
      columnName: '应用',
      columnPort: '端口',
      columnVps: '服务器',
      columnStatus: '记录状态',
      empty: '暂无已部署应用。',
      deployApp: '部署应用',
      openApp: '打开应用',
      statusDeployed: '已记录部署',
      statusNotDeployed: '未部署'
    },
    recent: {
      title: '近期活动',
      description: '跨所有服务器的操作审计日志。',
      viewAll: '查看完整日志',
      columnTime: '时间',
      columnAction: '操作',
      columnVps: '服务器',
      columnStatus: '状态',
      columnMessage: '信息',
      empty: '暂无活动记录。部署首个应用以查看审计历史。',
      deployNow: '立即部署',
      unknownVps: '已删除 VPS',
      unknownAction: '其他'
    },
    actions: {
      deploy: '部署',
      rollback_auto: '自动回滚',
      rollback_manual: '手动回滚'
    },
    statuses: {
      success: '成功',
      failed: '失败',
      cancelled: '已取消'
    },
    emptyVps: '暂无已注册 VPS。添加首个 VPS 以开始部署。',
    addVps: '添加 VPS',
    loadFailed: '无法加载总览数据。',
    retry: '重试'
  },
  history: {
    ...BASE_EN_STRINGS.history,
    title: '审计日志',
    description: '查看部署、回滚和告警记录。',
    filters: {
      action: '操作',
      actionAll: '全部操作',
      vps: '服务器',
      vpsAll: '全部服务器',
      timeRange: '时间范围',
      startDate: '开始日期',
      endDate: '结束日期'
    },
    columns: {
      time: '时间',
      action: '操作',
      vps: '服务器',
      status: '状态',
      message: '信息'
    },
    actions: {
      deploy: '部署',
      rollback_auto: '自动回滚',
      rollback_manual: '手动回滚',
      scan: '环境检查',
      install_docker: '安装 Docker',
      restart: '重启应用',
      stop: '停止应用',
      migrate_start: '开始迁移',
      migrate_confirm: '确认迁移',
      migrate_abort: '中止迁移',
      ssh_error: 'SSH 连接错误'
    },
    statuses: {
      success: '成功',
      failed: '失败',
      cancelled: '已取消'
    },
    detail: {
      title: '动态详情',
      time: '时间',
      vps: '服务器',
      action: '操作',
      status: '状态',
      message: '信息',
      fields: '附加信息',
      emptyFields: '无附加信息。'
    },
    empty: '没有符合该筛选条件的活动。',
    emptyPage: '此页暂无记录。',
    loadFailed: '无法加载历史记录。',
    retry: '重试',
    pagination: {
      prev: '上一页',
      next: '下一页',
      prevPageAction: '返回上一页',
      page: (page: number) => `第 ${page} 页`,
      pageTotal: (from: number, to: number, total: number) => `${from}–${to} / 共 ${total}`,
      pageMore: (from: number, to: number) => `${from}–${to} (还有更多)`
    }
  },
  deploy: {
    ...BASE_EN_STRINGS.deploy,
    title: '部署应用程序',
    description: '选择源码文件夹 — 系统将自动识别框架并通过 SSH 部署到 VPS。',
    vpsLabel: '目标 VPS',
    vpsLoading: '正在加载 VPS 列表…',
    vpsLoadError: '无法加载 VPS 列表',
    appLoadError: '无法加载此 VPS 的应用列表',
    appLoading: '正在加载应用列表…',
    preselectVpsNotFound: '预选的 VPS 不存在或已被删除。',
    preselectAppNotFound: '预选的应用不再属于此 VPS。',
    chooseAvailableVps: '选择可用 VPS',
    switchToNewApp: '切换为新建应用',
    targetApp: {
      title: '目标应用',
      mode: '部署目标',
      new: '新建应用',
      existing: '现有应用',
      selectApp: '选择应用',
      selectAppPlaceholder: '请选择一个应用…',
      noApps: '此 VPS 上暂无应用（将作为新应用部署）',
      appName: '应用名称',
      appNameRule: '仅限小写字母 a-z、数字和连字符，且必须以字母开头。'
    },
    config: {
      ...BASE_EN_STRINGS.deploy.config,
      appNameRule: '仅限小写字母 a-z、数字和连字符，且必须以字母开头。',
      missingRequired: (keys: string[]) => `缺少必需的环境变量: ${keys.join(', ')}。`
    },
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
      summaryTitle: '部署配置摘要',
      targetVps: '目标 VPS',
      targetApp: '目标应用',
      sourcePath: '源码文件夹',
      envList: '环境变量',
      noEnv: '无',
      envConfigured: '已配置',
      checksTitle: '预检结果',
      title: '部署前检查 VPS',
      checking: '正在进行预检…',
      retry: '重新检查',
      urlLabel: '访问地址',
      deploy: '开始部署',
      starting: '正在启动部署…',
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
      ...BASE_EN_STRINGS.deploy.exposure,
      runtimeRunning: '应用容器正在运行',
      reachableTitle: '应用运行中 — 外部端口访问正常',
      reachableDesc: '应用已成功部署并可从外部网络正常访问。',
      degradedTitle: '外部端口降级或无法访问',
      blockedHint: '外部端口可能被防火墙拦截。运行 Doctor 进行诊断并安全修复。',
      tunnelOnlyTitle: '应用运行中 — 专用隧道模式 (Tunnel only)',
      tunnelOnlyDesc: '应用正在通过内部网络或 Cloudflare Tunnel 安全运行，未开放公共主机端口。',
      notCheckedTitle: '应用运行中 — 未检测外部可访问性',
      notCheckedDesc: '容器正在运行。尚未执行外部网络连通性检测。',
      reachableTag: '外部访问: 正常',
      degradedTag: '外部访问: 受阻',
      tunnelOnlyTag: '外部访问: 专属隧道',
      notCheckedTag: '外部访问: 未检测',
      runtimeTag: '运行时: 运行中',
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
      steps: {
        PRECHECK: '预检检查',
        UPLOAD: '上传源码',
        RENDER: '生成配置',
        BUILD: '构建镜像',
        DEPLOY: '启动容器',
        HEALTHCHECK: '健康检查',
        RECORD: '记录状态'
      },
      openApp: '打开应用',
      viewDashboard: '查看总览',
      running: '正在部署',
      success: (duration: string) => `部署成功，耗时 ${duration}`,
      failedStep: (step: string) => `在 ${step} 步骤失败`,
      rolledBack: '健康检查失败 — 已自动回滚至上一版本。',
      toolbar: {
        copy: '复制',
        search: '查找',
        searchPlaceholder: '在日志中搜索…'
      },
      liveOutput: '实时日志',
      finished: '已完成',
      cancel: '取消部署',
      cancelConfirm: '停止',
      cancelAsk: '确定中途停止部署吗？根据当前步骤，旧应用将被保留或清理。',
      scrollDown: '滚动到底部',
      empty: '暂无日志。准备中…',
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
    statusRecordedDeployed: '已记录',
    statusNotDeployed: '未部署',
    recordedTitle: '记录的部署',
    recordedStatus: (status: string, version: number) => `记录: ${status} (v${version})`,
    currentDeploymentNotFound: '历史记录中未找到当前部署',
    currentDeploymentMismatchDesc: (id: number) => `在版本历史记录中未找到部署记录 #${id}。`,
    vpsStaleNotice: '服务器近期未检查 (>24h)',
    inspectLive: '运行时检查',
    recheckLive: '重新检查',
    liveUnverified: '未验证',
    liveRunning: '实时: 运行中',
    liveState: (state: string) => `实时: ${state}`,
    exposurePublishResult: '对外暴露 (发布记录)',
    runtime: '运行环境',
    healthy: '运行中 · 正常',
    unhealthy: '需检查',
    lastDeploy: '最近部署',
    vpsHost: 'VPS 主机',
    connectedLocal: '本地引擎已连接',
    tabs: {
      overview: '运行总览',
      history: '历史与回滚',
      doctor: 'Doctor 与公开检测',
      versions: '历史与回滚'
    },
    backToList: '返回应用列表',
    allVps: '所有 VPS 主机',
    viewDetail: '详情',
    deployAction: '部署',
    viewVps: '查看目标 VPS',
    deployNewVersion: '部署新版本',
    activeVersion: '当前激活',
    countDisplay: (filtered: number, total: number) => `显示 ${filtered} / ${total} 个应用`,
    doctorExposureTitle: 'Doctor 与公开检测',
    doctorDesc: '诊断网络连接与端口可达性，并安全自动修复配置问题。',
    doctorDiagnosticEvidence: '诊断依据',
    doctorCheckItem: '检查项',
    doctorResult: '结果',
    doctorEvidence: '观察依据',
    doctorNotRunYet: '点击“Doctor 诊断”以检查网络可达性和端口配置。',
    runtimeInfo: '运行时信息',
    runtimeSync: '同步自最近一次部署',
    appName: '应用名称',
    framework: '框架',
    vps: '目标 VPS',
    runtimeStatus: '运行状态',
    version: '当前版本',
    deploymentIdTitle: '部署 ID',
    loadError: '无法加载应用列表',
    versionsLoadError: '加载版本历史失败',
    recordMismatch: (id: number) => `未找到记录 (#${id})`,
    noDeploymentsYet: '暂无已记录的部署',
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
  vpsStatus: {
    checking: '確認中…',
    checkedNow: '確認済み',
    checkFailed: '確認できませんでした',
    stale: '最近未確認',
    unknown: '不明',
    recentPast: '最近確認済み',
    reportedOffline: 'オフライン（前回の確認）'
  },
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
  vps: {
    ...BASE_EN_STRINGS.vps,
    status: {
      online: '確認済み',
      offline: '確認できませんでした',
      unknown: '不明',
      checking: '確認中…',
      checkedNow: '確認済み',
      checkFailed: '確認できませんでした',
      stale: '最近未確認',
      recentPast: '最近確認済み'
    }
  },
  vpsControl: {
    ...BASE_EN_STRINGS.vpsControl,
    tabs: {
      overview: '概要・リソース',
      apps: 'サーバー上のアプリ',
      database: 'データベース',
      activity: 'アクティビティ'
    },
    fleet: {
      totalVps: 'VPS 合計',
      checkedNow: '確認済み',
      checkFailed: '確認できませんでした',
      online: '確認済み',
      offline: '確認できませんでした',
      totalApps: 'アプリ合計'
    },
    selector: {
      searchPlaceholder: '名前またはホストで検索…',
      filterAll: 'すべてのステータス',
      filterButton: 'ステータスで絞り込み',
      filterCheckedNow: '確認済み',
      filterCheckFailed: '確認できませんでした',
      filterStale: '最近未確認',
      filterUnknown: '不明',
      copyIp: 'IP をコピー',
      pageTotal: (from: number, to: number, total: number) => `${from}-${to} / 全 ${total}`,
      noSelection: '左側のリストから VPS を選択して詳細を表示します。',
      dockerMissing: 'Docker 未インストール',
      appsCount: (count: number) => (count === 0 ? 'アプリなし' : `${count} 個のアプリ`)
    },
    header: {
      mainIp: 'メイン IP',
      sshPort: 'SSH ポート',
      sshCommand: 'SSH コマンド'
    },
    sidebar: {
      title: 'サーバー情報',
      cpu: 'CPU 負荷',
      ram: 'メモリ使用率',
      cores: 'CPU コア数',
      disk: 'ディスク',
      ramTotal: '総メモリ',
      loadAvg: '平均負荷 (1m)',
      docker: 'Docker',
      lastSeen: '最終確認',
      checking: 'システムリソースを取得中…',
      resourceError: 'サーバーリソースを取得できません',
      retryResources: '再試行'
    },
    overview: {
      ...BASE_EN_STRINGS.vpsControl.overview,
      machineTitle: 'サーバー情報',
      resourcesTitle: 'システムリソース (CPU / RAM / ディスク)',
      resourcesEmpty: 'このセッションではまだリソースを確認していません。',
      resourcesRefresh: 'リソース取得',
      gaugesTitle: 'リソース使用率',
      specsTitle: 'リソーススペック',
      checkedAt: (time: string) => `リソース確認日時: ${time}`,
      dockerMissing: 'Docker 未インストール',
      neverSeen: '接続履歴なし',
      host: 'ホスト',
      sshPort: 'SSH ポート',
      username: 'ユーザー名',
      providerRegion: 'プロバイダー / リージョン',
      docker: 'Docker',
      createdAt: '追加日時',
      lastSeen: '最終確認',
      checkConnection: '接続確認・診断',
      actionsTitle: 'サーバー操作',
      copyCommand: 'SSH コマンドをコピー',
      copied: 'コピー完了'
    },
    apps: {
      title: 'サーバー上のアプリ',
      deployNew: '新規アプリをデプロイ',
      redeploy: '再デプロイ',
      openApp: 'アプリを開く',
      empty: 'このサーバーにはまだアプリがありません。',
      emptyHint: '最初のアプリをデプロイして管理を開始してください。',
      loadFailed: 'このサーバーのアプリ一覧を読み込めませんでした。',
      columns: {
        name: '名前',
        framework: 'フレームワーク',
        port: 'ポート',
        url: 'URL',
        version: 'バージョン',
        status: 'ステータス',
        actions: '操作'
      },
      status: {
        running: '稼働中',
        failed: '失敗',
        building: 'ビルド中',
        deploying: 'デプロイ中',
        stopped: '停止中',
        rolled_back: 'ロールバック済',
        none: '未デプロイ'
      }
    },
    activity: {
      title: '最近のアクティビティ',
      empty: 'このサーバーのアクティビティはまだありません。',
      emptyHint: 'アプリをデプロイまたは管理するとログが表示されます。',
      loadFailed: 'このサーバーのアクティビティログを読み込めませんでした。'
    },
    database: {
      ...BASE_EN_STRINGS.vpsControl.database,
      notSupportedTitle: 'データベース未サポート',
      notSupportedDesc:
        'OpsPilot では現在、このサーバーのデータベース管理機能をサポートしていません。',
      notSupported: 'このサーバーではデータベース管理はまだサポートされていません。'
    }
  },
  dashboard: {
    ...BASE_EN_STRINGS.dashboard,
    title: 'システム概要',
    description: 'アプリケーションの状態、インフラサーバー、直近のデプロイを監視します。',
    summaryLabel: 'システム概要',
    refresh: '更新',
    viewApps: 'アプリ一覧',
    viewVps: 'サーバー一覧',
    deployAction: '+ デプロイ',
    stats: {
      vpsOnline: '確認済みの VPS',
      appsRunning: '記録されたデプロイ',
      deploy24h: '過去24時間のデプロイ',
      lastDeploy: '最終デプロイ'
    },
    apps: {
      title: '管理中のアプリ',
      description: 'インフラサーバーノード上にデプロイされたアプリケーション。',
      viewAll: 'すべて表示',
      columnName: 'アプリ',
      columnPort: 'ポート',
      columnVps: 'サーバー',
      columnStatus: '記録ステータス',
      empty: 'デプロイされたアプリはありません。',
      deployApp: 'アプリをデプロイ',
      openApp: 'アプリを開く',
      statusDeployed: '記録済デプロイ',
      statusNotDeployed: '未デプロイ'
    },
    recent: {
      title: '最近のアクティビティ',
      description: '全サーバーの操作監査ログ。',
      viewAll: 'すべてのログを表示',
      columnTime: '日時',
      columnAction: '操作',
      columnVps: 'サーバー',
      columnStatus: 'ステータス',
      columnMessage: 'メッセージ',
      empty: 'アクティビティはまだありません。最初のアプリをデプロイして履歴を確認してください。',
      deployNow: '今すぐデプロイ',
      unknownVps: '削除済 VPS',
      unknownAction: 'その他'
    },
    actions: {
      deploy: 'デプロイ',
      rollback_auto: '自動ロールバック',
      rollback_manual: '手動ロールバック'
    },
    statuses: {
      success: '成功',
      failed: '失敗',
      cancelled: 'キャンセル済'
    },
    emptyVps: 'VPS が登録されていません。最初の VPS を追加してデプロイを開始してください。',
    addVps: 'VPS を追加',
    loadFailed: 'ダッシュボードのデータを読み込めませんでした。',
    retry: '再試行'
  },
  history: {
    ...BASE_EN_STRINGS.history,
    title: '監査ログ',
    description: 'デプロイ、ロールバック、アラートの履歴を確認します。',
    filters: {
      action: '操作',
      actionAll: 'すべての操作',
      vps: 'サーバー',
      vpsAll: 'すべてのサーバー',
      timeRange: '期間',
      startDate: '開始日',
      endDate: '終了日'
    },
    columns: {
      time: '日時',
      action: '操作',
      vps: 'サーバー',
      status: 'ステータス',
      message: 'メッセージ'
    },
    actions: {
      deploy: 'デプロイ',
      rollback_auto: '自動ロールバック',
      rollback_manual: '手動ロールバック',
      scan: '環境スキャン',
      install_docker: 'Docker インストール',
      restart: 'アプリ再起動',
      stop: 'アプリ停止',
      migrate_start: '移行開始',
      migrate_confirm: '移行確認',
      migrate_abort: '移行中止',
      ssh_error: 'SSH 接続エラー'
    },
    statuses: {
      success: '成功',
      failed: '失敗',
      cancelled: 'キャンセル済'
    },
    detail: {
      title: 'アクティビティ詳細',
      time: '日時',
      vps: 'サーバー',
      action: '操作',
      status: 'ステータス',
      message: 'メッセージ',
      fields: '詳細項目',
      emptyFields: '詳細項目はありません。'
    },
    empty: '条件に一致するアクティビティはありません。',
    emptyPage: 'このページにはレコードがありません。',
    loadFailed: '履歴を読み込めませんでした。',
    retry: '再試行',
    pagination: {
      prev: '前のページ',
      next: '次のページ',
      prevPageAction: '前のページに戻る',
      page: (page: number) => `${page} ページ`,
      pageTotal: (from: number, to: number, total: number) => `${from}–${to} / 全 ${total}`,
      pageMore: (from: number, to: number) => `${from}–${to} (続きあり)`
    }
  },
  deploy: {
    ...BASE_EN_STRINGS.deploy,
    title: 'アプリケーションデプロイ',
    description:
      'ソースフォルダを選択 — フレームワークを自動検出してSSH経由でVPSにデプロイします。',
    vpsLabel: '対象 VPS',
    vpsLoading: 'VPS 一覧を読み込み中…',
    vpsLoadError: 'VPS 一覧を読み込めませんでした',
    appLoadError: 'この VPS のアプリケーション一覧を読み込めませんでした',
    appLoading: 'アプリケーション一覧を読み込み中…',
    preselectVpsNotFound: '事前に選択された VPS が見つからないか、削除されました。',
    preselectAppNotFound: '事前に選択されたアプリケーションはこの VPS に存在しません。',
    chooseAvailableVps: '利用可能な VPS を選択',
    switchToNewApp: '新規アプリに変更',
    targetApp: {
      title: 'デプロイ先アプリケーション',
      mode: 'デプロイ対象',
      new: '新規アプリケーション',
      existing: '既存アプリケーション',
      selectApp: 'アプリケーションを選択',
      selectAppPlaceholder: 'アプリケーションを選択してください…',
      noApps: 'この VPS にはまだアプリケーションがありません（新規アプリとしてデプロイされます）',
      appName: 'アプリケーション名',
      appNameRule: '英小文字 a-z、数字、ハイフン（先頭は英文字である必要があります）。'
    },
    config: {
      ...BASE_EN_STRINGS.deploy.config,
      appNameRule: '英小文字 a-z、数字、ハイフン（先頭は英文字である必要があります）。',
      missingRequired: (keys: string[]) => `必須の環境変数が不足しています: ${keys.join(', ')}。`
    },
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
      summaryTitle: 'デプロイ設定概要',
      targetVps: '対象 VPS',
      targetApp: '対象アプリケーション',
      sourcePath: 'ソースフォルダ',
      envList: '環境変数',
      noEnv: 'なし',
      envConfigured: '設定済み',
      checksTitle: '事前チェック結果',
      title: 'デプロイ前 VPS チェック',
      checking: '事前チェック実行中…',
      retry: '再チェック',
      urlLabel: 'アクセスURL',
      deploy: 'デプロイ開始',
      starting: 'デプロイ開始中…',
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
      ...BASE_EN_STRINGS.deploy.exposure,
      runtimeRunning: 'ランタイムコンテナが稼働中',
      reachableTitle: '稼働中 — 外部ポートアクセス正常',
      reachableDesc: 'アプリケーションはデプロイされ、外部ネットワークからアクセス可能です。',
      degradedTitle: '外部ポートが劣化またはアクセス不能',
      blockedHint:
        '外部ポートがファイアウォールでブロックされている可能性があります。Doctorで診断し安全に自動修復してください。',
      tunnelOnlyTitle: '稼働中 — プライベートトンネル専用 (Tunnel only)',
      tunnelOnlyDesc:
        'アプリケーションは内部ネットワークまたは Cloudflare Tunnel 経由で安全に稼働しており、公開ホストポートはありません。',
      notCheckedTitle: '稼働中 — 外部アクセスの未確認',
      notCheckedDesc: 'コンテナは稼働中です。ホストポートへの外部接続確認は実行されていません。',
      reachableTag: '外部アクセス: 正常',
      degradedTag: '外部アクセス: 制限あり',
      tunnelOnlyTag: '外部アクセス: トンネル専用',
      notCheckedTag: '外部アクセス: 未確認',
      runtimeTag: 'ランタイム: 稼働中',
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
      steps: {
        PRECHECK: '事前チェック',
        UPLOAD: 'ソースコード転送',
        RENDER: '設定生成',
        BUILD: 'イメージ構築',
        DEPLOY: 'コンテナ起動',
        HEALTHCHECK: 'ヘルスチェック',
        RECORD: '状態記録'
      },
      openApp: 'アプリを開く',
      viewDashboard: 'ダッシュボードを表示',
      running: 'デプロイ中',
      success: (duration: string) => `デプロイ完了 (${duration})`,
      failedStep: (step: string) => `ステップ ${step} で失敗`,
      rolledBack: 'ヘルスチェックに失敗しました — 前のバージョンに自動ロールバックされました。',
      toolbar: {
        copy: 'コピー',
        search: '検索',
        searchPlaceholder: 'ログ内を検索…'
      },
      liveOutput: 'ライブ出力',
      finished: '完了',
      cancel: 'デプロイを中止',
      cancelConfirm: '中止',
      cancelAsk:
        '途中でデプロイを中止しますか？ステップに応じて、既存アプリが保持またはクリーンアップされます。',
      scrollDown: '最下部へスクロール',
      empty: 'ログがまだありません。準備中…',
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
    statusRecordedDeployed: '記録済み',
    statusNotDeployed: '未デプロイ',
    recordedTitle: '記録されたデプロイ',
    recordedStatus: (status: string, version: number) => `記録: ${status} (v${version})`,
    currentDeploymentNotFound: '履歴に現在のデプロイが見つかりません',
    currentDeploymentMismatchDesc: (id: number) =>
      `バージョン履歴にデプロイ記録 #${id} が見つかりませんでした。`,
    vpsStaleNotice: 'サーバーは最近未確認です (>24h)',
    inspectLive: 'ランタイム確認',
    recheckLive: '再確認',
    liveUnverified: '未検証',
    liveRunning: 'ライブ: 実行中',
    liveState: (state: string) => `ライブ: ${state}`,
    exposurePublishResult: '外部公開 (公開時の記録)',
    runtime: 'ランタイム',
    healthy: '実行中 · 正常',
    unhealthy: '要確認',
    lastDeploy: '最終デプロイ',
    vpsHost: 'VPS ホスト',
    connectedLocal: 'ローカル接続済み',
    tabs: {
      overview: '概要',
      history: '履歴 & ロールバック',
      doctor: 'ドクター & 公開診断',
      versions: '履歴 & ロールバック'
    },
    backToList: 'アプリ一覧に戻る',
    allVps: 'すべての VPS ホスト',
    viewDetail: '詳細',
    deployAction: 'デプロイ',
    viewVps: '対象 VPS を表示',
    deployNewVersion: '新しいバージョンをデプロイ',
    activeVersion: '有効',
    countDisplay: (filtered: number, total: number) => `${total} 件中 ${filtered} 件のアプリを表示`,
    doctorExposureTitle: 'ドクター & 公開診断',
    doctorDesc: 'ネットワーク接続性とポート到達性を診断し、構成エラーを安全に自動修復します。',
    doctorDiagnosticEvidence: '診断証跡',
    doctorCheckItem: '確認項目',
    doctorResult: '結果',
    doctorEvidence: '観察された証拠',
    doctorNotRunYet:
      '「ドクターで診断」をクリックして、ネットワーク到達性とポート構成を確認してください。',
    runtimeInfo: 'ランタイム情報',
    runtimeSync: '最新デプロイから同期',
    appName: 'アプリ名',
    framework: 'フレームワーク',
    vps: '対象 VPS',
    runtimeStatus: 'ランタイム状態',
    version: 'バージョン',
    deploymentIdTitle: 'デプロイID',
    loadError: 'アプリケーション一覧を読み込めませんでした',
    versionsLoadError: 'バージョン履歴の読み込みに失敗しました',
    recordMismatch: (id: number) => `記録が見つかりません (#${id})`,
    noDeploymentsYet: 'デプロイ履歴はまだ記録されていません',
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
    vpsStatus: { ...BASE_EN_STRINGS.vpsStatus, ...VI_OVERRIDES.vpsStatus },
    vps: {
      ...BASE_EN_STRINGS.vps,
      ...VI_OVERRIDES.vps,
      status: { ...BASE_EN_STRINGS.vps.status, ...VI_OVERRIDES.vps?.status },
      columns: { ...BASE_EN_STRINGS.vps.columns, ...VI_OVERRIDES.vps?.columns },
      actions: { ...BASE_EN_STRINGS.vps.actions, ...VI_OVERRIDES.vps?.actions },
      resources: { ...BASE_EN_STRINGS.vps.resources, ...VI_OVERRIDES.vps?.resources }
    },
    vpsControl: {
      ...BASE_EN_STRINGS.vpsControl,
      ...VI_OVERRIDES.vpsControl,
      tabs: { ...BASE_EN_STRINGS.vpsControl.tabs, ...VI_OVERRIDES.vpsControl?.tabs },
      fleet: { ...BASE_EN_STRINGS.vpsControl.fleet, ...VI_OVERRIDES.vpsControl?.fleet },
      selector: { ...BASE_EN_STRINGS.vpsControl.selector, ...VI_OVERRIDES.vpsControl?.selector },
      overview: { ...BASE_EN_STRINGS.vpsControl.overview, ...VI_OVERRIDES.vpsControl?.overview },
      header: { ...BASE_EN_STRINGS.vpsControl.header, ...VI_OVERRIDES.vpsControl?.header },
      sidebar: { ...BASE_EN_STRINGS.vpsControl.sidebar, ...VI_OVERRIDES.vpsControl?.sidebar },
      apps: {
        ...BASE_EN_STRINGS.vpsControl.apps,
        ...VI_OVERRIDES.vpsControl?.apps,
        columns: {
          ...BASE_EN_STRINGS.vpsControl.apps.columns,
          ...VI_OVERRIDES.vpsControl?.apps?.columns
        }
      },
      activity: { ...BASE_EN_STRINGS.vpsControl.activity, ...VI_OVERRIDES.vpsControl?.activity },
      database: { ...BASE_EN_STRINGS.vpsControl.database, ...VI_OVERRIDES.vpsControl?.database }
    },
    dashboard: {
      ...BASE_EN_STRINGS.dashboard,
      ...VI_OVERRIDES.dashboard,
      stats: { ...BASE_EN_STRINGS.dashboard.stats, ...VI_OVERRIDES.dashboard?.stats },
      apps: { ...BASE_EN_STRINGS.dashboard.apps, ...VI_OVERRIDES.dashboard?.apps },
      actions: { ...BASE_EN_STRINGS.dashboard.actions, ...VI_OVERRIDES.dashboard?.actions },
      statuses: { ...BASE_EN_STRINGS.dashboard.statuses, ...VI_OVERRIDES.dashboard?.statuses },
      recent: { ...BASE_EN_STRINGS.dashboard.recent, ...VI_OVERRIDES.dashboard?.recent }
    },
    apps: {
      ...BASE_EN_STRINGS.apps,
      ...VI_OVERRIDES.apps,
      tabs: { ...BASE_EN_STRINGS.apps.tabs, ...VI_OVERRIDES.apps?.tabs },
      exposureStatus: {
        ...BASE_EN_STRINGS.apps.exposureStatus,
        ...VI_OVERRIDES.apps?.exposureStatus
      }
    },
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
      log: {
        ...BASE_EN_STRINGS.deploy.log,
        ...VI_OVERRIDES.deploy?.log,
        steps: {
          ...BASE_EN_STRINGS.deploy.log.steps,
          ...VI_OVERRIDES.deploy?.log?.steps
        },
        toolbar: {
          ...BASE_EN_STRINGS.deploy.log.toolbar,
          ...VI_OVERRIDES.deploy?.log?.toolbar
        }
      },
      config: { ...BASE_EN_STRINGS.deploy.config, ...VI_OVERRIDES.deploy?.config },
      targetApp: { ...BASE_EN_STRINGS.deploy.targetApp, ...VI_OVERRIDES.deploy?.targetApp }
    },
    history: {
      ...BASE_EN_STRINGS.history,
      ...VI_OVERRIDES.history,
      filters: { ...BASE_EN_STRINGS.history.filters, ...VI_OVERRIDES.history?.filters },
      columns: { ...BASE_EN_STRINGS.history.columns, ...VI_OVERRIDES.history?.columns },
      actions: { ...BASE_EN_STRINGS.history.actions, ...VI_OVERRIDES.history?.actions },
      statuses: { ...BASE_EN_STRINGS.history.statuses, ...VI_OVERRIDES.history?.statuses },
      detail: { ...BASE_EN_STRINGS.history.detail, ...VI_OVERRIDES.history?.detail },
      pagination: { ...BASE_EN_STRINGS.history.pagination, ...VI_OVERRIDES.history?.pagination }
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
    vpsStatus: { ...BASE_EN_STRINGS.vpsStatus, ...CN_OVERRIDES.vpsStatus },
    vps: {
      ...BASE_EN_STRINGS.vps,
      ...CN_OVERRIDES.vps,
      status: { ...BASE_EN_STRINGS.vps.status, ...CN_OVERRIDES.vps?.status },
      columns: { ...BASE_EN_STRINGS.vps.columns, ...CN_OVERRIDES.vps?.columns },
      actions: { ...BASE_EN_STRINGS.vps.actions, ...CN_OVERRIDES.vps?.actions },
      resources: { ...BASE_EN_STRINGS.vps.resources, ...CN_OVERRIDES.vps?.resources }
    },
    vpsControl: {
      ...BASE_EN_STRINGS.vpsControl,
      ...CN_OVERRIDES.vpsControl,
      tabs: { ...BASE_EN_STRINGS.vpsControl.tabs, ...CN_OVERRIDES.vpsControl?.tabs },
      fleet: { ...BASE_EN_STRINGS.vpsControl.fleet, ...CN_OVERRIDES.vpsControl?.fleet },
      selector: { ...BASE_EN_STRINGS.vpsControl.selector, ...CN_OVERRIDES.vpsControl?.selector },
      overview: { ...BASE_EN_STRINGS.vpsControl.overview, ...CN_OVERRIDES.vpsControl?.overview },
      header: { ...BASE_EN_STRINGS.vpsControl.header, ...CN_OVERRIDES.vpsControl?.header },
      sidebar: { ...BASE_EN_STRINGS.vpsControl.sidebar, ...CN_OVERRIDES.vpsControl?.sidebar },
      apps: {
        ...BASE_EN_STRINGS.vpsControl.apps,
        ...CN_OVERRIDES.vpsControl?.apps,
        columns: {
          ...BASE_EN_STRINGS.vpsControl.apps.columns,
          ...CN_OVERRIDES.vpsControl?.apps?.columns
        }
      },
      activity: { ...BASE_EN_STRINGS.vpsControl.activity, ...CN_OVERRIDES.vpsControl?.activity },
      database: { ...BASE_EN_STRINGS.vpsControl.database, ...CN_OVERRIDES.vpsControl?.database }
    },
    dashboard: {
      ...BASE_EN_STRINGS.dashboard,
      ...CN_OVERRIDES.dashboard,
      stats: { ...BASE_EN_STRINGS.dashboard.stats, ...CN_OVERRIDES.dashboard?.stats },
      apps: { ...BASE_EN_STRINGS.dashboard.apps, ...CN_OVERRIDES.dashboard?.apps },
      actions: { ...BASE_EN_STRINGS.dashboard.actions, ...CN_OVERRIDES.dashboard?.actions },
      statuses: { ...BASE_EN_STRINGS.dashboard.statuses, ...CN_OVERRIDES.dashboard?.statuses },
      recent: { ...BASE_EN_STRINGS.dashboard.recent, ...CN_OVERRIDES.dashboard?.recent }
    },
    apps: {
      ...BASE_EN_STRINGS.apps,
      ...CN_OVERRIDES.apps,
      tabs: { ...BASE_EN_STRINGS.apps.tabs, ...CN_OVERRIDES.apps?.tabs },
      exposureStatus: {
        ...BASE_EN_STRINGS.apps.exposureStatus,
        ...CN_OVERRIDES.apps?.exposureStatus
      }
    },
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
      log: {
        ...BASE_EN_STRINGS.deploy.log,
        ...CN_OVERRIDES.deploy?.log,
        steps: {
          ...BASE_EN_STRINGS.deploy.log.steps,
          ...CN_OVERRIDES.deploy?.log?.steps
        },
        toolbar: {
          ...BASE_EN_STRINGS.deploy.log.toolbar,
          ...CN_OVERRIDES.deploy?.log?.toolbar
        }
      },
      config: { ...BASE_EN_STRINGS.deploy.config, ...CN_OVERRIDES.deploy?.config },
      targetApp: { ...BASE_EN_STRINGS.deploy.targetApp, ...CN_OVERRIDES.deploy?.targetApp }
    },
    history: {
      ...BASE_EN_STRINGS.history,
      ...CN_OVERRIDES.history,
      filters: { ...BASE_EN_STRINGS.history.filters, ...CN_OVERRIDES.history?.filters },
      columns: { ...BASE_EN_STRINGS.history.columns, ...CN_OVERRIDES.history?.columns },
      actions: { ...BASE_EN_STRINGS.history.actions, ...CN_OVERRIDES.history?.actions },
      statuses: { ...BASE_EN_STRINGS.history.statuses, ...CN_OVERRIDES.history?.statuses },
      detail: { ...BASE_EN_STRINGS.history.detail, ...CN_OVERRIDES.history?.detail },
      pagination: { ...BASE_EN_STRINGS.history.pagination, ...CN_OVERRIDES.history?.pagination }
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
    vpsStatus: { ...BASE_EN_STRINGS.vpsStatus, ...JP_OVERRIDES.vpsStatus },
    vps: {
      ...BASE_EN_STRINGS.vps,
      ...JP_OVERRIDES.vps,
      status: { ...BASE_EN_STRINGS.vps.status, ...JP_OVERRIDES.vps?.status },
      columns: { ...BASE_EN_STRINGS.vps.columns, ...JP_OVERRIDES.vps?.columns },
      actions: { ...BASE_EN_STRINGS.vps.actions, ...JP_OVERRIDES.vps?.actions },
      resources: { ...BASE_EN_STRINGS.vps.resources, ...JP_OVERRIDES.vps?.resources }
    },
    vpsControl: {
      ...BASE_EN_STRINGS.vpsControl,
      ...JP_OVERRIDES.vpsControl,
      tabs: { ...BASE_EN_STRINGS.vpsControl.tabs, ...JP_OVERRIDES.vpsControl?.tabs },
      fleet: { ...BASE_EN_STRINGS.vpsControl.fleet, ...JP_OVERRIDES.vpsControl?.fleet },
      selector: { ...BASE_EN_STRINGS.vpsControl.selector, ...JP_OVERRIDES.vpsControl?.selector },
      overview: { ...BASE_EN_STRINGS.vpsControl.overview, ...JP_OVERRIDES.vpsControl?.overview },
      header: { ...BASE_EN_STRINGS.vpsControl.header, ...JP_OVERRIDES.vpsControl?.header },
      sidebar: { ...BASE_EN_STRINGS.vpsControl.sidebar, ...JP_OVERRIDES.vpsControl?.sidebar },
      apps: {
        ...BASE_EN_STRINGS.vpsControl.apps,
        ...JP_OVERRIDES.vpsControl?.apps,
        columns: {
          ...BASE_EN_STRINGS.vpsControl.apps.columns,
          ...JP_OVERRIDES.vpsControl?.apps?.columns
        }
      },
      activity: { ...BASE_EN_STRINGS.vpsControl.activity, ...JP_OVERRIDES.vpsControl?.activity },
      database: { ...BASE_EN_STRINGS.vpsControl.database, ...JP_OVERRIDES.vpsControl?.database }
    },
    dashboard: {
      ...BASE_EN_STRINGS.dashboard,
      ...JP_OVERRIDES.dashboard,
      stats: { ...BASE_EN_STRINGS.dashboard.stats, ...JP_OVERRIDES.dashboard?.stats },
      apps: { ...BASE_EN_STRINGS.dashboard.apps, ...JP_OVERRIDES.dashboard?.apps },
      actions: { ...BASE_EN_STRINGS.dashboard.actions, ...JP_OVERRIDES.dashboard?.actions },
      statuses: { ...BASE_EN_STRINGS.dashboard.statuses, ...JP_OVERRIDES.dashboard?.statuses },
      recent: { ...BASE_EN_STRINGS.dashboard.recent, ...JP_OVERRIDES.dashboard?.recent }
    },
    apps: {
      ...BASE_EN_STRINGS.apps,
      ...JP_OVERRIDES.apps,
      tabs: { ...BASE_EN_STRINGS.apps.tabs, ...JP_OVERRIDES.apps?.tabs },
      exposureStatus: {
        ...BASE_EN_STRINGS.apps.exposureStatus,
        ...JP_OVERRIDES.apps?.exposureStatus
      }
    },
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
      log: {
        ...BASE_EN_STRINGS.deploy.log,
        ...JP_OVERRIDES.deploy?.log,
        steps: {
          ...BASE_EN_STRINGS.deploy.log.steps,
          ...JP_OVERRIDES.deploy?.log?.steps
        },
        toolbar: {
          ...BASE_EN_STRINGS.deploy.log.toolbar,
          ...JP_OVERRIDES.deploy?.log?.toolbar
        }
      },
      config: { ...BASE_EN_STRINGS.deploy.config, ...JP_OVERRIDES.deploy?.config },
      targetApp: { ...BASE_EN_STRINGS.deploy.targetApp, ...JP_OVERRIDES.deploy?.targetApp }
    },
    history: {
      ...BASE_EN_STRINGS.history,
      ...JP_OVERRIDES.history,
      filters: { ...BASE_EN_STRINGS.history.filters, ...JP_OVERRIDES.history?.filters },
      columns: { ...BASE_EN_STRINGS.history.columns, ...JP_OVERRIDES.history?.columns },
      actions: { ...BASE_EN_STRINGS.history.actions, ...JP_OVERRIDES.history?.actions },
      statuses: { ...BASE_EN_STRINGS.history.statuses, ...JP_OVERRIDES.history?.statuses },
      detail: { ...BASE_EN_STRINGS.history.detail, ...JP_OVERRIDES.history?.detail },
      pagination: { ...BASE_EN_STRINGS.history.pagination, ...JP_OVERRIDES.history?.pagination }
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
