import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { EMPTY } from '../hooks/history'
import type { History, Round } from '../hooks/history'
import { insightsOf } from '../hooks/insights'
import { REPORT_PANE } from '../hooks/report'

const MINUTE = 60_000
const FOCUS = 25 * MINUTE
// Noon on Friday 2 October 2026 where the test runs, far from either end of
// the day.
const NOW = new Date(2026, 9, 2, 12).getTime()
const SURFACES = ['terminal', 'desktop'] as const
const PANE = {
  plugin: 'pomodoro',
  component: 'Pane',
  requestId: REPORT_PANE,
  props: {
    title: 'Pomodoro',
    isFocused: true,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

/** A done round of 25 minutes that began then, in 2026. */
const round = (
  month: number,
  date: number,
  hour: number,
  minute: number,
  more: Partial<Round> = {},
): Round => {
  const start = new Date(2026, month, date, hour, minute).getTime()

  return {
    start,
    end: start + FOCUS,
    plannedMs: FOCUS,
    focusMs: FOCUS,
    status: 'done',
    label: '',
    tags: [],
    projects: [],
    claudeMs: 0,
    prompts: 0,
    ...more,
  }
}

const HISTORY: History = {
  rounds: [
    // Over 30 days back: in the heat map and the totals alone.
    round(7, 20, 9, 0, { projects: ['ancient'] }),
    // Eight days back: in the last 30 days, not the last 7.
    round(8, 25, 14, 0, { projects: ['old-week'], claudeMs: FOCUS }),
    round(8, 30, 14, 0, { projects: ['pomodoro'], claudeMs: FOCUS }),
    round(9, 1, 15, 0),
    // Begun before midnight, so it counts on the day it ended.
    round(9, 1, 23, 50, { projects: ['night'] }),
    round(9, 2, 9, 0, {
      projects: ['pomodoro'],
      tags: ['auth'],
      claudeMs: 10 * MINUTE,
    }),
    round(9, 2, 9, 30, {
      projects: ['pomodoro', 'orca'],
      tags: ['auth', 'api'],
      claudeMs: 15 * MINUTE,
    }),
    round(9, 2, 10, 0, {
      status: 'stopped',
      focusMs: 10 * MINUTE,
      projects: ['orca'],
    }),
  ],
  // A day from before rounds were kept: its totals and nothing more.
  days: { '2026-09-28': { rounds: 3, focusMs: 75 * MINUTE } },
}

// The 12 weeks as the pane draws them: a row per weekday, a column per week.
const HEAT = [
  `Mon ${'· '.repeat(11)}█ `,
  `Tue ${'· '.repeat(11)}· `,
  `Wed ${'· '.repeat(11)}▒ `,
  `Thu ${'· '.repeat(5)}▒ ${'· '.repeat(5)}▒ `,
  `Fri ${'· '.repeat(10)}▒ █ `,
  `Sat ${'· '.repeat(11)}  `,
  `Sun ${'· '.repeat(11)}  `,
]

/** The glyphs of a Raster's cells, row after row. */
const glyphsOf = (cells: string): string => {
  const bytes = Uint8Array.from(atob(cells), (char) => char.charCodeAt(0))
  const view = new DataView(bytes.buffer)

  return Array.from({ length: bytes.length / 12 }, (_, index) =>
    String.fromCodePoint(view.getUint32(index * 12, true)),
  ).join('')
}

/**
 * The engine beneath the plugin: its clock, the store with the history as
 * the plugin keeps it, and the panes the plugin asked to close. A test's own
 * hooks may call nothing on `$`, so the pane is drawn by the plugin's hook.
 */
const world = (on: On, history: History) => {
  mock.clock(on, { now: NOW })
  mock.store(on, { history })
  const closed: string[] = []

  on('ui.close', (_$, e) => {
    closed.push(e.id)

    return { value: undefined }
  })

  return { closed }
}

test('the last 7 days count each round on the day it ended, the days kept as totals among them', () => {
  const { today, goal, streak, best, total, week } = insightsOf(HISTORY, NOW, 8)

  expect(today).toEqual({ day: '2026-10-02', rounds: 3, focusMs: 85 * MINUTE })
  expect(goal).toBe(8)
  expect(streak).toBe(3)
  expect(best).toBe(3)
  expect(total).toEqual({ rounds: 10, focusMs: 260 * MINUTE })
  expect(week).toEqual([
    { day: '2026-09-26', rounds: 0, focusMs: 0 },
    { day: '2026-09-27', rounds: 0, focusMs: 0 },
    { day: '2026-09-28', rounds: 3, focusMs: 75 * MINUTE },
    { day: '2026-09-29', rounds: 0, focusMs: 0 },
    { day: '2026-09-30', rounds: 1, focusMs: FOCUS },
    { day: '2026-10-01', rounds: 1, focusMs: FOCUS },
    { day: '2026-10-02', rounds: 3, focusMs: 85 * MINUTE },
  ])
})

test('the 12 weeks run Monday first and end on today', () => {
  const { weeks } = insightsOf(HISTORY, NOW, 0)
  const weekdayOf = (day: string): number => {
    const [year = 0, month = 1, date = 1] = day.split('-').map(Number)

    return new Date(year, month - 1, date).getDay()
  }

  expect(weeks).toHaveLength(12)
  expect(weeks.slice(0, -1).map((week) => week.length)).toEqual(
    Array.from({ length: 11 }, () => 7),
  )
  expect(weeks.map((week) => weekdayOf(week[0]?.day ?? ''))).toEqual(
    Array.from({ length: 12 }, () => 1),
  )
  expect(weeks[0]?.[0]?.day).toBe('2026-07-13')
  expect(weeks[5]?.[3]).toEqual({ day: '2026-08-20', rounds: 1, focusMs: FOCUS })
  expect(weeks[11]?.map((day) => day.day)).toEqual([
    '2026-09-28',
    '2026-09-29',
    '2026-09-30',
    '2026-10-01',
    '2026-10-02',
  ])
})

test('hours, projects, tags and Claude\'s share come from the rounds alone', () => {
  const { hours, projects, tags, claudeShare } = insightsOf(HISTORY, NOW, 0)

  // Done rounds of the last 30 days by the hour they began.
  expect(hours).toHaveLength(24)
  expect(hours.flatMap((count, hour) => (count > 0 ? [[hour, count]] : []))).toEqual([
    [9, 2],
    [14, 2],
    [15, 1],
    [23, 1],
  ])
  // A stopped round's focus counts, its round does not; the day kept as
  // totals and the round over 30 days back are in none.
  expect(projects).toEqual([
    { name: 'pomodoro', rounds: 3, focusMs: 75 * MINUTE },
    { name: 'orca', rounds: 1, focusMs: 35 * MINUTE },
    { name: 'night', rounds: 1, focusMs: FOCUS },
    { name: 'old-week', rounds: 1, focusMs: FOCUS },
  ])
  expect(tags).toEqual([
    { name: 'auth', rounds: 2, focusMs: 50 * MINUTE },
    { name: 'api', rounds: 1, focusMs: FOCUS },
  ])
  // Of the last 7 days' 135 minutes of focus, Claude worked through 50.
  expect(claudeShare).toBe(50 / 135)
})

test('only the top five projects show, and no focus means no share for Claude', () => {
  const rounds = ['a', 'b', 'c', 'd', 'e', 'f'].map((name, index) =>
    round(9, 2, 6 + index, 0, { projects: [name], focusMs: (index + 1) * MINUTE }),
  )
  const { projects, claudeShare } = insightsOf({ rounds, days: {} }, NOW, 0)

  expect(projects.map((share) => share.name)).toEqual(['f', 'e', 'd', 'c', 'b'])
  expect(insightsOf(EMPTY, NOW, 0).claudeShare).toBe(0)
  expect(claudeShare).toBe(0)
})

test(
  'the report pane draws the header, the week and the 12 weeks, sized to the pane',
  { options: { dailyGoal: 8 } },
  async ($, on) => {
    const { closed } = world(on, HISTORY)

    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ ...PANE, surface })
      const texts = (await ui.findAll({ type: 'Text' })).map((text) => text.text)

      expect(texts).toContain('Today 3/8 rounds, 1h 25m · 3 days in a row (best 3)')
      expect(texts).toContain('10 rounds, 4h 20m in all')
      expect(texts).toContain(
        'Claude worked 37% of your focus time in the last 7 days.',
      )
      expect(texts.filter((text) => [...text].length > 60)).toEqual([])

      // The terminal draws the 12 weeks as one grid of cells, the others as text.
      const raster = await ui.find({ type: 'Raster' })

      if (surface === 'terminal') {
        expect(raster?.props).toMatchObject({ columns: 28, rows: 7 })
        expect(glyphsOf(String(raster?.props.cells))).toBe(HEAT.join(''))
      } else {
        expect(raster).toBeUndefined()
        expect(texts).toEqual(expect.arrayContaining(HEAT))
      }

      closed.splice(0)
      await ui.press({ key: 'close' })
      expect(closed).toEqual([REPORT_PANE])
      await ui.unmount()
    }
  },
)

test('with no rounds at all the report pane says how to begin one', async ($, on) => {
  const { closed } = world(on, EMPTY)

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface })
    const texts = (await ui.findAll({ type: 'Text' })).map((text) => text.text)

    expect(texts).toEqual(['No focus rounds yet. /pomodoro start begins one.'])
    expect(await ui.find({ type: 'Raster' })).toBeUndefined()

    closed.splice(0)
    await ui.press({ key: 'close' })
    expect(closed).toEqual([REPORT_PANE])
    await ui.unmount()
  }
})

test('a pane too narrow for the weekday names draws the weeks alone, no wider than it', async ($, on) => {
  world(on, HISTORY)

  for (const columns of [1, 3, 4]) {
    const ui = await $.ui.mount({
      ...PANE,
      surface: 'terminal',
      props: { ...PANE.props, bodyColumns: columns },
    })
    const raster = await ui.find({ type: 'Raster' })

    expect(Number(raster?.props.columns)).toBeLessThanOrEqual(columns)
    await ui.unmount()
  }
})
