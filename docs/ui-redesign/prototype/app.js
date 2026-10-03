/**
 * OpsPilot UI Redesign Prototype Controller
 * App-centric navigation, 5 fixed sidebar items, Deploy action button,
 * combined search & filter, honest trust model, and dynamic object detail views.
 */

// Global State
let currentTheme = 'dark';
let activeView = 'apps';
let currentApp = 'express-api';
let currentVps = 'VM01-Prod';
let currentAppObj = null;
let currentVpsObj = null;

let appSearchQuery = '';
let appSelectedVps = 'all';

// Mock Data Models
const APPS_DATA = {
  'express-api': {
    name: 'express-api',
    framework: 'Node.js Express',
    vpsName: 'VM01-Prod',
    vpsHost: '103.179.185.76',
    vpsPort: '22',
    hostPort: '3000',
    containerPort: '3000/tcp',
    healthPath: '/health',
    status: 'Đang chạy (Healthy)',
    statusClass: 'success',
    exposure: 'Direct Port Reachable',
    image: 'express-api:v4',
    containerName: 'opspilot-express-api-1',
    cpu: '4.2%',
    cpuWidth: '4.2%',
    ram: '84.5 MB',
    ramWidth: '16%',
    errorRate: '0.00%',
    deployments: [
      { id: '#dep-104 (v4)', image: 'express-api:v4 (commit 7a82b9c)', time: '03/10/2026 22:45:10', duration: '14.2s', status: 'running', statusClass: 'success', active: true, note: 'Tích hợp P2d-6b SSH key flow' },
      { id: '#dep-103 (v3)', image: 'express-api:v3 (commit b41c90a)', time: '02/10/2026 18:20:00', duration: '13.8s', status: 'stopped', statusClass: 'neutral', active: false, note: 'Bật fault injection testing endpoints' },
      { id: '#dep-101 (v2)', image: 'express-api:v2 (commit 90af231)', time: '01/10/2026 14:10:05', duration: '42.1s', status: 'failed', statusClass: 'danger', active: false, note: 'Lỗi HEALTHCHECK: Port 3000 timeout' },
      { id: '#dep-095 (v1)', image: 'express-api:v1 (commit 11e40fa)', time: '30/09/2026 09:00:00', duration: '15.0s', status: 'rolled_back', statusClass: 'neutral', active: false, note: 'Bản dựng khởi tạo ban đầu' }
    ],
    env: [
      { key: 'NODE_ENV', val: 'production', note: 'Chế độ runtime Express' },
      { key: 'PORT', val: '3000', note: 'Cổng ứng dụng lắng nghe' },
      { key: 'ENABLE_FAULT_ENDPOINTS', val: 'true', note: 'Bật theo chỉ thị P2d-6a cho pilot runner' },
      { key: 'DATABASE_URL', val: 'postgres://app_user:••••••••••@103.179.185.76:5432/appdb', note: 'Đã che mật khẩu (Masked)' }
    ],
    doctor: [
      { item: 'Binding cổng máy chủ', status: 'PASS', statusClass: 'success', note: 'docker-proxy lắng nghe trên 0.0.0.0:3000' },
      { item: 'Firewall UFW trên VPS', status: 'PASS', statusClass: 'success', note: 'Luật UFW cho phép TCP/3000 từ mọi nguồn' },
      { item: 'Probe Healthcheck', status: 'PASS', statusClass: 'success', note: 'GET http://103.179.185.76:3000/health -> 200 OK (2ms)' },
      { item: 'Domain & Ingress', status: 'CHƯA BẬT', statusClass: 'neutral', note: 'Chế độ Direct Port, chưa gắn Reverse Proxy' }
    ],
    logs: [
      { ts: '[2026-10-03T22:45:12Z]', level: '[INFO]', msg: 'Starting Express server on port 3000...' },
      { ts: '[2026-10-03T22:45:13Z]', level: '[INFO]', msg: 'Connected to PostgreSQL at 103.179.185.76:5432/appdb' },
      { ts: '[2026-10-03T22:45:13Z]', level: '[INFO]', msg: 'Fault endpoints enabled: /__fault/kill, /__fault/delay' },
      { ts: '[2026-10-03T22:45:15Z]', level: '[INFO]', msg: 'Healthcheck probe received: GET /health 200 (1ms)' },
      { ts: '[2026-10-03T23:01:22Z]', level: '[INFO]', msg: 'GET /api/v1/users 200 (14ms)' },
      { ts: '[2026-10-03T23:15:40Z]', level: '[INFO]', msg: 'GET /health 200 (2ms)' }
    ]
  },

  'next-blog': {
    name: 'next-blog',
    framework: 'Next.js 14 SSR',
    vpsName: 'VM01-Prod',
    vpsHost: '103.179.185.76',
    vpsPort: '22',
    hostPort: '3001',
    containerPort: '3000/tcp',
    healthPath: '/api/health',
    status: 'Đang chạy (Healthy)',
    statusClass: 'success',
    exposure: 'Direct Port Reachable',
    image: 'next-blog:v2',
    containerName: 'opspilot-next-blog-1',
    cpu: '2.1%',
    cpuWidth: '2.1%',
    ram: '142.0 MB',
    ramWidth: '28%',
    errorRate: '0.00%',
    deployments: [
      { id: '#dep-088 (v2)', image: 'next-blog:v2 (commit c99120e)', time: '02/10/2026 14:30:00', duration: '28.4s', status: 'running', statusClass: 'success', active: true, note: 'Tối ưu Server-Side Rendering cache' },
      { id: '#dep-070 (v1)', image: 'next-blog:v1 (commit 45f8a1b)', time: '28/09/2026 11:00:00', duration: '31.2s', status: 'stopped', statusClass: 'neutral', active: false, note: 'Bản khởi tạo Next.js portal' }
    ],
    env: [
      { key: 'NODE_ENV', val: 'production', note: 'Next.js production runtime' },
      { key: 'PORT', val: '3000', note: 'Cổng nội bộ container' },
      { key: 'NEXT_PUBLIC_API_URL', val: 'http://103.179.185.76:3000', note: 'Liên kết tới express-api' }
    ],
    doctor: [
      { item: 'Binding cổng máy chủ', status: 'PASS', statusClass: 'success', note: 'docker-proxy lắng nghe trên 0.0.0.0:3001' },
      { item: 'Firewall UFW trên VPS', status: 'PASS', statusClass: 'success', note: 'Port 3001 ACCEPT' },
      { item: 'Probe Healthcheck', status: 'PASS', statusClass: 'success', note: 'GET http://103.179.185.76:3001/api/health -> 200 OK' }
    ],
    logs: [
      { ts: '[2026-10-02T14:30:15Z]', level: '[INFO]', msg: '▲ Next.js 14.2.5 server ready on port 3000' },
      { ts: '[2026-10-02T14:30:16Z]', level: '[INFO]', msg: 'Compiled /api/health in 120ms' },
      { ts: '[2026-10-02T14:30:18Z]', level: '[INFO]', msg: 'Healthcheck probe: GET /api/health 200' }
    ]
  },

  'vite-dashboard': {
    name: 'vite-dashboard',
    framework: 'Vite / Nginx',
    vpsName: 'VM02-Staging',
    vpsHost: '103.179.185.77',
    vpsPort: '2222',
    hostPort: '8080',
    containerPort: '80/tcp',
    healthPath: '/',
    status: 'Chưa đối soát VPS (Stale)',
    statusClass: 'warning',
    exposure: 'Host Unverified',
    image: 'vite-dashboard:v1',
    containerName: 'opspilot-vite-dashboard-1',
    cpu: '0.8%',
    cpuWidth: '1%',
    ram: '32.0 MB',
    ramWidth: '8%',
    errorRate: 'Chưa đo',
    deployments: [
      { id: '#dep-042 (v1)', image: 'vite-dashboard:v1 (commit ea11029)', time: '20/09/2026 10:15:00', duration: '12.0s', status: 'running', statusClass: 'warning', active: true, note: 'Bản dựng Staging (VPS chưa quét lại)' }
    ],
    env: [
      { key: 'VITE_API_URL', val: 'http://103.179.185.77:3000', note: 'API Backend nội bộ Staging' },
      { key: 'NGINX_PORT', val: '80', note: 'Nginx static server' }
    ],
    doctor: [
      { item: 'Binding cổng máy chủ', status: 'CẢNH BÁO', statusClass: 'warning', note: 'Chưa quét lại thông tin cổng trong 13 ngày' },
      { item: 'Firewall UFW trên VPS', status: 'CHƯA RÕ', statusClass: 'neutral', note: 'Cần SSH keyscan & ping' },
      { item: 'Probe Healthcheck', status: 'PASS', statusClass: 'success', note: 'GET http://103.179.185.77:8080/ -> 200 OK' }
    ],
    logs: [
      { ts: '[2026-09-20T10:15:10Z]', level: '[INFO]', msg: 'nginx/1.25.4 worker process 1 started' },
      { ts: '[2026-09-20T10:15:12Z]', level: '[INFO]', msg: 'Configuration test successful' }
    ]
  }
};

const VPS_DATA = {
  'VM01-Prod': {
    name: 'VM01-Prod',
    host: '103.179.185.76',
    port: '22',
    user: 'deployer',
    os: 'Ubuntu 22.04 LTS (x86_64)',
    authType: 'SSH Key File',
    status: 'Đã kết nối (Reachable)',
    statusClass: 'success',
    badgeText: 'Đã kết nối',
    cpu: '24.5%',
    cpuWidth: '24.5%',
    cpuSub: 'Load avg: 0.98, 1.12',
    ram: '3.8 / 8.0 GB',
    ramWidth: '48%',
    ramSub: 'Còn trống: 4.2 GB',
    disk: '38 / 120 GB',
    diskWidth: '32%',
    diskSub: 'Còn trống: 82 GB',
    uptime: 'Chrony OK · Uptime 45 ngày',
    dockerVersion: '27.1.1 · Compose v2.29.1',
    storageDriver: 'overlay2 (ext4)',
    cgroupDriver: 'systemd (v2)',
    hostKeyType: 'ssh-ed25519',
    fingerprint: 'SHA256:4t7Zq91wJkWu...ed25519 (Quét qua ssh-keyscan)',
    fingerprintStatus: 'Chưa đối chiếu qua kênh tin cậy',
    fingerprintClass: 'neutral',
    apps: ['express-api', 'next-blog'],
    storage: { images: '3.4 GB (52% thu hồi)', containers: '45 MB', volumes: '2.1 GB' },
    activities: [
      { time: '03/10/2026 22:45:10', type: 'Deploy Execution', desc: 'Deploy express-api v4 qua runner bằng private key', status: 'Thành công', statusClass: 'success' },
      { time: '03/10/2026 22:44:50', type: 'Preflight Check', desc: 'Kiểm tra Docker socket & dung lượng đĩa', status: 'Đạt', statusClass: 'success' },
      { time: '03/10/2026 22:44:48', type: 'SSH Ping', desc: 'Xác thực deployer@103.179.185.76:22 thành công', status: 'PASS', statusClass: 'success' }
    ]
  },

  'VM02-Staging': {
    name: 'VM02-Staging',
    host: '103.179.185.77',
    port: '2222',
    user: 'ubuntu',
    os: 'Ubuntu 20.04 LTS (x86_64)',
    authType: 'Password Auth',
    status: 'Chưa xác minh (Stale - 13 ngày)',
    statusClass: 'warning',
    badgeText: 'Chưa xác minh',
    cpu: '12.0%',
    cpuWidth: '12%',
    cpuSub: 'Load avg: 0.15 (Cũ)',
    ram: '1.2 / 4.0 GB',
    ramWidth: '30%',
    ramSub: 'Còn trống: 2.8 GB',
    disk: '18 / 60 GB',
    diskWidth: '30%',
    diskSub: 'Còn trống: 42 GB',
    uptime: '13 ngày trước chưa quét lại',
    dockerVersion: '24.0.7 · Compose v2.21.0',
    storageDriver: 'overlay2 (ext4)',
    cgroupDriver: 'systemd (v2)',
    hostKeyType: 'ssh-ed25519',
    fingerprint: 'SHA256:7v8Wq2...ed25519 (Quét 13 ngày trước)',
    fingerprintStatus: 'Chưa đối chiếu lại (Stale)',
    fingerprintClass: 'warning',
    apps: ['vite-dashboard'],
    storage: { images: '1.2 GB', containers: '15 MB', volumes: '500 MB' },
    activities: [
      { time: '20/09/2026 10:15:00', type: 'Deploy Execution', desc: 'Deploy vite-dashboard v1', status: 'Thành công', statusClass: 'success' },
      { time: '20/09/2026 10:00:00', type: 'SSH Ping', desc: 'Xác thực password ubuntu@103.179.185.77:2222', status: 'PASS', statusClass: 'success' }
    ]
  },

  'VM03-Cloud-Expired': {
    name: 'VM03-Cloud-Expired',
    host: '192.168.1.99',
    port: '22',
    user: 'root',
    os: 'Không thể xác định (Mất kết nối)',
    authType: 'SSH Key File',
    status: 'Mất kết nối (Unreachable / Timeout)',
    statusClass: 'danger',
    badgeText: 'Mất kết nối',
    cpu: 'N/A',
    cpuWidth: '0%',
    cpuSub: 'Không thể đọc thông số',
    ram: 'N/A',
    ramWidth: '0%',
    ramSub: 'Không thể đọc thông số',
    disk: 'N/A',
    diskWidth: '0%',
    diskSub: 'Không thể đọc thông số',
    uptime: 'Mất kết nối TCP/22',
    dockerVersion: 'N/A',
    storageDriver: 'N/A',
    cgroupDriver: 'N/A',
    hostKeyType: 'Không xác định',
    fingerprint: 'N/A (Connection Timeout)',
    fingerprintStatus: 'Lỗi kết nối SSH',
    fingerprintClass: 'danger',
    apps: [],
    storage: { images: 'N/A', containers: 'N/A', volumes: 'N/A' },
    activities: [
      { time: '15/09/2026 09:12:00', type: 'SSH Ping', desc: 'TCP connection timeout 192.168.1.99:22', status: 'Timeout', statusClass: 'danger' },
      { time: '10/09/2026 08:00:00', type: 'SSH Handshake', desc: 'SSH authentication rejected (Key expired)', status: 'Auth Failed', statusClass: 'danger' }
    ]
  }
};


// View Switcher (5 fixed items + detail views)
function switchView(viewId) {
  activeView = viewId;

  // Update navigation button active state
  document.querySelectorAll('.nav-item-btn').forEach(btn => btn.classList.remove('active'));
  const navMap = {
    'dashboard': 'nav-btn-dashboard',
    'apps': 'nav-btn-apps',
    'app-detail': 'nav-btn-apps',
    'vps': 'nav-btn-vps',
    'vps-detail': 'nav-btn-vps',
    'activity': 'nav-btn-activity',
    'settings': 'nav-btn-settings'
  };

  const activeBtnId = navMap[viewId];
  if (activeBtnId) {
    const btn = document.getElementById(activeBtnId);
    if (btn) btn.classList.add('active');
  }

  // Hide all view containers
  document.querySelectorAll('.view-container').forEach(c => c.classList.remove('active'));

  // Show target view container
  const target = document.getElementById(`view-${viewId}`);
  if (target) {
    target.classList.add('active');
  }

  // Update Titlebar context breadcrumb
  const titleContext = document.getElementById('titlebar-context');
  if (titleContext) {
    if (viewId === 'dashboard') {
      titleContext.textContent = 'Tổng quan';
    } else if (viewId === 'apps') {
      titleContext.textContent = 'Ứng dụng';
    } else if (viewId === 'app-detail') {
      titleContext.textContent = `Ứng dụng / ${currentApp}`;
    } else if (viewId === 'vps') {
      titleContext.textContent = 'Máy chủ (VPS Fleet)';
    } else if (viewId === 'vps-detail') {
      titleContext.textContent = `Máy chủ / ${currentVps}`;
    } else if (viewId === 'activity') {
      titleContext.textContent = 'Nhật ký Hoạt động';
    } else if (viewId === 'settings') {
      titleContext.textContent = 'Cài đặt Hệ thống';
    }
  }

  // Scroll to top
  window.scrollTo(0, 0);
}


// Open App Detail View (Dynamic Rendering)
function openAppDetail(appName) {
  const app = APPS_DATA[appName];
  if (!app) return;

  currentApp = appName;
  currentAppObj = app;

  renderAppDetail(app);
  switchView('app-detail');
}

function renderAppDetail(app) {
  // Titlebar & Header
  document.getElementById('detail-app-name').textContent = app.name;
  document.getElementById('detail-app-name-breadcrumb').textContent = app.name;
  document.getElementById('detail-app-vps').textContent = `Hạ tầng: ${app.vpsName} (${app.vpsHost})`;
  document.getElementById('detail-app-subtitle').textContent =
    `Endpoint: http://${app.vpsHost}:${app.hostPort} | Cổng container: ${app.containerPort} | Healthcheck: ${app.healthPath}`;

  const statusBadge = document.getElementById('detail-app-status');
  statusBadge.className = `status-pill ${app.statusClass}`;
  document.getElementById('detail-app-status-text').textContent = app.status;

  // Overview Tab Metrics
  document.getElementById('detail-overview-container-state').textContent = app.statusClass === 'success' ? 'UP (2d 14h)' : (app.statusClass === 'warning' ? 'UP (Chưa đối soát)' : 'STOPPED');
  document.getElementById('detail-overview-container-name').textContent = `Container: ${app.containerName}`;
  document.getElementById('detail-overview-cpu').textContent = app.cpu;
  document.getElementById('detail-overview-cpu-bar').style.width = app.cpuWidth;
  document.getElementById('detail-overview-ram').textContent = app.ram;
  document.getElementById('detail-overview-ram-bar').style.width = app.ramWidth;
  document.getElementById('detail-overview-error-rate').textContent = app.errorRate;

  // Overview Port & Infra
  document.getElementById('detail-overview-host-port').textContent = app.hostPort;
  document.getElementById('detail-overview-container-port').textContent = app.containerPort;
  document.getElementById('detail-overview-health-path').textContent = app.healthPath;
  const expPill = document.getElementById('detail-overview-exposure-pill');
  expPill.className = `status-pill ${app.statusClass}`;
  expPill.textContent = app.exposure;

  document.getElementById('detail-overview-vps-title').textContent = app.vpsName;
  document.getElementById('detail-overview-vps-ip').textContent = `${app.vpsHost}:${app.vpsPort}`;

  // Deployments Tab
  const badgeCount = document.getElementById('app-detail-versions-badge');
  badgeCount.textContent = `${app.deployments.length} phiên bản`;

  const depTbody = document.getElementById('app-deployments-tbody');
  depTbody.innerHTML = app.deployments.map(d => `
    <tr style="${d.active ? 'background: rgba(59, 130, 246, 0.05);' : ''}">
      <td>
        <strong>${d.id}</strong>
        ${d.active ? '<span class="tab-badge" style="background: var(--color-primary); color: #fff; margin-left: 6px;">Đang kích hoạt</span>' : ''}
      </td>
      <td><span class="code-pill">${d.image}</span></td>
      <td>${d.time}</td>
      <td>${d.duration}</td>
      <td><span class="status-pill ${d.statusClass}"><span class="status-pill-dot"></span>${d.status}</span></td>
      <td>${d.note}</td>
      <td style="text-align: right">
        ${d.active
          ? '<span style="color: var(--text-muted); font-size: 11px;">(Đang chạy)</span>'
          : (d.status === 'failed'
              ? '<button class="btn btn-secondary btn-sm" disabled style="opacity: 0.5">Không khả dụng</button>'
              : `<button class="btn btn-secondary btn-sm" onclick="rollbackTo('${d.id}')">Rollback</button>`)}
      </td>
    </tr>
  `).join('');

  // Env Tab
  const envTbody = document.getElementById('app-env-tbody');
  envTbody.innerHTML = app.env.map(e => `
    <tr>
      <td><span class="code-pill">${e.key}</span></td>
      <td><code>${e.val}</code></td>
      <td>${e.note}</td>
    </tr>
  `).join('');

  // Doctor Tab
  const docTbody = document.getElementById('app-doctor-tbody');
  docTbody.innerHTML = app.doctor.map(doc => `
    <tr>
      <td>${doc.item}</td>
      <td><span class="status-pill ${doc.statusClass}">${doc.status}</span></td>
      <td>${doc.note}</td>
    </tr>
  `).join('');

  // Logs Tab
  document.getElementById('logs-container-label').textContent = `Container: ${app.containerName}`;
  const term = document.getElementById('terminal-content');
  term.innerHTML = app.logs.map(l => `
    <div class="log-line">
      <span class="log-ts">${l.ts}</span>
      <span class="log-info">${l.level}</span>
      <span>${l.msg}</span>
    </div>
  `).join('');
}


// Open VPS Detail View (Dynamic Rendering)
function openVpsDetail(vpsName) {
  const vps = VPS_DATA[vpsName];
  if (!vps) return;

  currentVps = vpsName;
  currentVpsObj = vps;

  renderVpsDetail(vps);
  switchView('vps-detail');
}

function renderVpsDetail(vps) {
  // Title & Header
  document.getElementById('detail-vps-title').textContent = vps.name;
  document.getElementById('detail-vps-name-breadcrumb').textContent = vps.name;
  document.getElementById('detail-vps-ip-pill').textContent = `${vps.host}:${vps.port}`;
  document.getElementById('detail-vps-subtitle').textContent =
    `Hệ điều hành: ${vps.os} | Người dùng SSH: ${vps.user} | Xác thực: ${vps.authType}`;

  const badge = document.getElementById('detail-vps-badge');
  badge.className = `status-pill ${vps.statusClass}`;
  document.getElementById('detail-vps-badge-text').textContent = vps.badgeText;

  // Specs Tab Metrics
  document.getElementById('vps-metric-cpu-val').textContent = vps.cpu;
  document.getElementById('vps-metric-cpu-sub').textContent = vps.cpuSub;
  document.getElementById('vps-metric-cpu-bar').style.width = vps.cpuWidth;

  document.getElementById('vps-metric-ram-val').textContent = vps.ram;
  document.getElementById('vps-metric-ram-sub').textContent = vps.ramSub;
  document.getElementById('vps-metric-ram-bar').style.width = vps.ramWidth;

  document.getElementById('vps-metric-disk-val').textContent = vps.disk;
  document.getElementById('vps-metric-disk-sub').textContent = vps.diskSub;
  document.getElementById('vps-metric-disk-bar').style.width = vps.diskWidth;

  document.getElementById('vps-metric-time-val').textContent = vps.statusClass === 'success' ? 'Chrony OK' : (vps.statusClass === 'warning' ? 'Cảnh báo lệch giờ' : 'N/A');
  document.getElementById('vps-metric-time-sub').textContent = vps.uptime;

  // Docker Runtime Info
  const dockerTbody = document.getElementById('vps-docker-tbody');
  dockerTbody.innerHTML = `
    <tr>
      <td style="color: var(--text-muted); width: 160px;">Docker Engine</td>
      <td><span class="code-pill">${vps.dockerVersion}</span></td>
    </tr>
    <tr>
      <td style="color: var(--text-muted);">Storage Driver</td>
      <td><code>${vps.storageDriver}</code></td>
    </tr>
    <tr>
      <td style="color: var(--text-muted);">Cgroup Driver</td>
      <td><code>${vps.cgroupDriver}</code></td>
    </tr>
  `;

  // Apps Tab
  document.getElementById('vps-tab-apps-badge').textContent = `${vps.apps.length} apps`;
  const appsTbody = document.getElementById('vps-apps-tbody');
  if (vps.apps.length === 0) {
    appsTbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--text-muted); padding: 24px;">Không có ứng dụng nào đang triển khai trên máy chủ này.</td></tr>`;
  } else {
    appsTbody.innerHTML = vps.apps.map(appName => {
      const a = APPS_DATA[appName];
      if (!a) return '';
      return `
        <tr class="table-row-clickable" onclick="openAppDetail('${a.name}')">
          <td>
            <strong>${a.name}</strong>
            <div style="font-size: 11px; color: var(--text-muted);">${a.image}</div>
          </td>
          <td><span class="code-pill">${a.containerName}</span></td>
          <td><code>${a.hostPort}:${a.containerPort}</code></td>
          <td>${a.ram}</td>
          <td>${a.cpu}</td>
          <td><span class="status-pill ${a.statusClass}"><span class="status-pill-dot"></span>${a.status}</span></td>
          <td style="text-align: right">
            <button class="btn btn-secondary btn-sm" onclick="event.stopPropagation(); openAppDetail('${a.name}')">Quản trị App</button>
          </td>
        </tr>
      `;
    }).join('');
  }

  // Storage Tab
  const storageTbody = document.getElementById('vps-storage-tbody');
  storageTbody.innerHTML = `
    <tr>
      <td>Images</td>
      <td>4</td>
      <td>${vps.apps.length}</td>
      <td>${vps.storage.images}</td>
      <td>1.2 GB</td>
    </tr>
    <tr>
      <td>Containers</td>
      <td>${vps.apps.length}</td>
      <td>${vps.apps.length}</td>
      <td>${vps.storage.containers}</td>
      <td>10 MB</td>
    </tr>
    <tr>
      <td>Local Volumes</td>
      <td>2</td>
      <td>2</td>
      <td>${vps.storage.volumes}</td>
      <td>0 B</td>
    </tr>
  `;

  // Security Tab (Honest Trust Model)
  const secTbody = document.getElementById('vps-security-tbody');
  secTbody.innerHTML = `
    <tr>
      <td style="color: var(--text-muted); width: 180px;">Loại khóa Host</td>
      <td><span class="code-pill">${vps.hostKeyType}</span></td>
    </tr>
    <tr>
      <td style="color: var(--text-muted);">Fingerprint quan sát</td>
      <td><span class="code-pill">${vps.fingerprint}</span></td>
    </tr>
    <tr>
      <td style="color: var(--text-muted);">Đối chiếu Host Key</td>
      <td>
        <span class="status-pill ${vps.fingerprintClass}">${vps.fingerprintStatus}</span>
        <div style="font-size: 11px; color: var(--text-muted); margin-top: 4px;">* Lệnh ssh-keyscan (TOFU) không thể coi là xác minh host. Cần đối chiếu fingerprint tin cậy ngoài.</div>
      </td>
    </tr>
    <tr>
      <td style="color: var(--text-muted);">Cơ chế SSH Auth</td>
      <td><code>${vps.authType}</code></td>
    </tr>
  `;

  // Activity Tab
  const actTbody = document.getElementById('vps-activity-tbody');
  actTbody.innerHTML = vps.activities.map(act => `
    <tr>
      <td>${act.time}</td>
      <td><strong>${act.type}</strong></td>
      <td>${act.desc}</td>
      <td><span class="status-pill ${act.statusClass}">${act.status}</span></td>
    </tr>
  `).join('');
}


// App Detail Tab Switching
function switchAppTab(paneId, btn) {
  const nav = btn.closest('.horizontal-tabs-nav');
  nav.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');

  const container = document.getElementById('view-app-detail');
  container.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
  const targetPane = document.getElementById(paneId);
  if (targetPane) targetPane.classList.add('active');
}

// VPS Detail Tab Switching
function switchVpsTab(paneId, btn) {
  const nav = btn.closest('.horizontal-tabs-nav');
  nav.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');

  const container = document.getElementById('view-vps-detail');
  container.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
  const targetPane = document.getElementById(paneId);
  if (targetPane) targetPane.classList.add('active');
}


// Combined Search & Filter on Apps List
function onAppSearchInput(query) {
  appSearchQuery = (query || '').trim().toLowerCase();
  applyAppFilters();
}

function onAppVpsFilterChange(vpsName) {
  appSelectedVps = vpsName;
  applyAppFilters();
}

function applyAppFilters() {
  const rows = document.querySelectorAll('#apps-table tbody tr');
  let visibleCount = 0;

  rows.forEach(r => {
    const rowText = r.textContent.toLowerCase();
    const rowVps = r.getAttribute('data-vps') || '';

    const matchSearch = !appSearchQuery || rowText.includes(appSearchQuery);
    const matchVps = appSelectedVps === 'all' || rowVps === appSelectedVps;

    if (matchSearch && matchVps) {
      r.style.display = '';
      visibleCount++;
    } else {
      r.style.display = 'none';
    }
  });

  const display = document.getElementById('apps-count-display');
  if (display) {
    display.textContent = `Hiển thị ${visibleCount} / 3 ứng dụng`;
  }
}

function refreshAppsList() {
  alert('Đã đồng bộ trạng thái container mới nhất từ các máy chủ VPS.');
}


// Deploy Modal (Global Action)
function openDeployModal(appName) {
  const targetApp = appName || 'express-api';
  const select = document.getElementById('modal-deploy-app-select');
  if (select) select.value = targetApp;

  onDeployAppChange(targetApp);

  const modal = document.getElementById('deploy-modal');
  if (modal) modal.style.display = 'flex';
}

function closeDeployModal() {
  const modal = document.getElementById('deploy-modal');
  if (modal) modal.style.display = 'none';
}

function onDeployAppChange(appName) {
  const app = APPS_DATA[appName];
  const targetInput = document.getElementById('modal-deploy-vps-target');
  if (app && targetInput) {
    targetInput.value = `${app.vpsName} (${app.vpsHost}:${app.vpsPort})`;
  }
}

function executeMockDeploy() {
  const select = document.getElementById('modal-deploy-app-select');
  const appName = select ? select.value : 'express-api';
  closeDeployModal();
  alert(`Bắt đầu chạy preflight và build mới cho ${appName}... Quá trình deploy sẽ được ghi nhận vào Nhật ký Hoạt động.`);
}


// Theme Switcher (Dark / Light)
function toggleTheme() {
  const html = document.documentElement;
  const label = document.getElementById('theme-label');
  if (currentTheme === 'dark') {
    currentTheme = 'light';
    html.setAttribute('data-theme', 'light');
    if (label) label.textContent = 'Giao diện Tối';
  } else {
    currentTheme = 'dark';
    html.setAttribute('data-theme', 'dark');
    if (label) label.textContent = 'Giao diện Sáng';
  }
}


// Diagnostics & Rollback Handlers
function runDoctorCheck() {
  alert('Doctor đang chẩn đoán DNS, socket binding và firewall... Kết quả: MỌI CHỈ SỐ BÌNH THƯỜNG.');
}

function rollbackTo(version) {
  if (confirm(`Bạn có chắc chắn muốn thực hiện Rollback về phiên bản ${version} ngay lập tức không? Hệ thống sẽ chuyển lưu lượng về container phiên bản trước.`)) {
    alert(`Rollback thành công về ${version}! Đã cập nhật router.`);
  }
}

function confirmRollbackModal() {
  const promptVal = prompt('Nhập chính xác tên ứng dụng "express-api" để xác nhận rollback về phiên bản trước:');
  if (promptVal === 'express-api') {
    alert('Xác nhận thành công! Đang kích hoạt Rollback về phiên bản trước...');
  } else if (promptVal !== null) {
    alert('Tên xác nhận không khớp! Hủy bỏ rollback an toàn.');
  }
}

function clearLogs() {
  const term = document.getElementById('terminal-content');
  if (term) {
    term.innerHTML = '<div class="log-line"><span class="log-ts">[LOG]</span> <span class="log-info">[INFO]</span> <span>Màn hình log đã được xóa. Đang lắng nghe luồng stdout...</span></div>';
  }
}

function scanFleet() {
  alert('Đang quét nhanh SSH tất cả máy chủ trong Fleet...');
}

function testVpsConnection() {
  alert('Đang gửi lệnh SSH ping kiểm tra kết nối...');
}

function scanVpsResources() {
  alert('Đang quét tài nguyên CPU/RAM/Disk từ xa...');
}


// Initialize default state on load
document.addEventListener('DOMContentLoaded', () => {
  openAppDetail('express-api');
  openVpsDetail('VM01-Prod');
  switchView('apps');
});
