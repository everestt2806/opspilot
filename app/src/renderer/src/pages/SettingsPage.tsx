import { Card, Segmented, Typography } from 'antd'

import { PageHeader } from '../components/PageHeader'
import { useStrings } from '../strings'
import { useUiState } from '../store/uiState'
import type { LocaleMode } from '../store/uiState'
import type { ThemeMode } from '../utils/themeTokens'

export function SettingsPage(): React.JSX.Element {
  const strings = useStrings()
  const themeMode = useUiState((state) => state.theme)
  const setTheme = useUiState((state) => state.setTheme)
  const locale = useUiState((state) => state.locale)
  const setLocale = useUiState((state) => state.setLocale)

  return (
    <section className="page-panel settings-page">
      <PageHeader title={strings.settings.title} description={strings.settings.description} />
      <div className="settings-card-wrapper">
        <Card className="settings-card">
          <div className="settings-row" role="group" aria-labelledby="setting-theme-title">
            <div className="settings-row-info">
              <Typography.Text strong id="setting-theme-title" className="settings-row-title">
                {strings.settings.appearance}
              </Typography.Text>
              <Typography.Paragraph
                type="secondary"
                id="setting-theme-desc"
                className="settings-row-desc"
              >
                {strings.settings.appearanceDescription}
              </Typography.Paragraph>
            </div>
            <div className="settings-row-control">
              <Segmented<ThemeMode>
                aria-label={strings.settings.appearance}
                aria-describedby="setting-theme-desc"
                value={themeMode}
                onChange={setTheme}
                options={[
                  { value: 'dark', label: strings.settings.dark },
                  { value: 'light', label: strings.settings.light }
                ]}
              />
            </div>
          </div>

          <div className="settings-divider" role="separator" />

          <div className="settings-row" role="group" aria-labelledby="setting-locale-title">
            <div className="settings-row-info">
              <Typography.Text strong id="setting-locale-title" className="settings-row-title">
                {strings.settings.language}
              </Typography.Text>
              <Typography.Paragraph
                type="secondary"
                id="setting-locale-desc"
                className="settings-row-desc"
              >
                {strings.settings.languageDescription}
              </Typography.Paragraph>
            </div>
            <div className="settings-row-control">
              <Segmented<LocaleMode>
                aria-label={strings.settings.language}
                aria-describedby="setting-locale-desc"
                value={locale}
                onChange={setLocale}
                options={[
                  { value: 'en', label: strings.settings.languages.en },
                  { value: 'vi', label: strings.settings.languages.vi },
                  { value: 'cn', label: strings.settings.languages.cn },
                  { value: 'jp', label: strings.settings.languages.jp }
                ]}
              />
            </div>
          </div>
        </Card>
      </div>
    </section>
  )
}
