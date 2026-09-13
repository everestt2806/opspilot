import opsPilotLogo from '../assets/opspilot-logo.png'

interface AppTitleBarProps {
  pageTitle: string
}

/** Thanh tiêu đề không khung theo kiểu VS Code; mọi quyền cửa sổ đi qua IPC typed. */
export function AppTitleBar({ pageTitle }: AppTitleBarProps): React.JSX.Element {
  return (
    <header className="app-titlebar">
      <div className="app-titlebar-brand" aria-label="OpsPilot">
        <img src={opsPilotLogo} alt="" aria-hidden="true" />
        <span>OpsPilot</span>
      </div>
      <div className="app-titlebar-caption" title={`OpsPilot — ${pageTitle}`}>
        OpsPilot — {pageTitle}
      </div>
      <div className="app-titlebar-right" aria-hidden="true" />
    </header>
  )
}
