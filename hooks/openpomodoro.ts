import type { Round } from './history'

export type OpenPomodoro = {
  start: number
  minutes: number
  description: string
  tags: string[]
}

const pad = (value: number): string => String(value).padStart(2, '0')

/** A moment in RFC 3339, with the offset where the person is. */
export const timestampOf = (at: number): string => {
  const date = new Date(at)
  const offset = -date.getTimezoneOffset()
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  const fraction = date.getMilliseconds() === 0
    ? ''
    : `.${String(date.getMilliseconds()).padStart(3, '0')}`

  return `${day}T${time}${fraction}${offset < 0 ? '-' : '+'}${pad(Math.floor(Math.abs(offset) / 60))}:${pad(Math.abs(offset) % 60)}`
}

const quoted = (text: string): string =>
  /[\s="\\\u0000-\u001f]/.test(text) || text === 'null' ? JSON.stringify(text) : text

/** One Open Pomodoro line, with empty description and tags left out. */
export const formatEntry = (entry: OpenPomodoro): string => [
  timestampOf(entry.start),
  ...(entry.description === '' ? [] : [`description=${quoted(entry.description)}`]),
  `duration=${entry.minutes}`,
  ...(entry.tags.length === 0 ? [] : [`tags=${quoted(entry.tags.join(','))}`]),
].join(' ')

const durationOf = (text: string): number | undefined => {
  if (/^\d+(?:\.\d+)?$/.test(text)) {
    const minutes = Number(text)

    return Number.isFinite(minutes) ? minutes : undefined
  }

  const parts = [...text.matchAll(/(\d+(?:\.\d+)?)(h|m|s)/g)]

  if (parts.length === 0 || parts.map((part) => part[0]).join('') !== text) {
    return undefined
  }

  const minutes = parts.reduce((sum, part) =>
    sum + Number(part[1]) * (part[2] === 'h' ? 60 : part[2] === 's' ? 1 / 60 : 1), 0)

  return Number.isFinite(minutes) ? minutes : undefined
}

/** A readable timestamp and logfmt fields; other keys carry no meaning here. */
export const parseEntry = (line: string): OpenPomodoro | undefined => {
  const first = line.trim().match(/^(\S+)(?:\s+(.*))?$/)
  const time = first?.[1] ?? ''

  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/i.test(time)) {
    return undefined
  }

  const start = Date.parse(time)

  if (!Number.isFinite(start)) {
    return undefined
  }

  const entry: OpenPomodoro = { start, minutes: 25, description: '', tags: [] }
  let rest = first?.[2] ?? ''

  while (rest.trim() !== '') {
    const field = rest.trimStart().match(/^([^\s="]+)=("(?:[^"\\]|\\.)*"|[^\s"]*)(?:\s+|$)/)

    if (!field) {
      return undefined
    }

    const key = field[1]
    const raw = field[2] ?? ''
    let value = raw

    if (raw.startsWith('"')) {
      try {
        value = JSON.parse(raw)
      } catch {
        return undefined
      }
    }

    if (key === 'description') {
      entry.description = value
    } else if (key === 'tags') {
      entry.tags = value === '' ? [] : value.split(',')
    } else if (key === 'duration') {
      const minutes = durationOf(value)

      if (minutes === undefined) {
        return undefined
      }

      entry.minutes = minutes
    }

    rest = rest.trimStart().slice(field[0].length)
  }

  return entry
}

/** A round's actual focus, in whole minutes with at least one recorded. */
export const entryOfRound = (round: Round): OpenPomodoro => ({
  start: round.start,
  minutes: Math.max(1, Math.round(round.focusMs / 60_000)),
  description: round.label,
  tags: [...round.tags],
})
