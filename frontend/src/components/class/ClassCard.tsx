import React from 'react'
import { Link } from 'react-router-dom'
import { Video, Calendar, Clock, Sparkles, Play, StopCircle } from 'lucide-react'
import type { ClassRoom } from '../../types'
import { Card, CardHeader, CardContent, CardFooter } from '../ui/Card'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'

export interface ClassCardProps {
  classroom: ClassRoom
  isTeacher?: boolean
  onStart?: (id: string) => void
  onEnd?: (id: string) => void
  isStarting?: boolean
  isEnding?: boolean
}

export const ClassCard: React.FC<ClassCardProps> = ({
  classroom,
  isTeacher = false,
  onStart,
  onEnd,
  isStarting = false,
  isEnding = false,
}) => {
  const isLive = classroom.status === 'LIVE'
  const isScheduled = classroom.status === 'SCHEDULED'
  const isEnded = classroom.status === 'ENDED'

  const formattedDate = new Date(classroom.scheduled_at).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })
  const formattedTime = new Date(classroom.scheduled_at).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  })

  return (
    <Card className="flex flex-col h-full border-[#E5E5E5]">
      <CardHeader className="flex items-center justify-between gap-2">
        <Badge variant="outline" size="sm" className="font-mono">
          {classroom.course_code || 'EDU'}
        </Badge>
        <Badge
          variant={
            isLive ? 'live' : isScheduled ? 'secondary' : isEnded ? 'default' : 'outline'
          }
          size="sm"
        >
          {classroom.status}
        </Badge>
      </CardHeader>

      <CardContent className="flex-1 flex flex-col">
        <h3 className="font-bold text-base text-[#111111] line-clamp-2 mb-2">
          {classroom.title}
        </h3>
        {classroom.course_title && (
          <p className="text-xs text-[#666666] mb-2">
            Course: <strong className="font-medium text-[#111111]">{classroom.course_title}</strong>
          </p>
        )}

        {classroom.section_name && (
          <div className="flex items-center gap-1.5 mb-3">
            <span className="text-[11px] font-medium bg-[#F5F5F5] text-[#111111] px-2 py-0.5 rounded border border-[#E5E5E5]">
              Section: {classroom.section_name}
            </span>
          </div>
        )}

        <div className="flex flex-col gap-1.5 text-xs text-[#666666] mt-auto pt-2 border-t border-[#F5F5F5]">
          <div className="flex items-center gap-2">
            <Calendar className="w-3.5 h-3.5 shrink-0" />
            <span>{formattedDate}</span>
          </div>
          <div className="flex items-center gap-2">
            <Clock className="w-3.5 h-3.5 shrink-0" />
            <span>{formattedTime}</span>
          </div>
        </div>
      </CardContent>

      <CardFooter className="flex-wrap gap-2">
        {/* Student actions */}
        {!isTeacher && (
          <>
            {isLive ? (
              <Link to={`/classroom/${classroom.id}`} className="w-full sm:w-auto">
                <Button size="sm" variant="primary" icon={<Video className="w-3.5 h-3.5" />}>
                  Join Live Room
                </Button>
              </Link>
            ) : isScheduled ? (
              <span className="text-xs text-[#666666] italic">Room opens when teacher starts class</span>
            ) : (
              <Link to={`/student/classes/${classroom.id}/summary`} className="w-full sm:w-auto">
                <Button size="sm" variant="secondary" icon={<Sparkles className="w-3.5 h-3.5" />}>
                  Lecture Summary
                </Button>
              </Link>
            )}
          </>
        )}

        {/* Teacher actions */}
        {isTeacher && (
          <div className="w-full flex items-center justify-between gap-2">
            {isScheduled && onStart && (
              <Button
                size="sm"
                variant="primary"
                isLoading={isStarting}
                onClick={() => onStart(classroom.id)}
                icon={<Play className="w-3.5 h-3.5" />}
              >
                Start Class
              </Button>
            )}

            {isLive && (
              <div className="flex items-center gap-2">
                <Link to={`/classroom/${classroom.id}`}>
                  <Button size="sm" variant="primary" icon={<Video className="w-3.5 h-3.5" />}>
                    Enter Room
                  </Button>
                </Link>
                {onEnd && (
                  <Button
                    size="sm"
                    variant="outline"
                    isLoading={isEnding}
                    onClick={() => onEnd(classroom.id)}
                    icon={<StopCircle className="w-3.5 h-3.5" />}
                  >
                    End Class
                  </Button>
                )}
              </div>
            )}

            {isEnded && (
              <Link to="/teacher/summaries">
                <Button size="sm" variant="secondary" icon={<Sparkles className="w-3.5 h-3.5" />}>
                  Review Summary
                </Button>
              </Link>
            )}
          </div>
        )}
      </CardFooter>
    </Card>
  )
}
