import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

const MINUTE = 60_000
// Noon on 2 October 2026 where the test runs, far from either end of the day.
const NOON = new Date(2026, 9, 2, 12).getTime()
const SESSION = { cwd: '/', surface: 'terminal', isInteractive: true } as const
const FOOTER = {
  plugin: 'pomodoro',
  component: 'SessionMode',
  props: { modes: [] },
} as const
const TURN = { text: 'go', turnId: 'turn-1' } as const
const DONE = {
  answer: 'ok',
  durationMs: 1000,
  isAborted: false,
  turnId: 'turn-1',
  reason: 'answer',
} as const
const ASKING = {
  message: 'Claude needs your permission',
  notification_type: 'permission_prompt',
} as const
const FOCUS = { phase: 'focus', lengthMs: 25 * MINUTE, pausedAt: 0, round: 0 }
const BREAK = { phase: 'break', lengthMs: 5 * MINUTE, pausedAt: 0, round: 1 }

// `/pomodoro ...` as the person types it at the prompt.
const said = (args: string) =>
  ({
    command: 'pomodoro',
    args,
    origin: { kind: 'composer' },
    presentation: { isFullscreen: false, columns: 80 },
  }) as const

/**
 * The engine beneath the mod: its clock, the store every session of the
 * plugin shares, the footer's labels drawn as one line, and what the mod
 * asked it to show and to play.
 */
const world = (on: On, entries: Readonly<Record<string, unknown>> = {}) => {
  const clock = mock.clock(on, { now: NOON })
  const store = new Map(Object.entries(entries))
  const toasts: string[] = []
  const clips: string[] = []

  on('store.get', (_$, e) => ({ value: store.get(e.key) }))
  on('store.set', (_$, e) => {
    store.set(e.key, JSON.parse(JSON.stringify(e.value)))

    return { value: undefined }
  })
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('ui.toast', (_$, e) => {
    toasts.push(e.text)

    return { value: undefined }
  })
  on('audio.play', (_$, e) => {
    clips.push(e.clip.asset ?? '')

    return { value: undefined }
  })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  on('classic.Notification', () => ({}))
  on('ui.render', { component: 'SessionMode' }, ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>{e.props.modes.join(' & ')}</Text>
  })

  return { clock, store, toasts, clips }
}

/** The footer's line as the terminal draws it now. */
const footer = async ($: Engine): Promise<string> => {
  const ui = await $.ui.mount({ ...FOOTER, surface: 'terminal' })
  const text = (await ui.find({ type: 'Text' }))?.text ?? ''
  await ui.unmount()

  return text
}

const run = async ($: Engine, args: string): Promise<string> =>
  (await $.command.run(said(args))).text ?? ''

test('the footer shows the round counting down on the terminal and the desktop', async ($, on) => {
  const { clock } = world(on)
  await $.session.start(SESSION)
  await run($, 'start')

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...FOOTER, surface })
    expect((await ui.find({ type: 'Text' }))?.text).toBe('🍅 25:00 · 1/4')
    await ui.unmount()
  }

  await clock.advance(MINUTE + 1000)
  expect(await footer($)).toBe('🍅 23:59 · 1/4')

  expect(await run($, 'stop')).toContain('Pomodoro is stopped')
  expect(await footer($)).toBe('')
})

test('a round that runs out while Claude works turns to a break at once', async ($, on) => {
  const { clock, toasts, clips } = world(on)
  await $.session.start(SESSION)
  await run($, 'start')
  await $.turn.start(TURN)

  await clock.advance(25 * MINUTE)
  expect(toasts).toEqual(['Take 5 while Claude works · 1/4 done'])
  expect(clips).toEqual(['sounds/break.wav'])
  expect(await footer($)).toBe('☕ 5:00')
  expect(await run($, 'stats')).toBe(
    'Pomodoro: today 1 · 25m of focus · 1 day in a row · 1 round and 25m in all',
  )
})

test('a round that runs out at an idle prompt waits for Claude to start working', async ($, on) => {
  const { clock, toasts } = world(on)
  await $.session.start(SESSION)
  await run($, 'start')

  await clock.advance(27 * MINUTE)
  expect(toasts).toEqual([])
  expect(await footer($)).toBe('🍅 break due · 1/4')

  await $.turn.start(TURN)
  expect(toasts).toEqual(['Take 5 while Claude works · 1/4 done'])
  expect(await footer($)).toBe('☕ 5:00')
  // The two minutes past the round's end were focus too.
  expect(await run($, 'stats')).toContain('today 1 · 27m of focus')
})

test('a round that ran out waits five minutes for a turn, then the break begins anyway', async ($, on) => {
  const { clock, toasts } = world(on)
  await $.session.start(SESSION)
  await run($, 'start')

  await clock.advance(30 * MINUTE - 1000)
  expect(toasts).toEqual([])

  await clock.advance(1000)
  expect(toasts).toEqual(['Take a 5 minute break · 1/4 done'])
})

test(
  'a break runs out into the next round, and the last round of a set earns the long break',
  { options: { rounds: 2 } },
  async ($, on) => {
    const { clock, toasts, clips } = world(on)
    await $.session.start(SESSION)
    await run($, 'start')
    await $.turn.start(TURN)

    await clock.advance(30 * MINUTE)
    expect(toasts.at(-1)).toBe('Break over · focus 2/2 is on')
    expect(clips.at(-1)).toBe('sounds/focus.wav')

    await clock.advance(25 * MINUTE)
    expect(toasts.at(-1)).toBe('Take 15 while Claude works · 2/2 done')
    expect(await footer($)).toBe('☕ 15:00')

    await clock.advance(15 * MINUTE)
    expect(toasts.at(-1)).toBe('Break over · focus 1/2 is on')
    expect(toasts).toHaveLength(4)
  },
)

test('a pause holds what is left until the round is resumed', async ($, on) => {
  const { clock, toasts } = world(on)
  await $.session.start(SESSION)
  await run($, 'start')
  await clock.advance(10 * MINUTE)

  expect(await run($, 'pause')).toContain('paused with 15:00 left')
  await clock.advance(60 * MINUTE)
  expect(await footer($)).toBe('🍅 paused 15:00 · 1/4')
  expect(toasts).toEqual([])

  await run($, 'resume')
  await clock.advance(14 * MINUTE)
  expect(await footer($)).toBe('🍅 1:00 · 1/4')
})

test('a skipped round turns to its break and is not counted', async ($, on) => {
  const { clock } = world(on)
  await $.session.start(SESSION)
  await run($, 'start')
  await clock.advance(10 * MINUTE)

  expect(await run($, 'skip')).toContain('Skipped to a 5 minute break')
  expect(await footer($)).toBe('☕ 5:00')
  expect(await run($, 'stats')).toContain('no focus rounds yet')
})

test('a pomodoro another session started shows here, and the break it turned is told without the sound', async ($, on) => {
  const { clock, store, toasts, clips } = world(on)
  await $.session.start(SESSION)
  expect(await footer($)).toBe('')

  // The other session writes to the store both read.
  store.set('timer', { ...FOCUS, startedAt: clock.now() })
  await clock.advance(5000)
  expect(await footer($)).toBe('🍅 24:55 · 1/4')

  store.set('timer', { ...BREAK, startedAt: clock.now() })
  await clock.advance(1000)
  expect(toasts).toEqual(['Take a 5 minute break · 1/4 done'])
  expect(clips).toEqual([])
  expect(await footer($)).toBe('☕ 4:59')
})

test('Claude finishing or asking during a break says what is left of it', async ($, on) => {
  const { clock, toasts } = world(on, {
    timer: { ...BREAK, startedAt: NOON },
  })
  await $.session.start(SESSION)
  await clock.advance(2 * MINUTE)

  // A subagent's turn ending is not Claude coming back to the person.
  await $.turn.complete({ ...DONE, agentId: 'agent-1' })
  expect(toasts).toEqual([])

  await $.turn.complete(DONE)
  await $.classic.Notification(ASKING)
  expect(toasts).toEqual([
    'Claude is done · 3:00 of break left',
    'Claude needs you · 3:00 of break left',
  ])
})

test('a turn that ends during focus says nothing', async ($, on) => {
  const { toasts } = world(on)
  await $.session.start(SESSION)
  await run($, 'start')

  await $.turn.complete(DONE)
  await $.classic.Notification(ASKING)
  expect(toasts).toEqual([])
})

test('a round that ran out with nobody there stops the pomodoro and counts nothing', async ($, on) => {
  const { toasts } = world(on, {
    timer: { ...FOCUS, startedAt: NOON - 120 * MINUTE },
  })
  await $.session.start(SESSION)

  expect(toasts).toEqual(['Pomodoro stopped · nobody was here'])
  expect(await footer($)).toBe('')
  expect(await run($, 'stats')).toContain('no focus rounds yet')
})

test('the stats count the days in a row up to today, a day with no round yet not breaking the row', async ($, on) => {
  world(on, {
    stats: {
      rounds: 6,
      focusMs: 150 * MINUTE,
      days: {
        '2026-09-27': { rounds: 1, focusMs: 25 * MINUTE },
        '2026-09-30': { rounds: 2, focusMs: 50 * MINUTE },
        '2026-10-01': { rounds: 3, focusMs: 75 * MINUTE },
      },
    },
  })

  expect(await run($, 'stats')).toBe(
    'Pomodoro: today 0 · 0m of focus · 2 days in a row · 6 rounds and 2h 30m in all',
  )
})

test('/pomodoro sound off keeps the toast and drops the sound', async ($, on) => {
  const { clock, toasts, clips } = world(on)
  await $.session.start(SESSION)
  expect(await run($, 'sound off')).toBe('Pomodoro sound is off.')
  await run($, 'start')
  await $.turn.start(TURN)

  await clock.advance(25 * MINUTE)
  expect(toasts).toHaveLength(1)
  expect(clips).toEqual([])

  expect(await run($, 'sound')).toBe('Pomodoro sound is on.')
  expect(await run($, 'nap')).toContain('Usage: /pomodoro')
})
