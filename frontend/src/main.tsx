import * as Sentry from '@sentry/react'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './i18n'
import App from './App'

// Error tracking (Sentry). Unset by default everywhere, including production: the app runs
// identically either way. Set VITE_SENTRY_DSN (a build-time env var, baked into the bundle like
// VITE_API_BASE_URL) to activate — no code change needed. Mirrors the backend's equivalent gate
// in app/main.py.
const sentryDsn = import.meta.env.VITE_SENTRY_DSN
if (sentryDsn) {
  Sentry.init({ dsn: sentryDsn, environment: import.meta.env.MODE, sendDefaultPii: false })
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
