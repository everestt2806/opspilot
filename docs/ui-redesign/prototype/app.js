/**
 * OpsPilot UI Redesign Prototype Controller
 * Handles interactive navigation, horizontal tabs, theme switching, and mock actions.
 */

// State
let currentTheme = 'dark';
let activeView = 'apps';
let currentApp = 'express-api';
let currentVps = 'VM01-Prod';

const APPS_DATA = {
  'express-api': {
    name: 'express-api',
    framework: 'Node.js Express',
    vps: 'VM01-Prod (192.168.1.100)',
    status: 'Đang hoạt động (Healthy)',
    port: '3000',
    url: 'http://192.168.1.100:3000',
    versionsCount: 4,
    health: 'healthy'
  },
  'nextjs-portal': {
    name: 'nextjs-portal',
    framework: 'Next.js 14 SSR',
    vps: 'VM01-Prod (192.168.1.100)',
    status: 'Đang hoạt động (Healthy)',
    port: '3001',
    url: 'http://192.168.1.100:3001',
    versionsCount: 2,
    health: 'healthy'
  },
  'worker-queue': {
    name: 'worker-queue',
    framework: 'Python Flask',
    vps: 'VM02-Staging (10.0.0.5:2222)',
    status: 'Chưa đối soát (Host Stale)',
    port: '5000',
    url: 'http://10.0.0.5:5000',
    versionsCount: 1,
    health: 'warning'
  }
};

const VPS_DATA = {
  'VM01-Prod': {
    name: 'VM01-Prod',
    host: '192.168.1.100:22',
    user: 'deployer',
    os: 'Ubuntu 22.04.4 LTS',
    status: 'Đã xác minh (Verified)',
    statusClass: 'success',
    badgeText: 'Đã xác minh (Verified)',
    appsCount: 2
  },
  'VM02-Staging': {
    name: 'VM02-Staging',
    host: '10.0.0.5:2222',
    user: 'ubuntu',
    os: 'Ubuntu 20.04.6 LTS',
    status: 'Chưa xác minh (Stale - 13 ngày)',
    statusClass: 'warning',
    badgeText: 'Chưa xác minh (Cũ)',
    appsCount: 1
  },
  'VM03-Cloud': {
    name: 'VM03-Cloud',
    host: '203.0.113.50:22',
    user: 'root',
    os: 'Debian 12 Bookworm',
    status: 'Mất kết nối / Hết hạn',
    statusClass: 'danger',
    badgeText: 'Mất kết nối / Khóa an toàn',
    appsCount: 0
  }
};

// Switch top-level views
function switchView(viewId) {
  activeView = viewId;

  // Update nav buttons
  document.querySelectorAll('.nav-item-btn').forEach(btn => btn.classList.remove('active'));
  const activeNavBtn = document.getElementById(`nav-btn-${viewId === 'app-detail' ? 'apps' : (viewId === 'vps-detail' ? 'vps' : viewId)}`);
  if (activeNavBtn) activeNavBtn.classList.add('active');

  // Hide all view containers
  document.querySelectorAll('.view-container').forEach(c => c.classList.remove('active'));

  // Show target container
  const target = document.getElementById(`view-${viewId}`);
  if (target) {
    target.classList.add('active');
  }

  // Update titlebar context
  const titleContext = document.getElementById('titlebar-context');
  if (viewId === 'apps') {
    titleContext.textContent = 'Ứng dụng';
  } else if (viewId === 'app-detail') {
    titleContext.textContent = `Ứng dụng / ${currentApp}`;
  } else if (viewId === 'vps') {
    titleContext.textContent = 'Hạ tầng máy chủ (VPS)';
  } else if (viewId === 'vps-detail') {
    titleContext.textContent = `Hạ tầng / ${currentVps}`;
  } else if (viewId === 'deploy') {
    alert('Điều hướng sang Trung tâm Triển khai');
  } else if (viewId === 'doctor') {
    alert('Điều hướng sang Bác sĩ Hệ thống');
  }
}

// Open App Detail
function openAppDetail(appName) {
  currentApp = appName;
  const app = APPS_DATA[appName];
  if (!app) return;

  document.getElementById('detail-app-name').textContent = app.name;
  document.getElementById('detail-app-name-breadcrumb').textContent = app.name;
  document.getElementById('detail-app-vps').textContent = `Hạ tầng: ${app.vps}`;

  const statusBadge = document.getElementById('detail-app-status');
  statusBadge.className = `status-pill ${app.health === 'healthy' ? 'success' : 'warning'}`;
  statusBadge.querySelector('span:last-child').textContent = app.status;

  switchView('app-detail');
}

// Open VPS Detail
function openVpsDetail(vpsName) {
  currentVps = vpsName;
  const vps = VPS_DATA[vpsName];
  if (!vps) return;

  document.getElementById('detail-vps-title').textContent = vps.name;
  document.getElementById('detail-vps-name-breadcrumb').textContent = vps.name;

  const badge = document.getElementById('detail-vps-badge');
  badge.className = `status-pill ${vps.statusClass}`;
  badge.querySelector('span:last-child').textContent = vps.badgeText;

  switchView('vps-detail');
}

// App Detail Horizontal Tab Switching
function switchAppTab(paneId, btn) {
  // Update buttons
  const nav = btn.closest('.horizontal-tabs-nav');
  nav.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');

  // Update panes
  const container = document.getElementById('view-app-detail');
  container.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
  const targetPane = document.getElementById(paneId);
  if (targetPane) targetPane.classList.add('active');
}

// VPS Detail Horizontal Tab Switching
function switchVpsTab(paneId, btn) {
  const nav = btn.closest('.horizontal-tabs-nav');
  nav.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');

  const container = document.getElementById('view-vps-detail');
  container.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
  const targetPane = document.getElementById(paneId);
  if (targetPane) targetPane.classList.add('active');
}

// Theme Toggle (Dark / Light)
function toggleTheme() {
  const html = document.documentElement;
  const label = document.getElementById('theme-label');
  if (currentTheme === 'dark') {
    currentTheme = 'light';
    html.setAttribute('data-theme', 'light');
    label.textContent = 'Giao diện Tối';
  } else {
    currentTheme = 'dark';
    html.setAttribute('data-theme', 'dark');
    label.textContent = 'Giao diện Sáng';
  }
}

// Filter apps by text
function filterAppRows(query) {
  const q = query.toLowerCase();
  const rows = document.querySelectorAll('#apps-table tbody tr');
  rows.forEach(r => {
    const text = r.textContent.toLowerCase();
    r.style.display = text.includes(q) ? '' : 'none';
  });
}

// Filter apps by VPS
function filterByVps(vpsName) {
  const rows = document.querySelectorAll('#apps-table tbody tr');
  rows.forEach(r => {
    if (vpsName === 'all') {
      r.style.display = '';
    } else {
      const match = r.textContent.includes(vpsName);
      r.style.display = match ? '' : 'none';
    }
  });
}

// Demo action handlers
function quickDeploy(appName) {
  alert(`Bắt đầu chạy preflight và build mới cho ${appName}...`);
}

function rollbackTo(version) {
  if (confirm(`Bạn có chắc chắn muốn thực hiện Rollback về phiên bản ${version} ngay lập tức không? Hệ thống sẽ chuyển lưu lượng về container phiên bản trước.`)) {
    alert(`Rollback thành công về ${version}! Đã cập nhật router.`);
  }
}

function confirmRollbackModal() {
  const promptVal = prompt('Nhập chính xác tên ứng dụng "express-api" để xác nhận rollback về phiên bản trước (v3):');
  if (promptVal === 'express-api') {
    alert('Xác nhận thành công! Đang kích hoạt Rollback về #dep-103 (v3)...');
  } else if (promptVal !== null) {
    alert('Tên xác nhận không khớp! Hủy bỏ rollback an toàn.');
  }
}

function runDoctorCheck() {
  alert('Doctor đang chẩn đoán DNS, socket binding và firewall... Kết quả: MỌI CHỈ SỐ BÌNH THƯỜNG.');
}

function clearLogs() {
  const term = document.getElementById('terminal-content');
  term.innerHTML = '<div class="log-line"><span class="log-ts">[LOG]</span> <span class="log-info">[INFO]</span> <span>Màn hình log đã được xóa. Đang lắng nghe luồng stdout...</span></div>';
}
