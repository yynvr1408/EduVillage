import React from 'react'
import { RefreshCw, CheckCircle, Clock, AlertCircle } from 'lucide-react'
import { Dialog } from './Dialog'
import { Button } from './Button'
import { Badge } from './Badge'
import { useSync } from '../../context/SyncContext'
import { useNetworkStatus } from '../../context/NetworkContext'

export interface SyncStatusModalProps {
  isOpen: boolean
  onClose: () => void
}

export const SyncStatusModal: React.FC<SyncStatusModalProps> = ({ isOpen, onClose }) => {
  const { operations, pendingCount, isSyncing, syncNow, lastSyncTime } = useSync()
  const { isOnline } = useNetworkStatus()

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title="Synchronization Queue"
      description="Offline assignment drafts and pending requests waiting for server synchronization."
      maxWidth="md"
    >
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between p-3.5 bg-[#F1F5F2] border border-[#E1E8E4] rounded-xl">
          <div>
            <p className="text-xs font-semibold text-[#202B2A]">
              Status: {isOnline ? 'Connected to LanternEd Server' : 'Offline (Local Only)'}
            </p>
            <p className="text-xs text-[#687775]">
              {lastSyncTime ? `Last synced: ${lastSyncTime.toLocaleTimeString()}` : 'No sync recorded yet this session'}
            </p>
          </div>
          <Badge variant={isOnline ? 'success' : 'warning'}>
            {pendingCount} Pending
          </Badge>
        </div>

        {operations.length === 0 ? (
          <div className="py-8 text-center text-[#687775] text-xs">
            <CheckCircle className="w-8 h-8 mx-auto text-[#247A4D] mb-2" />
            All drafts and submissions are synchronized with the server.
          </div>
        ) : (
          <div className="flex flex-col gap-2 max-h-60 overflow-y-auto">
            {operations.map((op) => (
              <div
                key={op.id}
                className="p-3 bg-[#FFFFFF] border border-[#E1E8E4] rounded-lg flex items-center justify-between text-xs"
              >
                <div className="flex items-center gap-2.5">
                  {op.status === 'pending' ? (
                    <Clock className="w-4 h-4 text-[#8A5700] shrink-0" />
                  ) : op.status === 'syncing' ? (
                    <RefreshCw className="w-4 h-4 text-[#0F5B57] animate-spin shrink-0" />
                  ) : op.status === 'completed' ? (
                    <CheckCircle className="w-4 h-4 text-[#247A4D] shrink-0" />
                  ) : (
                    <AlertCircle className="w-4 h-4 text-[#B42318] shrink-0" />
                  )}
                  <div>
                    <p className="font-medium text-[#202B2A]">
                      {op.operationType === 'submit_assignment' ? 'Assignment Submission' : 'Draft Save'}
                    </p>
                    <p className="text-xs text-[#687775]">
                      Queued: {new Date(op.createdAt).toLocaleTimeString()}
                      {op.retryCount > 0 && ` • Retries: ${op.retryCount}`}
                    </p>
                    {op.lastError && (
                      <p className="text-xs text-[#B42318] mt-0.5">{op.lastError}</p>
                    )}
                  </div>
                </div>

                <Badge
                  variant={
                    op.status === 'completed'
                      ? 'success'
                      : op.status === 'syncing'
                      ? 'default'
                      : op.status === 'failed'
                      ? 'error'
                      : 'warning'
                  }
                  size="sm"
                >
                  {op.status === 'failed' && op.outcome ? op.outcome : op.status}
                </Badge>
              </div>
            ))}
          </div>
        )}

        <div className="pt-2 flex justify-between items-center border-t border-[#E1E8E4]">
          <span className="text-xs text-[#687775]">
            Uses idempotent keys to guarantee zero duplicates
          </span>
          <Button
            size="sm"
            disabled={!isOnline || isSyncing || pendingCount === 0}
            isLoading={isSyncing}
            onClick={() => syncNow()}
            icon={<RefreshCw className="w-3.5 h-3.5" />}
          >
            Sync All
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
