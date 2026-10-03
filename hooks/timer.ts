// The pomodoro itself, with nothing of Claude Code in it: what the timer is at
// a given moment and what it becomes. Every open session reads the same timer
// from the plugin's store, so all of it is told from the clock alone.

import { intentText } from './history'
import type { Intent } from './history'
import { field, isRecord, toCount, toText, toWords } from './values'

export type FocusStart = 'prompt' | 'auto'
export type BreakStart = 'claude' | 'auto'
export type HintStyle = 'full' | 'dots' | 'minimal'
export type Plan = {
  focusMs: number
  breakMs: number
  longBreakMs: number
  // Focus rounds in a set: the long break comes after the last.
  rounds: number
  // Whether a break that ran out waits for the person's next prompt.
  focusStart: FocusStart
  // Whether a focus round that ran out waits for Claude to start working.
  breakStart: BreakStart
  // Rounds a day the person aims for: 0 for none.
  dailyGoal: number
  hint: HintStyle
}
export type Timer = {
  phase: 'idle' | 'focus' | 'break'
  // When the phase began, moved later by every pause it sat through.
  startedAt: number
  // When the phase began, unmoved: a focus round's name in the history.
  beganAt: number
  lengthMs: number
  // When it was paused: 0 while it runs.
  pausedAt: number
  // Focus rounds finished in this set.
  round: number
  // What the person said the rounds are for, kept from round to round.
  label: string
  tags: string[]
  // A focus round the clock began, with nobody there to see it begin.
  isUnattended: boolean
  // A break that ran out and waits for the person to come back.
  isDue: boolean
}
// What a session knows of the moment it looks at the timer.
export type Moment = {
  now: number
  // Whether Claude is working in the session that looks.
  isWorking: boolean
  // When the person last did something, in any session.
  activeAt: number
}
// What a moment makes of the timer: a break that begins, a break that ran
// out, a focus round that begins, a pomodoro nobody was there for, or nothing.
export type Step = {
  timer: Timer
  event: 'none' | 'break' | 'due' | 'focus' | 'stale'
  // How long the round that ended ran, for a break that begins.
  focusedMs: number
}

const SECOND_MS = 1000
const MINUTE_MS = 60 * SECOND_MS
const MAX_MINUTES = 600
const MAX_ROUNDS = 12
const FOCUS_STARTS: readonly FocusStart[] = ['prompt', 'auto']
const BREAK_STARTS: readonly BreakStart[] = ['claude', 'auto']
const HINT_STYLES: readonly HintStyle[] = ['full', 'dots', 'minimal']
// A focus round that ran out waits this long for Claude to start working, so
// the break lands on a wait; after it the break begins anyway.
export const GRACE_MS = 5 * MINUTE_MS
// A phase this far past its end ran out with nobody there: the pomodoro is
// over.
export const STALE_MS = 30 * MINUTE_MS

export const IDLE: Timer = {
  phase: 'idle',
  startedAt: 0,
  beganAt: 0,
  lengthMs: 0,
  pausedAt: 0,
  round: 0,
  label: '',
  tags: [],
  isUnattended: false,
  isDue: false,
}

const toMs = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.round(Math.min(value, MAX_MINUTES) * MINUTE_MS)
    : fallback * MINUTE_MS

const toChoice = <T extends string>(
  value: unknown,
  choices: readonly T[],
  fallback: T,
): T => choices.find((choice) => choice === value) ?? fallback

/** The lengths and ways the person set in the config menu, each a default when unset. */
export const planOf = (options: Readonly<Record<string, unknown>>): Plan => ({
  focusMs: toMs(options.focusMinutes, 25),
  breakMs: toMs(options.breakMinutes, 5),
  longBreakMs: toMs(options.longBreakMinutes, 15),
  rounds: Math.min(toCount(options.rounds) || 4, MAX_ROUNDS),
  focusStart: toChoice(options.focusStart, FOCUS_STARTS, 'prompt'),
  breakStart: toChoice(options.breakStart, BREAK_STARTS, 'claude'),
  dailyGoal: Math.min(toCount(options.dailyGoal), 99),
  hint: toChoice(options.hintStyle, HINT_STYLES, 'full'),
})

/** The timer as the store keeps it: idle when nothing there reads as one. */
export const toTimer = (value: unknown): Timer => {
  if (!isRecord(value)) {
    return IDLE
  }

  const phase = field(value, 'phase')

  if (phase !== 'focus' && phase !== 'break') {
    return IDLE
  }

  const startedAt = toCount(field(value, 'startedAt'))

  return {
    phase,
    startedAt,
    // A timer an earlier version kept has no unmoved start.
    beganAt: toCount(field(value, 'beganAt')) || startedAt,
    lengthMs: toCount(field(value, 'lengthMs')),
    pausedAt: toCount(field(value, 'pausedAt')),
    round: toCount(field(value, 'round')),
    label: toText(field(value, 'label')),
    tags: toWords(field(value, 'tags')),
    isUnattended: field(value, 'isUnattended') === true,
    isDue: field(value, 'isDue') === true,
  }
}

export const isPaused = (timer: Timer): boolean => timer.pausedAt > 0

const elapsedOf = (timer: Timer, now: number): number =>
  (isPaused(timer) ? timer.pausedAt : now) - timer.startedAt

/** What the phase has left: negative once it ran out. */
export const leftOf = (timer: Timer, now: number): number =>
  timer.lengthMs - elapsedOf(timer, now)

/** Whether the running phase ran out by `now`: a break waiting, a round due. */
export const isOver = (timer: Timer, now: number): boolean =>
  timer.phase !== 'idle' && !isPaused(timer) && leftOf(timer, now) <= 0

/** The focus a round has had by now: its run, and no more than `GRACE_MS` past its end. */
export const focusOf = (timer: Timer, now: number): number =>
  Math.max(0, Math.min(elapsedOf(timer, now), timer.lengthMs + GRACE_MS))

/** A focus round that begins now, after the rounds and for the intent given. */
export const focused = (
  plan: Plan,
  now: number,
  { round, label, tags }: Pick<Timer, 'round' | 'label' | 'tags'>,
  isUnattended = false,
): Timer => ({
  phase: 'focus',
  startedAt: now,
  beganAt: now,
  lengthMs: plan.focusMs,
  pausedAt: 0,
  round,
  label,
  tags,
  isUnattended,
  isDue: false,
})

/** The break after the focus round `timer` is in: long after a set's last. */
export const rested = (timer: Timer, plan: Plan, now: number): Timer => {
  const round = timer.round + 1
  const isLong = round >= plan.rounds

  return {
    ...timer,
    phase: 'break',
    startedAt: now,
    beganAt: now,
    lengthMs: isLong ? plan.longBreakMs : plan.breakMs,
    pausedAt: 0,
    round: isLong ? 0 : round,
    isUnattended: false,
    isDue: false,
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

/** The phase with `ms` more to run, counted from now once it ran out. */
export const extended = (timer: Timer, now: number, ms: number): Timer => ({
  ...timer,
  lengthMs: Math.max(timer.lengthMs, elapsedOf(timer, now)) + ms,
  isDue: false,
})

export const intended = (timer: Timer, intent: Intent): Timer => ({
  ...timer,
  ...intent,
})

/** The phase after this one, begun now whatever the phase has left. */
export const skipped = (timer: Timer, plan: Plan, now: number): Timer => {
  if (timer.phase === 'focus') {
    return rested(timer, plan, now)
  }

  return timer.phase === 'break' ? focused(plan, now, timer) : timer
}

/** A break that ran out, turned to focus now that the person is back. */
export const returned = (
  timer: Timer,
  plan: Plan,
  now: number,
): Timer | undefined =>
  timer.phase === 'break' && isOver(timer, now)
    ? focused(plan, now, timer)
    : undefined

/**
 * What the moment makes of the timer. A break that ran out turns to focus at
 * once, or waits for the person when `focusStart` is `prompt`. A focus round
 * that ran out turns to a break once Claude is working, or `GRACE_MS` later
 * when it is not. A round the clock began that nobody came to ends with no
 * round counted.
 */
export const stepped = (timer: Timer, moment: Moment, plan: Plan): Step => {
  const { now, isWorking, activeAt } = moment
  const over = -leftOf(timer, now)
  const kept: Step = { timer, event: 'none', focusedMs: 0 }

  if (timer.phase === 'idle' || isPaused(timer) || over < 0) {
    return kept
  }

  if (over > STALE_MS) {
    return { timer: IDLE, event: 'stale', focusedMs: 0 }
  }

  if (timer.phase === 'break') {
    if (plan.focusStart === 'auto') {
      return {
        timer: focused(plan, now, timer, true),
        event: 'focus',
        focusedMs: 0,
      }
    }

    return timer.isDue
      ? kept
      : { timer: { ...timer, isDue: true }, event: 'due', focusedMs: 0 }
  }

  if (timer.isUnattended && activeAt < timer.beganAt && !isWorking) {
    return { timer: IDLE, event: 'stale', focusedMs: 0 }
  }

  if (plan.breakStart === 'claude' && !isWorking && over < GRACE_MS) {
    return kept
  }

  return {
    timer: rested(timer, plan, now),
    event: 'break',
    focusedMs: focusOf(timer, now),
  }
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

/** The round a focus phase is, of its set: `2/4`. */
export const roundText = (timer: Timer, plan: Plan): string =>
  `${timer.round + 1}/${plan.rounds}`

/** The set's rounds as the `dots` hint draws them: `●●○○`, two done. */
const dotsText = (timer: Timer, plan: Plan): string =>
  '●'.repeat(Math.min(timer.round, plan.rounds)) +
  '○'.repeat(Math.max(plan.rounds - timer.round, 0))

const setText = (timer: Timer, plan: Plan): string => {
  if (plan.hint === 'minimal') {
    return ''
  }

  return plan.hint === 'dots'
    ? ` ${dotsText(timer, plan)}`
    : ` · ${roundText(timer, plan)}`
}

/** The timer as the hint line shows it: empty while no pomodoro is on. */
export const labelOf = (timer: Timer, now: number, plan: Plan): string => {
  if (timer.phase === 'idle') {
    return ''
  }

  const left = leftOf(timer, now)
  const clock = `${isPaused(timer) ? 'paused ' : ''}${clockText(left)}`
  const isRunning = left > 0 || isPaused(timer)

  if (timer.phase === 'break') {
    return isRunning ? `☕ ${clock}` : '☕ break over'
  }

  return `🍅 ${isRunning ? clock : 'break due'}${setText(timer, plan)}`
}

/** The timer in a sentence, as `/pomodoro` answers. */
export const statusText = (timer: Timer, now: number, plan: Plan): string => {
  if (timer.phase === 'idle') {
    return 'No pomodoro is on. /pomodoro start begins one.'
  }

  const left = leftOf(timer, now)
  const intent = intentText(timer)
  const phase = `${
    timer.phase === 'break' ? 'break' : `focus ${roundText(timer, plan)}`
  }${intent === '' ? '' : ` (${intent})`}`

  if (isPaused(timer)) {
    return `Pomodoro: ${phase}, paused with ${clockText(left)} left. /pomodoro resume runs it on.`
  }

  if (left > 0) {
    return `Pomodoro: ${phase} · ${clockText(left)} left`
  }

  return timer.phase === 'break'
    ? `Pomodoro: the break is over · focus ${roundText(timer, plan)} begins with your next prompt`
    : `Pomodoro: ${phase} is done · the break begins when Claude starts working`
}

/** How long the phase has sat paused so far, the pause it is in included. */
export const pausedOf = (timer: Timer, now: number): number =>
  timer.startedAt - timer.beganAt + (isPaused(timer) ? now - timer.pausedAt : 0)
