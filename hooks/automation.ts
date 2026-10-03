import type { OpenPomodoro } from './openpomodoro'
import { formatEntry, parseEntry } from './openpomodoro'

export type PomodoroEvent = 'start' | 'stop' | 'break'
export type HookContext = {
  phase: 'focus' | 'break' | 'idle'
  round: number
  rounds: number
  minutes: number
  description: string
  tags: string[]
}

/** The Open Pomodoro directory under the person's home. */
export const pomodoroDirOf = (home: string): string =>
  `${home.replace(/\/+$/, '')}/.pomodoro`

export const hookPathOf = (directory: string, event: PomodoroEvent): string =>
  `${directory}/hooks/${event}`

/** The variables a hook sees, with the phase that begins and its intent. */
export const hookEnvOf = (
  directory: string,
  event: PomodoroEvent,
  context: HookContext,
): Record<string, string> => ({
  POMODORO_EVENT: event,
  POMODORO_PHASE: context.phase,
  POMODORO_ROUND: String(context.round),
  POMODORO_ROUNDS: String(context.rounds),
  POMODORO_MINUTES: String(context.minutes),
  POMODORO_DESCRIPTION: context.description,
  POMODORO_TAGS: context.tags.join(','),
  POMODORO_DIRECTORY: directory,
})

/** An entry followed by a newline, or the empty file the CLI clears with. */
export const currentTextOf = (entry: OpenPomodoro | undefined): string =>
  entry ? `${formatEntry(entry)}\n` : ''

/** The current file's first line, absent when it is empty or unreadable. */
export const readCurrentText = (text: string): OpenPomodoro | undefined =>
  parseEntry(text.split(/\r\n|\r|\n/)[0] ?? '')

/**
 * The history file with `entry` in it: in place of a line of the same start,
 * which a round another tool began has from its start, or added at the end.
 * The other lines stay as they were; undefined when nothing changes.
 */
export const historyWith = (
  existing: string,
  entry: OpenPomodoro,
): string | undefined => {
  const line = formatEntry(entry)
  const lines = existing.split(/\r\n|\r|\n/)
  const at = lines.findIndex((kept) => parseEntry(kept)?.start === entry.start)

  if (at >= 0) {
    return lines[at] === line
      ? undefined
      : lines.map((kept, index) => (index === at ? line : kept)).join('\n')
  }

  const separator = existing === '' || /[\r\n]$/.test(existing) ? '' : '\n'

  return `${existing}${separator}${line}\n`
}

/** The history file without the round that began at `start`: undefined when it has none. */
export const historyWithout = (
  existing: string,
  start: number,
): string | undefined => {
  const lines = existing.split(/\r\n|\r|\n/)
  const kept = lines.filter((line) => parseEntry(line)?.start !== start)

  return kept.length === lines.length ? undefined : kept.join('\n')
}
