import { useEffect, useState } from 'react'
import { BorderOutlined, CloseOutlined, MinusOutlined, SwitcherOutlined } from '@ant-design/icons'

import opsPilotLogo from '../assets/opspilot-logo.png'

interface AppTitleBarProps {
  pageTitle: string
}

/** Thanh tiêu đề không khung theo kiểu VS Code; mọi quyền cửa sổ đi qua IPC typed. */
export function AppTitleBar({ pageTitle }: AppTitleBarProps): React.JSX.Element {
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    let active = true
    void window.api.invoke('window:is-maximized').then((result) => {
      if (active && result.ok) setMaximized(result.data.maximized)
    })
    const unsubscribe = window.api.on('window:maximized-changed', ({ maximized: next }) => {
      setMaximized(next)
    })
    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  async function toggleMaximize(): Promise<void> {
    const result = await window.api.invoke('window:toggle-maximize')
    if (result.ok) setMaximized(result.data.maximized)
  }

  return (
    <header className="app-titlebar" onDoubleClick={() => void toggleMaximize()}>
      <div className="app-titlebar-brand" aria-label="OpsPilot">
        <img src={opsPilotLogo} alt="" aria-hidden="true" />
        <span>OpsPilot</span>
      </div>
      <div className="app-titlebar-caption" title={`OpsPilot — ${pageTitle}`}>
        OpsPilot — {pageTitle}
      </div>
      <div className="app-titlebar-controls" onDoubleClick={(event) => event.stopPropagation()}>
        <button
          type="button"
          className="app-titlebar-button"
          aria-label="Minimize window"
          title="Minimize"
          onClick={() => void window.api.invoke('window:minimize')}
        >
          <MinusOutlined />
        </button>
        <button
          type="button"
          className="app-titlebar-button"
          aria-label={maximized ? 'Restore window' : 'Maximize window'}
          title={maximized ? 'Restore' : 'Maximize'}
          onClick={() => void toggleMaximize()}
        >
          {maximized ? <SwitcherOutlined /> : <BorderOutlined />}
        </button>
        <button
          type="button"
          className="app-titlebar-button app-titlebar-button-close"
          aria-label="Close window"
          title="Close"
          onClick={() => void window.api.invoke('window:close')}
        >
          <CloseOutlined />
        </button>
      </div>
    </header>
  )
}
