import { Segmented, Typography } from 'antd'

import { PageHeader } from '../components/PageHeader'
import { strings } from '../strings'
import { useUiState } from '../store/uiState'
import type { ThemeMode } from '../utils/themeTokens'

export function SettingsPage(): React.JSX.Element {
  const themeMode = useUiState((state) => state.theme)
  const setTheme = useUiState((state) => state.setTheme)

  return (
    <section className="page-panel settings-page">
      <PageHeader title={strings.settings.title} description={strings.settings.description} />
      <div className="settings-layout">
        <nav className="settings-categories" aria-label={strings.settings.categoriesLabel}>
          <button type="button" className="settings-category settings-category-active">
            {strings.settings.appearance}
          </button>
          <span className="settings-category settings-category-disabled">
            {strings.settings.monitoringCategory}
          </span>
        </nav>
        <div className="settings-sections">
          <section className="settings-section">
            <div>
              <Typography.Text strong>{strings.settings.appearance}</Typography.Text>
              <Typography.Paragraph type="secondary">
                {strings.settings.appearanceDescription}
              </Typography.Paragraph>
            </div>
            <Segmented<ThemeMode>
              aria-label={strings.settings.appearance}
              value={themeMode}
              onChange={setTheme}
              options={[
                { value: 'dark', label: strings.settings.dark },
                { value: 'light', label: strings.settings.light }
              ]}
            />
          </section>
          <section className="settings-section settings-section-readonly">
            <div>
              <Typography.Text strong>{strings.settings.monitoring}</Typography.Text>
              <Typography.Paragraph type="secondary">
                {strings.settings.deferred}
              </Typography.Paragraph>
            </div>
          </section>
        </div>
      </div>
    </section>
  )
}
