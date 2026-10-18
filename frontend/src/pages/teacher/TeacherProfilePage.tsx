import React from 'react'
import { User, Mail, Shield, LogOut, CheckCircle2 } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { useNetworkStatus } from '../../context/NetworkContext'
import { PageContainer } from '../../components/layout/PageContainer'
import { Card, CardHeader, CardContent } from '../../components/ui/Card'
import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'

export const TeacherProfilePage: React.FC = () => {
  const { user, logout } = useAuth()
  const { isOnline, quality, latencyMs } = useNetworkStatus()

  return (
    <PageContainer
      title="Instructor Profile & Console Settings"
      subtitle="Teacher credentials, authorized role capabilities, and streaming diagnostics."
      maxWidth="md"
    >
      <div className="flex flex-col gap-6">
        <Card>
          <CardContent className="p-6 flex items-center gap-4">
            <div className="w-14 h-14 rounded-full bg-[#0F5B57] text-[#FFFFFF] flex items-center justify-center font-bold text-lg shrink-0">
              {user?.full_name?.charAt(0) || 'T'}
            </div>
            <div>
              <div className="flex items-center gap-2 mb-1">
                <h2 className="text-lg font-bold text-[#202B2A]">{user?.full_name}</h2>
                <Badge variant="default" size="sm" className="uppercase text-xs">
                  {user?.role}
                </Badge>
              </div>
              <p className="text-xs text-[#687775] flex items-center gap-1.5">
                <Mail className="w-3.5 h-3.5 text-[#0F5B57]" /> {user?.email}
              </p>
              <p className="text-xs text-[#84908D] mt-1">
                Role Authorized by LanternEd Administrative Core
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Permissions details */}
        <Card>
          <CardHeader className="py-3 px-5 font-bold text-sm text-[#202B2A] flex items-center gap-2">
            <Shield className="w-4 h-4 text-[#0F5B57]" /> Instructor Permissions
          </CardHeader>
          <CardContent className="p-5 flex flex-col gap-2.5 text-xs">
            <div className="flex items-center gap-2 text-[#247A4D]">
              <CheckCircle2 className="w-4 h-4 shrink-0 text-[#247A4D]" />
              <span>Full Publisher rights to broadcast live WebRTC video & audio</span>
            </div>
            <div className="flex items-center gap-2 text-[#247A4D]">
              <CheckCircle2 className="w-4 h-4 shrink-0 text-[#247A4D]" />
              <span>Course curriculum authoring and offline asset publishing</span>
            </div>
            <div className="flex items-center gap-2 text-[#247A4D]">
              <CheckCircle2 className="w-4 h-4 shrink-0 text-[#247A4D]" />
              <span>AI Lecture Summary review, editing, and approval authority</span>
            </div>
            <div className="flex items-center gap-2 text-[#247A4D]">
              <CheckCircle2 className="w-4 h-4 shrink-0 text-[#247A4D]" />
              <span>Student assignment grading and feedback submission</span>
            </div>
          </CardContent>
        </Card>

        {/* Diagnostic */}
        <Card>
          <CardContent className="p-5 text-xs text-[#687775] flex items-center justify-between">
            <div>
              <p className="font-semibold text-[#202B2A]">Network Health</p>
              <p className="text-xs">
                {isOnline ? `Online (${quality}) • ${latencyMs}ms latency` : 'Offline'}
              </p>
            </div>
            <Badge variant={isOnline ? 'success' : 'default'} size="sm">
              {isOnline ? 'Active' : 'Offline'}
            </Badge>
          </CardContent>
        </Card>

        <div className="pt-2">
          <Button
            variant="outline"
            fullWidth
            onClick={() => logout()}
            icon={<LogOut className="w-4 h-4 text-[#687775]" />}
          >
            Sign Out of Teacher Console
          </Button>
        </div>
      </div>
    </PageContainer>
  )
}
