import { useCallback, useEffect, useRef, useState } from 'react'
import { RoomEvent, type Room, type RemoteParticipant } from 'livekit-client'
import { TOPIC, apply, decode, emptyBoard, encode, snapshot, type BoardState, type Message } from './protocol'

/**
 * Shared whiteboard state over the LiveKit data channel.
 *
 * Teacher: every local action is applied and broadcast. When someone joins, the teacher re-sends the whole board to
 * that person only. Students never send anything and only accept messages from participants who are allowed to
 * publish (a student cannot forge the teacher's board).
 */
export function useWhiteboard(room: Room | undefined, isTeacher: boolean) {
  const [board, setBoard] = useState<BoardState>(emptyBoard)
  const boardRef = useRef(board)
  boardRef.current = board

  const publish = useCallback(
    (messages: Message[], to?: string[]) => {
      if (!room) return
      for (const m of messages) {
        room.localParticipant
          .publishData(encode(m), { reliable: true, topic: TOPIC, ...(to ? { destinationIdentities: to } : {}) })
          .catch(() => undefined) // a dropped packet must never break the lesson; the next snapshot repairs it
      }
    },
    [room],
  )

  /** Teacher: apply locally and send to everyone. */
  const dispatch = useCallback(
    (message: Message) => {
      setBoard((b) => apply(b, message))
      publish([message])
    },
    [publish],
  )

  useEffect(() => {
    if (!room) return
    const onData = (payload: Uint8Array, participant?: RemoteParticipant, _kind?: unknown, topic?: string) => {
      if (isTeacher || topic !== TOPIC) return
      if (!participant?.permissions?.canPublish) return // only a teacher's board is believed
      const message = decode(payload)
      if (!message || message.t === 'req') return
      setBoard((b) => apply(b, message))
    }
    room.on(RoomEvent.DataReceived, onData as any)
    return () => {
      room.off(RoomEvent.DataReceived, onData as any)
    }
  }, [room, isTeacher])

  // Teacher: bring each newly connected participant up to date (twice, because their channel may still be opening).
  useEffect(() => {
    if (!room || !isTeacher) return
    const timers: ReturnType<typeof setTimeout>[] = []
    const onJoin = (p: RemoteParticipant) => {
      for (const delay of [800, 3000]) {
        timers.push(setTimeout(() => publish(snapshot(boardRef.current), [p.identity]), delay))
      }
    }
    room.on(RoomEvent.ParticipantConnected, onJoin)
    return () => {
      room.off(RoomEvent.ParticipantConnected, onJoin)
      timers.forEach(clearTimeout)
    }
  }, [room, isTeacher, publish])

  /** Teacher: show or hide the board for everyone (sending the full board when it is opened). */
  const setOpen = useCallback(
    (open: boolean) => {
      if (!isTeacher) return
      setBoard((b) => ({ ...b, open }))
      publish(open ? snapshot({ ...boardRef.current, open }) : [{ t: 'open', open: false }])
    },
    [isTeacher, publish],
  )

  const applyLocal = useCallback((message: Message) => setBoard((b) => apply(b, message)), [])
  const send = useCallback((message: Message) => publish([message]), [publish])

  return { board, dispatch, applyLocal, send, setOpen }
}
