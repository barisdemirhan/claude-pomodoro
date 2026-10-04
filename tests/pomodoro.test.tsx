import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { formatEntry } from '../hooks/openpomodoro'

const MINUTE = 60_000
// Noon on 2 October 2026 where the test runs, far from either end of the day.
const NOON = new Date(2026, 9, 2, 12).getTime()
const SESSION = { cwd: '/', surface: 'terminal', isInteractive: true } as const
// The hint line under the terminal's prompt, and the mode labels the desktop
// draws beside its own.
const HINT = {
  plugin: 'pomodoro',
  surface: 'terminal',
  component: 'PromptHint',
  props: { isDraft: false, isWorking: false, hint: '? for shortcuts' },
} as const
const MODES = {
  plugin: 'pomodoro',
  surface: 'desktop',
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
 * plugin shares, the hint line's tail and the mode labels drawn as text, and
 * what the mod asked it to show and to play.
 */
const world = (on: On, entries: Readonly<Record<string, unknown>> = {}) => {
  const clock = mock.clock(on, { now: NOON })
  const store = new Map(Object.entries(entries))
  const toasts: string[] = []
  const clips: string[] = []
  // Called on each read of the store, to stand for another session acting
  // between this session's reads.
  const spy = { get: (_key: string): void => undefined }
  // Rows another mod beneath draws under the hint line, as ambient does.
  const beneath = { rows: [] as string[] }

  on('store.get', (_$, e) => {
    spy.get(e.key)

    return { value: store.get(e.key) }
  })
  on('store.set', (_$, e) => {
    store.set(e.key, JSON.parse(JSON.stringify(e.value)))

    return { value: undefined }
  })
  on('store.keys', () => ({ value: [...store.keys()] }))
  on('store.delete', (_$, e) => {
    store.delete(e.key)

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
  on('prompt.submit', (_$, e) => ({ text: e.text }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  on('classic.Notification', () => ({}))
  on('ui.render', { component: 'PromptHint' }, ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const line = <Text>{e.props.tail ?? ''}</Text>

    return beneath.rows.length === 0 ? (
      line
    ) : (
      <Box flexDirection="column">
        {line}
        {beneath.rows.map((row) => (
          <Text>{row}</Text>
        ))}
      </Box>
    )
  })
  on('ui.render', { component: 'SessionMode' }, ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>{e.props.modes.join(' & ')}</Text>
  })

  return { clock, store, toasts, clips, spy, beneath }
}

const HOME = '/home/me'

/**
 * The files and programs beneath the mod, for what it may do outside its
 * store: a home folder, and the scripts it ran.
 */
const disk = (on: On, files: Map<string, string>) => {
  const runs: { argv: readonly string[]; env: Record<string, string> }[] = []

  on('env.get', (_$, e) => ({ value: e.name === 'HOME' ? HOME : undefined }))
  on('fs.read', (_$, e) => {
    const text = files.get(e.path)

    if (text === undefined) {
      throw new Error(`no such file: ${e.path}`)
    }

    return { value: text }
  })
  on('fs.write', (_$, e) => {
    files.set(e.path, e.text)

    return { value: undefined }
  })
  on('fs.stat', (_$, e) => {
    if (!files.has(e.path)) {
      throw new Error(`no such file: ${e.path}`)
    }

    return { value: { kind: 'file', size: 1, mtimeMs: 0, isLink: false } }
  })
  on('process.run', (_$, e) => {
    runs.push({ argv: e.argv, env: e.init?.env ?? {} })

    return {
      value: {
        exitCode: 0,
        stdout: '',
        stderr: '',
        isStdoutTruncated: false,
        isStderrTruncated: false,
      },
    }
  })
  on('ui.log', () => ({ value: undefined }))

  return runs
}

/** What the mod adds to the terminal's hint line now. */
const footer = async ($: Engine): Promise<string> => {
  const ui = await $.ui.mount(HINT)
  const text = (await ui.find({ type: 'Text' }))?.text ?? ''
  await ui.unmount()

  return text
}

const run = async ($: Engine, args: string): Promise<string> =>
  (await $.command.run(said(args))).text ?? ''

/** A prompt the person typed, or one that came from elsewhere. */
const prompt = async (
  $: Engine,
  kind: 'composer' | 'scheduled-trigger' = 'composer',
): Promise<void> => {
  await $.prompt.submit({ text: 'go on', wait: false, origin: { kind } })
}

test('the round counts down on the terminal\'s hint line and among the desktop\'s mode labels', async ($, on) => {
  const { clock } = world(on)
  await $.session.start(SESSION)
  await run($, 'start')
  expect(await footer($)).toBe('🍅 25:00 · 1/4')

  const desktop = await $.ui.mount(MODES)
  expect((await desktop.find({ type: 'Text' }))?.text).toBe('🍅 25:00 · 1/4')
  await desktop.unmount()

  // The terminal has the timer on its hint line, so not on a row over it too.
  const row = await $.ui.mount({ ...MODES, surface: 'terminal' })
  expect((await row.find({ type: 'Text' }))?.text).toBe('')
  await row.unmount()

  // What another mod put on the hint line stays, the timer after it.
  const shared = await $.ui.mount({
    ...HINT,
    props: { ...HINT.props, tail: '🦖 HI 00255' },
  })
  expect((await shared.find({ type: 'Text' }))?.text).toBe(
    '🦖 HI 00255 · 🍅 25:00 · 1/4',
  )
  await shared.unmount()

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
    'Pomodoro: today 1 · 25m of focus · 1 day in a row · 1 round and 25m in all\n' +
      'Last 7 days: 1 round · 25m of focus · Claude worked 100% of it',
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
  'with focus starting by itself, a break runs out into the next round, and the last round of a set earns the long break',
  { options: { rounds: 2, focusStart: 'auto' } },
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

  expect(await run($, 'skip')).toBe(
    'Skipped to a 5 minute break. The round is not counted.',
  )
  expect(await footer($)).toBe('☕ 5:00')
  // Its ten minutes were focus all the same.
  expect(await run($, 'stats')).toBe(
    'Pomodoro: today 0 · 10m of focus · 0 rounds and 10m in all\n' +
      'Last 7 days: 0 rounds · 10m of focus',
  )
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

test('the stats from before rounds were kept count the days in a row up to today, a day with no round yet not breaking the row', async ($, on) => {
  world(on, {
    stats: {
      rounds: 9,
      focusMs: 225 * MINUTE,
      days: {
        '2026-09-20': { rounds: 1, focusMs: 25 * MINUTE },
        '2026-09-21': { rounds: 1, focusMs: 25 * MINUTE },
        '2026-09-22': { rounds: 1, focusMs: 25 * MINUTE },
        '2026-09-27': { rounds: 1, focusMs: 25 * MINUTE },
        '2026-09-30': { rounds: 2, focusMs: 50 * MINUTE },
        '2026-10-01': { rounds: 3, focusMs: 75 * MINUTE },
      },
    },
  })

  expect(await run($, 'stats')).toBe(
    'Pomodoro: today 0 · 0m of focus · 2 days in a row, best 3 · 9 rounds and 3h 45m in all',
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

test('a break that runs out waits for the person, and their next prompt begins the round', async ($, on) => {
  const { clock, toasts, clips } = world(on)
  await $.session.start(SESSION)
  await run($, 'start')
  await $.turn.start(TURN)
  await clock.advance(25 * MINUTE)
  await $.turn.complete(DONE)

  await clock.advance(5 * MINUTE)
  expect(toasts.at(-1)).toBe("Break's over · focus 2/4 is next")
  expect(clips.at(-1)).toBe('sounds/focus.wav')
  expect(await footer($)).toBe('☕ break over')
  expect(await run($, '')).toBe(
    'Pomodoro: the break is over · focus 2/4 begins with your next prompt',
  )

  // A prompt the person did not send is not them coming back.
  const told = toasts.length
  await clock.advance(10 * MINUTE)
  await prompt($, 'scheduled-trigger')
  expect(toasts).toHaveLength(told)
  expect(await footer($)).toBe('☕ break over')

  // Claude's turn that ended as the break began is told too.
  await prompt($)
  expect(toasts.slice(-2)).toEqual([
    'Welcome back · focus 2/4 is on',
    'Meanwhile: 1 turn done',
  ])
  expect(await footer($)).toBe('🍅 25:00 · 2/4')
})

test('an open session with nobody at it stops the pomodoro once the break has waited half an hour', async ($, on) => {
  const { clock, toasts } = world(on)
  await $.session.start(SESSION)
  await run($, 'start')
  await $.turn.start(TURN)
  await clock.advance(25 * MINUTE)
  await $.turn.complete(DONE)

  await clock.advance(5 * MINUTE + 30 * MINUTE + 1000)
  expect(toasts.at(-1)).toBe('Pomodoro stopped · nobody was here')
  expect(await footer($)).toBe('')
  expect(await run($, 'stats')).toContain('today 1 · 25m of focus')
})

test(
  'a round the clock began that nobody came to ends with nothing counted',
  { options: { focusStart: 'auto' } },
  async ($, on) => {
    const { clock, toasts } = world(on)
    await $.session.start(SESSION)
    await run($, 'start')
    await $.turn.start(TURN)
    await clock.advance(25 * MINUTE)
    await $.turn.complete(DONE)

    await clock.advance(5 * MINUTE)
    expect(toasts.slice(-2)).toEqual([
      'Break over · focus 2/4 is on',
      'Meanwhile: 1 turn done',
    ])

    await clock.advance(25 * MINUTE)
    expect(toasts.at(-1)).toBe('Pomodoro stopped · nobody was here')
    expect(await run($, 'stats')).toContain('today 1 · 25m of focus')
  },
)

test(
  'with the break starting by itself, a round that runs out at an idle prompt turns to a break at once',
  { options: { breakStart: 'auto' } },
  async ($, on) => {
    const { clock, toasts } = world(on)
    await $.session.start(SESSION)
    expect(await run($, 'start')).toBe(
      'Pomodoro is on: 25 minutes of focus, round 1/4.',
    )

    await clock.advance(25 * MINUTE)
    expect(toasts).toEqual(['Take a 5 minute break · 1/4 done'])
  },
)

test('/pomodoro finish counts the round with the time it ran, and extend adds to what is left', async ($, on) => {
  const { clock } = world(on)
  await $.session.start(SESSION)
  await run($, 'start')
  await clock.advance(24 * MINUTE)

  expect(await run($, 'extend')).toBe('Added 5 minutes. Pomodoro: focus 1/4 · 6:00 left')
  expect(await run($, 'extend 2')).toBe('Added 2 minutes. Pomodoro: focus 1/4 · 8:00 left')
  expect(await run($, 'extend soon')).toBe('Usage: /pomodoro extend [minutes], 1 to 120.')

  await clock.advance(MINUTE)
  expect(await run($, 'finish')).toBe(
    'Finished focus 1/4 after 25m: take a 5 minute break.',
  )
  expect(await footer($)).toBe('☕ 5:00')
  expect(await run($, 'stats')).toContain('today 1 · 25m of focus')

  expect(await run($, 'finish')).toBe('Skipped the break: focus 2/4 is on.')
})

test('a round stopped after it ran out is counted as done', async ($, on) => {
  const { clock } = world(on)
  await $.session.start(SESSION)
  await run($, 'start')
  await clock.advance(26 * MINUTE)

  expect(await footer($)).toBe('🍅 break due · 1/4')
  expect(await run($, 'stop')).toContain('Pomodoro is stopped')
  expect(await run($, 'stats')).toContain('today 1 · 26m of focus')
})

test('/pomodoro undo takes back a stop, and a break with the round it counted, for five minutes', async ($, on) => {
  const { clock } = world(on)
  await $.session.start(SESSION)
  expect(await run($, 'undo')).toBe('Pomodoro: nothing to undo.')
  await run($, 'start')
  await clock.advance(10 * MINUTE)
  await run($, 'stop')
  await clock.advance(6 * MINUTE)
  expect(await run($, 'undo')).toBe('Pomodoro: nothing to undo.')

  await run($, 'start')
  await clock.advance(10 * MINUTE)
  await run($, 'stop')
  expect(await run($, 'undo')).toBe(
    'Undid the last change. Pomodoro: focus 1/4 · 15:00 left',
  )
  expect(await footer($)).toBe('🍅 15:00 · 1/4')
  expect(await run($, 'undo')).toBe('Pomodoro: nothing to undo.')

  await $.turn.start(TURN)
  await clock.advance(15 * MINUTE)
  await $.turn.complete(DONE)
  expect(await run($, 'stats')).toContain('today 1 · 35m of focus')

  // The first round, stopped long ago, stays.
  expect(await run($, 'undo')).toContain('Undid the last change.')
  expect(await run($, 'stats')).toContain('today 0 · 10m of focus')
})

test('a round keeps what it was for, the person\'s prompts and Claude\'s part, and the log lists it', async ($, on) => {
  const { clock } = world(on)
  on('session.repo', () => ({
    value: { root: '/work/claude-pomodoro', remote: null, internal: false, name: null },
  }))
  await $.session.start(SESSION)
  expect(await run($, 'start Write the tests #Auth')).toBe(
    'Pomodoro is on: 25 minutes of focus, round 1/4 for Write the tests #auth. The break toast comes while Claude works.',
  )

  await prompt($)
  await prompt($, 'scheduled-trigger')
  await $.turn.start(TURN)
  await clock.advance(10 * MINUTE)
  await $.turn.complete({ ...DONE, durationMs: 10 * MINUTE })
  await clock.advance(15 * MINUTE)
  expect(await run($, '')).toBe(
    'Pomodoro: focus 1/4 (Write the tests #auth) is done · the break begins when Claude starts working',
  )

  await prompt($)
  await $.turn.start(TURN)
  expect(await run($, 'log')).toBe(
    'Pomodoro on 2026-10-02: 1 round · 25m of focus\n' +
      '  12:00–12:25 · 25m · Write the tests #auth · claude-pomodoro · Claude 10m · 2 prompts',
  )
  expect(await run($, 'log yesterday')).toBe('Pomodoro: no focus rounds on 2026-10-01.')
  expect(await run($, 'log someday')).toContain('Usage: /pomodoro')

  // The note carries into the next round until it is changed.
  expect(await run($, 'note review #auth #api')).toBe(
    'Pomodoro: the rounds are for review #auth #api now.',
  )
  expect(await run($, 'note')).toBe('Pomodoro: the note is cleared.')
})

test('Claude\'s turns and asks during a break are told when the person is back', async ($, on) => {
  const { clock, toasts } = world(on)
  await $.session.start(SESSION)
  await run($, 'start')
  await $.turn.start(TURN)
  await clock.advance(25 * MINUTE)

  await clock.advance(MINUTE)
  await $.turn.complete(DONE)
  await $.classic.Notification(ASKING)
  await clock.advance(10 * MINUTE)
  await prompt($)
  expect(toasts.slice(-2)).toEqual([
    'Welcome back · focus 2/4 is on',
    'Meanwhile: 1 turn done · 1 ask for you',
  ])
})

test(
  'the daily goal shows in the stats and is told on the round that meets it',
  { options: { dailyGoal: 1 } },
  async ($, on) => {
    const { clock, toasts } = world(on)
    await $.session.start(SESSION)
    await run($, 'start')
    await $.turn.start(TURN)
    await clock.advance(25 * MINUTE)

    expect(toasts).toEqual([
      'Take 5 while Claude works · 1/4 done',
      'Daily goal reached · 1 round 🎯',
    ])
    expect(await run($, 'stats')).toContain('Pomodoro: today 1/1 · 25m of focus')
  },
)

test(
  'the dots hint shows the set as dots',
  { options: { hintStyle: 'dots', rounds: 3 } },
  async ($, on) => {
    world(on)
    await $.session.start(SESSION)
    await run($, 'start')
    expect(await footer($)).toBe('🍅 25:00 ○○○')

    await run($, 'skip')
    await run($, 'skip')
    expect(await footer($)).toBe('🍅 25:00 ●○○')
  },
)

test(
  'with its tools on, Claude can read the stats and act on the timer',
  { options: { modelTools: true } },
  async ($, on) => {
    world(on)
    const listed: string[] = []
    on('tool.register', (_$, e) => {
      listed.push(e.name)

      return { value: { tool: `mcp__pomodoro__${e.name}` } }
    })
    await $.session.start(SESSION)
    expect(listed).toEqual(['stats', 'timer'])

    const acted = await $.tool.call({
      tool: 'mcp__pomodoro__timer',
      action: 'start',
      text: 'ship the docs #docs',
    })
    expect(acted.result).toContain('round 1/4 for ship the docs #docs')

    const refused = await $.tool.call({ tool: 'mcp__pomodoro__timer', action: 'nap' })
    expect(refused.deny).toContain('The action is one of')

    const read = await $.tool.call({ tool: 'mcp__pomodoro__stats' })
    expect(read.result).toBe(
      'Pomodoro: focus 1/4 (ship the docs #docs) · 25:00 left\n\n' +
        'Pomodoro: no focus rounds yet. /pomodoro start begins one.\n\n' +
        'Pomodoro: no focus rounds on 2026-10-02.',
    )
  },
)

test(
  'with Open Pomodoro files on, the round is kept in ~/.pomodoro as openpomodoro-cli keeps it',
  { options: { openPomodoro: true } },
  async ($, on) => {
    const { clock } = world(on)
    const files = new Map<string, string>()
    disk(on, files)
    const entry = { start: NOON, minutes: 25, description: 'write docs', tags: ['docs'] }
    await $.session.start(SESSION)
    await run($, 'start write docs #docs')
    await clock.advance(1000)
    expect(files.get(`${HOME}/.pomodoro/current`)).toBe(`${formatEntry(entry)}\n`)

    await $.turn.start(TURN)
    await clock.advance(25 * MINUTE + 1000)
    expect(files.get(`${HOME}/.pomodoro/current`)).toBe('')
    expect(files.get(`${HOME}/.pomodoro/history`)).toBe(`${formatEntry(entry)}\n`)
  },
)

test(
  'a pomodoro openpomodoro-cli began shows here, and one stopped here is not picked up again',
  { options: { openPomodoro: true } },
  async ($, on) => {
    const { clock, toasts } = world(on)
    const began = { start: NOON - 5 * MINUTE, minutes: 25, description: 'review', tags: [] }
    const files = new Map([[`${HOME}/.pomodoro/current`, `${formatEntry(began)}\n`]])
    disk(on, files)
    await $.session.start(SESSION)
    expect(toasts).toEqual(['Picked up a pomodoro from ~/.pomodoro'])
    expect(await run($, '')).toBe('Pomodoro: focus 1/4 (review) · 20:00 left')

    await run($, 'stop')
    files.set(`${HOME}/.pomodoro/current`, `${formatEntry(began)}\n`)
    await clock.advance(10_000)
    expect(await footer($)).toBe('')
    expect(toasts).toHaveLength(1)
  },
)

test(
  'with hook scripts on, the scripts kept in ~/.pomodoro/hooks run as the phases change',
  { options: { scriptHooks: true } },
  async ($, on) => {
    const { clock } = world(on)
    const files = new Map([
      [`${HOME}/.pomodoro/hooks/start`, '#!/bin/sh'],
      [`${HOME}/.pomodoro/hooks/break`, '#!/bin/sh'],
    ])
    const runs = disk(on, files)
    await $.session.start(SESSION)
    await run($, 'start write docs #docs')
    await clock.advance(1000)
    expect(runs).toEqual([
      {
        argv: [`${HOME}/.pomodoro/hooks/start`],
        env: {
          POMODORO_EVENT: 'start',
          POMODORO_PHASE: 'focus',
          POMODORO_ROUND: '1',
          POMODORO_ROUNDS: '4',
          POMODORO_MINUTES: '25',
          POMODORO_DESCRIPTION: 'write docs',
          POMODORO_TAGS: 'docs',
          POMODORO_DIRECTORY: `${HOME}/.pomodoro`,
        },
      },
    ])

    // The round's end is a stop, which has no script here, then the break.
    await run($, 'skip')
    await clock.advance(1000)
    expect(runs.map((ran) => ran.env.POMODORO_EVENT)).toEqual(['start', 'break'])
    expect(runs[1]?.env.POMODORO_MINUTES).toBe('5')
    expect(runs[1]?.env.POMODORO_ROUND).toBe('1')
  },
)

test('/pomodoro export copies every round kept, or writes them to the file named', async ($, on) => {
  const { clock } = world(on)
  const files = new Map<string, string>()
  disk(on, files)
  const copied: string[] = []
  on('ui.copy', (_$, e) => {
    copied.push(e.text)

    return { value: { isCopied: true } }
  })
  await $.session.start(SESSION)
  await run($, 'start')
  await clock.advance(20 * MINUTE)
  await run($, 'finish')

  expect(await run($, 'export')).toBe('Copied 1 round as CSV to the clipboard.')
  expect(copied[0]).toContain('start,end,focus_minutes')
  expect(await run($, 'export ical ~/focus.ics')).toBe(
    'Wrote 1 round as ICAL to ~/focus.ics.',
  )
  expect(files.get(`${HOME}/focus.ics`)).toContain('BEGIN:VCALENDAR')
  expect(await run($, 'export xml')).toContain('Usage: /pomodoro')
})

test('/pomodoro report opens the pane, and an open pane draws again once a round is kept', async ($, on) => {
  const { clock } = world(on)
  const opened: string[] = []
  on('ui.open', (_$, e) => {
    opened.push(e.id)

    return { value: { isPlaced: true } }
  })
  on('ui.close', () => ({ value: undefined }))
  await $.session.start(SESSION)
  expect(await run($, 'report')).toBe('Pomodoro report opened.')
  expect(opened).toEqual(['pomodoro-report'])

  const pane = await $.ui.mount({
    plugin: 'pomodoro',
    surface: 'desktop',
    component: 'Pane',
    requestId: 'pomodoro-report',
    props: {
      title: 'Pomodoro',
      isFocused: true,
      bodyColumns: 60,
      placement: 'dock',
      scroll: { offset: 0, bodyRows: 40 },
      view: {},
    },
  })
  const texts = async (): Promise<string[]> =>
    (await pane.findAll({ type: 'Text' })).map((text) => text.text)
  expect(await texts()).toEqual(['No focus rounds yet. /pomodoro start begins one.'])

  await run($, 'start')
  await clock.advance(20 * MINUTE)
  await run($, 'finish')
  expect((await texts()).some((text) => text.startsWith('Today 1 round'))).toBe(true)
  await pane.unmount()
})

test(
  'a tick that read the timer before another session stopped it writes nothing over the stop',
  { options: { breakStart: 'auto' } },
  async ($, on) => {
    const { clock, store, toasts, clips, spy } = world(on)
    await $.session.start(SESSION)
    await run($, 'start')

    // As this session's tick turns the round, another session stops it.
    spy.get = (key) => {
      if (key === 'activeAt' && clock.now() >= NOON + 25 * MINUTE) {
        store.set('timer', { phase: 'idle' })
        spy.get = () => undefined
      }
    }
    await clock.advance(25 * MINUTE + 2000)
    expect(store.get('timer')).toEqual({ phase: 'idle' })
    expect(toasts).toEqual([])
    expect(clips).toEqual([])
    expect(await footer($)).toBe('')
  },
)

test('/pomodoro undo takes nothing back once the phase changed again', async ($, on) => {
  const { clock } = world(on)
  await $.session.start(SESSION)
  await run($, 'start old')
  await clock.advance(10 * MINUTE)
  await run($, 'stop')
  await clock.advance(MINUTE)
  await run($, 'start new')

  expect(await run($, 'undo')).toBe('Pomodoro: nothing to undo.')
  expect(await run($, '')).toBe('Pomodoro: focus 1/4 (new) · 25:00 left')
  expect(await run($, 'stats')).toContain('10m of focus')
})

test('a round paused after it ran out is done when it is stopped', async ($, on) => {
  const { clock } = world(on)
  await $.session.start(SESSION)
  await run($, 'start')
  await clock.advance(26 * MINUTE)
  await run($, 'pause')

  await run($, 'stop')
  expect(await run($, 'stats')).toContain('today 1 · 26m of focus')
})

test(
  'Claude\'s part of a round leaves out the time the round sat paused',
  { options: { focusMinutes: 60 } },
  async ($, on) => {
    const { clock } = world(on)
    await $.session.start(SESSION)
    await run($, 'start')
    await clock.advance(10 * MINUTE)
    await $.turn.start(TURN)
    await clock.advance(5 * MINUTE)
    await run($, 'pause')
    await clock.advance(10 * MINUTE)
    await run($, 'resume')
    await clock.advance(5 * MINUTE)
    await $.turn.complete({ ...DONE, durationMs: 20 * MINUTE })

    await run($, 'stop')
    expect(await run($, 'log')).toBe(
      'Pomodoro on 2026-10-02: 0 rounds · 20m of focus\n' +
        '  12:00–12:30 · 20m · stopped · Claude 10m',
    )
  },
)

test('an open report draws again when another session keeps a round', async ($, on) => {
  const { clock, store } = world(on)
  await $.session.start(SESSION)
  const pane = await $.ui.mount({
    plugin: 'pomodoro',
    surface: 'desktop',
    component: 'Pane',
    requestId: 'pomodoro-report',
    props: {
      title: 'Pomodoro',
      isFocused: true,
      bodyColumns: 60,
      placement: 'dock',
      scroll: { offset: 0, bodyRows: 40 },
      view: {},
    },
  })
  const texts = async (): Promise<string[]> =>
    (await pane.findAll({ type: 'Text' })).map((text) => text.text)
  expect(await texts()).toEqual(['No focus rounds yet. /pomodoro start begins one.'])

  store.set('history', {
    rounds: [
      {
        start: NOON - 30 * MINUTE,
        end: NOON - 5 * MINUTE,
        plannedMs: 25 * MINUTE,
        focusMs: 25 * MINUTE,
        status: 'done',
      },
    ],
    days: {},
  })
  store.set('revision', 1)
  await clock.advance(5000)
  expect((await texts()).some((text) => text.startsWith('Today 1 round'))).toBe(true)
  await pane.unmount()
})

test(
  'a stop that kept no round still keeps ~/.pomodoro/current from bringing it back',
  { options: { openPomodoro: true } },
  async ($, on) => {
    const { clock, toasts } = world(on)
    const files = new Map<string, string>()
    disk(on, files)
    await $.session.start(SESSION)
    await run($, 'start')
    await clock.advance(1000)
    const left = files.get(`${HOME}/.pomodoro/current`) ?? ''
    expect(left).not.toBe('')

    await clock.advance(29_000)
    await run($, 'stop')
    // As if clearing the file failed, or another session read it first.
    files.set(`${HOME}/.pomodoro/current`, left)
    await clock.advance(10_000)
    expect(await footer($)).toBe('')
    expect(toasts).toEqual([])
  },
)

test(
  'a round picked up from openpomodoro-cli and finished here rewrites its history line, and a resumed round moves current\'s end',
  { options: { openPomodoro: true } },
  async ($, on) => {
    const { clock } = world(on)
    const began = { start: NOON - 5 * MINUTE, minutes: 25, description: 'review', tags: [] }
    const files = new Map([
      [`${HOME}/.pomodoro/current`, `${formatEntry(began)}\n`],
      [`${HOME}/.pomodoro/history`, `${formatEntry(began)}\n`],
    ])
    disk(on, files)
    await $.session.start(SESSION)
    await clock.advance(5 * MINUTE)
    await run($, 'finish')
    await clock.advance(1000)
    expect(files.get(`${HOME}/.pomodoro/history`)).toBe(
      `${formatEntry({ ...began, minutes: 10 })}\n`,
    )
    expect(files.get(`${HOME}/.pomodoro/current`)).toBe('')

    await run($, 'skip')
    const start = clock.now()
    await clock.advance(10 * MINUTE)
    await run($, 'pause')
    await clock.advance(10 * MINUTE)
    await run($, 'resume')
    await clock.advance(1000)
    expect(files.get(`${HOME}/.pomodoro/current`)).toBe(
      `${formatEntry({ start, minutes: 35, description: 'review', tags: [] })}\n`,
    )
  },
)

test(
  'with hook scripts on, a break that runs out stops there, and the person\'s return only starts',
  { options: { scriptHooks: true } },
  async ($, on) => {
    const { clock } = world(on)
    const files = new Map([
      [`${HOME}/.pomodoro/hooks/start`, '#!/bin/sh'],
      [`${HOME}/.pomodoro/hooks/stop`, '#!/bin/sh'],
      [`${HOME}/.pomodoro/hooks/break`, '#!/bin/sh'],
    ])
    const runs = disk(on, files)
    await $.session.start(SESSION)
    await run($, 'start')
    await $.turn.start(TURN)
    await clock.advance(25 * MINUTE + 1000)
    await $.turn.complete(DONE)
    await clock.advance(5 * MINUTE + 1000)
    expect(runs.map((ran) => ran.env.POMODORO_EVENT)).toEqual([
      'start',
      'stop',
      'break',
      'stop',
    ])

    await prompt($)
    await clock.advance(1000)
    expect(runs.map((ran) => ran.env.POMODORO_EVENT)).toEqual([
      'start',
      'stop',
      'break',
      'stop',
      'start',
    ])
  },
)

test(
  'a round another session ended is not picked up from ~/.pomodoro/current here',
  { options: { openPomodoro: true } },
  async ($, on) => {
    const began = { start: NOON - 5 * MINUTE, minutes: 25, description: '', tags: [] }
    const { toasts } = world(on, { ended: [began.start] })
    disk(on, new Map([[`${HOME}/.pomodoro/current`, `${formatEntry(began)}\n`]]))
    await $.session.start(SESSION)

    expect(toasts).toEqual([])
    expect(await footer($)).toBe('')
  },
)

// The terminal's fullscreen layout, where a pointer can press a button.
const FULLSCREEN = { columns: 120, rows: 40, isFullscreen: true } as const

/** The labels of the buttons under the hint line, as a surface draws them. */
const buttons = async (
  $: Engine,
  surface: 'terminal' | 'desktop' = 'terminal',
  isFullscreen = true,
): Promise<string[]> => {
  const ui = await $.ui.mount({
    ...HINT,
    surface,
    viewport: isFullscreen ? FULLSCREEN : undefined,
  })
  const labels = (await ui.findAll({ type: 'Button' })).map((button) =>
    String(button.props.label),
  )
  await ui.unmount()

  return labels
}

const press = async ($: Engine, key: string): Promise<void> => {
  const ui = await $.ui.mount({ ...HINT, viewport: FULLSCREEN })
  await ui.press({ key })
  await ui.unmount()
}

/** The texts of the hint line and what is drawn with it, on the fullscreen terminal. */
const texts = async ($: Engine): Promise<string[]> => {
  const ui = await $.ui.mount({ ...HINT, viewport: FULLSCREEN })
  const found = (await ui.findAll({ type: 'Text' })).map((text) => text.text)
  await ui.unmount()

  return found
}

test('where there is a pointer, the timer has a row of its own with buttons that act on it', async ($, on) => {
  const { store } = world(on)
  const opened: string[] = []
  on('ui.open', (_$, e) => {
    opened.push(e.id)

    return { value: { isPlaced: true } }
  })
  await $.session.start(SESSION)

  // The terminal's main screen has no pointer: the timer stays in the tail.
  expect(await buttons($, 'terminal', false)).toEqual([])
  expect(await buttons($, 'desktop', false)).toEqual(['▶ start', '● sound', 'report', '×'])
  expect(await buttons($)).toEqual(['▶ start', '● sound', 'report', '×'])
  expect(await texts($)).toEqual(['', '🍅 pomodoro'])

  await press($, 'start')
  // The row holds the timer, so the line's tail does not.
  expect(await texts($)).toEqual(['', '🍅 25:00 · 1/4'])
  expect(await buttons($)).toEqual([
    '❚❚ pause',
    '+5m',
    '✓ finish',
    '■ stop',
    '● sound',
    'report',
    '×',
  ])

  await press($, 'pause')
  expect(await buttons($)).toEqual(['▶ resume', '■ stop', '● sound', 'report', '×'])

  await press($, 'stop')
  expect(await footer($)).toBe('')
  expect(await buttons($)).toEqual(['▶ start', '↶ undo', '● sound', 'report', '×'])
  await press($, 'undo')
  expect(await footer($)).toBe('🍅 paused 25:00 · 1/4')

  await press($, 'sound')
  expect(store.get('isMuted')).toBe(true)
  expect(await buttons($)).toContain('○ sound')

  await press($, 'report')
  expect(opened).toEqual(['pomodoro-report'])

  // Closed, the row is gone and the timer is back at the end of the line,
  // until `/pomodoro controls` opens it again.
  await press($, 'close')
  expect(await buttons($)).toEqual([])
  expect(await texts($)).toEqual(['🍅 paused 25:00 · 1/4'])
  expect(await run($, 'controls')).toContain('Pomodoro controls are on.')
  expect(await buttons($)).toContain('▶ resume')
})

test(
  'with the control row set to running, the buttons show only while a pomodoro is on',
  { options: { controls: 'running' } },
  async ($, on) => {
    world(on)
    await $.session.start(SESSION)
    expect(await buttons($)).toEqual([])

    await run($, 'start')
    expect(await buttons($)).toContain('❚❚ pause')
  },
)

test('the timer\'s row goes right under the hint line, over the rows another mod draws there', async ($, on) => {
  const { beneath } = world(on)
  beneath.rows = ['♪ matrix']
  await $.session.start(SESSION)
  await run($, 'start')

  expect(await texts($)).toEqual(['', '🍅 25:00 · 1/4', '♪ matrix'])

  await run($, 'skip')
  expect(await texts($)).toEqual(['', '🍅 ☕ 5:00', '♪ matrix'])
})

/** The mode labels the desktop draws beside its hint line now. */
const modes = async ($: Engine): Promise<string> => {
  const ui = await $.ui.mount(MODES)
  const text = (await ui.find({ type: 'Text' }))?.text ?? ''
  await ui.unmount()

  return text
}

test('/pomodoro close takes it all out of sight and hearing while the pomodoro runs on, and open brings it back as it was', async ($, on) => {
  const { clock, store, toasts, clips } = world(on)
  const closed: string[] = []
  on('ui.close', (_$, e) => {
    closed.push(e.id)

    return { value: undefined }
  })
  await $.session.start(SESSION)
  await run($, 'start')
  await $.turn.start(TURN)

  expect(await run($, 'close')).toBe(
    'Pomodoro is closed: the timer, its buttons, the report, its toasts and its sounds are away, and a pomodoro on runs on. /pomodoro open, start or resume brings them back.',
  )
  expect(closed).toEqual(['pomodoro-report'])
  expect(await footer($)).toBe('')
  expect(await buttons($)).toEqual([])
  expect(await buttons($, 'desktop', false)).toEqual([])
  expect(await modes($)).toBe('')

  // The round runs out while Claude works and the break begins, unseen and unheard.
  await clock.advance(25 * MINUTE)
  expect(await run($, '')).toBe('Pomodoro: break · 5:00 left')
  expect(toasts).toEqual([])
  expect(clips).toEqual([])

  // Open, it shows and sounds as it did, the sound and the row as they were.
  expect(await run($, 'open')).toBe(
    'Pomodoro is open: the timer, its buttons, its toasts and its sounds are back as they were.',
  )
  expect(await footer($)).toBe('☕ 5:00')
  expect(await modes($)).toBe('☕ 5:00')
  expect(await buttons($)).toContain('● sound')
  await clock.advance(5 * MINUTE)
  expect(toasts).toEqual(["Break's over · focus 2/4 is next"])
  expect(clips).toEqual(['sounds/focus.wav'])

  // Closing and opening leave the person's own switches as they set them.
  await run($, 'sound off')
  await run($, 'controls off')
  await run($, 'quit')
  await run($, 'open')
  expect(store.get('isMuted')).toBe(true)
  expect(await buttons($)).toEqual([])
  expect(await footer($)).toBe('☕ break over')

  // Opening the row brings the rest back with it.
  expect(await run($, 'exit')).toContain('Pomodoro is closed')
  expect(await run($, 'controls')).toContain('Pomodoro controls are on.')
  expect(await buttons($)).toContain('○ sound')
  expect(await run($, 'close now')).toContain('Usage: /pomodoro')

  // Running the pomodoro on brings it all back too, and so does beginning
  // one; plain /pomodoro only says where it stands while one is on.
  await run($, 'close')
  await run($, '')
  expect(store.get('isClosed')).toBe(true)
  await run($, 'resume')
  expect(store.get('isClosed')).toBe(false)
  expect(await footer($)).not.toBe('')
  await run($, 'stop')
  await run($, 'close')
  expect(await run($, '')).toContain('Pomodoro is on')
  expect(store.get('isClosed')).toBe(false)
  expect(await footer($)).not.toBe('')
})

test('/pomodoro close, open, sound and controls in another session reach this one at its next tick', async ($, on) => {
  const { clock, store, toasts, clips } = world(on)
  const closed: string[] = []
  on('ui.close', (_$, e) => {
    closed.push(e.id)

    return { value: undefined }
  })
  await $.session.start(SESSION)
  await run($, 'start')
  await $.turn.start(TURN)

  // The other session writes to the store both read.
  store.set('isClosed', true)
  await clock.advance(1000)
  expect(await footer($)).toBe('')
  expect(await buttons($)).toEqual([])
  expect(closed).toEqual(['pomodoro-report'])
  await clock.advance(25 * MINUTE)
  expect(toasts).toEqual([])
  expect(clips).toEqual([])

  store.set('isClosed', false)
  store.set('isMuted', true)
  store.set('areControlsOpen', false)
  await clock.advance(1000)
  expect(await footer($)).toBe('☕ 4:58')
  expect(await buttons($)).toEqual([])

  store.set('areControlsOpen', true)
  await clock.advance(1000)
  expect(await buttons($)).toContain('○ sound')
  await clock.advance(5 * MINUTE)
  expect(toasts).toEqual(["Break's over · focus 2/4 is next"])
  expect(clips).toEqual([])
})
