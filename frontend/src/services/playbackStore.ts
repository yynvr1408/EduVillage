import { db } from '../db/db'

const MIN_DELTA_SECONDS = 3

export const playbackStore = {
  key: {
    resource: (id: string) => `res:${id}`,
    recording: (id: string) => `rec:${id}`,
  },

  async get(id: string) {
    return db.playbackPositions.get(id)
  },

  /** Saves where the student is. Near-identical positions are skipped to avoid needless writes. */
  async save(id: string, positionSeconds: number, durationSeconds: number, completed = false): Promise<void> {
    if (!Number.isFinite(positionSeconds) || positionSeconds < 0) return
    const existing = await db.playbackPositions.get(id)
    if (existing && !completed && Math.abs(existing.positionSeconds - positionSeconds) < MIN_DELTA_SECONDS) return
    await db.playbackPositions.put({
      id,
      positionSeconds: Math.floor(positionSeconds),
      durationSeconds: Number.isFinite(durationSeconds) ? Math.floor(durationSeconds) : 0,
      completed: completed || Boolean(existing?.completed),
      updatedAt: new Date().toISOString(),
    })
  },

  /** Position to resume from; ignores positions at/after the end so a finished lecture restarts. */
  async resumeAt(id: string, durationSeconds?: number): Promise<number> {
    const saved = await db.playbackPositions.get(id)
    if (!saved || saved.completed) return 0
    const total = durationSeconds || saved.durationSeconds
    if (total && saved.positionSeconds >= total - 5) return 0
    return saved.positionSeconds
  },

  async clear(id: string): Promise<void> {
    await db.playbackPositions.delete(id)
  },
}
