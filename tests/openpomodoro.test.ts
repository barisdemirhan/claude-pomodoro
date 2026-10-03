import { expect, test } from 'claude-code/testing'
import type { Round } from '../hooks/history'
import { entryOfRound, formatEntry, parseEntry } from '../hooks/openpomodoro'

const NOON = new Date(2026, 9, 2, 12).getTime()
const TIME = '2026-10-02T12:00:00+03:00'

test('Open Pomodoro entries round-trip quoted escapes, Unicode and whole minutes', () => {
  const entry = {
    start: NOON,
    minutes: 25,
    description: 'Write "tests"\\notes\nnext\r\nline\t🍅',
    tags: ['work', 'api', 'two words'],
  }
  const text = formatEntry(entry)

  expect(text.includes('\n')).toBe(false)
  expect(text.includes(' description="')).toBe(true)
  expect(parseEntry(text)).toEqual(entry)
  expect(parseEntry(formatEntry({ ...entry, start: NOON + 123 }))).toEqual({ ...entry, start: NOON + 123 })
})

test('Open Pomodoro matches the CLI field order and omits empty fields', () => {
  const empty = { start: NOON, minutes: 25, description: '', tags: [] }
  const text = formatEntry(empty)
  const offset = -new Date(NOON).getTimezoneOffset()
  const hours = String(Math.floor(Math.abs(offset) / 60)).padStart(2, '0')
  const minutes = String(Math.abs(offset) % 60).padStart(2, '0')

  expect(text).toBe(`2026-10-02T12:00:00${offset < 0 ? '-' : '+'}${hours}:${minutes} duration=25`)
  expect(parseEntry(text)).toEqual(empty)
  expect(formatEntry({ ...empty, description: 'Blog post', tags: ['writing', 'personal'] }).endsWith(' description="Blog post" duration=25 tags=writing,personal')).toBe(true)
  expect(formatEntry({ ...empty, description: 'Code' }).endsWith(' description=Code duration=25')).toBe(true)
})

test('the CLI lines read with bare minutes, durations and optional attributes', () => {
  expect(parseEntry(`${TIME} description="Blog post" duration=25 tags=writing,personal`)).toEqual({
    start: Date.parse(TIME), minutes: 25, description: 'Blog post', tags: ['writing', 'personal'],
  })
  expect(parseEntry(`${TIME} duration=25m`)).toEqual({ start: Date.parse(TIME), minutes: 25, description: '', tags: [] })
  expect(parseEntry(`${TIME} duration=1h30m tags=work`)?.minutes).toBe(90)
  expect(parseEntry(`${TIME} duration=90s`)?.minutes).toBe(1.5)
  expect(parseEntry(`${TIME} duration=22m30s`)?.minutes).toBe(22.5)
  expect(parseEntry(`${TIME} ignored="with spaces" description=Code`)?.description).toBe('Code')
  expect(parseEntry(TIME)?.minutes).toBe(25)
})

test('unreadable lines read as nothing', () => {
  for (const line of ['', '  ', 'not a timestamp', '2026-10-02', `${TIME} duration=nope`, `${TIME} description="unfinished`, `${TIME} duration=Infinity`, `${TIME} duration=25mgarbage`]) {
    expect(parseEntry(line)).toBe(undefined)
  }
})

test('round entries use actual focus rounded to at least one minute', () => {
  const round: Round = {
    start: NOON, end: NOON + 12 * 60_000, plannedMs: 25 * 60_000,
    focusMs: 11 * 60_000 + 31_000, claudeMs: 0, prompts: 0,
    status: 'stopped', label: 'Work', tags: ['api'], projects: [],
  }

  expect(entryOfRound(round)).toEqual({ start: NOON, minutes: 12, description: 'Work', tags: ['api'] })
  expect(entryOfRound({ ...round, focusMs: 0 }).minutes).toBe(1)
  expect(entryOfRound({ ...round, focusMs: 29_000 }).minutes).toBe(1)
})
