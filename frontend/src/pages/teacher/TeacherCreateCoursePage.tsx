import React, { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { ArrowLeft, PlusCircle, AlertCircle } from 'lucide-react'
import { courseService } from '../../services/courseService'
import { PageContainer } from '../../components/layout/PageContainer'
import { FormField } from '../../components/ui/FormField'
import { Input } from '../../components/ui/Input'
import { Textarea } from '../../components/ui/Textarea'
import { Button } from '../../components/ui/Button'
import { Card, CardContent } from '../../components/ui/Card'

export const TeacherCreateCoursePage: React.FC = () => {
  const navigate = useNavigate()

  const [title, setTitle] = useState('')
  const [code, setCode] = useState('')
  const [description, setDescription] = useState('')
  const [gradeLevel, setGradeLevel] = useState('')
  const [language, setLanguage] = useState('')
  const [institution, setInstitution] = useState('')
  const [region, setRegion] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim() || !code.trim()) {
      setError('Please provide course title and course code.')
      return
    }

    setIsSubmitting(true)
    setError(null)
    try {
      const created = await courseService.createCourse({
        title,
        code: code.toUpperCase().trim(),
        description,
        grade_level: gradeLevel.trim() || undefined,
        language: language.trim() || undefined,
        institution: institution.trim() || undefined,
        region: region.trim() || undefined,
      })
      navigate(`/teacher/courses/${created.id}/manage`)
    } catch (err: any) {
      setError(err.message || 'Failed to create course on server.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <PageContainer maxWidth="md">
      <div className="mb-4">
        <Link
          to="/teacher/courses"
          className="text-xs font-semibold text-[#687775] hover:text-[#0F5B57] inline-flex items-center gap-1.5"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> Back to Courses
        </Link>
      </div>

      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-[#202B2A]">
          Author New Course
        </h1>
        <p className="text-xs text-[#687775] mt-1">
          Define course metadata and learning goals. You can attach sequential lessons and downloadable assets on the next screen.
        </p>
      </div>

      <Card>
        <CardContent className="p-6">
          {error && (
            <div className="mb-5 p-3 rounded-lg bg-[#FDE8E7] text-[#B42318] border border-[#CBD7D1] text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <FormField label="Course Title" htmlFor="title" required hint="e.g. Solar Micro-Grids: Design & Maintenance">
              <Input
                id="title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Course title..."
                required
              />
            </FormField>

            <FormField label="Course Code" htmlFor="code" required hint="Short alphanumeric tag (e.g. STEM-201)">
              <Input
                id="code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="STEM-201"
                required
                className="font-mono uppercase"
              />
            </FormField>

            <FormField label="Curriculum Description" htmlFor="description">
              <Textarea
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={4}
                placeholder="Explain the learning objectives, practical applications, and target learners..."
              />
            </FormField>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <FormField label="Grade / Academic Level" htmlFor="gradeLevel" hint="Optional — helps students find the right course">
                <Input id="gradeLevel" value={gradeLevel} onChange={(e) => setGradeLevel(e.target.value)} placeholder="e.g. Grade 9" />
              </FormField>
              <FormField label="Language of Instruction" htmlFor="language" hint="Optional">
                <Input id="language" value={language} onChange={(e) => setLanguage(e.target.value)} placeholder="e.g. Telugu" />
              </FormField>
              <FormField label="Institution" htmlFor="institution" hint="Optional">
                <Input id="institution" value={institution} onChange={(e) => setInstitution(e.target.value)} placeholder="e.g. Rural College A" />
              </FormField>
              <FormField label="Region" htmlFor="region" hint="Optional">
                <Input id="region" value={region} onChange={(e) => setRegion(e.target.value)} placeholder="e.g. District 4" />
              </FormField>
            </div>

            <div className="flex items-center justify-end gap-3 pt-4 border-t border-[#E1E8E4]">
              <Link to="/teacher/courses">
                <Button variant="ghost" size="sm">
                  Cancel
                </Button>
              </Link>
              <Button
                type="submit"
                size="sm"
                variant="primary"
                isLoading={isSubmitting}
                icon={<PlusCircle className="w-3.5 h-3.5" />}
              >
                Create Course
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </PageContainer>
  )
}
