import React, { useState } from 'react'
import { User, Mail, Shield, Wifi, HardDrive, LogOut, CheckCircle2 } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { useNetworkStatus } from '../../context/NetworkContext'
import { useSync } from '../../context/SyncContext'
import { PageContainer } from '../../components/layout/PageContainer'
import { Card, CardHeader, CardContent } from '../../components/ui/Card'
import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { StorageMeter } from '../../components/download/StorageMeter'

export const StudentProfilePage: React.FC = () => {
  const { user, logout } = useAuth()
  const { isOnline, quality, latencyMs } = useNetworkStatus()
  const { pendingCount } = useSync()

  const [audioOnlyPref, setAudioOnlyPref] = useState(false)

  return (
    <PageContainer
      title="Student Profile & Settings"
      subtitle="Manage your identity, connectivity preferences, and local storage state."
      maxWidth="md"
    >
      <div className="flex flex-col gap-6">
        {/* User Card */}
        <Card>
          <CardContent className="p-6 flex items-center gap-4">
            <div className="w-14 h-14 rounded-full bg-[#111111] text-[#FFFFFF] flex items-center justify-center font-bold text-lg shrink-0">
              {user?.full_name?.charAt(0) || 'S'}
            </div>
            <div>
              <div className="flex items-center gap-2 mb-1">
                <h2 className="text-lg font-bold text-[#111111]">{user?.full_name}</h2>
                <Badge variant="secondary" size="sm" className="uppercase text-[10px]">
                  {user?.role}
                </Badge>
              </div>
              <p className="text-xs text-[#666666] flex items-center gap-1.5">
                <Mail className="w-3.5 h-3.5" /> {user?.email}
              </p>
              <p className="text-[11px] text-[#888888] mt-1">
                Registered: {user?.created_at ? new Date(user.created_at).toLocaleDateString() : 'Active'}
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Network & Low-Bandwidth Preferences */}
        <Card>
          <CardHeader className="py-3 px-5 font-bold text-sm text-[#111111] flex items-center gap-2">
            <Wifi className="w-4 h-4" /> Low-Bandwidth Optimization Settings
          </CardHeader>
          <CardContent className="p-5 flex flex-col gap-4 text-xs">
            <div className="flex items-center justify-between pb-3 border-b border-[#F5F5F5]">
              <div>
                <p className="font-semibold text-[#111111]">Always Start Live Classes in Audio-Only Mode</p>
                <p className="text-[11px] text-[#666666]">
                  Saves ~85% mobile data by muting presenter video streams unless explicitly toggled.
                </p>
              </div>
              <input
                type="checkbox"
                checked={audioOnlyPref}
                onChange={(e) => setAudioOnlyPref(e.target.checked)}
                className="w-4 h-4 rounded border-[#CCCCCC] text-[#111111] focus:ring-[#111111]"
              />
            </div>

            <div className="flex items-center justify-between">
              <div>
                <p className="font-semibold text-[#111111]">Current Network Diagnostic</p>
                <p className="text-[11px] text-[#666666]">
                  Status: {isOnline ? `Online (${quality})` : 'Offline'} • Latency: {latencyMs}ms
                </p>
              </div>
              <Badge variant={isOnline ? 'success' : 'default'} size="sm">
                {isOnline ? 'Connected' : 'Offline'}
              </Badge>
            </div>
          </CardContent>
        </Card>

        {/* Local Storage Meter */}
        <StorageMeter />

        {/* Logout Button */}
        <div className="pt-2">
          <Button
            variant="outline"
            fullWidth
            onClick={() => logout()}
            icon={<LogOut className="w-4 h-4" />}
          >
            Sign Out of EduVillage
          </Button>
          <p className="text-[11px] text-[#666666] text-center mt-2">
            Signing out wipes draft tokens and pending queue records from this device for privacy.
          </p>
        </div>
      </div>
    </PageContainer>
  )
}
