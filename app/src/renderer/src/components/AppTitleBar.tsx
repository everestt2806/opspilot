import opsPilotLogo from '../assets/opspilot-logo.png'

/** Thanh tiêu đề tối giản; không lặp tên trang; native titlebarOverlay trên Windows. */
export function AppTitleBar(): React.JSX.Element {
  return (
    <header className="app-titlebar">
      <div className="app-titlebar-drag-region">
        <div className="app-titlebar-brand" aria-label="OpsPilot">
          <img src={opsPilotLogo} alt="" aria-hidden="true" />
          <span>OpsPilot</span>
        </div>
      </div>
    </header>
  )
}
