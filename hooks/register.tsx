import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderElement, RenderNode } from 'claude-code'

import {
  currentTextOf,
  historyWith,
  historyWithout,
  hookEnvOf,
  hookPathOf,
  pomodoroDirOf,
  readCurrentText,
} from './automation'
import type { HookContext, PomodoroEvent } from './automation'
import { EXPORT_FORMATS, exportText } from './export'
import {
  dayOf,
  dayTotals,
  intentOf,
  intentText,
  logText,
  plural,
  recorded,
  removed,
  spanText,
  statsText,
  toHistory,
} from './history'
import type { History, Round, RoundStatus } from './history'
import { entryOfRound } from './openpomodoro'
import type { OpenPomodoro } from './openpomodoro'
import { REPORT_OPEN, registerReport } from './report'
import {
  IDLE,
  clockText,
  extended,
  focusOf,
  focused,
  intended,
  isPaused,
  labelOf,
  leftOf,
  minutesText,
  paused,
  pausedOf,
  planOf,
  rested,
  resumed,
  returned,
  roundText,
  skipped,
  statusText,
  stepped,
  toTimer,
} from './timer'
import type { Plan, Timer } from './timer'
import { ACTIONS, TOOLS } from './tools'
import { field, isRecord, toCount, toWords } from './values'

// What Claude did in this session while the person was on a break.
type Away = { turns: number; asks: number }
// What this session knows that the shared timer does not.
type Session = {
  // The session's own id, naming its tally in the store.
  id: string
  isWorking: boolean
  // When Claude's turn here began: 0 while it is not working.
  turnAt: number
  // The focus round the turn began in, and how long that round had sat
  // paused then: what the turn's time inside the round leaves out.
  turnRound: number
  turnPausedMs: number
  // The timer as this session last saw it.
  seen: Timer | undefined
  // The history's revision as this session last drew it.
  revision: number
  // The repository or folder this session works in, by name.
  project: string
  away: Away
}
// What a focus round gathers in one session while it runs, each session
// under a key of its own: counting a prompt never writes over a phase or a
// count another session wrote.
type Tally = {
  start: number
  prompts: number
  claudeMs: number
  projects: string[]
  // When a turn of Claude's that still runs began in this round: 0 for none.
  turnAt: number
}
// How the person wants to hear it.
type Sound = { gain: number; isSpoken: boolean }
// What the person let the mod do outside its own store: keep Open
// Pomodoro's files in `~/.pomodoro`, and run the hook scripts kept there.
type Outside = { isMirrored: boolean; isScripted: boolean }
type Ways = { sound: Sound; outside: Outside }
// When the buttons under the hint line show: always, only while a pomodoro
// is on, or never.
type ControlRow = 'always' | 'running' | 'off'
// One of the timer's buttons: the `/pomodoro` word it says, and its label.
type Control = { verb: string; label: string }

const TIMER = 'timer'
const HISTORY = 'history'
// The stats before the history was kept: each day's totals alone.
const STATS = 'stats'
const MUTED = 'isMuted'
// Whether the timer's row of buttons is open: it is until closed.
const CONTROLS_OPEN = 'areControlsOpen'
// When the person last did something, in any session.
const ACTIVE = 'activeAt'
// Each session's tally is under this, then the session's id.
const TALLY = 'tally.'
const UNDO = 'undo'
// The focus rounds lately ended, so a `~/.pomodoro/current` left behind
// brings none of them back in any session.
const ENDED = 'ended'
const MAX_ENDED = 20
// Counts the history's changes, so each session's open report draws again.
const REVISION = 'revision'
const TICK_MS = 1000
// With no pomodoro on, the store is read this many ticks apart: how soon one
// started in another session shows here.
const IDLE_TICKS = 5
const TOAST_MS = 8000
const MINUTE_MS = 60_000
// A round stopped before this much focus is not worth a line in the history.
const MIN_ROUND_MS = MINUTE_MS
// How long after a change `/pomodoro undo` can still take it back.
const UNDO_MS = 5 * MINUTE_MS
const MAX_EXTEND_MINUTES = 120
// How long a hook script of the person's may run.
const SCRIPT_MS = 10_000
// The notices Claude Code sends when it waits on the person's answer.
const WAITING = ['permission_prompt', 'elicitation_dialog']
// Where a prompt the person sent themselves comes from.
const PERSON = ['composer', 'bridge']
const CLIPS = { break: 'sounds/break.wav', focus: 'sounds/focus.wav' } as const
const USAGE =
  'Usage: /pomodoro [start [what #tag]], pause, resume, skip, finish, stop, extend [minutes], note [what #tag], undo, stats, report, log [today|yesterday|YYYY-MM-DD], export [json|csv|ical] [file], sound [on|off] or controls [on|off].'
const TIMER_VERBS = ['', 'start', 'pause', 'resume', 'skip', 'finish', 'stop', 'extend', 'note', 'undo']
// The verbs that take no words after them.
const BARE_VERBS = ['', 'pause', 'skip', 'finish', 'stop', 'undo']
const SWITCH: Readonly<Record<string, boolean>> = { on: true, off: false }
const CONTROL_ROWS: readonly ControlRow[] = ['always', 'running', 'off']
const NOBODY: Away = { turns: 0, asks: 0 }

// Bumped each time a round is recorded, so an open report pane draws again.
const historyVersion = atom(
  { plugin: 'pomodoro', key: 'historyVersion' } as const,
  0,
)
const label = atom({ plugin: 'pomodoro', key: 'label' } as const, '')

const controlRowOf = (options: Readonly<Record<string, unknown>>): ControlRow =>
  CONTROL_ROWS.find((row) => row === options.controls) ?? 'always'

const outsideOf = (options: Readonly<Record<string, unknown>>): Outside => ({
  isMirrored: options.openPomodoro === true,
  isScripted: options.scriptHooks === true,
})

const soundOf = (options: Readonly<Record<string, unknown>>): Sound => ({
  gain:
    typeof options.volume === 'number' && Number.isFinite(options.volume)
      ? Math.min(Math.max(options.volume, 0), 100) / 100
      : 0.5,
  isSpoken: options.voice === true,
})

const ring = async (
  $: EngineInterface,
  sound: Sound,
  clip: keyof typeof CLIPS,
  words: string,
): Promise<void> => {
  if ((await $.store.get(MUTED)) === true) {
    return
  }

  // A machine with no player has no sound; the timer runs on without it.
  await $.audio.play({ asset: CLIPS[clip] }, { gain: sound.gain }).catch(() => undefined)

  if (sound.isSpoken) {
    await $.audio.speak(words).catch(() => undefined)
  }
}

/**
 * What to say of a break that begins: its length, and that now is the time.
 * A toast is a box forty cells wide, so each of these stays one line of it.
 */
const breakText = (
  before: Timer,
  after: Timer,
  plan: Plan,
  isWorking: boolean,
): string => {
  const done = `${roundText(before, plan)} done`
  const minutes = minutesText(after.lengthMs)

  return isWorking
    ? `Take ${minutes} while Claude works · ${done}`
    : `Take a ${minutes} minute break · ${done}`
}

const focusText = (timer: Timer, plan: Plan): string =>
  `Break over · focus ${roundText(timer, plan)} is on`

const dueText = (timer: Timer, plan: Plan): string =>
  `Break's over · focus ${roundText(timer, plan)} is next`

const awayText = ({ turns, asks }: Away): string => {
  const parts = [
    turns > 0 ? `${plural(turns, 'turn')} done` : '',
    asks > 0 ? `${plural(asks, 'ask')} for you` : '',
  ].filter((part) => part !== '')

  return parts.length === 0 ? '' : `Meanwhile: ${parts.join(' · ')}`
}

/** Says what Claude did here while the person was away, and starts over. */
const welcomed = ($: EngineInterface, session: Session): void => {
  const text = awayText(session.away)

  if (text !== '') {
    $.ui.toast(text, { timeoutMs: TOAST_MS })
  }

  session.away = NOBODY
}

const historyOf = async ($: EngineInterface): Promise<History> =>
  toHistory(await $.store.get(HISTORY), await $.store.get(STATS))

const toTally = (value: unknown, start: number): Tally =>
  isRecord(value) && toCount(field(value, 'start')) === start
    ? {
        start,
        prompts: toCount(field(value, 'prompts')),
        claudeMs: toCount(field(value, 'claudeMs')),
        projects: toWords(field(value, 'projects')),
        turnAt: toCount(field(value, 'turnAt')),
      }
    : { start, prompts: 0, claudeMs: 0, projects: [], turnAt: 0 }

const tallyKey = (session: Session): string => `${TALLY}${session.id}`

const toStarts = (value: unknown): number[] =>
  Array.isArray(value) ? value.map(toCount).filter((start) => start > 0) : []

/**
 * How long Claude's turn here has worked inside the focus round so far, the
 * round's pauses since the turn began left out: 0 with no turn running.
 */
const workingOf = (session: Session, timer: Timer, now: number): number => {
  if (session.turnAt === 0) {
    return 0
  }

  const pausedMs =
    pausedOf(timer, now) - (session.turnRound === timer.beganAt ? session.turnPausedMs : 0)

  return Math.max(now - Math.max(session.turnAt, timer.beganAt) - pausedMs, 0)
}

/**
 * What every session gathered in the focus round `timer` is, summed: a turn
 * of Claude's still running in another session counted up to now.
 */
const talliesOf = async (
  $: EngineInterface,
  session: Session,
  timer: Timer,
  now: number,
): Promise<Tally> => {
  const start = timer.beganAt
  const own = tallyKey(session)
  const keys = (await $.store.keys()).filter((key) => key.startsWith(TALLY))
  let sum: Tally = toTally(undefined, start)

  for (const key of keys) {
    const tally = toTally(await $.store.get(key), start)
    const running =
      key === own || tally.turnAt === 0 ? 0 : Math.max(now - Math.max(tally.turnAt, start), 0)

    sum = {
      ...sum,
      prompts: sum.prompts + tally.prompts,
      claudeMs: sum.claudeMs + tally.claudeMs + running,
      projects: [...new Set([...sum.projects, ...tally.projects])],
    }
  }

  return { ...sum, claudeMs: sum.claudeMs + workingOf(session, timer, now) }
}

/** Drops every session's tally of a round that is over: the one that began at `start`, or before. */
const cleared = async ($: EngineInterface, start: number): Promise<void> => {
  const keys = (await $.store.keys()).filter((key) => key.startsWith(TALLY))

  for (const key of keys) {
    const value = await $.store.get(key)

    if (!isRecord(value) || toCount(field(value, 'start')) <= start) {
      await $.store.delete(key)
    }
  }
}

/** Marks the focus round that began at `start` as ended, for every session. */
const buried = async ($: EngineInterface, start: number): Promise<void> => {
  const ended = toStarts(await $.store.get(ENDED)).filter((kept) => kept !== start)

  await $.store.set(ENDED, [...ended, start].slice(-MAX_ENDED))
}

/** Keeps the history, and counts the change so every open report draws again. */
const saved = async (
  $: EngineInterface,
  session: Session,
  history: History,
): Promise<void> => {
  const revision = toCount(await $.store.get(REVISION)) + 1

  await $.store.set(HISTORY, history)
  await $.store.set(REVISION, revision)
  session.revision = revision
  await update($, historyVersion, (version) => version + 1)
}

/**
 * Writes `after` in place of `before`, unless another session changed the
 * timer since `before` was read: then nothing is written, and the change and
 * all it sets going are that session's. The store has no compare-and-set,
 * so this narrows the race to the moment between the two calls.
 */
const swapped = async (
  $: EngineInterface,
  before: Timer,
  after: Timer,
): Promise<boolean> => {
  const now = toTimer(await $.store.get(TIMER))

  if (JSON.stringify(now) !== JSON.stringify(before)) {
    return false
  }

  await $.store.set(TIMER, after)

  return true
}

/** Draws the timer's label again, if the timer reads otherwise by now. */
const shown = async (
  $: EngineInterface,
  timer: Timer,
  plan: Plan,
): Promise<void> => {
  const text = labelOf(timer, await $.clock.now(), plan)

  if ((await read($, label)) !== text) {
    await update($, label, () => text)
  }
}

/** Keeps `timer` as the one every session reads, and shows it here. */
const turned = async (
  $: EngineInterface,
  session: Session,
  plan: Plan,
  timer: Timer,
): Promise<void> => {
  await $.store.set(TIMER, timer)
  session.seen = timer
  await shown($, timer, plan)
}

/**
 * Writes the focus round `timer` was into the history, with what it
 * gathered while it ran: none for a stop too short to keep.
 */
const archived = async (
  $: EngineInterface,
  session: Session,
  timer: Timer,
  now: number,
  status: RoundStatus,
): Promise<Round | undefined> => {
  const focusMs = Math.round(focusOf(timer, now))

  if (timer.phase !== 'focus') {
    return undefined
  }

  await buried($, timer.beganAt)

  if (status === 'stopped' && focusMs < MIN_ROUND_MS) {
    await cleared($, timer.beganAt)

    return undefined
  }

  const tally = await talliesOf($, session, timer, now)
  const round: Round = {
    start: timer.beganAt,
    end: now,
    plannedMs: timer.lengthMs,
    focusMs,
    status,
    label: timer.label,
    tags: timer.tags,
    projects:
      tally.projects.length > 0 || session.project === ''
        ? tally.projects
        : [session.project],
    claudeMs: Math.min(focusMs, tally.claudeMs),
    prompts: tally.prompts,
  }

  await saved($, session, recorded(await historyOf($), round, now))
  await cleared($, timer.beganAt)

  return round
}

/**
 * Keeps what `/pomodoro undo` takes back: the timer before, the round
 * written, and which phase the change made, so that an undo after anything
 * else changed the phase takes nothing back.
 */
const remembered = async (
  $: EngineInterface,
  before: Timer,
  after: Timer,
  now: number,
  round?: Round,
): Promise<void> =>
  $.store.set(UNDO, {
    timer: before,
    phase: after.phase,
    beganAt: after.beganAt,
    at: now,
    start: round?.start ?? 0,
  })

/** Tells the person the day's goal is met, on the round that met it. */
const goalMet = async (
  $: EngineInterface,
  plan: Plan,
  round: Round | undefined,
  now: number,
): Promise<void> => {
  if (plan.dailyGoal === 0 || round?.status !== 'done') {
    return
  }

  const today = dayTotals(await historyOf($))[dayOf(now)]

  if (today?.rounds === plan.dailyGoal) {
    $.ui.toast(`Daily goal reached · ${plural(plan.dailyGoal, 'round')} 🎯`, {
      timeoutMs: TOAST_MS,
    })
  }
}

/** The `~/.pomodoro` folder the Open Pomodoro tools share: none without a home. */
const sharedDir = async ($: EngineInterface): Promise<string | undefined> => {
  const home = await $.env.get('HOME')

  return home === undefined || home === '' ? undefined : pomodoroDirOf(home)
}

/** A focus round as Open Pomodoro's `current` file holds it. */
const entryOf = (timer: Timer): OpenPomodoro => ({
  start: timer.beganAt,
  // Open Pomodoro has no pause: the round ends that much later instead.
  minutes: Math.max(1, Math.round((timer.lengthMs + timer.startedAt - timer.beganAt) / MINUTE_MS)),
  description: timer.label,
  tags: timer.tags,
})

/**
 * What a change of the timer is to Open Pomodoro's hooks, in their order:
 * the phase that ends stops, and the one that begins starts or breaks.
 */
const eventsOf = (before: Timer, after: Timer): PomodoroEvent[] => {
  if (before.phase === after.phase && before.beganAt === after.beganAt) {
    // A break that ran out stops there, though its round waits for the person.
    return before.phase === 'break' && !before.isDue && after.isDue ? ['stop'] : []
  }

  const hasStopped = before.phase === 'idle' || (before.phase === 'break' && before.isDue)
  const ends: PomodoroEvent[] = hasStopped ? [] : ['stop']
  const begins: PomodoroEvent[] =
    after.phase === 'focus' ? ['start'] : after.phase === 'break' ? ['break'] : []

  return [...ends, ...begins]
}

const contextOf = (timer: Timer, plan: Plan): HookContext => ({
  phase: timer.phase,
  // A break's round is the one just done; the long break's, the set's last.
  round:
    timer.phase === 'focus' ? timer.round + 1 : timer.round === 0 ? plan.rounds : timer.round,
  rounds: plan.rounds,
  minutes: timer.phase === 'idle' ? 0 : Math.round(timer.lengthMs / MINUTE_MS),
  description: timer.label,
  tags: timer.tags,
})

/** Runs the person's `~/.pomodoro/hooks/<event>` script, if they keep one. */
const scripted = async (
  $: EngineInterface,
  dir: string,
  event: PomodoroEvent,
  context: HookContext,
): Promise<void> => {
  const path = hookPathOf(dir, event)
  const kind = (await $.fs.stat(path).catch(() => undefined))?.kind

  if (kind !== 'file') {
    return
  }

  const ran = await $.process
    .run([path], { env: hookEnvOf(dir, event, context), timeoutMs: SCRIPT_MS })
    .catch(() => undefined)

  if (ran?.exitCode !== 0) {
    $.ui.log(
      `pomodoro: hooks/${event} ${ran === undefined ? 'did not run' : `exited with ${ran.exitCode}`}`,
      { to: 'debug' },
    )
  }
}

/**
 * Tells the world outside the store of a change this session made to the
 * timer: Open Pomodoro's `current` and `history` files, then the person's
 * hook scripts. Nothing here can stop the timer: a failure is logged.
 */
const announced = async (
  $: EngineInterface,
  plan: Plan,
  outside: Outside,
  before: Timer,
  after: Timer,
  round: Round | undefined,
  removed: number,
): Promise<void> => {
  const dir = await sharedDir($)

  if (dir === undefined) {
    return
  }

  // A round that ended undone is cancelled, as the CLI cancels one: a line
  // the tool that began it wrote goes. So does a round an undo took back.
  const hasEnded =
    before.phase === 'focus' && (after.phase !== 'focus' || after.beganAt !== before.beganAt)
  const gone = removed > 0 ? removed : hasEnded && round?.status !== 'done' ? before.beganAt : 0

  try {
    if (outside.isMirrored && (round?.status === 'done' || gone > 0)) {
      const kept = await $.fs.read(`${dir}/history`).catch(() => '')
      const text =
        round?.status === 'done'
          ? historyWith(kept, entryOfRound(round))
          : historyWithout(kept, gone)

      if (text !== undefined) {
        await $.fs.write(`${dir}/history`, text)
      }
    }

    if (outside.isMirrored && (after.phase === 'focus' || before.phase === 'focus')) {
      const entry = after.phase === 'focus' ? entryOf(after) : undefined
      await $.fs.write(`${dir}/current`, currentTextOf(entry))
    }

    if (outside.isScripted) {
      for (const event of eventsOf(before, after)) {
        await scripted($, dir, event, contextOf(after, plan))
      }
    }
  } catch (error) {
    $.ui.log(`pomodoro: could not keep ${dir}: ${String(error)}`, { to: 'debug' })
  }
}

/** Sends word of a change on, once the change itself is kept. */
const told = (
  $: EngineInterface,
  plan: Plan,
  outside: Outside,
  before: Timer,
  after: Timer,
  round?: Round,
  removed = 0,
): void => {
  if (outside.isMirrored || outside.isScripted) {
    $.clock.after(1, () => {
      void announced($, plan, outside, before, after, round, removed)
    })
  }
}

/**
 * A pomodoro another Open Pomodoro tool began, read from `~/.pomodoro/current`
 * while none is on here: a focus round still running, and not one lately
 * ended here or the history holds.
 */
const picked = async (
  $: EngineInterface,
  plan: Plan,
  now: number,
): Promise<Timer | undefined> => {
  const dir = await sharedDir($)
  const text = dir === undefined ? '' : await $.fs.read(`${dir}/current`).catch(() => '')
  const entry = readCurrentText(text)

  if (entry === undefined || toStarts(await $.store.get(ENDED)).includes(entry.start)) {
    return undefined
  }

  const lengthMs = entry.minutes * MINUTE_MS
  const isKept = (await historyOf($)).rounds.some((round) => round.start === entry.start)

  if (isKept || entry.start > now || entry.start + lengthMs <= now) {
    return undefined
  }

  return {
    ...focused(plan, entry.start, { round: 0, label: entry.description, tags: entry.tags }),
    lengthMs,
  }
}

/**
 * Brings this session up to the shared timer. A phase that ran out is
 * turned here, with a toast and a sound; one another session turned is
 * told with the toast alone, the sound being that session's to play.
 */
const synced = async (
  $: EngineInterface,
  session: Session,
  plan: Plan,
  { sound, outside }: Ways,
): Promise<void> => {
  const now = await $.clock.now()
  const stored = toTimer(await $.store.get(TIMER))
  const found =
    outside.isMirrored && stored.phase === 'idle'
      ? await picked($, plan, now)
      : undefined

  if (found !== undefined && (await swapped($, stored, found))) {
    $.ui.toast('Picked up a pomodoro from ~/.pomodoro')
  }

  const revision = toCount(await $.store.get(REVISION))

  if (revision !== session.revision) {
    session.revision = revision
    await update($, historyVersion, (version) => version + 1)
  }

  const before = toTimer(await $.store.get(TIMER))
  const activeAt = toCount(await $.store.get(ACTIVE))
  const moment = { now, isWorking: session.isWorking, activeAt }
  const { timer, event } = stepped(before, moment, plan)
  const was = session.seen

  // Another session turned it first: the next tick shows what it made.
  if (event !== 'none' && !(await swapped($, before, timer))) {
    return
  }

  if (event === 'break') {
    const round = await archived($, session, before, now, 'done')
    await remembered($, before, timer, now, round)
    told($, plan, outside, before, timer, round)
    $.ui.toast(breakText(before, timer, plan, session.isWorking), {
      timeoutMs: TOAST_MS,
    })
    session.away = NOBODY
    void ring($, sound, 'break', `Take a ${minutesText(timer.lengthMs)} minute break.`)
    await goalMet($, plan, round, now)
  } else if (event === 'due') {
    told($, plan, outside, before, timer)
    $.ui.toast(dueText(timer, plan), { timeoutMs: TOAST_MS })
    void ring($, sound, 'focus', 'The break is over.')
  } else if (event === 'focus') {
    await remembered($, before, timer, now)
    told($, plan, outside, before, timer)
    $.ui.toast(focusText(timer, plan), { timeoutMs: TOAST_MS })
    welcomed($, session)
    void ring($, sound, 'focus', `Focus round ${timer.round + 1}.`)
  } else if (event === 'stale') {
    if (before.phase === 'focus') {
      await buried($, before.beganAt)
    }

    told($, plan, outside, before, timer)
    $.ui.toast('Pomodoro stopped · nobody was here')
  } else if (was !== undefined && timer.beganAt > was.beganAt) {
    // Another session turned the phase; an undo, going back, is no news.
    if (was.phase === 'focus' && timer.phase === 'break') {
      $.ui.toast(breakText(was, timer, plan, session.isWorking), {
        timeoutMs: TOAST_MS,
      })
      session.away = NOBODY
    } else if (was.phase === 'break' && timer.phase === 'focus') {
      $.ui.toast(focusText(timer, plan), { timeoutMs: TOAST_MS })
      welcomed($, session)
    }
  } else if (was?.phase === 'break' && !was.isDue && timer.isDue) {
    $.ui.toast(dueText(timer, plan), { timeoutMs: TOAST_MS })
  }

  session.seen = timer
  await shown($, timer, plan)
}

/** Counts a prompt of the person's into the focus round it came in. */
const tallied = async (
  $: EngineInterface,
  session: Session,
  timer: Timer,
): Promise<void> => {
  const key = tallyKey(session)
  const tally = toTally(await $.store.get(key), timer.beganAt)
  const isNew = session.project !== '' && !tally.projects.includes(session.project)

  await $.store.set(key, {
    ...tally,
    prompts: tally.prompts + 1,
    projects: isNew ? [...tally.projects, session.project] : tally.projects,
  })
}

/**
 * The person sent a prompt: they are here. A break that ran out and waits
 * for them turns to focus.
 */
const arrived = async (
  $: EngineInterface,
  session: Session,
  plan: Plan,
  outside: Outside,
): Promise<void> => {
  const now = await $.clock.now()
  const timer = toTimer(await $.store.get(TIMER))
  const back = returned(timer, plan, now)

  await $.store.set(ACTIVE, now)

  if (back !== undefined) {
    await turned($, session, plan, back)
    await remembered($, timer, back, now)
    told($, plan, outside, timer, back)
    $.ui.toast(`Welcome back · focus ${roundText(back, plan)} is on`, {
      timeoutMs: TOAST_MS,
    })
    welcomed($, session)
    await tallied($, session, back)
  } else if (timer.phase === 'focus' && !isPaused(timer)) {
    await tallied($, session, timer)
  }
}

/** Notes in this session's tally that a turn of Claude's began in the focus round. */
const began = async ($: EngineInterface, session: Session): Promise<void> => {
  const now = await $.clock.now()
  const timer = toTimer(await $.store.get(TIMER))
  const isFocus = timer.phase === 'focus'

  session.turnAt = now
  session.turnRound = isFocus ? timer.beganAt : 0
  session.turnPausedMs = isFocus ? pausedOf(timer, now) : 0

  if (isFocus) {
    const key = tallyKey(session)
    await $.store.set(key, { ...toTally(await $.store.get(key), timer.beganAt), turnAt: now })
  }
}

/**
 * Adds the part of Claude's turn that fell inside the focus round, its
 * pauses left out. A round that ended while the turn ran counted it then.
 */
const worked = async ($: EngineInterface, session: Session): Promise<void> => {
  const now = await $.clock.now()
  const timer = toTimer(await $.store.get(TIMER))
  const inside = workingOf(session, timer, now)

  session.turnAt = 0

  if (timer.phase !== 'focus') {
    return
  }

  const key = tallyKey(session)
  const tally = toTally(await $.store.get(key), timer.beganAt)

  await $.store.set(key, { ...tally, claudeMs: tally.claudeMs + inside, turnAt: 0 })
}

/** During a break, says that Claude asks for the person and what is left. */
const called = async (
  $: EngineInterface,
  session: Session,
  what: string,
  kind: keyof Away,
): Promise<void> => {
  const timer = toTimer(await $.store.get(TIMER))
  const left = leftOf(timer, await $.clock.now())

  if (timer.phase !== 'break' || isPaused(timer)) {
    return
  }

  session.away = { ...session.away, [kind]: session.away[kind] + 1 }
  $.ui.toast(
    `${what} · ${left > 0 ? `${clockText(left)} of break left` : 'the break is over'}`,
  )
}

/** `/pomodoro sound [on|off]`: the word's way, or the other way with no word. */
const soundText = async ($: EngineInterface, word: string): Promise<string> => {
  const isOn = word === '' ? (await $.store.get(MUTED)) === true : SWITCH[word]

  if (isOn === undefined) {
    return USAGE
  }

  await $.store.set(MUTED, !isOn)

  return `Pomodoro sound is ${isOn ? 'on' : 'off'}.`
}

/** The day `/pomodoro log` names: today with no word. */
const dayFrom = (word: string, now: number): string | undefined => {
  if (word === '' || word === 'today') {
    return dayOf(now)
  }

  if (word === 'yesterday') {
    return dayOf(now, 1)
  }

  return /^\d{4}-\d{2}-\d{2}$/.test(word) ? word : undefined
}

/**
 * What `/pomodoro undo` would take back now: the timer it holds now, the one
 * before the last change and the round that change wrote. Nothing once five
 * minutes have passed or the phase changed again.
 */
const undoOf = async (
  $: EngineInterface,
  now: number,
): Promise<{ was: Timer; timer: Timer; start: number } | undefined> => {
  const kept = await $.store.get(UNDO)
  const was = toTimer(await $.store.get(TIMER))

  if (
    !isRecord(kept) ||
    now - toCount(field(kept, 'at')) > UNDO_MS ||
    field(kept, 'phase') !== was.phase ||
    toCount(field(kept, 'beganAt')) !== was.beganAt
  ) {
    return undefined
  }

  return { was, timer: toTimer(field(kept, 'timer')), start: toCount(field(kept, 'start')) }
}

/** `/pomodoro undo`: the timer as it was before the last change, if lately. */
const undone = async (
  $: EngineInterface,
  session: Session,
  plan: Plan,
  outside: Outside,
  now: number,
): Promise<string> => {
  const undo = await undoOf($, now)

  if (undo === undefined) {
    return 'Pomodoro: nothing to undo.'
  }

  const { was, timer, start } = undo

  if (start > 0) {
    await saved($, session, removed(await historyOf($), start))
  }

  await $.store.set(UNDO, null)
  await turned($, session, plan, timer)
  told($, plan, outside, was, timer, undefined, start)

  return `Undid the last change. ${statusText(timer, now, plan)}`
}

/**
 * `tree` with `row` right under the hint line. The engine draws its line
 * over a tree's first row, and another mod's drawing may hold the line's
 * place first with rows of its own after it, or draw over the line from a
 * box of its own: `row` goes in right after that place, so what the others
 * drew stays where it was, under it or over the line.
 */
const under = (tree: RenderNode, row: RenderElement): RenderElement => {
  if (typeof tree === 'string' || tree.type !== 'Box' || tree.children === undefined) {
    return { type: 'Box', props: { flexDirection: 'column' }, children: [tree, row] }
  }

  const [first, ...rest] = tree.children
  const isLine = typeof first === 'string' || first?.type !== 'Box'

  if (first === undefined) {
    return { ...tree, children: [row] }
  }

  if (tree.props?.flexDirection === 'column' && isLine) {
    return { ...tree, children: [first, row, ...rest] }
  }

  return { ...tree, children: [under(first, row), ...rest] }
}

/** `/pomodoro controls [on|off]`: the word's way, or the other way with no word. */
const controlsText = async ($: EngineInterface, word: string): Promise<string> => {
  const isOn = word === '' ? (await $.store.get(CONTROLS_OPEN)) === false : SWITCH[word]

  if (isOn === undefined) {
    return USAGE
  }

  await $.store.set(CONTROLS_OPEN, isOn)

  return `Pomodoro controls are ${isOn ? 'on' : 'off'}. They show where there is a pointer: the fullscreen terminal and the desktop app.`
}

/**
 * The timer's buttons for where it stands, the one most likely wanted first:
 * the row draws the rest dim.
 */
const controlsOf = (timer: Timer, now: number): Control[] => {
  const stop = { verb: 'stop', label: '■ stop' }
  const more = { verb: 'extend', label: '+5m' }
  const pause = { verb: 'pause', label: '❚❚ pause' }

  if (timer.phase === 'idle') {
    return [{ verb: 'start', label: '▶ start' }]
  }

  if (isPaused(timer)) {
    return [{ verb: 'resume', label: '▶ resume' }, stop]
  }

  const isOver = leftOf(timer, now) <= 0

  if (timer.phase === 'break') {
    return isOver
      ? [{ verb: 'start', label: '▶ focus' }, stop]
      : [{ verb: 'skip', label: '▶ focus' }, more, pause, stop]
  }

  return isOver
    ? [{ verb: 'finish', label: '▶ break' }, more, stop]
    : [pause, more, { verb: 'finish', label: '✓ finish' }, stop]
}

const beganText = (timer: Timer, plan: Plan): string => {
  const intent = intentText(timer)
  const what = `${minutesText(plan.focusMs)} minutes of focus, round 1/${plan.rounds}${intent === '' ? '' : ` for ${intent}`}`

  return plan.breakStart === 'claude'
    ? `Pomodoro is on: ${what}. The break toast comes while Claude works.`
    : `Pomodoro is on: ${what}.`
}

/** Every `/pomodoro` word that acts on the timer; answers what it did. */
const commanded = async (
  $: EngineInterface,
  session: Session,
  plan: Plan,
  outside: Outside,
  verb: string,
  text: string,
): Promise<string> => {
  const now = await $.clock.now()
  const timer = toTimer(await $.store.get(TIMER))
  const intent = intentOf(text)

  await $.store.set(ACTIVE, now)

  if (verb === 'undo') {
    return undone($, session, plan, outside, now)
  }

  if (timer.phase === 'idle') {
    if (verb !== '' && verb !== 'start') {
      return statusText(timer, now, plan)
    }

    const begun = focused(plan, now, { round: 0, ...intent })
    await turned($, session, plan, begun)
    told($, plan, outside, timer, begun)

    return beganText(begun, plan)
  }

  if (verb === '') {
    return statusText(timer, now, plan)
  }

  if (verb === 'start' || verb === 'resume') {
    const held = text === '' ? timer : intended(timer, intent)
    const back = returned(held, plan, now)
    const running = back ?? (isPaused(held) ? resumed(held, now) : held)
    await turned($, session, plan, running)

    if (back !== undefined) {
      await remembered($, timer, back, now)
    }

    told($, plan, outside, timer, running)

    return statusText(running, now, plan)
  }

  if (verb === 'pause') {
    const held = isPaused(timer) ? timer : paused(timer, now)
    await turned($, session, plan, held)

    return statusText(held, now, plan)
  }

  if (verb === 'note') {
    const noted = intended(timer, intent)
    await turned($, session, plan, noted)
    told($, plan, outside, timer, noted)

    return text === ''
      ? 'Pomodoro: the note is cleared.'
      : `Pomodoro: the rounds are for ${intentText(intent)} now.`
  }

  if (verb === 'extend') {
    const minutes = text === '' ? 5 : Number(text)

    if (!Number.isInteger(minutes) || minutes < 1 || minutes > MAX_EXTEND_MINUTES) {
      return `Usage: /pomodoro extend [minutes], 1 to ${MAX_EXTEND_MINUTES}.`
    }

    const longer = extended(timer, now, minutes * MINUTE_MS)
    await turned($, session, plan, longer)
    told($, plan, outside, timer, longer)

    return `Added ${plural(minutes, 'minute')}. ${statusText(longer, now, plan)}`
  }

  // A round that ran its length is done, whatever ends it, paused or not.
  const status: RoundStatus =
    timer.phase === 'focus' && leftOf(timer, now) <= 0 ? 'done' : 'stopped'

  if (verb === 'finish' && timer.phase === 'focus') {
    const next = rested(timer, plan, now)
    const round = await archived($, session, timer, now, 'done')
    await turned($, session, plan, next)
    await remembered($, timer, next, now, round)
    told($, plan, outside, timer, next, round)
    await goalMet($, plan, round, now)

    return `Finished focus ${roundText(timer, plan)} after ${spanText(focusOf(timer, now))}: take a ${minutesText(next.lengthMs)} minute break.`
  }

  if (verb === 'skip' || verb === 'finish') {
    const next = skipped(timer, plan, now)
    const round = await archived($, session, timer, now, status)
    await turned($, session, plan, next)
    await remembered($, timer, next, now, round)
    told($, plan, outside, timer, next, round)

    if (next.phase === 'focus') {
      return `Skipped the break: focus ${roundText(next, plan)} is on.`
    }

    return status === 'done'
      ? `Focus ${roundText(timer, plan)} is done: take a ${minutesText(next.lengthMs)} minute break.`
      : `Skipped to a ${minutesText(next.lengthMs)} minute break. The round is not counted.`
  }

  const round = await archived($, session, timer, now, status)
  await turned($, session, plan, IDLE)
  await remembered($, timer, IDLE, now, round)
  told($, plan, outside, timer, IDLE, round)

  return 'Pomodoro is stopped. /pomodoro start begins a new set.'
}

/**
 * `/pomodoro export [format] [file]`: every round kept, to the clipboard, or
 * to the file named.
 */
const exported = async ($: EngineInterface, words: readonly string[]): Promise<string> => {
  const [kind = 'csv', path = '', ...more] = words
  const format = EXPORT_FORMATS.find((name) => name === kind.toLowerCase())

  if (format === undefined || more.length > 0) {
    return USAGE
  }

  const { rounds } = await historyOf($)
  const text = exportText(rounds, format)
  const what = `${plural(rounds.length, 'round')} as ${format.toUpperCase()}`

  if (path !== '') {
    const home = (await $.env.get('HOME')) ?? ''
    const file = path.startsWith('~/') && home !== '' ? `${home}${path.slice(1)}` : path
    const error = await $.fs.write(file, text).then(
      () => undefined,
      (failure: unknown) => String(failure),
    )

    return error === undefined
      ? `Wrote ${what} to ${path}.`
      : `Could not write ${path}: ${error}`
  }

  const copied = await $.ui.copy({ text })

  return copied.isCopied
    ? `Copied ${what} to the clipboard.`
    : `No clipboard to copy to here (${copied.reason}). /pomodoro export ${format} <file> writes them to a file.`
}

/** The name of the repository the session works in, or of its folder. */
const projectOf = async ($: EngineInterface): Promise<string> => {
  const repo = await $.session.repo().catch(() => null)
  const path = repo?.root ?? (await $.session.cwd().catch(() => ''))

  return path.split(/[\\/]/).filter((part) => part !== '').at(-1) ?? ''
}

export const register: Register = (on, options) => {
  const plan = planOf(options)
  const outside = outsideOf(options)
  const ways: Ways = { sound: soundOf(options), outside }
  const session: Session = {
    id: '',
    isWorking: false,
    turnAt: 0,
    turnRound: 0,
    turnPausedMs: 0,
    seen: undefined,
    revision: 0,
    project: '',
    away: NOBODY,
  }
  const hasTools = options.modelTools === true
  const controlRow = controlRowOf(options)
  let ticks = 0
  // One piece of work on the shared timer at a time: a tick and a turn that
  // starts in the same moment must not both turn the phase.
  let queue: Promise<unknown> = Promise.resolve()
  const inTurn = <T,>(work: () => Promise<T>): Promise<T> => {
    const run = queue.then(work, work)
    queue = run.catch(() => undefined)

    return run
  }

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'pomodoro',
      description: 'A pomodoro timer whose break toast lands while Claude works',
      argumentHint:
        '[start|pause|resume|skip|finish|stop|extend|note|undo|stats|report|log|export|sound|controls]',
    })
    session.id = await $.session.id().catch(() => String(Math.random()).slice(2))
    session.project = await projectOf($)

    if (hasTools) {
      for (const tool of TOOLS) {
        await $.tool.register(tool)
      }
    }

    await inTurn(() => synced($, session, plan, ways))
    $.clock.every(TICK_MS, () => {
      ticks += 1

      if (session.seen?.phase !== 'idle' || ticks % IDLE_TICKS === 0) {
        void inTurn(() => synced($, session, plan, ways))
      }
    })

    return next(e)
  })

  registerReport(on, async (get) => ({
    history: toHistory(await get(HISTORY), await get(STATS)),
    goal: plan.dailyGoal,
  }))

  on('command.run', { command: 'pomodoro' }, async ($, e) => {
    const [first = '', ...rest] = e.args.trim().split(/\s+/)
    const verb = first.toLowerCase()
    const text = rest.join(' ')
    const word = text.toLowerCase()

    if (verb === 'controls') {
      return { text: rest.length > 1 ? USAGE : await controlsText($, word) }
    }

    if (verb === 'sound') {
      return { text: rest.length > 1 ? USAGE : await soundText($, word) }
    }

    if (verb === 'stats') {
      if (text !== '') {
        return { text: USAGE }
      }

      return { text: statsText(await historyOf($), await $.clock.now(), plan.dailyGoal) }
    }

    if (verb === 'report') {
      if (text !== '') {
        return { text: USAGE }
      }

      await $.ui.open(REPORT_OPEN)

      return { text: 'Pomodoro report opened.' }
    }

    if (verb === 'export') {
      return { text: await exported($, rest) }
    }

    if (verb === 'log') {
      const day = rest.length > 1 ? undefined : dayFrom(word, await $.clock.now())

      return { text: day === undefined ? USAGE : logText(await historyOf($), day) }
    }

    if (!TIMER_VERBS.includes(verb) || (BARE_VERBS.includes(verb) && text !== '')) {
      return { text: USAGE }
    }

    return {
      text: await inTurn(() => commanded($, session, plan, outside, verb, text)),
    }
  })

  if (hasTools) {
    on('tool.call', { tool: 'mcp__pomodoro__stats' }, async ($, e) => {
      const now = await $.clock.now()
      const history = await historyOf($)
      const timer = toTimer(await $.store.get(TIMER))
      const day = dayFrom((e.day ?? '').trim().toLowerCase(), now) ?? dayOf(now)

      return {
        result: [
          statusText(timer, now, plan),
          statsText(history, now, plan.dailyGoal),
          logText(history, day),
        ].join('\n\n'),
      }
    })

    on('tool.call', { tool: 'mcp__pomodoro__timer' }, async ($, e) => {
      const action = e.action.trim().toLowerCase()

      if (!ACTIONS.includes(action)) {
        return { deny: `The action is one of: ${ACTIONS.join(', ')}.` }
      }

      return {
        result: await inTurn(() =>
          commanded($, session, plan, outside, action, (e.text ?? '').trim()),
        ),
      }
    })
  }

  // The person's own prompt says they are here, and is counted into the
  // round. Its words are never read: only where it came from.
  on('prompt.submit', async ($, e, next) => {
    if (PERSON.includes(e.origin.kind)) {
      await inTurn(() => arrived($, session, plan, outside))
    }

    return next(e)
  })

  // A focus round that ran out waits for this: the break begins as Claude
  // starts working, when the person has a wait ahead of them anyway.
  on('turn.start', async ($, e, next) => {
    session.isWorking = true
    await inTurn(() => began($, session))
    await inTurn(() => synced($, session, plan, ways))

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) {
      session.isWorking = false
      await inTurn(() => worked($, session))
      await called($, session, 'Claude is done', 'turns')
    }

    return next(e)
  })

  // Claude Code's own notice that it waits on the person. It is only read:
  // the notice goes on as it came, and what it asks stays theirs to answer.
  on('classic.Notification', async ($, e, next) => {
    if (WAITING.includes(e.notification_type)) {
      await called($, session, 'Claude needs you', 'asks')
    }

    return next(e)
  })

  // The timer at the end of the hint line under the prompt, where it takes no
  // row of its own. The hint's text is the engine's to draw: this only adds
  // to its tail, after what another mod put there. Where there is a pointer
  // to press with (the terminal's fullscreen layout, the desktop app), the
  // timer moves to a row of its own under the line instead, with buttons
  // beside it that act on it as `/pomodoro` does; the last closes the row,
  // and the timer goes back to the line.
  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    const text = await read($, label)
    const hasPointer = e.surface !== 'terminal' || e.viewport?.isFullscreen === true
    const isWanted = controlRow === 'always' || (controlRow === 'running' && text !== '')
    const isOpen = hasPointer && isWanted && (await $.store.get(CONTROLS_OPEN)) !== false

    if (!isOpen) {
      const before = e.props.tail ?? ''
      const tail = before === '' ? text : `${before} · ${text}`

      return text === '' || e.surface !== 'terminal'
        ? next(e)
        : next({ ...e, props: { ...e.props, tail } })
    }

    const line = await next(e)
    const now = await $.clock.now()
    const timer = toTimer(await $.store.get(TIMER))
    const isHeard = (await $.store.get(MUTED)) !== true
    const canUndo = (await undoOf($, now)) !== undefined
    const { Box, Button, Text } = $.ui.resolve(e)
    // What a button did shows on the row itself: a change the label does
    // not carry, the sound's or the undo's, is drawn again here.
    const said = (verb: string) => (): void => {
      void inTurn(() => commanded($, session, plan, outside, verb, '')).then(() =>
        $.ui.invalidate('ui.render'),
      )
    }

    return under(
      line,
      <Box columnGap={2} flexWrap="wrap">
        {/* The tomato leads the row whatever the timer says, so the row
            reads as the pomodoro's even with none on or on a break. */}
        <Text dimColor={text === ''}>
          {text === '' ? '🍅 pomodoro' : text.startsWith('🍅') ? text : `🍅 ${text}`}
        </Text>
        {controlsOf(timer, now).map((control, index) => (
          <Button
            key={control.verb}
            dimColor={index > 0}
            label={control.label}
            onPress={said(control.verb)}
          />
        ))}
        {canUndo && <Button key="undo" dimColor label="↶ undo" onPress={said('undo')} />}
        <Button
          key="sound"
          dimColor={!isHeard}
          label={`${isHeard ? '●' : '○'} sound`}
          onPress={() => {
            void soundText($, '').then(() => $.ui.invalidate('ui.render'))
          }}
        />
        <Button
          key="report"
          dimColor
          label="report"
          onPress={() => {
            void $.ui.open(REPORT_OPEN)
          }}
        />
        <Button
          key="close"
          dimColor
          label="×"
          onPress={() => {
            void controlsText($, 'off').then(() => $.ui.invalidate('ui.render'))
          }}
        />
      </Box>,
    )
  })

  // Only the terminal draws a hint's tail: elsewhere the timer goes among the
  // mode labels beside the hint line.
  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    const text = await read($, label)

    if (text === '' || e.surface === 'terminal') {
      return next(e)
    }

    return next({ ...e, props: { ...e.props, modes: [...e.props.modes, text] } })
  })
}
