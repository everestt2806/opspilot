import { readFileSync } from 'node:fs'
import { BrowserWindow } from 'electron'

function loadLogoDataUri(iconPath: string): string {
  try {
    const buf = readFileSync(iconPath)
    return `data:image/png;base64,${buf.toString('base64')}`
  } catch {
    return ''
  }
}

function buildSplashHtml(logoUri: string): string {
  const logoMarkup = logoUri
    ? `<img class="logo-img" src="${logoUri}" alt="OpsPilot" />`
    : `<div class="logo-fallback">OP</div>`

  return `<!doctype html>
<html>
<head>
<meta charset="UTF-8" />
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body {
    width: 100%;
    height: 100%;
    background: transparent;
    overflow: hidden;
    font-family: 'Segoe UI Variable', 'Segoe UI', system-ui, -apple-system, sans-serif;
    user-select: none;
    -webkit-font-smoothing: antialiased;
  }
  .stage {
    width: 100%;
    height: 100%;
    padding: 20px;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .card {
    position: relative;
    width: 100%;
    height: 100%;
    border-radius: 18px;
    background:
      radial-gradient(300px 180px at 50% 24%, rgba(47, 129, 247, 0.14), transparent 72%),
      radial-gradient(200px 130px at 50% 10%, rgba(56, 189, 248, 0.1), transparent 70%),
      linear-gradient(180deg, #16181E 0%, #101216 100%);
    border: 1px solid rgba(255, 255, 255, 0.09);
    box-shadow:
      0 22px 48px rgba(0, 0, 0, 0.68),
      0 0 0 1px rgba(0, 0, 0, 0.4),
      inset 0 1px 0 rgba(255, 255, 255, 0.08);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 30px 34px 26px;
    overflow: hidden;
    opacity: 0;
    transform: scale(0.96);
    animation: cardIn 260ms cubic-bezier(0.16, 1, 0.3, 1) forwards;
    transition: opacity 180ms ease, transform 180ms ease;
  }
  .card::before {
    content: '';
    position: absolute;
    inset: 0;
    background-image:
      linear-gradient(rgba(255, 255, 255, 0.025) 1px, transparent 1px),
      linear-gradient(90deg, rgba(255, 255, 255, 0.025) 1px, transparent 1px);
    background-size: 28px 28px;
    mask-image: radial-gradient(circle at 50% 35%, black 15%, transparent 75%);
    -webkit-mask-image: radial-gradient(circle at 50% 35%, black 15%, transparent 75%);
    pointer-events: none;
  }
  .card.closing {
    opacity: 0;
    transform: scale(0.975);
  }
  .emblem-wrap {
    position: relative;
    width: 104px;
    height: 104px;
    display: flex;
    align-items: center;
    justify-content: center;
    margin-bottom: 18px;
  }
  .emblem-halo {
    position: absolute;
    inset: 10px;
    border-radius: 50%;
    background: radial-gradient(circle, rgba(56, 189, 248, 0.24) 0%, rgba(47, 129, 247, 0.06) 55%, transparent 75%);
    filter: blur(8px);
    animation: haloBreathe 2.6s ease-in-out infinite;
  }
  .orbital-ring {
    position: absolute;
    inset: 2px;
    border-radius: 50%;
    border: 1px solid rgba(255, 255, 255, 0.07);
  }
  .orbital-arc {
    position: absolute;
    inset: 1px;
    border-radius: 50%;
    border: 1.75px solid transparent;
    border-top-color: #38BDF8;
    border-right-color: rgba(47, 129, 247, 0.45);
    animation: spin 1.65s cubic-bezier(0.45, 0.05, 0.55, 0.95) infinite;
  }
  .logo-img {
    position: relative;
    z-index: 1;
    width: 72px;
    height: 72px;
    object-fit: contain;
    filter: drop-shadow(0 8px 18px rgba(0, 0, 0, 0.55));
    animation: breathe 2.6s ease-in-out infinite;
  }
  .logo-fallback {
    position: relative;
    z-index: 1;
    width: 68px;
    height: 68px;
    border-radius: 16px;
    background: #1B1F27;
    border: 1px solid rgba(255, 255, 255, 0.12);
    display: flex;
    align-items: center;
    justify-content: center;
    color: #ECEEF2;
    font-weight: 700;
    font-size: 20px;
  }
  .title {
    position: relative;
    z-index: 1;
    color: #F3F5F8;
    font-size: 21px;
    font-weight: 700;
    letter-spacing: -0.025em;
    line-height: 25px;
  }
  .subtitle {
    position: relative;
    z-index: 1;
    margin-top: 4px;
    color: #7D8590;
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.18em;
    text-transform: uppercase;
  }
  .status-row {
    position: relative;
    z-index: 1;
    margin-top: 24px;
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    color: #9BA1AE;
    font-size: 11.5px;
  }
  .status-text {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .status-pct {
    font-family: 'Cascadia Mono', Consolas, monospace;
    font-size: 11px;
    color: #7D8590;
    flex-shrink: 0;
  }
  .progress-track {
    position: relative;
    z-index: 1;
    margin-top: 8px;
    width: 100%;
    height: 3px;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.08);
    overflow: hidden;
  }
  .progress-fill {
    height: 100%;
    width: 22%;
    border-radius: 999px;
    background: linear-gradient(90deg, #2F81F7 0%, #38BDF8 100%);
    transition: width 260ms cubic-bezier(0.16, 1, 0.3, 1);
    position: relative;
  }
  .progress-fill::after {
    content: '';
    position: absolute;
    inset: 0;
    background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.5), transparent);
    animation: sheen 1.15s linear infinite;
  }
  @keyframes cardIn {
    to { opacity: 1; transform: scale(1); }
  }
  @keyframes spin {
    to { transform: rotate(360deg); }
  }
  @keyframes breathe {
    0%, 100% { transform: scale(1); }
    50% { transform: scale(1.025); }
  }
  @keyframes haloBreathe {
    0%, 100% { opacity: 0.7; transform: scale(0.96); }
    50% { opacity: 1; transform: scale(1.04); }
  }
  @keyframes sheen {
    from { transform: translateX(-100%); }
    to { transform: translateX(100%); }
  }
</style>
</head>
<body>
  <div class="stage">
    <div class="card" id="card">
      <div class="emblem-wrap">
        <div class="emblem-halo"></div>
        <div class="orbital-ring"></div>
        <div class="orbital-arc"></div>
        ${logoMarkup}
      </div>
      <div class="title">OpsPilot</div>
      <div class="subtitle">Desktop Control Plane</div>
      <div class="status-row">
        <span class="status-text" id="status-text">Initializing workspace…</span>
        <span class="status-pct" id="status-pct">20%</span>
      </div>
      <div class="progress-track">
        <div class="progress-fill" id="progress-fill"></div>
      </div>
    </div>
  </div>
</body>
</html>`
}

export function createSplashWindow(iconPath: string): BrowserWindow {
  const splash = new BrowserWindow({
    width: 450,
    height: 310,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    center: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  const logoUri = loadLogoDataUri(iconPath)
  const html = buildSplashHtml(logoUri)
  void splash.loadURL(`data:text/html;charset=UTF-8,${encodeURIComponent(html)}`)
  splash.once('ready-to-show', () => {
    if (!splash.isDestroyed()) {
      splash.show()
    }
  })
  return splash
}

export function updateSplashStatus(
  splash: BrowserWindow | null,
  statusText: string,
  percent: number
): void {
  if (!splash || splash.isDestroyed()) return
  const safeText = JSON.stringify(statusText)
  const clamped = Math.max(5, Math.min(100, Math.round(percent)))
  void splash.webContents
    .executeJavaScript(
      `(() => {
        const text = document.getElementById('status-text');
        const pct = document.getElementById('status-pct');
        const fill = document.getElementById('progress-fill');
        if (text) text.textContent = ${safeText};
        if (pct) pct.textContent = '${clamped}%';
        if (fill) fill.style.width = '${clamped}%';
      })();`,
      true
    )
    .catch(() => {})
}

export async function closeSplashWindow(splash: BrowserWindow | null): Promise<void> {
  if (!splash || splash.isDestroyed()) return
  try {
    await splash.webContents.executeJavaScript(
      `document.getElementById('card')?.classList.add('closing');`,
      true
    )
    await new Promise((resolve) => setTimeout(resolve, 180))
  } catch {
    // Ignore closing race
  }
  if (!splash.isDestroyed()) {
    splash.destroy()
  }
}
