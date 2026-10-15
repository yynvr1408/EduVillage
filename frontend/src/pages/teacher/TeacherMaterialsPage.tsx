import React, { useState, useEffect } from 'react'
import {
  Upload,
  FolderOpen,
  FileText,
  Music,
  CheckCircle2,
  AlertCircle,
  Plus,
} from 'lucide-react'
import { courseService } from '../../services/courseService'
import { api } from '../../services/apiClient'
import type { Course, Material, MaterialType } from '../../types'
import { PageContainer } from '../../components/layout/PageContainer'
import { Card, CardHeader, CardContent } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { Select } from '../../components/ui/Select'
import { Input } from '../../components/ui/Input'
import { FormField } from '../../components/ui/FormField'
import { Badge } from '../../components/ui/Badge'
import { Dialog } from '../../components/ui/Dialog'

export const TeacherMaterialsPage: React.FC = () => {
  const [materials, setMaterials] = useState<Material[]>([])
  const [courses, setCourses] = useState<Course[]>([])
  const [isLoading, setIsLoading] = useState(true)

  // Upload dialog state
  const [isUploadOpen, setIsUploadOpen] = useState(false)
  const [courseId, setCourseId] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [resourceType, setResourceType] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [isUploading, setIsUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [uploadSuccess, setUploadSuccess] = useState(false)

  const loadData = async () => {
    setIsLoading(true)
    try {
      const [coursesList, materialsList] = await Promise.allSettled([
        courseService.getCourses(),
        api.getMaterials(),
      ])

      if (coursesList.status === 'fulfilled') {
        setCourses(coursesList.value)
        if (coursesList.value.length > 0 && !courseId) {
          setCourseId(coursesList.value[0].id)
        }
      }
      if (materialsList.status === 'fulfilled') {
        setMaterials(materialsList.value)
      }
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [])

  const handleUploadSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!file || !courseId) {
      setUploadError('Choose a course and a file to upload.')
      return
    }

    setIsUploading(true)
    setUploadError(null)

    try {
      // Real upload: the file goes to object storage, then the server verifies it before publishing.
      await api.uploadMaterial(courseId, file, {
        title,
        description,
        resourceType: (resourceType || undefined) as MaterialType | undefined,
      })

      setUploadSuccess(true)
      setTimeout(() => {
        setIsUploadOpen(false)
        setUploadSuccess(false)
        setFile(null)
        setTitle('')
        setDescription('')
        setResourceType('')
        loadData()
      }, 1000)
    } catch (err: any) {
      setUploadError(err.message || 'Failed to upload the file')
    } finally {
      setIsUploading(false)
    }
  }

  const togglePublish = async (mat: Material) => {
    setBusyId(mat.id)
    try {
      await api.setMaterialPublished(mat.id, !mat.is_published)
      await loadData()
    } catch (err: any) {
      setUploadError(err.message || 'Could not change publication status')
    } finally {
      setBusyId(null)
    }
  }

  const courseOptions = courses.map((c) => ({
    value: c.id,
    label: `${c.code}: ${c.title}`,
  }))

  return (
    <PageContainer
      title="Course Learning Materials"
      subtitle="Upload PDFs, calculation worksheets, and compressed audio lectures for students to download offline."
      action={
        <Button
          size="sm"
          variant="primary"
          onClick={() => setIsUploadOpen(true)}
          icon={<Plus className="w-4 h-4" />}
        >
          Publish Material
        </Button>
      }
    >
      {materials.length === 0 ? (
        <div className="p-8 border border-dashed border-[#CBD7D1] bg-[#F8FAF7] rounded-xl text-center text-xs text-[#687775]">
          <FolderOpen className="w-8 h-8 mx-auto text-[#0F5B57] mb-2" />
          No materials published yet. Click 'Publish Material' to add offline study resources.
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {materials.map((mat) => {
            const course = courses.find((c) => c.id === mat.course_id)
            const isAudio = mat.file_type.startsWith('audio')

            return (
              <div
                key={mat.id}
                className="p-4 bg-[#FFFFFF] border border-[#E1E8E4] rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
              >
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-[#DDF3EA] border border-[#CBD7D1] flex items-center justify-center shrink-0 text-[#0F5B57]">
                    {isAudio ? <Music className="w-4 h-4 text-[#2364AA]" /> : <FileText className="w-4 h-4 text-[#0F5B57]" />}
                  </div>
                  <div>
                    <p className="font-semibold text-sm text-[#202B2A]">{mat.title}</p>
                    <div className="flex items-center gap-2 text-[#687775] mt-0.5">
                      <span className="uppercase font-mono text-[10px]">{mat.file_type}</span>
                      <span>•</span>
                      <span>{course ? `${course.code}: ${course.title}` : 'General Course'}</span>
                      <span>•</span>
                      <span>{(mat.file_size / 1024).toFixed(0)} KB</span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <Badge
                    variant={
                      mat.processing_status === 'failed'
                        ? 'error'
                        : mat.processing_status !== 'ready'
                        ? 'warning'
                        : mat.is_published
                        ? 'success'
                        : 'secondary'
                    }
                    size="sm"
                  >
                    {mat.processing_status === 'failed'
                      ? 'Processing Failed'
                      : mat.processing_status === 'pending'
                      ? 'Upload Not Completed'
                      : mat.processing_status === 'processing'
                      ? 'Processing'
                      : mat.is_published
                      ? 'Published to Students'
                      : 'Unpublished'}
                  </Badge>
                  {mat.processing_status === 'ready' && (
                    <Button size="sm" variant="outline" isLoading={busyId === mat.id} onClick={() => togglePublish(mat)}>
                      {mat.is_published ? 'Unpublish' : 'Publish'}
                    </Button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Upload Material Dialog */}
      <Dialog
        isOpen={isUploadOpen}
        onClose={() => setIsUploadOpen(false)}
        title="Publish Learning Resource"
        description="Provide resource details. The file will be available for student offline downloads."
        maxWidth="md"
      >
        <form onSubmit={handleUploadSubmit} className="flex flex-col gap-4 text-xs">
          {uploadError && (
            <div className="p-3 bg-[#FDE8E7] text-[#B42318] border border-[#CBD7D1] rounded-lg font-medium">
              {uploadError}
            </div>
          )}
          {uploadSuccess && (
            <div className="p-3 bg-[#E5F5EB] text-[#247A4D] border border-[#CBD7D1] rounded-lg font-medium flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-[#247A4D]" /> Resource uploaded. Publish it when students should see it.
            </div>
          )}

          <FormField label="Target Course" htmlFor="matCourse" required>
            <Select
              id="matCourse"
              value={courseId}
              onChange={(e) => setCourseId(e.target.value)}
              options={courseOptions}
            />
          </FormField>

          <FormField label="Resource Title" htmlFor="matTitle" hint="Defaults to the file name">
            <Input id="matTitle" value={title} onChange={(e) => setTitle(e.target.value)} />
          </FormField>

          <FormField label="Description" htmlFor="matDesc">
            <Input id="matDesc" value={description} onChange={(e) => setDescription(e.target.value)} />
          </FormField>

          <FormField label="Resource Type" htmlFor="matType" hint="Detected from the file when left on automatic">
            <Select
              id="matType"
              value={resourceType}
              onChange={(e) => setResourceType(e.target.value)}
              options={[
                { value: '', label: 'Detect automatically' },
                { value: 'video', label: 'Lecture video' },
                { value: 'audio', label: 'Audio recording' },
                { value: 'document', label: 'PDF / document' },
                { value: 'presentation', label: 'Slides / presentation' },
                { value: 'notes', label: 'Lecture notes' },
                { value: 'other', label: 'Other' },
              ]}
            />
          </FormField>

          <FormField label="File" htmlFor="matFile" required hint="Video, audio, PDF, slides or notes — checked on the server">
            <input
              id="matFile"
              type="file"
              required
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="block w-full text-xs text-[#202B2A] file:mr-3 file:rounded-lg file:border file:border-[#CBD7D1] file:bg-[#F1F5F2] file:px-3 file:py-2 file:text-xs file:text-[#202B2A] file:cursor-pointer"
            />
          </FormField>

          <div className="flex items-center justify-end gap-2 pt-3 border-t border-[#E1E8E4]">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setIsUploadOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              variant="primary"
              isLoading={isUploading}
              icon={<Upload className="w-3.5 h-3.5" />}
            >
              Upload Resource
            </Button>
          </div>
        </form>
      </Dialog>
    </PageContainer>
  )
}
