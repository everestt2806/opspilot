/**
 * OpsPilot UI Redesign Prototype Controller
 * App-centric navigation, 5 fixed sidebar items, Deploy action button,
 * combined search & filter, honest last_seen_at labels, and UI-1 IPC scope alignment.
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

// Mock Data Models aligned with UI-1 IPC Capabilities
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
    doctor: [
      { item: 'Binding cổng máy chủ', status: 'PASS', statusClass: 'success', note: 'docker-proxy lắng nghe trên 0.0.0.0:3000' },
      { item: 'Firewall UFW trên VPS', status: 'PASS', statusClass: 'success', note: 'Luật UFW cho phép TCP/3000 từ mọi nguồn' },
      { item: 'Probe Healthcheck', status: 'PASS', statusClass: 'success', note: 'GET http://103.179.185.76:3000/health -> 200 OK (2ms)' },
      { item: 'Domain & Ingress', status: 'CHƯA BẬT', statusClass: 'neutral', note: 'Chế độ Direct Port, chưa gắn Reverse Proxy' }
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
    doctor: [
      { item: 'Binding cổng máy chủ', status: 'PASS', statusClass: 'success', note: 'docker-proxy lắng nghe trên 0.0.0.0:3001' },
      { item: 'Firewall UFW trên VPS', status: 'PASS', statusClass: 'success', note: 'Port 3001 ACCEPT' },
      { item: 'Probe Healthcheck', status: 'PASS', statusClass: 'success', note: 'GET http://103.179.185.76:3001/api/health -> 200 OK' }
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
    status: 'Chưa đối soát VPS',
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
    doctor: [
      { item: 'Binding cổng máy chủ', status: 'CẢNH BÁO', statusClass: 'warning', note: 'Chưa quét lại thông tin cổng trong 13 ngày' },
      { item: 'Firewall UFW trên VPS', status: 'CHƯA RÕ', statusClass: 'neutral', note: 'Cần SSH scan' },
      { item: 'Probe Healthcheck', status: 'PASS', statusClass: 'success', note: 'GET http://103.179.185.77:8080/ -> 200 OK' }
    ]
  }
};

const VPS_DATA = {
  'VM01-Prod': {
    id: 1,
    name: 'VM01-Prod',
    host: '103.179.185.76',
    port: '22',
    user: 'deployer',
    os: 'Ubuntu 22.04 LTS (x86_64)',
    authType: 'SSH Key File',
    status: 'Đã kết nối',
    statusClass: 'success',
    badgeText: 'Đã kết nối',
    lastSeen: 'Đã kiểm tra lúc 22:44:48',
    lastSeenSub: '2 phút trước · vps:scan OK',
    cpu: '24.5%',
    cpuWidth: '24.5%',
    cpuSub: 'Load avg: 0.98, 1.12',
    ram: '3.8 / 8.0 GB',
    ramWidth: '48%',
    ramSub: 'Còn trống: 4.2 GB',
    disk: '38 / 120 GB',
    diskWidth: '32%',
    diskSub: 'Còn trống: 82 GB',
    dockerVersion: '27.1.1 · Compose v2.29.1',
    storageDriver: 'overlay2 (ext4)',
    cgroupDriver: 'systemd (v2)',
    apps: ['express-api', 'next-blog'],
    databases: [
      { type: 'PostgreSQL 16', name: 'appdb', port: '5432', mem: '124 MB', status: 'Running' }
    ],
    activities: [
      { time: '03/10/2026 22:45:10', type: 'Deploy Execution', desc: 'Deploy express-api v4 qua runner bằng private key', status: 'Thành công', statusClass: 'success' },
      { time: '03/10/2026 22:44:50', type: 'Preflight Check', desc: 'P2d-6b: Đọc SSH private key từ file, kiểm tra Docker socket', status: 'Đạt', statusClass: 'success' },
      { time: '03/10/2026 22:44:48', type: 'Scan (vps:scan)', desc: 'Quét tài nguyên deployer@103.179.185.76:22 thành công', status: 'PASS', statusClass: 'success' }
    ]
  },

  'VM02-Staging': {
    id: 2,
    name: 'VM02-Staging',
    host: '103.179.185.77',
    port: '2222',
    user: 'ubuntu',
    os: 'Ubuntu 20.04 LTS (x86_64)',
    authType: 'Password Auth',
    status: 'Chưa kiểm tra gần đây',
    statusClass: 'warning',
    badgeText: 'Chưa kiểm tra gần đây',
    lastSeen: 'Chưa kiểm tra gần đây',
    lastSeenSub: '13 ngày trước · Quy tắc hiển thị >24h',
    cpu: '12.0%',
    cpuWidth: '12%',
    cpuSub: 'Load avg: 0.15 (Cũ)',
    ram: '1.2 / 4.0 GB',
    ramWidth: '30%',
    ramSub: 'Còn trống: 2.8 GB',
    disk: '18 / 60 GB',
    diskWidth: '30%',
    diskSub: 'Còn trống: 42 GB',
    dockerVersion: '24.0.7 · Compose v2.21.0',
    storageDriver: 'overlay2 (ext4)',
    cgroupDriver: 'systemd (v2)',
    apps: ['vite-dashboard'],
    databases: [
      { type: 'PostgreSQL 16', name: 'staging_db', port: '5432', mem: '98 MB', status: 'Running' }
    ],
    activities: [
      { time: '20/09/2026 10:15:00', type: 'Deploy Execution', desc: 'Deploy vite-dashboard v1', status: 'Thành công', statusClass: 'success' },
      { time: '20/09/2026 10:00:00', type: 'Scan (vps:scan)', desc: 'Xác thực password ubuntu@103.179.185.77:2222', status: 'PASS', statusClass: 'success' }
    ]
  },

  'VM03-Cloud-Expired': {
    id: 3,
    name: 'VM03-Cloud-Expired',
    host: '192.168.1.99',
    port: '22',
    user: 'root',
    os: 'Không thể xác định (Mất kết nối)',
    authType: 'SSH Key File',
    status: 'Mất kết nối',
    statusClass: 'danger',
    badgeText: 'Mất kết nối',
    lastSeen: 'Mất kết nối (Timeout)',
    lastSeenSub: 'TCP connection timeout 192.168.1.99:22',
    cpu: 'N/A',
    cpuWidth: '0%',
    cpuSub: 'Không thể đọc thông số',
    ram: 'N/A',
    ramWidth: '0%',
    ramSub: 'Không thể đọc thông số',
    disk: 'N/A',
    diskWidth: '0%',
    diskSub: 'Không thể đọc thông số',
    dockerVersion: 'N/A',
    storageDriver: 'N/A',
    cgroupDriver: 'N/A',
    apps: [],
    databases: [],
    activities: [
      { time: '15/09/2026 09:12:00', type: 'Scan (vps:scan)', desc: 'TCP connection timeout 192.168.1.99:22', status: 'Timeout', statusClass: 'danger' },
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
    'settings': 'nav-btn-settings',
    'deploy': null
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
    } else if (viewId === 'deploy') {
      titleContext.textContent = 'Triển khai (DeployPage)';
    }
  }

  // Scroll to top
  window.scrollTo(0, 0);
}


// Open App Detail View (Dynamic Rendering - 3 UI-1 Tabs)
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

  // Doctor Tab
  const docTbody = document.getElementById('app-doctor-tbody');
  docTbody.innerHTML = app.doctor.map(doc => `
    <tr>
      <td>${doc.item}</td>
      <td><span class="status-pill ${doc.statusClass}">${doc.status}</span></td>
      <td>${doc.note}</td>
    </tr>
  `).join('');
}


// Open VPS Detail View (Dynamic Rendering - 4 UI-1 Tabs)
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

  document.getElementById('vps-metric-time-val').textContent = vps.lastSeen;
  document.getElementById('vps-metric-time-sub').textContent = vps.lastSeenSub;

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

  // Databases Tab (database:list IPC)
  document.getElementById('vps-tab-db-badge').textContent = `${vps.databases.length} DB`;
  const dbTbody = document.getElementById('vps-database-tbody');
  if (vps.databases.length === 0) {
    dbTbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--text-muted); padding: 20px;">Không có cơ sở dữ liệu nào trên máy chủ này.</td></tr>`;
  } else {
    dbTbody.innerHTML = vps.databases.map(db => `
      <tr>
        <td><strong>${db.type}</strong></td>
        <td><code>${db.name}</code></td>
        <td><span class="code-pill">:${db.port}</span></td>
        <td>${db.mem}</td>
        <td><span class="status-pill success"><span class="status-pill-dot"></span>${db.status}</span></td>
      </tr>
    `).join('');
  }

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
  alert('[Mô phỏng Prototype] Đã đồng bộ danh sách ứng dụng từ cơ sở dữ liệu cục bộ qua IPC app:list. (Chỉ mô phỏng giao diện)');
}


// Deploy Page Navigation with Preselect (UI-1 Design Decision)
function openDeployPage(appName, vpsName) {
  const targetApp = appName || 'express-api';
  const app = APPS_DATA[targetApp];

  const select = document.getElementById('deploy-page-app-select');
  if (select) select.value = targetApp;

  const targetInput = document.getElementById('deploy-page-vps-target');
  if (app && targetInput) {
    targetInput.value = `${app.vpsName} (${app.vpsHost}:${app.vpsPort})`;
  } else if (vpsName && targetInput) {
    targetInput.value = vpsName;
  }

  switchView('deploy');
}

function onDeployPageAppChange(appName) {
  const app = APPS_DATA[appName];
  const targetInput = document.getElementById('deploy-page-vps-target');
  if (app && targetInput) {
    targetInput.value = `${app.vpsName} (${app.vpsHost}:${app.vpsPort})`;
  }
}

function simulateDeploy() {
  const select = document.getElementById('deploy-page-app-select');
  const appName = select ? select.value : 'express-api';
  alert(`[Mô phỏng Prototype] Đã kích hoạt quy trình triển khai cho ${appName} qua DeployPage/runner. (Chỉ mô phỏng giao diện, không chạy thật)`);
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
  alert('[Mô phỏng Prototype] Gọi IPC doctor:diagnose... Kết quả: MỌI CHỈ SỐ BÌNH THƯỜNG. (Chỉ mô phỏng giao diện)');
}

function rollbackTo(version) {
  if (confirm(`[Mô phỏng Prototype] Bạn có muốn gọi IPC app:rollback về phiên bản ${version} không?`)) {
    alert(`[Mô phỏng Prototype] Rollback hoàn tất về ${version}. (Chỉ mô phỏng giao diện, không chạy thật)`);
  }
}

function confirmRollbackModal() {
  const promptVal = prompt('[Mô phỏng Prototype] Nhập tên ứng dụng "express-api" để xác nhận rollback:');
  if (promptVal === 'express-api') {
    alert('[Mô phỏng Prototype] Xác nhận thành công! Đã kích hoạt rollback về phiên bản trước. (Chỉ mô phỏng giao diện)');
  } else if (promptVal !== null) {
    alert('[Mô phỏng Prototype] Tên xác nhận không khớp! Hủy rollback an toàn.');
  }
}

function scanFleet() {
  alert('[Mô phỏng Prototype] Đang lặp qua danh sách VPS và gọi IPC vps:scan(vpsId) cho từng máy chủ. (Chỉ mô phỏng giao diện)');
}

function scanVps(vpsName, vpsId) {
  alert(`[Mô phỏng Prototype] Gọi IPC vps:scan(${vpsId}) để cập nhật tài nguyên cho máy chủ ${vpsName}. (Chỉ mô phỏng giao diện)`);
}

function scanCurrentVps() {
  if (!currentVpsObj) return;
  scanVps(currentVpsObj.name, currentVpsObj.id);
}


// Initialize default state on load
document.addEventListener('DOMContentLoaded', () => {
  openAppDetail('express-api');
  openVpsDetail('VM01-Prod');
  switchView('apps');
});
