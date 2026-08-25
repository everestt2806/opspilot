import { useEffect, useState } from 'react'
import {
  BorderOutlined,
  CloseOutlined,
  MinusOutlined,
  MoonOutlined,
  SunOutlined,
  SwitcherOutlined
} from '@ant-design/icons'
import { Badge, Segmented, Tooltip } from 'antd'

import opsPilotLogo from '../assets/opspilot-logo.png'
import { strings } from '../strings'
import type { ThemeMode } from '../utils/themeTokens'

interface AppTitleBarProps {
  pageTitle: string
  selectedVpsCount: number
  mlRunning: boolean
  themeMode: ThemeMode
  onThemeChange: (theme: ThemeMode) => void
}

/** Thanh tiêu đề không khung theo kiểu VS Code; mọi quyền cửa sổ đi qua IPC typed. */
export function AppTitleBar({
  pageTitle,
  selectedVpsCount,
  mlRunning,
  themeMode,
  onThemeChange
}: AppTitleBarProps): React.JSX.Element {
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
      <div className="app-titlebar-right" onDoubleClick={(event) => event.stopPropagation()}>
        <div className="app-titlebar-status">
          <span className="titlebar-selected-vps">
            {selectedVpsCount > 0
              ? strings.app.vpsSelected(selectedVpsCount)
              : strings.app.noSelection}
          </span>
          <Badge
            className="titlebar-ssh-status"
            status="default"
            text={`${strings.status.ssh}: ${strings.status.unknown}`}
          />
          <Badge
            className="titlebar-ml-status"
            status={mlRunning ? 'success' : 'error'}
            text={`${strings.status.mlService}: ${
              mlRunning ? strings.status.running : strings.status.stopped
            }`}
          />
          <Tooltip title={strings.appearance.label}>
            <Segmented<ThemeMode>
              className="titlebar-theme"
              size="small"
              value={themeMode}
              onChange={onThemeChange}
              options={[
                {
                  value: 'light',
                  icon: <SunOutlined aria-hidden="true" />,
                  label: strings.appearance.light
                },
                {
                  value: 'dark',
                  icon: <MoonOutlined aria-hidden="true" />,
                  label: strings.appearance.dark
                }
              ]}
            />
          </Tooltip>
        </div>
        <div className="app-titlebar-controls">
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
      </div>
    </header>
  )
}
