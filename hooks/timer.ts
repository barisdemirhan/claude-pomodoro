// The pomodoro itself, with nothing of Claude Code in it: what the timer is at
// a given moment and what it becomes. Every open session reads the same timer
// from the plugin's store, so all of it is told from the clock alone.

export type Plan = {
  focusMs: number
  breakMs: number
  longBreakMs: number
  // Focus rounds in a set: the long break comes after the last.
  rounds: number
}
export type Timer = {
  phase: 'idle' | 'focus' | 'break'
  // When the phase began, moved later by every pause it sat through.
  startedAt: number
  lengthMs: number
  // When it was paused: 0 while it runs.
  pausedAt: number
  // Focus rounds finished in this set.
  round: number
}
export type Day = { rounds: number; focusMs: number }
export type Stats = Day & { days: Record<string, Day> }
// What a moment makes of the timer: a break that begins, a focus round that
// begins, a pomodoro nobody was there for, or nothing.
export type Step = {
  timer: Timer
  event: 'none' | 'break' | 'focus' | 'stale'
  // How long the round that ended ran, for a break that begins.
  focusedMs: number
}

const SECOND_MS = 1000
const MINUTE_MS = 60 * SECOND_MS
const MAX_MINUTES = 600
const MAX_ROUNDS = 12
// A focus round that ran out waits this long for Claude to start working, so
// the break lands on a wait; after it the break begins anyway.
export const GRACE_MS = 5 * MINUTE_MS
// A phase this far past its end ran out with nobody there (the machine
// asleep, every session closed): the pomodoro is over.
export const STALE_MS = 30 * MINUTE_MS

export const IDLE: Timer = {
  phase: 'idle',
  startedAt: 0,
  lengthMs: 0,
  pausedAt: 0,
  round: 0,
}
const NO_STATS: Stats = { rounds: 0, focusMs: 0, days: {} }

const toCount = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : 0

const field = (value: object, key: string): unknown => Reflect.get(value, key)

const toMs = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.round(Math.min(value, MAX_MINUTES) * MINUTE_MS)
    : fallback * MINUTE_MS

/** The lengths the person set in the config menu, each a default when unset. */
export const planOf = (options: Readonly<Record<string, unknown>>): Plan => ({
  focusMs: toMs(options.focusMinutes, 25),
  breakMs: toMs(options.breakMinutes, 5),
  longBreakMs: toMs(options.longBreakMinutes, 15),
  rounds: Math.min(toCount(options.rounds) || 4, MAX_ROUNDS),
})

/** The timer as the store keeps it: idle when nothing there reads as one. */
export const toTimer = (value: unknown): Timer => {
  if (typeof value !== 'object' || value === null) {
    return IDLE
  }

  const phase = field(value, 'phase')

  if (phase !== 'focus' && phase !== 'break') {
    return IDLE
  }

  return {
    phase,
    startedAt: toCount(field(value, 'startedAt')),
    lengthMs: toCount(field(value, 'lengthMs')),
    pausedAt: toCount(field(value, 'pausedAt')),
    round: toCount(field(value, 'round')),
  }
}

const toDay = (value: unknown): Day =>
  typeof value === 'object' && value !== null
    ? {
        rounds: toCount(field(value, 'rounds')),
        focusMs: toCount(field(value, 'focusMs')),
      }
    : { rounds: 0, focusMs: 0 }

export const toStats = (value: unknown): Stats => {
  if (typeof value !== 'object' || value === null) {
    return NO_STATS
  }

  const days = field(value, 'days')

  return {
    ...toDay(value),
    days:
      typeof days === 'object' && days !== null
        ? Object.fromEntries(
            Object.entries(days).map(([day, kept]) => [day, toDay(kept)]),
          )
        : {},
  }
}

export const isPaused = (timer: Timer): boolean => timer.pausedAt > 0

const elapsedOf = (timer: Timer, now: number): number =>
  (isPaused(timer) ? timer.pausedAt : now) - timer.startedAt

/** What the phase has left: negative once it ran out. */
export const leftOf = (timer: Timer, now: number): number =>
  timer.lengthMs - elapsedOf(timer, now)

/** A focus round that begins now, `round` rounds of its set behind it. */
export const focused = (plan: Plan, now: number, round: number): Timer => ({
  phase: 'focus',
  startedAt: now,
  lengthMs: plan.focusMs,
  pausedAt: 0,
  round,
})

/** The break after the focus round `timer` is in: long after a set's last. */
export const rested = (timer: Timer, plan: Plan, now: number): Timer => {
  const round = timer.round + 1
  const isLong = round >= plan.rounds

  return {
    phase: 'break',
    startedAt: now,
    lengthMs: isLong ? plan.longBreakMs : plan.breakMs,
    pausedAt: 0,
    round: isLong ? 0 : round,
  }
}

export const paused = (timer: Timer, now: number): Timer => ({
  ...timer,
  pausedAt: now,
})

export const resumed = (timer: Timer, now: number): Timer => ({
  ...timer,
  startedAt: timer.startedAt + (now - timer.pausedAt),
  pausedAt: 0,
})

/** The phase after this one, begun now whatever the phase has left. */
export const skipped = (timer: Timer, plan: Plan, now: number): Timer => {
  if (timer.phase === 'focus') {
    return rested(timer, plan, now)
  }

  return timer.phase === 'break' ? focused(plan, now, timer.round) : timer
}

/**
 * What `now` makes of the timer. A break that ran out turns to focus at
 * once. A focus round that ran out turns to a break once Claude is working,
 * or `GRACE_MS` later when it is not.
 */
export const stepped = (
  timer: Timer,
  now: number,
  plan: Plan,
  isWorking: boolean,
): Step => {
  const over = -leftOf(timer, now)
  const kept: Step = { timer, event: 'none', focusedMs: 0 }

  if (timer.phase === 'idle' || isPaused(timer) || over < 0) {
    return kept
  }

  if (over > STALE_MS) {
    return { timer: IDLE, event: 'stale', focusedMs: 0 }
  }

  if (timer.phase === 'break') {
    return {
      timer: focused(plan, now, timer.round),
      event: 'focus',
      focusedMs: 0,
    }
  }

  if (!isWorking && over < GRACE_MS) {
    return kept
  }

  return {
    timer: rested(timer, plan, now),
    event: 'break',
    focusedMs: timer.lengthMs + Math.min(over, GRACE_MS),
  }
}

/** The day `now` falls on where the person is, as `2026-10-02`. */
export const dayOf = (now: number, daysBack = 0): string => {
  const at = new Date(now)
  const date = new Date(at.getFullYear(), at.getMonth(), at.getDate() - daysBack)
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')

  return `${date.getFullYear()}-${month}-${day}`
}

/** The stats with one more focus round, finished now, in them. */
export const counted = (stats: Stats, now: number, focusMs: number): Stats => {
  const day = dayOf(now)
  const today = stats.days[day] ?? { rounds: 0, focusMs: 0 }

  return {
    rounds: stats.rounds + 1,
    focusMs: stats.focusMs + focusMs,
    days: {
      ...stats.days,
      [day]: { rounds: today.rounds + 1, focusMs: today.focusMs + focusMs },
    },
  }
}

/**
 * Days in a row with a focus round, up to today: a day that has none yet
 * does not break the row before it.
 */
export const streakOf = (stats: Stats, now: number): number => {
  const has = (daysBack: number): boolean =>
    (stats.days[dayOf(now, daysBack)]?.rounds ?? 0) > 0
  const first = has(0) ? 0 : 1
  let streak = 0

  while (has(first + streak)) {
    streak += 1
  }

  return streak
}

/** What is left, to the second above: `18:42`, and `0:00` once run out. */
export const clockText = (ms: number): string => {
  const seconds = Math.ceil(Math.max(ms, 0) / SECOND_MS)

  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

/** A length in whole minutes, a fraction kept for one under ten: `5`, `1.5`. */
export const minutesText = (ms: number): string => {
  const minutes = ms / MINUTE_MS

  return String(minutes < 10 ? Math.round(minutes * 10) / 10 : Math.round(minutes))
}

const spanText = (ms: number): string => {
  const minutes = Math.round(ms / MINUTE_MS)
  const hours = Math.floor(minutes / 60)

  return hours > 0 ? `${hours}h ${minutes % 60}m` : `${minutes}m`
}

const roundText = (timer: Timer, plan: Plan): string =>
  `${timer.round + 1}/${plan.rounds}`

/** The timer as the prompt footer shows it: empty while no pomodoro is on. */
export const labelOf = (timer: Timer, now: number, plan: Plan): string => {
  if (timer.phase === 'idle') {
    return ''
  }

  const left = leftOf(timer, now)
  const clock = `${isPaused(timer) ? 'paused ' : ''}${clockText(left)}`

  if (timer.phase === 'break') {
    return `☕ ${clock}`
  }

  return left > 0 || isPaused(timer)
    ? `🍅 ${clock} · ${roundText(timer, plan)}`
    : `🍅 break due · ${roundText(timer, plan)}`
}

/** The timer in a sentence, as `/pomodoro` answers. */
export const statusText = (timer: Timer, now: number, plan: Plan): string => {
  if (timer.phase === 'idle') {
    return 'No pomodoro is on. /pomodoro start begins one.'
  }

  const left = leftOf(timer, now)
  const phase =
    timer.phase === 'break' ? 'break' : `focus ${roundText(timer, plan)}`

  if (isPaused(timer)) {
    return `Pomodoro: ${phase}, paused with ${clockText(left)} left. /pomodoro resume runs it on.`
  }

  return left > 0
    ? `Pomodoro: ${phase} · ${clockText(left)} left`
    : `Pomodoro: ${phase} is done · the break begins when Claude starts working`
}

/** The rounds so far in a sentence, as `/pomodoro stats` answers. */
export const statsText = (stats: Stats, now: number): string => {
  if (stats.rounds === 0) {
    return 'Pomodoro: no focus rounds yet. /pomodoro start begins one.'
  }

  const today = stats.days[dayOf(now)] ?? { rounds: 0, focusMs: 0 }
  const streak = streakOf(stats, now)
  const days = `${streak} ${streak === 1 ? 'day' : 'days'} in a row`
  const total = `${stats.rounds} ${stats.rounds === 1 ? 'round' : 'rounds'}`

  return `Pomodoro: today ${today.rounds} · ${spanText(today.focusMs)} of focus · ${days} · ${total} and ${spanText(stats.focusMs)} in all`
}
