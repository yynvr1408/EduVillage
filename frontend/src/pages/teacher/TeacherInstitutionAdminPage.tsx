import React, { useEffect, useState } from 'react'
import { Building2, KeyRound, Layers, Pencil } from 'lucide-react'
import { PageContainer } from '../../components/layout/PageContainer'
import { Card, CardContent, Badge, Button, FormField, Input, LoadingState, ErrorState, EmptyState } from '../../components/ui'
import { CollegeStructureDialog } from '../admin/CollegeStructureDialog'
import { institutionAdminApi } from '../../services/institutionAdminApi'
import type { College } from '../../services/adminApi'

/**
 * Self-serve institution management for a teacher delegated as a college administrator (see
 * college_service.assign_college_admin on the backend). Only reachable/useful for the small
 * number of teachers a platform admin has granted this to — `myColleges()` returns an empty list
 * for everyone else, which the surrounding nav uses to decide whether to show this page at all.
 */
export const TeacherInstitutionAdminPage: React.FC = () => {
  const [colleges, setColleges] = useState<College[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<College | null>(null)
  const [editLocation, setEditLocation] = useState('')
  const [editContactEmail, setEditContactEmail] = useState('')
  const [editContactPhone, setEditContactPhone] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [regeneratingId, setRegeneratingId] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [structureCollege, setStructureCollege] = useState<College | null>(null)

  const load = async () => {
    setError(null)
    try {
      setColleges(await institutionAdminApi.myColleges())
    } catch (err: any) {
      setError(err.message || 'Could not load your institutions.')
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const startEdit = (college: College) => {
    setEditing(college)
    setEditLocation(college.location ?? '')
    setEditContactEmail(college.contact_email ?? '')
    setEditContactPhone(college.contact_phone ?? '')
    setSaveError(null)
  }

  const saveEdit = async () => {
    if (!editing) return
    setSaving(true)
    setSaveError(null)
    try {
      await institutionAdminApi.updateCollege(editing.id, {
        location: editLocation.trim() || null,
        contact_email: editContactEmail.trim() || null,
        contact_phone: editContactPhone.trim() || null,
      })
      setEditing(null)
      setNotice('Institution details updated.')
      await load()
    } catch (err: any) {
      setSaveError(err.message || 'Could not save these changes.')
    } finally {
      setSaving(false)
    }
  }

  const regenerateCode = async (college: College) => {
    if (!window.confirm(`Generate a new registration code for ${college.name}? The old code (${college.code}) stops working immediately.`)) {
      return
    }
    setRegeneratingId(college.id)
    setError(null)
    try {
      await institutionAdminApi.regenerateCode(college.id)
      setNotice('A new registration code was generated.')
      await load()
    } catch (err: any) {
      setError(err.message || 'Could not regenerate the code.')
    } finally {
      setRegeneratingId(null)
    }
  }

  return (
    <PageContainer
      title="Institution Administration"
      subtitle="Manage the branches, sections and registration code for the institution(s) you've been delegated to administer."
      maxWidth="lg"
    >
      {notice && (
        <div className="mb-4 p-3 rounded-lg bg-[#E5F5EB] border border-[#247A4D]/30 text-[#247A4D] text-xs" role="status">
          {notice}
        </div>
      )}
      {error && <ErrorState message={error} onRetry={load} className="mb-4" />}

      {colleges === null ? (
        <LoadingState message="Loading your institutions..." />
      ) : colleges.length === 0 ? (
        <EmptyState
          icon={<Building2 className="w-6 h-6" />}
          title="You're not an administrator of any institution"
          description="A platform administrator can delegate management of a college's branches, sections and registration code to a teacher. If you were expecting access here, ask them to grant it."
        />
      ) : (
        <div className="flex flex-col gap-4">
          {colleges.map((college) => (
            <Card key={college.id}>
              <CardContent className="p-5 flex flex-col gap-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="text-base font-bold text-[#202B2A]">{college.name}</h3>
                      <Badge variant={college.status === 'active' ? 'success' : 'secondary'} size="sm">
                        {college.status === 'active' ? 'Active' : 'Inactive'}
                      </Badge>
                    </div>
                    <p className="text-xs text-[#687775]">{college.location || 'No location set'}</p>
                    <p className="text-xs font-mono text-[#0F5B57] mt-1">{college.code}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" icon={<Pencil className="w-4 h-4" />} onClick={() => startEdit(college)}>
                      Edit Details
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      icon={<KeyRound className="w-4 h-4" />}
                      isLoading={regeneratingId === college.id}
                      onClick={() => regenerateCode(college)}
                    >
                      Regenerate Code
                    </Button>
                    <Button size="sm" icon={<Layers className="w-4 h-4" />} onClick={() => setStructureCollege(college)}>
                      Branches &amp; Sections
                    </Button>
                  </div>
                </div>

                {editing?.id === college.id && (
                  <div className="border-t border-[#E1E8E4] pt-4 flex flex-col gap-3">
                    {saveError && <p className="text-xs text-[#B42318]">{saveError}</p>}
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <FormField label="Location" htmlFor={`loc-${college.id}`}>
                        <Input id={`loc-${college.id}`} value={editLocation} onChange={(e) => setEditLocation(e.target.value)} maxLength={160} />
                      </FormField>
                      <FormField label="Contact email" htmlFor={`email-${college.id}`}>
                        <Input id={`email-${college.id}`} type="email" value={editContactEmail} onChange={(e) => setEditContactEmail(e.target.value)} />
                      </FormField>
                      <FormField label="Contact phone" htmlFor={`phone-${college.id}`}>
                        <Input id={`phone-${college.id}`} value={editContactPhone} onChange={(e) => setEditContactPhone(e.target.value)} maxLength={40} />
                      </FormField>
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" isLoading={saving} onClick={saveEdit}>
                        Save
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setEditing(null)}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <CollegeStructureDialog
        college={structureCollege}
        onClose={() => setStructureCollege(null)}
        onSessionExpired={() => setStructureCollege(null)}
        api={institutionAdminApi}
      />
    </PageContainer>
  )
}
