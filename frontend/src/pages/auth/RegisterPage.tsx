import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AlertCircle, UserPlus } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import type { Role } from '../../types'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { FormField } from '../../components/ui/FormField'
import { Select } from '../../components/ui/Select'
import { Logo } from '../../components/ui/Logo'
import { registrationApi, type RegistrationBranch, type RegistrationCollege, type RegistrationSection } from '../../services/registrationApi'

export interface RegisterPageProps {
  /** Set by the /register/student and /register/teacher routes to fix the role and drop the
   * role-selection dropdown entirely. Left unset, this renders the original generic form with
   * a role dropdown — kept only as a safe fallback, nothing currently routes to it bare. */
  portal?: 'student' | 'teacher'
}

type FieldKey = 'fullName' | 'email' | 'password' | 'confirmPassword' | 'college' | 'collegeCode' | 'branch' | 'section'

/** Select value for the teacher-only branch-wide choice; it is never sent as a section id. */
const ALL_SECTIONS = '__all_sections__'
type FieldErrors = Partial<Record<FieldKey, string>>

/** Where each backend error code belongs, so the message shows next to the field that caused it. */
const SERVER_FIELD: Record<string, FieldKey> = {
  EMAIL_TAKEN: 'email',
  INVALID_COLLEGE_CODE: 'collegeCode',
  COLLEGE_NOT_FOUND: 'college',
  COLLEGE_INACTIVE: 'college',
  COLLEGE_REQUIRED: 'college',
  BRANCH_REQUIRED: 'branch',
  INVALID_BRANCH: 'branch',
  BRANCH_INACTIVE: 'branch',
  SECTION_REQUIRED: 'section',
  INVALID_SECTION: 'section',
  SECTION_INACTIVE: 'section',
}

type Load<T> = { status: 'idle' | 'loading' | 'error'; items: T[] } | { status: 'ready'; items: T[] }

export const RegisterPage: React.FC<RegisterPageProps> = ({ portal }) => {
  const { register } = useAuth()
  const navigate = useNavigate()

  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [role, setRole] = useState<Role>(portal ?? 'student')
  const [collegeId, setCollegeId] = useState('')
  const [collegeCode, setCollegeCode] = useState('')
  const [branchId, setBranchId] = useState('')
  const [sectionId, setSectionId] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})

  const [colleges, setColleges] = useState<Load<RegistrationCollege>>({ status: 'loading', items: [] })
  const [branches, setBranches] = useState<Load<RegistrationBranch>>({ status: 'idle', items: [] })
  const [sections, setSections] = useState<Load<RegistrationSection>>({ status: 'idle', items: [] })
  const branchRequest = useRef(0)
  const sectionRequest = useRef(0)

  const loadColleges = useCallback(async () => {
    setColleges({ status: 'loading', items: [] })
    try {
      setColleges({ status: 'ready', items: await registrationApi.listColleges() })
    } catch {
      setColleges({ status: 'error', items: [] })
    }
  }, [])

  const loadBranches = useCallback(async (id: string) => {
    const seq = ++branchRequest.current
    setBranches({ status: 'loading', items: [] })
    try {
      const items = await registrationApi.listBranches(id)
      if (seq === branchRequest.current) setBranches({ status: 'ready', items })
    } catch {
      if (seq === branchRequest.current) setBranches({ status: 'error', items: [] })
    }
  }, [])

  const loadSections = useCallback(async (id: string) => {
    const seq = ++sectionRequest.current
    setSections({ status: 'loading', items: [] })
    try {
      const items = await registrationApi.listSections(id)
      if (seq === sectionRequest.current) setSections({ status: 'ready', items })
    } catch {
      if (seq === sectionRequest.current) setSections({ status: 'error', items: [] })
    }
  }, [])

  useEffect(() => {
    void loadColleges()
  }, [loadColleges])

  const resetSections = () => {
    sectionRequest.current++
    setSections({ status: 'idle', items: [] })
  }

  const onCollegeChange = (id: string) => {
    setCollegeId(id)
    // a branch or section from the previous college is never valid for the new one
    setBranchId('')
    setSectionId('')
    resetSections()
    setFieldErrors((f) => ({ ...f, college: undefined, branch: undefined, section: undefined }))
    if (id) void loadBranches(id)
    else {
      branchRequest.current++
      setBranches({ status: 'idle', items: [] })
    }
  }

  const onBranchChange = (id: string) => {
    setBranchId(id)
    setSectionId('')
    setFieldErrors((f) => ({ ...f, branch: undefined, section: undefined }))
    if (id) void loadSections(id)
    else resetSections()
  }

  const isTeacher = role === 'teacher'
  // College, its code, branch and section are mandatory for both roles — an administrator must
  // set up at least one college before anyone can register.
  const collegesUnavailable = colleges.status === 'error'

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (isLoading) return

    const errs: FieldErrors = {}
    if (!fullName.trim()) errs.fullName = 'Enter your full name.'
    if (!email.trim()) errs.email = 'Enter your email address.'
    if (!password) errs.password = 'Enter a password.'
    else if (password.length < 8) errs.password = 'Password must be at least 8 characters long.'
    if (password && confirmPassword !== password) errs.confirmPassword = 'Passwords do not match.'
    if (!collegeId) errs.college = 'Select your college.'
    if (!collegeCode.trim()) errs.collegeCode = 'Enter the college code given by your administrator.'
    if (collegeId && !branchId) errs.branch = 'Select your branch.'
    if (branchId && !sectionId) errs.section = isTeacher ? 'Select a section or All Sections.' : 'Select your section.'
    setFieldErrors(errs)
    setError(null)
    if (Object.keys(errs).length > 0) return

    setIsLoading(true)
    try {
      const allSections = isTeacher && sectionId === ALL_SECTIONS
      const selection = collegeId
        ? { collegeId, branchId, sectionId: allSections ? undefined : sectionId, allSections, collegeCode: collegeCode.trim() }
        : undefined
      const user = await register(email, fullName, password, role, undefined, selection)
      navigate(user.role === 'teacher' ? '/teacher/dashboard' : '/student/dashboard', {
        replace: true,
      })
    } catch (err: any) {
      const field = SERVER_FIELD[err?.code as string]
      if (field) {
        setFieldErrors({ [field]: err.message })
        // The college may have been deactivated or the section removed since the page loaded.
        if (field === 'college') void loadColleges()
        if (field === 'branch' && collegeId) void loadBranches(collegeId)
        if (field === 'section' && branchId) void loadSections(branchId)
      } else {
        setError(
          err?.isNetworkError ? 'Cannot reach the server. Check your connection and try again.' : err?.message || 'Registration failed. Please check your information.'
        )
      }
    } finally {
      setIsLoading(false)
    }
  }

  const collegeOptions = [
    { value: '', label: colleges.status === 'loading' ? 'Loading colleges...' : 'Select your college' },
    ...colleges.items.map((c) => ({ value: c.id, label: c.location ? `${c.name} — ${c.location}` : c.name })),
  ]
  const branchOptions = [
    {
      value: '',
      label: !collegeId ? 'Select a college first' : branches.status === 'loading' ? 'Loading branches...' : 'Select your branch',
    },
    ...branches.items.map((b) => ({ value: b.id, label: b.short_code ? `${b.name} (${b.short_code})` : b.name })),
  ]
  const sectionOptions = [
    {
      value: '',
      label: !branchId ? 'Select a branch first' : sections.status === 'loading' ? 'Loading sections...' : 'Select your section',
    },
    ...sections.items.map((s) => ({ value: s.id, label: s.name })),
    // Teachers who teach every section of the branch; a branch-wide assignment, not a real section.
    ...(isTeacher && branchId && sections.status === 'ready' ? [{ value: ALL_SECTIONS, label: 'All Sections' }] : []),
  ]

  return (
    <div className="min-h-screen bg-[#F8FAF7] flex flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md px-4">
        {/* Brand */}
        <div className="flex flex-col items-center text-center mb-6">
          <Logo size={48} className="mb-3" />
          <h1 className="text-2xl font-bold tracking-tight text-[#202B2A]">
            {portal === 'teacher'
              ? 'Create Teacher Account'
              : portal === 'student'
              ? 'Create Student Account'
              : 'Create EduVillage Account'}
          </h1>
          <p className="text-xs sm:text-sm text-[#687775] mt-1 max-w-xs leading-relaxed">
            Join low-bandwidth classrooms and access downloadable offline curricula.
          </p>
        </div>

        {portal && (
          <div className="flex justify-center mb-4">
            <Link
              to="/register"
              className="text-xs font-semibold text-[#687775] hover:text-[#0F5B57] inline-flex items-center gap-1"
            >
              ← Not a {portal === 'teacher' ? 'teacher' : 'student'}? Switch portal
            </Link>
          </div>
        )}

        {/* Card */}
        <div className="bg-[#FFFFFF] border border-[#E1E8E4] rounded-2xl p-6 sm:p-8 shadow-xs">
          {error && (
            <div
              className="mb-5 p-3 rounded-lg bg-[#FDE8E7] border border-[#B42318]/30 text-[#B42318] text-xs flex items-center gap-2"
              role="alert"
            >
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
            <FormField label="Full Name" htmlFor="fullName" required error={fieldErrors.fullName}>
              <Input
                id="fullName"
                type="text"
                autoComplete="name"
                placeholder="e.g. Amina Diallo"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                isError={!!fieldErrors.fullName}
                required
              />
            </FormField>

            <FormField label="Email Address" htmlFor="email" required error={fieldErrors.email}>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                placeholder="amina@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                isError={!!fieldErrors.email}
                required
              />
            </FormField>

            {!portal && (
              <FormField label="Role Selection" htmlFor="role" required hint="Choose your primary portal role">
                <Select
                  id="role"
                  value={role}
                  onChange={(e) => setRole(e.target.value as Role)}
                  options={[
                    { value: 'student', label: 'Student (Access courses, classes, offline downloads)' },
                    { value: 'teacher', label: 'Teacher (Schedule classes, manage materials & assignments)' },
                  ]}
                />
              </FormField>
            )}

            <FormField label="Password" htmlFor="password" required hint="Min. 8 characters" error={fieldErrors.password}>
              <Input
                id="password"
                type="password"
                isPassword
                autoComplete="new-password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                isError={!!fieldErrors.password}
                required
              />
            </FormField>

            <FormField label="Confirm Password" htmlFor="confirmPassword" required error={fieldErrors.confirmPassword}>
              <Input
                id="confirmPassword"
                type="password"
                isPassword
                autoComplete="new-password"
                placeholder="••••••••"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                isError={!!fieldErrors.confirmPassword}
                required
              />
            </FormField>

            <FormField label="College" htmlFor="college" required error={fieldErrors.college}>
              <Select
                id="college"
                value={collegeId}
                onChange={(e) => onCollegeChange(e.target.value)}
                options={collegeOptions}
                isError={!!fieldErrors.college}
                disabled={colleges.status !== 'ready' || colleges.items.length === 0}
              />
            </FormField>
            {collegesUnavailable && (
              <p className="text-xs text-[#B42318] -mt-2" role="alert">
                Could not load colleges.{' '}
                <button type="button" onClick={loadColleges} className="font-semibold underline">
                  Try again
                </button>
              </p>
            )}
            {colleges.status === 'ready' && colleges.items.length === 0 && (
              <p className="text-xs text-[#687775] -mt-2" role="status">
                No colleges are open for registration yet. Please contact your administrator.
              </p>
            )}

            <FormField
              label="College Code"
              htmlFor="collegeCode"
              required
              hint="From your administrator"
              error={fieldErrors.collegeCode}
            >
              <Input
                id="collegeCode"
                value={collegeCode}
                onChange={(e) => {
                  setCollegeCode(e.target.value)
                  setFieldErrors((f) => ({ ...f, collegeCode: undefined }))
                }}
                autoComplete="off"
                placeholder="EV-XXXX-XXXX"
                isError={!!fieldErrors.collegeCode}
                required
              />
            </FormField>

            <FormField label="Branch" htmlFor="branch" required error={fieldErrors.branch}>
              <Select
                id="branch"
                value={branchId}
                onChange={(e) => onBranchChange(e.target.value)}
                options={branchOptions}
                isError={!!fieldErrors.branch}
                disabled={!collegeId || branches.status !== 'ready' || branches.items.length === 0}
              />
            </FormField>
            {collegeId && branches.status === 'error' && (
              <p className="text-xs text-[#B42318] -mt-2" role="alert">
                Could not load branches.{' '}
                <button type="button" onClick={() => loadBranches(collegeId)} className="font-semibold underline">
                  Try again
                </button>
              </p>
            )}
            {collegeId && branches.status === 'ready' && branches.items.length === 0 && (
              <p className="text-xs text-[#687775] -mt-2" role="status">
                This college has no branches yet. Please contact your administrator.
              </p>
            )}

            <FormField label="Section" htmlFor="section" required error={fieldErrors.section}>
              <Select
                id="section"
                value={sectionId}
                onChange={(e) => {
                  setSectionId(e.target.value)
                  setFieldErrors((f) => ({ ...f, section: undefined }))
                }}
                options={sectionOptions}
                isError={!!fieldErrors.section}
                disabled={!branchId || sections.status !== 'ready' || sections.items.length === 0}
              />
            </FormField>
            {branchId && sections.status === 'error' && (
              <p className="text-xs text-[#B42318] -mt-2" role="alert">
                Could not load sections.{' '}
                <button type="button" onClick={() => loadSections(branchId)} className="font-semibold underline">
                  Try again
                </button>
              </p>
            )}
            {branchId && sections.status === 'ready' && sections.items.length === 0 && (
              <p className="text-xs text-[#687775] -mt-2" role="status">
                This branch has no sections yet. Please contact your administrator.
              </p>
            )}

            <Button
              type="submit"
              fullWidth
              isLoading={isLoading}
              icon={<UserPlus className="w-4 h-4" />}
              className="mt-3"
            >
              Register & Begin Learning
            </Button>
          </form>
        </div>

        <p className="text-center text-xs text-[#687775] mt-6">
          Already registered?{' '}
          <Link to={portal ? `/login/${portal}` : '/login'} className="font-semibold text-[#0F5B57] hover:underline">
            Sign in here
          </Link>
        </p>
      </div>
    </div>
  )
}
