export type Role = 'student' | 'teacher'

export interface User {
  id: string
  email: string
  full_name: string
  role: Role
  status?: string
  created_at?: string
}

/** Sessions are httpOnly cookies set by the server; JavaScript never holds a token. */
export interface AuthResponse {
  user: User
}

export interface Lesson {
  id: string
  course_id: string
  title: string
  description?: string
  order_index: number
  content?: string
  offline_ready: boolean
  created_at: string
}

export interface Material {
  id: string
  course_id: string
  lesson_id?: string
  title: string
  file_url: string
  file_type: string
  file_size: number
  is_published: boolean
  created_at: string
  description?: string
  resource_type?: MaterialType
  /** pending (uploading) → processing → ready | failed. Students only ever see ready + published. */
  processing_status?: 'pending' | 'processing' | 'ready' | 'failed'
  processing_error?: string
  /** Bumped whenever the file or its metadata changes; downloads compare it to detect stale copies. */
  version?: number
  checksum_sha256?: string
}

export type MaterialType = 'video' | 'audio' | 'document' | 'presentation' | 'notes' | 'other'

export interface Course {
  id: string
  title: string
  code: string
  description?: string
  teacher_id: string
  teacher_name?: string
  created_at: string
  lessons_count?: number
  lessons?: Lesson[]
}

export interface Section {
  id: string
  course_id: string
  name: string
  code: string
  student_count: number
  created_at: string
}

export type RecordingStatus = 'PROCESSING' | 'READY' | 'FAILED' | 'ARCHIVED'

export interface Recording {
  id: string
  course_id: string
  course_title?: string
  course_code?: string
  class_id?: string
  teacher_id: string
  teacher_name?: string
  title: string
  description?: string
  duration_seconds: number
  video_url?: string
  download_url?: string
  file_size_bytes: number
  status: RecordingStatus
  has_transcript: boolean
  has_summary: boolean
  summary_id?: string
  section_ids: string[]
  is_published: boolean
  created_at: string
  user_progress_seconds?: number
  user_completed?: boolean
  transcript?: string
  summary?: Summary
  /** Present only for teachers when the server reports a recording failure. */
  error_message?: string
}

export type ClassStatus = 'SCHEDULED' | 'LIVE' | 'ENDED' | 'CANCELLED'

export interface ClassRoom {
  id: string
  course_id: string
  section_id?: string
  section_name?: string
  course_title?: string
  course_code?: string
  teacher_id: string
  teacher_name?: string
  title: string
  status: ClassStatus
  scheduled_at: string
  livekit_room_name: string
  started_at?: string
  ended_at?: string
}

export interface JoinTokenResponse {
  token: string
  url: string
  room_name: string
  is_publisher: boolean
  /** True when the session is being recorded; participants must be told. */
  recording_active: boolean
}

export interface Submission {
  id: string
  assignment_id: string
  student_id: string
  student_name?: string
  content: string
  status: 'SUBMITTED' | 'GRADED'
  score?: number
  feedback?: string
  submitted_at: string
  idempotency_key?: string
}

export interface Assignment {
  id: string
  course_id: string
  course_title?: string
  title: string
  instructions: string
  due_date: string
  max_score: number
  created_at: string
  submissions_count?: number
  my_submission?: Submission | null
}

export type SummaryStatus = 'QUEUED' | 'PROCESSING' | 'NEEDS_REVIEW' | 'COMPLETED' | 'FAILED'
export type SummaryReviewStatus = 'PENDING' | 'APPROVED' | 'REVISION_REQUESTED'

export interface SummaryDefinition {
  term: string
  definition: string
}

export interface Summary {
  id: string
  class_id: string
  course_id: string
  status: SummaryStatus
  review_status: SummaryReviewStatus
  overview?: string
  key_concepts?: string[]
  definitions?: SummaryDefinition[]
  examples?: string[]
  revision_questions?: string[]
  teacher_notes?: string
  /** 'llm' for a real model, 'stub' for the labeled no-provider fallback. */
  generator?: string
  teacher_edited?: boolean
  created_at: string
}

export type SyncOperationType = 'submit_assignment' | 'save_draft'
export type SyncStatus = 'pending' | 'syncing' | 'failed' | 'completed'
export type SyncOutcomeKind = 'expired' | 'closed' | 'conflict' | 'rejected' | 'network'

export interface SyncOperation {
  id: string
  operationType: SyncOperationType
  entityId: string
  payload: any
  status: SyncStatus
  idempotencyKey: string
  createdAt: string
  retryCount: number
  lastError?: string
  /** Why a failed operation failed. Only 'network' failures are retried automatically. */
  outcome?: SyncOutcomeKind
  errorCode?: string
}

export interface AssignmentDraft {
  id: string // assignment_id
  assignmentId: string
  studentId: string
  courseId: string
  assignmentTitle: string
  content: string
  wordCount: number
  savedAt: string
  /**
   * local_only: saved on this device. pending_sync: queued. synced: the SERVER confirmed it stored it.
   * expired / conflict / rejected: the server answered and refused (final). sync_failed: repeated network
   * failures; still retried, but NOT received.
   */
  syncStatus: 'local_only' | 'pending_sync' | 'synced' | 'expired' | 'conflict' | 'rejected' | 'sync_failed'
  /** Server message for the last refusal. */
  syncMessage?: string
  lastServerSubmissionId?: string
}

export interface DownloadedResource {
  id: string
  resourceId: string
  courseId: string
  lessonId?: string
  title: string
  fileType: string
  sizeBytes: number
  blob?: Blob
  content?: string
  downloadedAt: string
  /** Server content version the verified local copy was taken from (stale when the server's is newer). */
  version?: number
  checksum?: string
  verifiedAt?: string
}

export type NetworkQuality = 'excellent' | 'good' | 'poor' | 'offline'
