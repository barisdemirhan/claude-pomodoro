// The focus rounds a person has done, one record each, kept in the plugin's
// store beside the timer. Every number the stats give is told from these. A
// round is named by when it began, so one that two sessions both turned is
// still one round.

import { field, isRecord, toCount, toText, toWords } from './values'

export type RoundStatus = 'done' | 'stopped'
export type Round = {
  /** When the round began, unmoved by pauses: the round's name. */
  start: number
  end: number
  plannedMs: number
  /** How long it was focused: its run with the pauses left out. */
  focusMs: number
  /** `done` ran out or was finished; `stopped` was stopped or skipped first. */
  status: RoundStatus
  label: string
  /** Its tags, without the `#`. */
  tags: string[]
  /** The repositories or folders worked in during it, by name. */
  projects: string[]
  /** About how long Claude worked inside it. */
  claudeMs: number
  prompts: number
}
export type Day = { rounds: number; focusMs: number }
export type History = {
  /** Oldest first, one per start. */
  rounds: Round[]
  /** Days kept as totals alone: from before rounds were kept, or folded. */
  days: Record<string, Day>
}
export type Intent = { label: string; tags: string[] }

const MINUTE_MS = 60_000
const DAY_MS = 24 * 60 * MINUTE_MS
// Rounds older than this are kept as their days' totals alone: the store is
// one JSON file of 4 MiB in all.
export const KEEP_DAYS = 400
const MAX_ROUNDS = 8_000
const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/
const TAG = /^#[^#\s]+$/

export const EMPTY: History = { rounds: [], days: {} }
const NO_DAY: Day = { rounds: 0, focusMs: 0 }

/** The day `at` falls on where the person is, as `2026-10-02`. */
export const dayOf = (at: number, daysBack = 0): string => {
  const moment = new Date(at)
  const date = new Date(
    moment.getFullYear(),
    moment.getMonth(),
    moment.getDate() - daysBack,
  )
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')

  return `${date.getFullYear()}-${month}-${day}`
}

/** Noon of a `2026-10-02` day where the person is: safe from either end. */
const noonOf = (day: string): number => {
  const [year = 0, month = 1, date = 1] = day.split('-').map(Number)

  return new Date(year, month - 1, date, 12).getTime()
}

const toDay = (value: unknown): Day =>
  isRecord(value)
    ? {
        rounds: toCount(field(value, 'rounds')),
        focusMs: toCount(field(value, 'focusMs')),
      }
    : NO_DAY

const toDays = (value: unknown): Record<string, Day> =>
  isRecord(value)
    ? Object.fromEntries(
        Object.entries(value)
          .filter(([day]) => DAY_KEY.test(day))
          .map(([day, kept]) => [day, toDay(kept)]),
      )
    : {}

const toRound = (value: unknown): Round | undefined => {
  if (!isRecord(value)) {
    return undefined
  }

  const start = toCount(field(value, 'start'))
  const end = toCount(field(value, 'end'))

  if (start === 0 || end < start) {
    return undefined
  }

  return {
    start,
    end,
    plannedMs: toCount(field(value, 'plannedMs')),
    focusMs: toCount(field(value, 'focusMs')),
    status: field(value, 'status') === 'stopped' ? 'stopped' : 'done',
    label: toText(field(value, 'label')),
    tags: toWords(field(value, 'tags')),
    projects: toWords(field(value, 'projects')),
    claudeMs: toCount(field(value, 'claudeMs')),
    prompts: toCount(field(value, 'prompts')),
  }
}

/** One round per start, the later record kept, oldest first. */
const sorted = (rounds: readonly Round[]): Round[] =>
  [...new Map(rounds.map((round) => [round.start, round])).values()].sort(
    (a, b) => a.start - b.start,
  )

/**
 * The history as the store keeps it. The stats before it kept each day's
 * totals alone: given those, they carry over as days with no rounds.
 */
export const toHistory = (stored: unknown, legacy?: unknown): History => {
  if (isRecord(stored)) {
    const rounds = field(stored, 'rounds')

    return {
      rounds: sorted(
        Array.isArray(rounds)
          ? rounds.map(toRound).filter((round): round is Round => round !== undefined)
          : [],
      ),
      days: toDays(field(stored, 'days')),
    }
  }

  return isRecord(legacy)
    ? { rounds: [], days: toDays(field(legacy, 'days')) }
    : EMPTY
}

const added = (days: Record<string, Day>, round: Round): void => {
  const day = dayOf(round.end)
  const kept = days[day] ?? NO_DAY

  days[day] = {
    rounds: kept.rounds + (round.status === 'done' ? 1 : 0),
    focusMs: kept.focusMs + round.focusMs,
  }
}

/** Rounds past `KEEP_DAYS`, or past the most the store holds, as day totals. */
const folded = (history: History, now: number): History => {
  const oldest = now - KEEP_DAYS * DAY_MS
  const extra = history.rounds.length - MAX_ROUNDS
  const isOld = (round: Round, index: number): boolean =>
    round.start < oldest || index < extra
  const old = history.rounds.filter(isOld)

  if (old.length === 0) {
    return history
  }

  const days = { ...history.days }
  old.forEach((round) => added(days, round))

  return {
    rounds: history.rounds.filter((round, index) => !isOld(round, index)),
    days,
  }
}

/** The history with `round` in it, in place of any of the same start. */
export const recorded = (
  history: History,
  round: Round,
  now: number,
): History =>
  folded({ ...history, rounds: sorted([...history.rounds, round]) }, now)

/** The history without the round that began at `start`. */
export const removed = (history: History, start: number): History => ({
  ...history,
  rounds: history.rounds.filter((round) => round.start !== start),
})

/**
 * Each day's rounds and focus, by the day a round ended: a round counts once
 * done, while the focus of a stopped one counts too.
 */
export const dayTotals = (history: History): Record<string, Day> => {
  const days = { ...history.days }
  history.rounds.forEach((round) => added(days, round))

  return days
}

export const totalOf = (days: Readonly<Record<string, Day>>): Day =>
  Object.values(days).reduce(
    (sum, day) => ({
      rounds: sum.rounds + day.rounds,
      focusMs: sum.focusMs + day.focusMs,
    }),
    NO_DAY,
  )

/** The rounds that ended on `day`, oldest first. */
export const roundsOn = (history: History, day: string): Round[] =>
  history.rounds.filter((round) => dayOf(round.end) === day)

/**
 * Days in a row with a focus round, up to today: a day that has none yet
 * does not break the row before it.
 */
export const streakOf = (
  days: Readonly<Record<string, Day>>,
  now: number,
): number => {
  const has = (daysBack: number): boolean =>
    (days[dayOf(now, daysBack)]?.rounds ?? 0) > 0
  const first = has(0) ? 0 : 1
  let streak = 0

  while (has(first + streak)) {
    streak += 1
  }

  return streak
}

/** The most days in a row there ever was a focus round. */
export const bestStreakOf = (days: Readonly<Record<string, Day>>): number => {
  let best = 0
  let run = 0
  let last = ''

  Object.keys(days)
    .filter((day) => (days[day]?.rounds ?? 0) > 0)
    .sort()
    .forEach((day) => {
      run = last !== '' && dayOf(noonOf(last), -1) === day ? run + 1 : 1
      best = Math.max(best, run)
      last = day
    })

  return best
}

/** `write the tests #auth #api` as a label and its tags. */
export const intentOf = (text: string): Intent => {
  const words = text.trim().split(/\s+/).filter((word) => word !== '')
  const tags = words
    .filter((word) => TAG.test(word))
    .map((word) => word.slice(1).toLowerCase())

  return {
    label: words.filter((word) => !TAG.test(word)).join(' '),
    tags: [...new Set(tags)],
  }
}

/** A label with its tags after it: `write the tests #auth`. */
export const intentText = ({ label, tags }: Intent): string =>
  [label, ...tags.map((tag) => `#${tag}`)].filter((word) => word !== '').join(' ')

/** A span in hours and minutes: `1h 5m`, `25m`. */
export const spanText = (ms: number): string => {
  const minutes = Math.round(ms / MINUTE_MS)
  const hours = Math.floor(minutes / 60)

  return hours > 0 ? `${hours}h ${minutes % 60}m` : `${minutes}m`
}

/** A count with its word: `1 round`, `3 rounds`. */
export const plural = (count: number, word: string): string =>
  `${count} ${count === 1 ? word : `${word}s`}`

/** A moment's hour and minute where the person is: `09:05`. */
const timeOf = (at: number): string => {
  const moment = new Date(at)

  return `${String(moment.getHours()).padStart(2, '0')}:${String(moment.getMinutes()).padStart(2, '0')}`
}

/** The names of `rounds` with the most focus first, each with its focus. */
const sharesOf = (
  rounds: readonly Round[],
  namesOf: (round: Round) => readonly string[],
): [string, number][] => {
  const focus = new Map<string, number>()

  rounds.forEach((round) =>
    namesOf(round).forEach((name) =>
      focus.set(name, (focus.get(name) ?? 0) + round.focusMs),
    ),
  )

  return [...focus.entries()].sort((a, b) => b[1] - a[1])
}

/** The last seven days in a line: what was done, Claude's part, and where. */
const weekText = (history: History, now: number): string => {
  const first = dayOf(now, 6)
  const rounds = history.rounds.filter((round) => dayOf(round.end) >= first)
  const focusMs = rounds.reduce((sum, round) => sum + round.focusMs, 0)

  if (rounds.length === 0 || focusMs === 0) {
    return ''
  }

  const done = rounds.filter((round) => round.status === 'done').length
  const claudeMs = rounds.reduce((sum, round) => sum + round.claudeMs, 0)
  const share = Math.round((claudeMs / focusMs) * 100)
  const top = (shares: [string, number][], prefix: string): string =>
    shares
      .slice(0, 3)
      .map(([name, ms]) => `${prefix}${name} ${spanText(ms)}`)
      .join(', ')
  const parts = [
    `Last 7 days: ${plural(done, 'round')} · ${spanText(focusMs)} of focus`,
    share > 0 ? `Claude worked ${share}% of it` : '',
    top(sharesOf(rounds, (round) => round.projects), ''),
    top(sharesOf(rounds, (round) => round.tags), '#'),
  ]

  return parts.filter((part) => part !== '').join(' · ')
}

/** The rounds so far, as `/pomodoro stats` answers. */
export const statsText = (history: History, now: number, goal: number): string => {
  const days = dayTotals(history)
  const total = totalOf(days)

  if (total.rounds === 0 && total.focusMs === 0) {
    return 'Pomodoro: no focus rounds yet. /pomodoro start begins one.'
  }

  const today = days[dayOf(now)] ?? NO_DAY
  const streak = streakOf(days, now)
  const best = bestStreakOf(days)
  const rows =
    streak > 0
      ? `${streak} ${streak === 1 ? 'day' : 'days'} in a row${best > streak ? `, best ${best}` : ''}`
      : best > 0
        ? `best ${plural(best, 'day')} in a row`
        : ''
  const line = [
    `Pomodoro: today ${today.rounds}${goal > 0 ? `/${goal}` : ''}`,
    `${spanText(today.focusMs)} of focus`,
    rows,
    `${plural(total.rounds, 'round')} and ${spanText(total.focusMs)} in all`,
  ]
    .filter((part) => part !== '')
    .join(' · ')
  const week = weekText(history, now)

  return week === '' ? line : `${line}\n${week}`
}

const roundLine = (round: Round): string => {
  const parts = [
    `${timeOf(round.start)}–${timeOf(round.end)}`,
    spanText(round.focusMs),
    round.status === 'stopped' ? 'stopped' : '',
    intentText(round),
    round.projects.join(', '),
    round.claudeMs > 0 ? `Claude ${spanText(round.claudeMs)}` : '',
    round.prompts > 0 ? plural(round.prompts, 'prompt') : '',
  ]

  return `  ${parts.filter((part) => part !== '').join(' · ')}`
}

/** A day's rounds one to a line, as `/pomodoro log` answers. */
export const logText = (history: History, day: string): string => {
  const rounds = roundsOn(history, day)
  const total = dayTotals(history)[day] ?? NO_DAY
  const head = `Pomodoro on ${day}: ${plural(total.rounds, 'round')} · ${spanText(total.focusMs)} of focus`

  if (rounds.length === 0) {
    return total.focusMs > 0
      ? `${head}, kept as a total with no rounds to list.`
      : `Pomodoro: no focus rounds on ${day}.`
  }

  return [head, ...rounds.map(roundLine)].join('\n')
}
