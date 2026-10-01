import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import {
  IDLE,
  clockText,
  counted,
  focused,
  isPaused,
  labelOf,
  leftOf,
  minutesText,
  paused,
  planOf,
  resumed,
  skipped,
  statsText,
  statusText,
  stepped,
  toStats,
  toTimer,
} from './timer'
import type { Plan, Timer } from './timer'

// What this session knows that the shared timer does not: whether Claude is
// working here, and the timer as this session last saw it.
type Session = { isWorking: boolean; seen: Timer | undefined }

const TIMER = 'timer'
const STATS = 'stats'
const MUTED = 'isMuted'
const TICK_MS = 1000
// With no pomodoro on, the store is read this many ticks apart: how soon one
// started in another session shows here.
const IDLE_TICKS = 5
const TOAST_MS = 8000
// The notices Claude Code sends when it waits on the person's answer.
const WAITING = ['permission_prompt', 'elicitation_dialog']
const CLIPS = { break: 'sounds/break.wav', focus: 'sounds/focus.wav' } as const
const USAGE =
  'Usage: /pomodoro [start], /pomodoro pause, /pomodoro resume, /pomodoro skip, /pomodoro stop, /pomodoro stats or /pomodoro sound [on|off].'
const SWITCH: Readonly<Record<string, boolean>> = { on: true, off: false }

const label = atom({ plugin: 'pomodoro', key: 'label' } as const, '')

const ring = async (
  $: EngineInterface,
  clip: keyof typeof CLIPS,
): Promise<void> => {
  if ((await $.store.get(MUTED)) !== true) {
    // A machine with no player has no sound; the timer runs on without it.
    await $.audio.play({ asset: CLIPS[clip] }, { gain: 0.5 }).catch(() => undefined)
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
  const done = `${before.round + 1}/${plan.rounds} done`
  const minutes = minutesText(after.lengthMs)

  return isWorking
    ? `Take ${minutes} while Claude works · ${done}`
    : `Take a ${minutes} minute break · ${done}`
}

const focusText = (timer: Timer, plan: Plan): string =>
  `Break over · focus ${timer.round + 1}/${plan.rounds} is on`

/** Draws the footer's label again, if the timer reads otherwise by now. */
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
 * Brings this session up to the shared timer. A phase that ran out is
 * turned here, with a toast and a sound; one another session turned is
 * told with the toast alone, the sound being that session's to play.
 */
const synced = async (
  $: EngineInterface,
  session: Session,
  plan: Plan,
): Promise<void> => {
  const now = await $.clock.now()
  const before = toTimer(await $.store.get(TIMER))
  const { timer, event, focusedMs } = stepped(before, now, plan, session.isWorking)
  const was = session.seen?.phase

  if (event === 'break') {
    await $.store.set(TIMER, timer)
    const stats = toStats(await $.store.get(STATS))
    await $.store.set(STATS, counted(stats, now, focusedMs))
    $.ui.toast(breakText(before, timer, plan, session.isWorking), {
      timeoutMs: TOAST_MS,
    })
    void ring($, 'break')
  } else if (event === 'focus') {
    await $.store.set(TIMER, timer)
    $.ui.toast(focusText(timer, plan), { timeoutMs: TOAST_MS })
    void ring($, 'focus')
  } else if (event === 'stale') {
    await $.store.set(TIMER, timer)
    $.ui.toast('Pomodoro stopped · nobody was here')
  } else if (was === 'focus' && timer.phase === 'break') {
    const ended = session.seen ?? before
    $.ui.toast(breakText(ended, timer, plan, session.isWorking), {
      timeoutMs: TOAST_MS,
    })
  } else if (was === 'break' && timer.phase === 'focus') {
    $.ui.toast(focusText(timer, plan), { timeoutMs: TOAST_MS })
  }

  session.seen = timer
  await shown($, timer, plan)
}

/** During a break, says that Claude asks for the person and what is left. */
const called = async ($: EngineInterface, what: string): Promise<void> => {
  const timer = toTimer(await $.store.get(TIMER))
  const left = leftOf(timer, await $.clock.now())

  if (timer.phase === 'break' && !isPaused(timer) && left > 0) {
    $.ui.toast(`${what} · ${clockText(left)} of break left`)
  }
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

/** Every `/pomodoro` word that acts on the timer; answers what it did. */
const commanded = async (
  $: EngineInterface,
  session: Session,
  plan: Plan,
  verb: string,
): Promise<string> => {
  const now = await $.clock.now()
  const timer = toTimer(await $.store.get(TIMER))

  if (timer.phase === 'idle') {
    if (verb !== '' && verb !== 'start') {
      return statusText(timer, now, plan)
    }

    await turned($, session, plan, focused(plan, now, 0))

    return `Pomodoro is on: ${minutesText(plan.focusMs)} minutes of focus, round 1/${plan.rounds}. The break toast comes while Claude works.`
  }

  if (verb === '') {
    return statusText(timer, now, plan)
  }

  if (verb === 'start' || verb === 'resume') {
    const running = isPaused(timer) ? resumed(timer, now) : timer
    await turned($, session, plan, running)

    return statusText(running, now, plan)
  }

  if (verb === 'pause') {
    const held = isPaused(timer) ? timer : paused(timer, now)
    await turned($, session, plan, held)

    return statusText(held, now, plan)
  }

  if (verb === 'skip') {
    const next = skipped(timer, plan, now)
    await turned($, session, plan, next)

    return next.phase === 'break'
      ? `Skipped to a ${minutesText(next.lengthMs)} minute break. The round is not counted.`
      : `Skipped the break: focus ${next.round + 1}/${plan.rounds} is on.`
  }

  await turned($, session, plan, IDLE)

  return 'Pomodoro is stopped. /pomodoro start begins a new set.'
}

export const register: Register = (on, options) => {
  const plan = planOf(options)
  const session: Session = { isWorking: false, seen: undefined }
  let ticks = 0
  // One piece of work on the shared timer at a time: a tick and a turn that
  // starts in the same moment must not both turn the phase.
  let queue: Promise<unknown> = Promise.resolve()
  const inTurn = <T>(work: () => Promise<T>): Promise<T> => {
    const run = queue.then(work, work)
    queue = run.catch(() => undefined)

    return run
  }

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'pomodoro',
      description: 'A pomodoro timer whose break toast lands while Claude works',
      argumentHint: '[start|pause|resume|skip|stop|stats|sound]',
    })
    await inTurn(() => synced($, session, plan))
    $.clock.every(TICK_MS, () => {
      ticks += 1

      if (session.seen?.phase !== 'idle' || ticks % IDLE_TICKS === 0) {
        void inTurn(() => synced($, session, plan))
      }
    })

    return next(e)
  })

  on('command.run', { command: 'pomodoro' }, async ($, e) => {
    const [verb = '', word = '', ...rest] = e.args
      .trim()
      .toLowerCase()
      .split(/\s+/)

    if (rest.length > 0) {
      return { text: USAGE }
    }

    if (verb === 'sound') {
      return { text: await soundText($, word) }
    }

    if (word !== '') {
      return { text: USAGE }
    }

    if (verb === 'stats') {
      const stats = toStats(await $.store.get(STATS))

      return { text: statsText(stats, await $.clock.now()) }
    }

    if (!['', 'start', 'pause', 'resume', 'skip', 'stop'].includes(verb)) {
      return { text: USAGE }
    }

    return { text: await inTurn(() => commanded($, session, plan, verb)) }
  })

  // A focus round that ran out waits for this: the break begins as Claude
  // starts working, when the person has a wait ahead of them anyway.
  on('turn.start', async ($, e, next) => {
    session.isWorking = true
    await inTurn(() => synced($, session, plan))

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) {
      session.isWorking = false
      await called($, 'Claude is done')
    }

    return next(e)
  })

  // Claude Code's own notice that it waits on the person. It is only read:
  // the notice goes on as it came, and what it asks stays theirs to answer.
  on('classic.Notification', async ($, e, next) => {
    if (WAITING.includes(e.notification_type)) {
      await called($, 'Claude needs you')
    }

    return next(e)
  })

  // The timer among the mode labels at the right of the prompt footer: the
  // row over the hint line, which the footer keeps whether a label is there
  // or not.
  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    const text = await read($, label)

    if (text === '') {
      return next(e)
    }

    return next({ ...e, props: { ...e.props, modes: [...e.props.modes, text] } })
  })
}
