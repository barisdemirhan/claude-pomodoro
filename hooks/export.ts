import type { Round } from './history'
import { timestampOf } from './openpomodoro'

export type ExportFormat = 'json' | 'csv' | 'ical'
export const EXPORT_FORMATS: readonly ExportFormat[] = ['json', 'csv', 'ical']

const minutesOf = (ms: number): number => Math.round(ms / 6000) / 10

const recordOf = (round: Round) => ({
  start: timestampOf(round.start),
  end: timestampOf(round.end),
  focusMinutes: minutesOf(round.focusMs),
  plannedMinutes: minutesOf(round.plannedMs),
  status: round.status,
  label: round.label,
  tags: round.tags,
  projects: round.projects,
  claudeMinutes: minutesOf(round.claudeMs),
  prompts: round.prompts,
})

const csvField = (value: string | number): string => {
  const text = String(value)

  return /[,"\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

const csvText = (rounds: readonly Round[]): string => {
  const header = 'start,end,focus_minutes,planned_minutes,status,label,tags,projects,claude_minutes,prompts'
  const lines = rounds.map((round) => {
    const record = recordOf(round)

    return [
      record.start, record.end, record.focusMinutes, record.plannedMinutes,
      record.status, record.label, record.tags.join(';'), record.projects.join(';'),
      record.claudeMinutes, record.prompts,
    ].map(csvField).join(',')
  })

  return [header, ...lines, ''].join('\r\n')
}

const utcTime = (at: number): string =>
  new Date(at).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')

const icalText = (text: string): string =>
  text.replaceAll('\\', '\\\\')
    .replace(/\r\n|\r|\n/g, '\\n')
    .replaceAll(';', '\\;')
    .replaceAll(',', '\\,')

/** Content lines of at most 75 bytes, keeping every Unicode character whole. */
const folded = (line: string): string => {
  const encoder = new TextEncoder()
  const lines: string[] = []
  let part = ''
  let bytes = 0

  for (const character of line) {
    const size = encoder.encode(character).length

    if (bytes + size > 75) {
      lines.push(part)
      part = ' '
      bytes = 1
    }

    part += character
    bytes += size
  }

  return [...lines, part].join('\r\n')
}

const calendarText = (rounds: readonly Round[]): string => {
  const events = rounds.flatMap((round) => [
    'BEGIN:VEVENT',
    `UID:${round.start}@claude-pomodoro`,
    `DTSTAMP:${utcTime(round.end)}`,
    `DTSTART:${utcTime(round.start)}`,
    `DTEND:${utcTime(round.end)}`,
    `SUMMARY:${icalText(`🍅 ${round.label || 'Focus'}${round.status === 'stopped' ? ' (stopped)' : ''}`)}`,
    ...(round.tags.length > 0 ? [`CATEGORIES:${round.tags.map(icalText).join(',')}`] : []),
    `DESCRIPTION:${icalText(`Projects: ${round.projects.join(', ')}\nFocus minutes: ${minutesOf(round.focusMs)}\nClaude minutes: ${minutesOf(round.claudeMs)}`)}`,
    'END:VEVENT',
  ])

  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//claude-pomodoro//EN',
    ...events, 'END:VCALENDAR', '',
  ].map(folded).join('\r\n')
}

/** The rounds as a document another app can read. */
export const exportText = (rounds: readonly Round[], format: ExportFormat): string => {
  if (format === 'json') {
    return JSON.stringify(rounds.map(recordOf), null, 2)
  }

  return format === 'csv' ? csvText(rounds) : calendarText(rounds)
}
