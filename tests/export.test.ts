import { expect, test } from 'claude-code/testing'
import { exportText } from '../hooks/export'
import type { Round } from '../hooks/history'

const NOON = new Date(2026, 9, 2, 12)
const ROUND: Round = {
  start: NOON.getTime(),
  end: NOON.getTime() + 25 * 60_000,
  focusMs: 24 * 60_000 + 36_000,
  plannedMs: 25 * 60_000,
  status: 'done',
  label: 'Write tests',
  tags: ['work', 'api'],
  projects: ['pomodoro', 'client'],
  claudeMs: 3 * 60_000 + 14_000,
  prompts: 4,
}

const offsetOf = (date: Date): string => {
  const offset = -date.getTimezoneOffset()
  const hours = String(Math.floor(Math.abs(offset) / 60)).padStart(2, '0')
  const minutes = String(Math.abs(offset) % 60).padStart(2, '0')

  return `${offset < 0 ? '-' : '+'}${hours}:${minutes}`
}

test('JSON exports the round fields, local offsets and tenths of a minute', () => {
  const text = exportText([ROUND], 'json')
  expect(text.startsWith('[\n  {\n')).toBe(true)
  expect(JSON.parse(text)).toEqual([{
    start: `2026-10-02T12:00:00${offsetOf(NOON)}`,
    end: `2026-10-02T12:25:00${offsetOf(new Date(ROUND.end))}`,
    focusMinutes: 24.6,
    plannedMinutes: 25,
    status: 'done',
    label: 'Write tests',
    tags: ['work', 'api'],
    projects: ['pomodoro', 'client'],
    claudeMinutes: 3.2,
    prompts: 4,
  }])
})

test('CSV quotes commas, quotes and line breaks, leaving ordinary fields bare', () => {
  const text = exportText([{
    ...ROUND,
    label: 'Say "hello", then\r\nwork',
    tags: ['work', 'api'],
    projects: ['a,b', 'c"d'],
  }], 'csv')

  expect(text.startsWith('start,end,focus_minutes,planned_minutes,status,label,tags,projects,claude_minutes,prompts\r\n')).toBe(true)
  expect(text.includes(',24.6,25,done,"Say ""hello"", then\r\nwork",work;api,"a,b;c""d",3.2,4\r\n')).toBe(true)
  expect(exportText([ROUND], 'csv').includes(',done,Write tests,work;api,pomodoro;client,')).toBe(true)
})

test('iCal uses UTC times and escapes text while keeping categories separate', () => {
  const text = exportText([{
    ...ROUND,
    status: 'stopped',
    label: 'Plan\\work; check,\nnext',
    tags: ['a,b', 'c;d', 'e\\f'],
    projects: ['one;two', 'next\r\nline'],
  }], 'ical').replace(/\r\n /g, '')
  const start = new Date(ROUND.start).toISOString().replace(/[-:]/g, '').replace('.000Z', 'Z')
  const end = new Date(ROUND.end).toISOString().replace(/[-:]/g, '').replace('.000Z', 'Z')

  expect(text.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//claude-pomodoro//EN\r\n')).toBe(true)
  expect(text.includes(`UID:${ROUND.start}@claude-pomodoro\r\nDTSTAMP:${end}\r\nDTSTART:${start}\r\nDTEND:${end}`)).toBe(true)
  expect(text.includes('SUMMARY:🍅 Plan\\\\work\\; check\\,\\nnext (stopped)\r\n')).toBe(true)
  expect(text.includes('CATEGORIES:a\\,b,c\\;d,e\\\\f\r\n')).toBe(true)
  expect(text.includes('DESCRIPTION:Projects: one\\;two\\, next\\nline\\nFocus minutes: 24.6\\nClaude minutes: 3.2\r\n')).toBe(true)
  expect(text.endsWith('END:VEVENT\r\nEND:VCALENDAR\r\n')).toBe(true)
})

test('iCal folds long multi-byte labels at 75 bytes without losing characters', () => {
  const label = '🍅漢é'.repeat(45)
  const text = exportText([{ ...ROUND, label }], 'ical')
  const encoder = new TextEncoder()

  expect(text.includes('\r\n ')).toBe(true)
  expect(text.split('\r\n').every((line) => encoder.encode(line).length <= 75)).toBe(true)
  expect(text.replace(/\r\n /g, '').includes(`SUMMARY:🍅 ${label}\r\n`)).toBe(true)
  expect(text.includes('�')).toBe(false)
})

test('empty exports stay readable and unlabeled iCal events use Focus', () => {
  expect(exportText([], 'json')).toBe('[]')
  expect(exportText([], 'csv').split('\r\n').length).toBe(2)
  expect(exportText([], 'ical').includes('BEGIN:VEVENT')).toBe(false)
  const text = exportText([{ ...ROUND, label: '', tags: [] }, { ...ROUND, start: ROUND.start + 1, label: '', status: 'stopped' }], 'ical')
  expect(text.includes('SUMMARY:🍅 Focus\r\n')).toBe(true)
  expect(text.includes('SUMMARY:🍅 Focus (stopped)\r\n')).toBe(true)
  expect(text.split('BEGIN:VEVENT').length).toBe(3)
})
