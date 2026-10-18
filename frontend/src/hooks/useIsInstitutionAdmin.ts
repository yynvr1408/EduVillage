import { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { institutionAdminApi } from '../services/institutionAdminApi'

/**
 * True once the current teacher has been delegated to administer at least one college - used to
 * decide whether the "Institution Administration" nav item shows at all. False for the large
 * majority of teachers, who were never granted this; the fetch itself is harmless for them since
 * it just comes back empty.
 */
export function useIsInstitutionAdmin(): boolean {
  const { isTeacher } = useAuth()
  const [isAdmin, setIsAdmin] = useState(false)

  useEffect(() => {
    if (!isTeacher) return
    let active = true
    institutionAdminApi
      .myColleges()
      .then((colleges) => {
        if (active) setIsAdmin(colleges.length > 0)
      })
      .catch(() => {
        // Not delegated (or offline) - the nav item just stays hidden, nothing to surface.
      })
    return () => {
      active = false
    }
  }, [isTeacher])

  return isAdmin
}
