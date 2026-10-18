import React, { useEffect, useState } from 'react'
import { LoadingState } from '../../components/ui'
import { adminApi, AdminApiError } from '../../services/adminApi'
import { AdminLoginPage } from './AdminLoginPage'
import { AdminDashboardPage } from './AdminDashboardPage'

type State = { status: 'checking' } | { status: 'out' } | { status: 'in'; username: string }

/** /admin: shows the sign-in form or the dashboard depending on a server-validated session. */
export const AdminApp: React.FC = () => {
  const [state, setState] = useState<State>({ status: 'checking' })

  useEffect(() => {
    document.title = 'LanternEd Administration'
    let cancelled = false
    adminApi.me().then(
      (a) => {
        if (!cancelled) setState({ status: 'in', username: a.username })
      },
      () => {
        // 401 or an unreachable server: either way the sign-in form is the right place to be.
        if (!cancelled) setState({ status: 'out' })
      },
    )
    return () => {
      cancelled = true
    }
  }, [])

  if (state.status === 'checking') {
    return (
      <div className="min-h-screen bg-[#F8FAF7] flex items-center justify-center">
        <LoadingState message="Checking session..." />
      </div>
    )
  }
  if (state.status === 'out') return <AdminLoginPage onSignedIn={(username) => setState({ status: 'in', username })} />
  return (
    <AdminDashboardPage
      username={state.username}
      onSignedOut={() => setState({ status: 'out' })}
      onSessionExpired={() => setState({ status: 'out' })}
    />
  )
}

export { AdminApiError }
