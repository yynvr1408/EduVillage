/** A due date the server may not have set: show a clear label instead of "Invalid Date". */
export function formatDueDate(due?: string | null, options?: Intl.DateTimeFormatOptions): string {
  if (!due) return 'No due date'
  const d = new Date(due)
  if (Number.isNaN(d.getTime())) return 'No due date'
  return d.toLocaleDateString(undefined, options)
}
