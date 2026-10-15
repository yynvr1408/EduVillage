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
import { apiRequest } from '../../services/apiClient'
import type { Course, Material } from '../../types'
import { PageContainer } from '../../components/layout/PageContainer'
import { Card, CardHeader, CardContent } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { Select } from '../../components/ui/Select'
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
  const [title, setTitle] = useState('')
  const [fileType, setFileType] = useState('pdf')
  const [fileUrl, setFileUrl] = useState('')
  const [fileSize, setFileSize] = useState<number>(1500000)
  const [isUploading, setIsUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [uploadSuccess, setUploadSuccess] = useState(false)

  const loadData = async () => {
    setIsLoading(true)
    try {
      const [coursesList, materialsList] = await Promise.allSettled([
        courseService.getCourses(),
        apiRequest<Material[]>('/api/materials'),
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
    if (!title.trim() || !courseId) {
      setUploadError('Title and course are required.')
      return
    }

    setIsUploading(true)
    setUploadError(null)

    try {
      await apiRequest<Material>('/api/materials', {
        method: 'POST',
        body: JSON.stringify({
          course_id: courseId,
          title,
          file_type: fileType,
          file_url: fileUrl || `/downloads/${title.toLowerCase().replace(/\s+/g, '-')}.${fileType}`,
          file_size: fileSize,
        }),
      })

      setUploadSuccess(true)
      setTimeout(() => {
        setIsUploadOpen(false)
        setUploadSuccess(false)
        setTitle('')
        setFileUrl('')
        loadData()
      }, 1000)
    } catch (err: any) {
      setUploadError(err.message || 'Failed to upload material metadata')
    } finally {
      setIsUploading(false)
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
        <div className="p-8 border border-dashed border-[#E5E5E5] rounded-xl text-center text-xs text-[#666666]">
          <FolderOpen className="w-8 h-8 mx-auto text-[#666666] mb-2" />
          No materials published yet. Click 'Publish Material' to add offline study resources.
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {materials.map((mat) => {
            const course = courses.find((c) => c.id === mat.course_id)
            const isAudio = mat.file_type === 'audio' || mat.file_type === 'mp3'

            return (
              <div
                key={mat.id}
                className="p-4 bg-[#FFFFFF] border border-[#E5E5E5] rounded-lg flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
              >
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-md bg-[#F5F5F5] border border-[#E5E5E5] flex items-center justify-center shrink-0 text-[#111111]">
                    {isAudio ? <Music className="w-4 h-4" /> : <FileText className="w-4 h-4" />}
                  </div>
                  <div>
                    <p className="font-semibold text-sm text-[#111111]">{mat.title}</p>
                    <div className="flex items-center gap-2 text-[#666666] mt-0.5">
                      <span className="uppercase font-mono text-[10px]">{mat.file_type}</span>
                      <span>•</span>
                      <span>{course ? `${course.code}: ${course.title}` : 'General Course'}</span>
                      <span>•</span>
                      <span>Published {new Date(mat.created_at).toLocaleDateString()}</span>
                    </div>
                  </div>
                </div>

                <Badge variant={mat.is_published ? 'success' : 'secondary'} size="sm">
                  {mat.is_published ? 'Published to Students' : 'Draft'}
                </Badge>
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
            <div className="p-3 bg-[#B42318]/10 text-[#B42318] rounded-md font-medium">
              {uploadError}
            </div>
          )}
          {uploadSuccess && (
            <div className="p-3 bg-[#166534]/10 text-[#166534] rounded-md font-medium flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4" /> Material published successfully!
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

          <FormField label="Resource Title" htmlFor="matTitle" required>
            <Input
              id="matTitle"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Inverter Sizing Calculation Worksheet"
              required
            />
          </FormField>

          <FormField label="Resource Type" htmlFor="matType" required>
            <Select
              id="matType"
              value={fileType}
              onChange={(e) => setFileType(e.target.value)}
              options={[
                { value: 'pdf', label: 'PDF Document / Study Guide' },
                { value: 'audio', label: 'Audio Lecture (MP3/OPUS)' },
                { value: 'doc', label: 'Reference Worksheet' },
              ]}
            />
          </FormField>

          <FormField label="File Size (Bytes)" htmlFor="matSize" hint="Estimated storage requirement">
            <Input
              id="matSize"
              type="number"
              value={fileSize}
              onChange={(e) => setFileSize(Number(e.target.value))}
            />
          </FormField>

          <div className="flex items-center justify-end gap-2 pt-3 border-t border-[#E5E5E5]">
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
              Publish Resource
            </Button>
          </div>
        </form>
      </Dialog>
    </PageContainer>
  )
}
