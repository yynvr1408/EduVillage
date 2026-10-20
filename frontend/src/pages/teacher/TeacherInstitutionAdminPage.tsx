import React, { useEffect, useState } from 'react'
import {
  ArrowRightLeft,
  Building2,
  Check,
  KeyRound,
  Layers,
  Mail,
  Pencil,
  PauseCircle,
  PlayCircle,
  ShieldAlert,
  UserMinus,
  Users,
  X,
} from 'lucide-react'
import { PageContainer } from '../../components/layout/PageContainer'
import { Card, CardContent, Badge, Button, Dialog, FormField, Input, Select, LoadingState, ErrorState, EmptyState } from '../../components/ui'
import { CollegeStructureDialog } from '../admin/CollegeStructureDialog'
import { institutionAdminApi, type CollegeDeletionRequest, type PendingUser } from '../../services/institutionAdminApi'
import type { College, CollegeBranch, CollegeSection } from '../../services/adminApi'

const ALL_SECTIONS = '__all_sections__'

/** Moves an already-admitted student/teacher to a different branch/section of the same college —
 * the one roster action that was still missing: previously the only fix for a mis-registered
 * member was removing them and having them register again. */
const ReassignDialog: React.FC<{ collegeId: string; member: PendingUser; onClose: () => void; onDone: () => void }> = ({
  collegeId,
  member,
  onClose,
  onDone,
}) => {
  const [branches, setBranches] = useState<CollegeBranch[]>([])
  const [sections, setSections] = useState<CollegeSection[]>([])
  const [branchId, setBranchId] = useState('')
  const [sectionId, setSectionId] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void institutionAdminApi.listBranches(collegeId).then(setBranches)
  }, [collegeId])

  useEffect(() => {
    setSectionId('')
    if (branchId) void institutionAdminApi.listSections(branchId).then(setSections)
    else setSections([])
  }, [branchId])

  const submit = async () => {
    setIsSubmitting(true)
    setError(null)
    try {
      const allSections = member.role === 'teacher' && sectionId === ALL_SECTIONS
      await institutionAdminApi.reassignMember(collegeId, member.id, {
        branchId,
        sectionId: allSections ? undefined : sectionId || undefined,
        allSections,
      })
      onDone()
    } catch (err: any) {
      setError(err.message || 'Could not move this person.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog isOpen onClose={onClose} title="Move to a different branch/section" description={member.full_name}>
      <div className="flex flex-col gap-4">
        {error && <p className="text-xs text-[#B42318]">{error}</p>}
        <FormField label="Branch" htmlFor="reassign-branch">
          <Select
            id="reassign-branch"
            value={branchId}
            onChange={(e) => setBranchId(e.target.value)}
            options={[{ value: '', label: 'Select a branch' }, ...branches.map((b) => ({ value: b.id, label: b.name }))]}
          />
        </FormField>
        <FormField label="Section" htmlFor="reassign-section">
          <Select
            id="reassign-section"
            value={sectionId}
            onChange={(e) => setSectionId(e.target.value)}
            disabled={!branchId}
            options={[
              { value: '', label: !branchId ? 'Select a branch first' : 'Select a section' },
              ...sections.map((s) => ({ value: s.id, label: s.name })),
              ...(member.role === 'teacher' && branchId ? [{ value: ALL_SECTIONS, label: 'All Sections' }] : []),
            ]}
          />
        </FormField>
        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button variant="primary" isLoading={isSubmitting} disabled={!branchId || !sectionId} onClick={submit}>
            Move
          </Button>
        </div>
      </div>
    </Dialog>
  )
}

/** "Rural Science College" -> "RSC"; a single-word name falls back to its first few letters
 * ("Harvard" -> "HARV") rather than a single, meaningless initial. */
const shortForm = (name: string): string => {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length > 1) return words.map((w) => w[0]!.toUpperCase()).join('').slice(0, 6)
  return (words[0] || '').slice(0, 4).toUpperCase()
}

/** The two-step confirmation a college administrator must complete before a super admin's
 * deletion request actually takes effect: their own password, then an OTP emailed to the
 * college's registered contact address. Nothing is deleted until both succeed. */
const DeletionConfirmPanel: React.FC<{ college: College; request: CollegeDeletionRequest; onResolved: () => void }> = ({
  college,
  request,
  onResolved,
}) => {
  const [otpSent, setOtpSent] = useState(false)
  const [password, setPassword] = useState('')
  const [otp, setOtp] = useState('')
  const [devOtp, setDevOtp] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const sendOtp = async () => {
    setIsSubmitting(true)
    setError(null)
    try {
      const res = await institutionAdminApi.requestDeletionOtp(college.id, request.id, password)
      setOtpSent(true)
      setDevOtp(res.dev_otp ?? null)
    } catch (err: any) {
      setError(err.message || 'Could not verify your password.')
    } finally {
      setIsSubmitting(false)
    }
  }

  const confirm = async () => {
    setIsSubmitting(true)
    setError(null)
    try {
      await institutionAdminApi.confirmDeletion(college.id, request.id, otp)
      onResolved()
    } catch (err: any) {
      setError(err.message || 'That code is incorrect or has expired.')
    } finally {
      setIsSubmitting(false)
    }
  }

  const decline = async () => {
    setIsSubmitting(true)
    setError(null)
    try {
      await institutionAdminApi.declineDeletion(college.id, request.id)
      onResolved()
    } catch (err: any) {
      setError(err.message || 'Could not decline the request.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="border border-[#B42318]/30 bg-[#FDE8E7] rounded-xl p-4 flex flex-col gap-3">
      <div className="flex items-center gap-2 text-[#B42318] font-bold text-sm">
        <ShieldAlert className="w-4 h-4" /> Deletion Requested
      </div>
      <p className="text-xs text-[#B42318] leading-relaxed">
        A platform administrator has requested that <strong>{college.name}</strong> be permanently deleted — its
        branches, sections and registration code will be removed (students' and teachers' accounts are kept, just
        detached from this institution). As this institution's administrator, confirming requires your own password
        plus a code emailed to the institution's registered contact address.
      </p>
      {error && <p className="text-xs text-[#B42318] font-semibold">{error}</p>}

      {!otpSent ? (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <FormField label="Your password" htmlFor={`del-pw-${request.id}`} className="flex-1">
            <Input
              id={`del-pw-${request.id}`}
              type="password"
              isPassword
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
          </FormField>
          <div className="flex gap-2">
            <Button size="sm" variant="primary" isLoading={isSubmitting} disabled={!password} onClick={sendOtp} icon={<Mail className="w-3.5 h-3.5" />}>
              Send Code
            </Button>
            <Button size="sm" variant="outline" disabled={isSubmitting} onClick={decline} icon={<X className="w-3.5 h-3.5" />}>
              Decline
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {devOtp && (
            <p className="text-xs text-[#8A5700] bg-[#FFF0CB] p-2 rounded-lg border border-[#8A5700]/30">
              Development mode: email is not configured. Your code is <strong className="font-mono">{devOtp}</strong>.
            </p>
          )}
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <FormField label="Confirmation code" htmlFor={`del-otp-${request.id}`} className="flex-1">
              <Input
                id={`del-otp-${request.id}`}
                inputMode="numeric"
                maxLength={6}
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
              />
            </FormField>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="primary"
                isLoading={isSubmitting}
                disabled={otp.length !== 6}
                onClick={confirm}
                icon={<Check className="w-3.5 h-3.5" />}
              >
                Confirm Deletion
              </Button>
              <Button size="sm" variant="outline" disabled={isSubmitting} onClick={decline} icon={<X className="w-3.5 h-3.5" />}>
                Decline
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/** Everyone already admitted to this college (active or suspended), with account-management
 * actions. A college admin can never act on themselves or on a peer administrator of the same
 * college through here (enforced server-side too — see college_service.suspend_member). */
const MembersRosterSection: React.FC<{ collegeId: string; refreshKey: number }> = ({ collegeId, refreshKey }) => {
  const [members, setMembers] = useState<PendingUser[] | null>(null)
  const [actingOn, setActingOn] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [removing, setRemoving] = useState<PendingUser | null>(null)
  const [reassigning, setReassigning] = useState<PendingUser | null>(null)

  const load = async () => {
    setError(null)
    try {
      setMembers(await institutionAdminApi.listMembers(collegeId))
    } catch (err: any) {
      setError(err.message || 'Could not load the student/teacher roster.')
    }
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collegeId, refreshKey])

  const toggleSuspend = async (m: PendingUser) => {
    setActingOn(m.id)
    setError(null)
    try {
      if (m.status === 'suspended') await institutionAdminApi.reactivateMember(collegeId, m.id)
      else await institutionAdminApi.suspendMember(collegeId, m.id)
      await load()
    } catch (err: any) {
      setError(err.message || 'Could not update this account.')
    } finally {
      setActingOn(null)
    }
  }

  const confirmRemove = async () => {
    if (!removing) return
    setActingOn(removing.id)
    setError(null)
    try {
      await institutionAdminApi.removeMember(collegeId, removing.id)
      setRemoving(null)
      await load()
    } catch (err: any) {
      setError(err.message || 'Could not remove this person from the institution.')
    } finally {
      setActingOn(null)
    }
  }

  return (
    <div className="border-t border-[#E1E8E4] pt-4 flex flex-col gap-2">
      <p className="text-xs font-bold text-[#687775] uppercase tracking-wider flex items-center gap-1.5">
        <Users className="w-3.5 h-3.5" /> Students & Teachers {members ? `(${members.length})` : ''}
      </p>
      {error && <p className="text-xs text-[#B42318]">{error}</p>}
      {members === null ? (
        <p className="text-xs text-[#687775]">Loading roster...</p>
      ) : members.length === 0 ? (
        <p className="text-xs text-[#687775] italic">No one has been admitted to this institution yet.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {members.map((m) => (
            <div key={m.id} className="flex flex-wrap items-center justify-between gap-2 p-2.5 bg-[#F8FAF7] border border-[#E1E8E4] rounded-lg">
              <div>
                <p className="text-sm font-semibold text-[#202B2A]">{m.full_name}</p>
                <p className="text-xs text-[#687775] flex items-center gap-1.5 flex-wrap">
                  {m.email}
                  <Badge variant="secondary" size="sm">{m.role}</Badge>
                  <Badge variant={m.status === 'active' ? 'success' : 'warning'} size="sm">{m.status}</Badge>
                </p>
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  isLoading={actingOn === m.id}
                  onClick={() => toggleSuspend(m)}
                  icon={m.status === 'suspended' ? <PlayCircle className="w-3.5 h-3.5" /> : <PauseCircle className="w-3.5 h-3.5" />}
                >
                  {m.status === 'suspended' ? 'Reactivate' : 'Suspend'}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={actingOn === m.id}
                  onClick={() => setReassigning(m)}
                  icon={<ArrowRightLeft className="w-3.5 h-3.5" />}
                >
                  Move
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={actingOn === m.id}
                  onClick={() => setRemoving(m)}
                  icon={<UserMinus className="w-3.5 h-3.5" />}
                >
                  Remove
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog isOpen={!!removing} onClose={() => setRemoving(null)} title="Remove from institution?" description={removing?.full_name}>
        <div className="flex flex-col gap-4">
          <p className="text-sm text-[#687775]">
            {removing?.full_name} will be detached from this institution — their branch/section assignment is cleared. Their account, and
            everything else tied to it (courses, submissions, recordings), is kept; they simply won't belong to this institution anymore.
          </p>
          <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
            <Button variant="outline" onClick={() => setRemoving(null)}>
              Cancel
            </Button>
            <Button variant="destructive" isLoading={actingOn === removing?.id} onClick={confirmRemove}>
              Remove
            </Button>
          </div>
        </div>
      </Dialog>

      {reassigning && (
        <ReassignDialog
          collegeId={collegeId}
          member={reassigning}
          onClose={() => setReassigning(null)}
          onDone={() => {
            setReassigning(null)
            void load()
          }}
        />
      )}
    </div>
  )
}

const PendingRegistrationsSection: React.FC<{ collegeId: string; onChange: () => void }> = ({ collegeId, onChange }) => {
  const [pending, setPending] = useState<PendingUser[] | null>(null)
  const [actingOn, setActingOn] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = async () => {
    try {
      setPending(await institutionAdminApi.listPendingRegistrations(collegeId))
    } catch (err: any) {
      setError(err.message || 'Could not load pending registrations.')
    }
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collegeId])

  const act = async (userId: string, action: 'approve' | 'reject') => {
    setActingOn(userId)
    setError(null)
    try {
      if (action === 'approve') await institutionAdminApi.approveRegistration(collegeId, userId)
      else await institutionAdminApi.rejectRegistration(collegeId, userId)
      await load()
      onChange()
    } catch (err: any) {
      setError(err.message || 'Could not update this registration.')
    } finally {
      setActingOn(null)
    }
  }

  if (pending === null) return null
  if (pending.length === 0) return null

  return (
    <div className="border-t border-[#E1E8E4] pt-4 flex flex-col gap-2">
      <p className="text-xs font-bold text-[#687775] uppercase tracking-wider">
        Pending Registrations ({pending.length})
      </p>
      {error && <p className="text-xs text-[#B42318]">{error}</p>}
      <div className="flex flex-col gap-2">
        {pending.map((u) => (
          <div key={u.id} className="flex flex-wrap items-center justify-between gap-2 p-2.5 bg-[#F8FAF7] border border-[#E1E8E4] rounded-lg">
            <div>
              <p className="text-sm font-semibold text-[#202B2A]">{u.full_name}</p>
              <p className="text-xs text-[#687775]">
                {u.email} · <Badge variant="secondary" size="sm">{u.role}</Badge>
              </p>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="primary" isLoading={actingOn === u.id} onClick={() => act(u.id, 'approve')} icon={<Check className="w-3.5 h-3.5" />}>
                Approve
              </Button>
              <Button size="sm" variant="outline" disabled={actingOn === u.id} onClick={() => act(u.id, 'reject')} icon={<X className="w-3.5 h-3.5" />}>
                Reject
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

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
  const [deletionRequests, setDeletionRequests] = useState<Record<string, CollegeDeletionRequest | null>>({})
  const [refreshTick, setRefreshTick] = useState(0)

  const load = async () => {
    setError(null)
    try {
      const list = await institutionAdminApi.myColleges()
      setColleges(list)
      const entries = await Promise.all(
        list.map(async (c) => [c.id, await institutionAdminApi.getDeletionRequest(c.id).catch(() => null)] as const)
      )
      setDeletionRequests(Object.fromEntries(entries))
    } catch (err: any) {
      setError(err.message || 'Could not load your institutions.')
    }
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshTick])

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

  const pageTitle = colleges && colleges.length === 1 ? `${shortForm(colleges[0].name)} Console` : 'Institution Administration'
  const pageSubtitle =
    colleges && colleges.length === 1
      ? `${colleges[0].name} — manage its branches, sections, registration code and student/teacher roster.`
      : "Manage the branches, sections and registration code for the institution(s) you've been delegated to administer."

  return (
    <PageContainer title={pageTitle} subtitle={pageSubtitle} maxWidth="lg">
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
                      <span className="text-xs font-mono font-bold text-[#0F5B57] bg-[#DDF3EA] border border-[#CBD7D1] rounded px-1.5 py-0.5">
                        {shortForm(college.name)}
                      </span>
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

                {deletionRequests[college.id] && (
                  <DeletionConfirmPanel
                    college={college}
                    request={deletionRequests[college.id]!}
                    onResolved={() => setRefreshTick((t) => t + 1)}
                  />
                )}

                <PendingRegistrationsSection collegeId={college.id} onChange={() => setRefreshTick((t) => t + 1)} />

                <MembersRosterSection collegeId={college.id} refreshKey={refreshTick} />
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
