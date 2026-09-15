import 'antd/dist/reset.css'
import './assets/main.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import App from './App'
import { useUiState } from './store/uiState'
import { applyTheme } from './utils/themeTokens'

// Áp theme từ session trước lần render đầu để CSS var không nháy theme cũ.
applyTheme(useUiState.getState().theme)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
