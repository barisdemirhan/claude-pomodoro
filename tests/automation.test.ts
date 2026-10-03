import { expect, test } from 'claude-code/testing'
import { historyWith, historyWithout } from '../hooks/automation'
import { formatEntry } from '../hooks/openpomodoro'

const ENTRY = {
  start: new Date(2026, 9, 2, 12).getTime(),
  minutes: 25,
  description: 'Write tests',
  tags: ['work', 'api'],
}

test('history creates an empty file, appends new starts once, and rewrites a start it has', () => {
  const first = historyWith('', ENTRY) ?? ''
  expect(first).toBe(`${formatEntry(ENTRY)}\n`)
  expect(historyWith(first, ENTRY)).toBe(undefined)
  const finished = { ...ENTRY, minutes: 10 }
  expect(historyWith(first, finished)).toBe(`${formatEntry(finished)}\n`)
  const next = { ...ENTRY, start: ENTRY.start + 30 * 60_000 }
  expect(historyWith(first, next)).toBe(`${formatEntry(ENTRY)}\n${formatEntry(next)}\n`)
})

test('history finds the same instant written with a different offset, to rewrite or remove it', () => {
  const utc = new Date(ENTRY.start).toISOString()
  const other = `${new Date(ENTRY.start + 60 * 60_000).toISOString()} duration=25\n`
  const existing = `${utc} description="Other client" duration=25m tags=work\n${other}`
  expect(historyWith(existing, ENTRY)).toBe(`${formatEntry(ENTRY)}\n${other}`)
  expect(historyWithout(existing, ENTRY.start)).toBe(other)
  expect(historyWithout(other, ENTRY.start)).toBe(undefined)
})

test('history keeps old lines verbatim and separates an unterminated last line', () => {
  const old = { ...ENTRY, start: ENTRY.start - 30 * 60_000 }
  const existing = `unrecognized old line\r\n${formatEntry(old)}`
  expect(historyWith(existing, ENTRY)).toBe(`${existing}\n${formatEntry(ENTRY)}\n`)
  expect(historyWith(`${existing}\r\n`, ENTRY)).toBe(`${existing}\r\n${formatEntry(ENTRY)}\n`)
})
