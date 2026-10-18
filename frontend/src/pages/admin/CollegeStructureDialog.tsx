import React, { useCallback, useEffect, useState } from 'react'
import { ChevronRight, Layers, Pencil, Plus, Power, Search } from 'lucide-react'
import { Badge, Button, Dialog, FormField, Input, LoadingState } from '../../components/ui'
import { adminApi, type College, type CollegeBranch, type CollegeSection, type CollegeStatus } from '../../services/adminApi'

/** The slice of adminApi this dialog actually needs - lets a delegated institution admin (a
 * regular teacher session, see institutionAdminApi) reuse this exact component by passing a
 * different implementation, instead of duplicating the whole branch/section management UI. */
export interface CollegeStructureApi {
  listBranches: (collegeId: string, search?: string) => Promise<CollegeBranch[]>
  createBranch: (collegeId: string, name: string, shortCode?: string) => Promise<CollegeBranch>
  updateBranch: (id: string, input: { name?: string; short_code?: string | null }) => Promise<CollegeBranch>
  setBranchStatus: (id: string, status: CollegeStatus) => Promise<CollegeBranch>
  listSections: (branchId: string, search?: string) => Promise<CollegeSection[]>
  createSection: (branchId: string, name: string) => Promise<CollegeSection>
  updateSection: (id: string, name: string) => Promise<CollegeSection>
  setSectionStatus: (id: string, status: CollegeStatus) => Promise<CollegeSection>
}

type Item = { id: string; name: string; status: CollegeStatus; short_code?: string | null }

interface ListProps {
  noun: 'branch' | 'section'
  items: Item[] | null
  search: string
  onSearch: (v: string) => void
  onAdd: (name: string, shortCode: string) => Promise<void>
  onRename: (item: Item, name: string, shortCode: string) => Promise<void>
  onToggle: (item: Item) => void
  onOpen?: (item: Item) => void
  withShortCode?: boolean
  busy: boolean
}

/** One reusable list for either level: add, search, rename, activate/deactivate (and open, for branches). */
const ManageList: React.FC<ListProps> = ({ noun, items, search, onSearch, onAdd, onRename, onToggle, onOpen, withShortCode, busy }) => {
  const [name, setName] = useState('')
  const [shortCode, setShortCode] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editCode, setEditCode] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const Noun = noun === 'branch' ? 'Branch' : 'Section'

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim() || (noun === 'branch' && name.trim().length < 2)) {
      setFormError(`Enter the ${noun} name.`)
      return
    }
    setFormError(null)
    try {
      await onAdd(name.trim(), shortCode.trim())
      setName('')
      setShortCode('')
    } catch {
      /* the parent shows the server message */
    }
  }

  const saveEdit = async (item: Item) => {
    if (!editName.trim()) return
    try {
      await onRename(item, editName.trim(), editCode.trim())
      setEditing(null)
    } catch {
      /* the parent shows the server message */
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={submit} className="flex flex-col sm:flex-row gap-2 sm:items-end" noValidate>
        <div className="flex-1">
          <FormField label={`New ${noun}`} htmlFor={`new-${noun}`} error={formError ?? undefined}>
            <Input
              id={`new-${noun}`}
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={noun === 'branch' ? 120 : 80}
              placeholder={noun === 'branch' ? 'e.g. Computer Science and Engineering' : 'e.g. Section A'}
            />
          </FormField>
        </div>
        {withShortCode && (
          <div className="sm:w-32">
            <FormField label="Short code" htmlFor="new-branch-code">
              <Input id="new-branch-code" value={shortCode} onChange={(e) => setShortCode(e.target.value)} maxLength={20} placeholder="CSE" />
            </FormField>
          </div>
        )}
        <Button type="submit" isLoading={busy} icon={<Plus className="w-4 h-4" />}>
          Add {Noun}
        </Button>
      </form>

      <Input aria-label={`Search ${noun}s`} placeholder={`Search ${noun}s`} value={search} onChange={(e) => onSearch(e.target.value)} leftIcon={<Search className="w-4 h-4" />} />

      {items === null ? (
        <LoadingState message={`Loading ${noun}s...`} className="p-6" />
      ) : items.length === 0 ? (
        <p className="text-sm text-[#687775]">
          {search ? `No ${noun}s match your search.` : `No ${noun}s yet. Registration stays blocked until at least one is added.`}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((it) => (
            <li key={it.id} className="border border-[#E1E8E4] rounded-lg px-3 py-2 flex flex-col sm:flex-row sm:items-center gap-2 justify-between" data-testid={`${noun}-row`}>
              {editing === it.id ? (
                <div className="flex flex-1 flex-col sm:flex-row gap-2">
                  <Input aria-label={`${Noun} name`} value={editName} onChange={(e) => setEditName(e.target.value)} maxLength={noun === 'branch' ? 120 : 80} />
                  {withShortCode && <Input aria-label="Short code" value={editCode} onChange={(e) => setEditCode(e.target.value)} maxLength={20} className="sm:w-28" />}
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => saveEdit(it)} disabled={busy}>
                      Save
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setEditing(null)}>
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <>
                  <span className="flex flex-wrap items-center gap-2 min-w-0">
                    <span className="text-sm font-semibold text-[#202B2A] break-words">{it.name}</span>
                    {it.short_code && <span className="text-xs text-[#687775]">({it.short_code})</span>}
                    <Badge variant={it.status === 'active' ? 'success' : 'secondary'}>{it.status === 'active' ? 'Active' : 'Inactive'}</Badge>
                  </span>
                  <span className="flex flex-wrap gap-2 shrink-0">
                    {onOpen && (
                      <Button size="sm" variant="outline" icon={<Layers className="w-4 h-4" />} onClick={() => onOpen(it)}>
                        Sections
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      icon={<Pencil className="w-4 h-4" />}
                      onClick={() => {
                        setEditing(it.id)
                        setEditName(it.name)
                        setEditCode(it.short_code ?? '')
                      }}
                    >
                      Edit
                    </Button>
                    <Button size="sm" variant="outline" icon={<Power className="w-4 h-4" />} disabled={busy} onClick={() => onToggle(it)}>
                      {it.status === 'active' ? 'Deactivate' : 'Activate'}
                    </Button>
                  </span>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** Colleges -> (this dialog) Branches -> Sections. Everything is read from and written to the backend. */
export const CollegeStructureDialog: React.FC<{
  college: College | null
  onClose: () => void
  onSessionExpired: () => void
  /** Defaults to the platform admin's own transport; a delegated institution admin passes
   * institutionAdminApi instead, which rides their ordinary teacher session. */
  api?: CollegeStructureApi
}> = ({ college, onClose, onSessionExpired, api = adminApi }) => {
  const [branch, setBranch] = useState<CollegeBranch | null>(null)
  const [branches, setBranches] = useState<CollegeBranch[] | null>(null)
  const [sections, setSections] = useState<CollegeSection[] | null>(null)
  const [branchSearch, setBranchSearch] = useState('')
  const [sectionSearch, setSectionSearch] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState<{ kind: 'branch' | 'section'; item: Item } | null>(null)

  const fail = useCallback(
    (err: any) => {
      if (err?.status === 401) onSessionExpired()
      else setError(err?.message || 'Something went wrong.')
    },
    [onSessionExpired],
  )

  const loadBranches = useCallback(async () => {
    if (!college) return
    try {
      setBranches(await api.listBranches(college.id, branchSearch))
    } catch (err) {
      fail(err)
    }
  }, [college, branchSearch, fail, api])

  const loadSections = useCallback(async () => {
    if (!branch) return
    try {
      setSections(await api.listSections(branch.id, sectionSearch))
    } catch (err) {
      fail(err)
    }
  }, [branch, sectionSearch, fail, api])

  useEffect(() => {
    setBranch(null)
    setBranches(null)
    setBranchSearch('')
    setError(null)
    setNotice(null)
  }, [college])

  useEffect(() => {
    const t = setTimeout(() => void loadBranches(), 250)
    return () => clearTimeout(t)
  }, [loadBranches])

  useEffect(() => {
    setSections(null)
    if (!branch) return
    const t = setTimeout(() => void loadSections(), 250)
    return () => clearTimeout(t)
  }, [loadSections, branch])

  const run = async (action: () => Promise<unknown>, success: string, reload: () => Promise<void>) => {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      await action()
      setNotice(success)
      await reload()
    } catch (err) {
      fail(err)
      throw err
    } finally {
      setBusy(false)
    }
  }

  const doToggle = (kind: 'branch' | 'section', item: Item) => {
    const next: CollegeStatus = item.status === 'active' ? 'inactive' : 'active'
    void run(
      () => (kind === 'branch' ? api.setBranchStatus(item.id, next) : api.setSectionStatus(item.id, next)),
      `${item.name} is now ${next}.`,
      kind === 'branch' ? loadBranches : loadSections,
    ).catch(() => undefined)
  }

  // Deactivating hides it from new registrations, so it asks first; re-activating does not.
  const requestToggle = (kind: 'branch' | 'section', item: Item) => (item.status === 'active' ? setConfirm({ kind, item }) : doToggle(kind, item))

  return (
    <Dialog
      isOpen={!!college}
      onClose={onClose}
      title={branch ? `Sections of ${branch.name}` : 'Branches and sections'}
      description={college ? (branch ? `${college.name} › ${branch.name}` : college.name) : undefined}
      maxWidth="xl"
    >
      <div className="flex flex-col gap-4">
        <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1 text-xs text-[#687775]">
          <button type="button" className={branch ? 'font-semibold text-[#0F5B57] hover:underline' : 'font-semibold text-[#202B2A]'} onClick={() => setBranch(null)} disabled={!branch}>
            Branches
          </button>
          {branch && (
            <>
              <ChevronRight className="w-3 h-3" aria-hidden="true" />
              <span className="font-semibold text-[#202B2A]">{branch.name}</span>
              <ChevronRight className="w-3 h-3" aria-hidden="true" />
              <span>Sections</span>
            </>
          )}
        </nav>

        {error && (
          <div className="p-3 rounded-lg bg-[#FDE8E7] border border-[#B42318]/30 text-[#B42318] text-xs" role="alert">
            {error}
          </div>
        )}
        {notice && !error && (
          <div className="p-3 rounded-lg bg-[#E5F5EB] border border-[#247A4D]/30 text-[#247A4D] text-xs" role="status">
            {notice}
          </div>
        )}

        {!branch ? (
          <ManageList
            noun="branch"
            withShortCode
            items={branches}
            search={branchSearch}
            onSearch={setBranchSearch}
            busy={busy}
            onAdd={(name, code) => run(() => api.createBranch(college!.id, name, code), `Branch ${name} added.`, loadBranches)}
            onRename={(it, name, code) => run(() => api.updateBranch(it.id, { name, short_code: code || null }), 'Branch updated.', loadBranches)}
            onToggle={(it) => requestToggle('branch', it)}
            onOpen={(it) => {
              setNotice(null)
              setError(null)
              setSectionSearch('')
              setBranch(branches!.find((b) => b.id === it.id)!)
            }}
          />
        ) : (
          <ManageList
            noun="section"
            items={sections}
            search={sectionSearch}
            onSearch={setSectionSearch}
            busy={busy}
            onAdd={(name) => run(() => api.createSection(branch.id, name), `Section ${name} added.`, loadSections)}
            onRename={(it, name) => run(() => api.updateSection(it.id, name), 'Section updated.', loadSections)}
            onToggle={(it) => requestToggle('section', it)}
          />
        )}
      </div>

      <Dialog
        isOpen={!!confirm}
        onClose={() => setConfirm(null)}
        title={confirm?.kind === 'branch' ? 'Deactivate this branch?' : 'Deactivate this section?'}
        description={confirm?.item.name}
        maxWidth="sm"
      >
        <div className="flex flex-col gap-4">
          <p className="text-sm text-[#687775]">
            It will no longer be offered at registration. Existing teachers, students and their assignments are not changed, and you can activate it again at any time.
          </p>
          <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
            <Button variant="outline" onClick={() => setConfirm(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                const c = confirm
                setConfirm(null)
                if (c) doToggle(c.kind, c.item)
              }}
            >
              Deactivate
            </Button>
          </div>
        </div>
      </Dialog>
    </Dialog>
  )
}
