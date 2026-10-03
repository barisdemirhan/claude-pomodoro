// The report pane `/pomodoro report` opens: today against the goal, the days
// in a row, the last week and twelve weeks of focus, the hours it happens in
// and where it went. It draws the history `load` hands it and writes nothing.

import { atom, read } from 'claude-code'
import type {
  ElementConstructor,
  On,
  PaneOpenArgs,
  RasterProps,
  RenderElement,
} from 'claude-code'

import { plural, spanText } from './history'
import type { History } from './history'
import { insightsOf } from './insights'
import type { DayBar, Insights, Share } from './insights'

/** Reads the value the plugin's store keeps under `key`. */
export type StoreGet = (key: string) => Promise<unknown>
export type ReportLoad = (get: StoreGet) => Promise<{ history: History; goal: number }>
// A line of text and how strongly it is drawn.
type Line = { text: string; isStrong: boolean; isDim: boolean }

export const REPORT_PANE = 'pomodoro-report'

/**
 * The pane as `/pomodoro report` opens it: with the keys, Escape closing it.
 * The host follows `$` into no function of another file, so the command
 * calls `$.ui.open(REPORT_OPEN)` itself.
 */
export const REPORT_OPEN: PaneOpenArgs = {
  id: REPORT_PANE,
  title: 'Pomodoro',
  focus: true,
  closeOnEscape: true,
}

/**
 * Bumped each time a round is recorded, so an open pane draws again. The
 * host lists only the state a file names itself, so the module that bumps it
 * makes its own atom of the same name.
 */
const historyVersion = atom(
  { plugin: 'pomodoro', key: 'historyVersion' } as const,
  0,
)

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
// A day's name, its bar and its span, a cell between each.
const NAME_WIDTH = 4
const MAX_BAR = 40
// No focus, then each quarter of the most focus a day had.
const HEAT = ['·', '░', '▒', '▓', '█']
const SPARK = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█']
const AXIS = ['0', '6', '12', '18'].map((hour) => hour.padEnd(6)).join('')
// A Raster cell is three little-endian u32: its glyph and two colors.
const CELL_BYTES = 12
const DEFAULT_COLOR = 0x01000000
const EMPTY_TEXT = 'No focus rounds yet. /pomodoro start begins one.'

const widthOf = (text: string): number => [...text].length

/** `text` cut to `width` cells, an ellipsis where it was cut. */
const cut = (text: string, width: number): string =>
  widthOf(text) > width
    ? `${[...text].slice(0, Math.max(0, width - 1)).join('')}…`
    : text

/** Parts joined with ` · ` into lines no wider than `width`. */
const packed = (parts: readonly string[], width: number): string[] =>
  parts.reduce<string[]>((lines, part) => {
    const last = lines.at(-1)

    return last !== undefined && widthOf(`${last} · ${part}`) <= width
      ? [...lines.slice(0, -1), `${last} · ${part}`]
      : [...lines, part]
  }, [])

const headerOf = ({ today, goal, streak, best, total }: Insights): string[] => [
  `Today ${goal > 0 ? `${today.rounds}/${goal} rounds` : plural(today.rounds, 'round')}, ${spanText(today.focusMs)}`,
  `${plural(streak, 'day')} in a row (best ${best})`,
  `${plural(total.rounds, 'round')}, ${spanText(total.focusMs)} in all`,
]

/** The name of a `2026-10-02` day: `Fri`. */
const nameOf = (day: string): string => {
  const [year = 0, month = 1, date = 1] = day.split('-').map(Number)

  return WEEKDAYS[(new Date(year, month - 1, date).getDay() + 6) % 7] ?? ''
}

/** Each day as its name, a bar as long as its share of the most focus, and its span. */
const weekLines = (
  week: readonly DayBar[],
  today: string,
  width: number,
): Line[] => {
  const spanWidth = Math.max(...week.map((bar) => spanText(bar.focusMs).length))
  const room = Math.max(0, Math.min(MAX_BAR, width - NAME_WIDTH - spanWidth - 1))
  const most = Math.max(...week.map((bar) => bar.focusMs))

  return week.map((bar) => {
    const length =
      bar.focusMs > 0
        ? Math.min(room, Math.max(1, Math.round((bar.focusMs / most) * room)))
        : 0

    return {
      text: `${nameOf(bar.day)} ${'█'.repeat(length).padEnd(room)} ${spanText(bar.focusMs).padStart(spanWidth)}`,
      isStrong: bar.day === today,
      isDim: bar.focusMs === 0 && bar.day !== today,
    }
  })
}

/**
 * The weeks as seven rows of glyphs, one per weekday from Monday and a
 * column per week, the denser the more focus. As many of the latest weeks
 * as `width` holds; a cell between weeks when there is room.
 */
const heatRows = (weeks: readonly DayBar[][], width: number): string[] => {
  // Too narrow for the weekday names, the weeks alone, as many as fit.
  const hasNames = width > NAME_WIDTH
  const room = Math.max(1, hasNames ? width - NAME_WIDTH : width)
  const cell = room >= weeks.length * 2 ? 2 : 1
  const shown = weeks.slice(-Math.max(1, Math.floor(room / cell)))
  const most = Math.max(0, ...weeks.flat().map((bar) => bar.focusMs))
  const glyphOf = (bar: DayBar | undefined): string => {
    if (bar === undefined) {
      return ' '
    }

    const level =
      bar.focusMs > 0 ? Math.ceil((bar.focusMs / most) * (HEAT.length - 1)) : 0

    return HEAT[level] ?? ' '
  }

  return WEEKDAYS.map(
    (name, weekday) =>
      `${hasNames ? `${name} ` : ''}${shown.map((week) => glyphOf(week[weekday]).padEnd(cell)).join('')}`,
  )
}

/** Rows of glyphs as a Raster's `cells`, each in the terminal's own colors. */
const cellsOf = (rows: readonly string[]): string => {
  const glyphs = rows.flatMap((row) => [...row])
  const view = new DataView(new ArrayBuffer(glyphs.length * CELL_BYTES))

  glyphs.forEach((glyph, index) => {
    const at = index * CELL_BYTES
    view.setUint32(at, glyph.codePointAt(0) ?? 0x20, true)
    view.setUint32(at + 4, DEFAULT_COLOR, true)
    view.setUint32(at + 8, DEFAULT_COLOR, true)
  })

  return btoa(String.fromCharCode(...new Uint8Array(view.buffer)))
}

/** The heat rows as one Raster: the terminal's own grid of cells. */
const heatRaster = (
  Raster: ElementConstructor<RasterProps>,
  rows: readonly string[],
): RenderElement => (
  <Raster
    key="heat"
    columns={widthOf(rows[0] ?? ' ')}
    rows={rows.length}
    cells={cellsOf(rows)}
  />
)

/** The hours as one glyph each, taller for more rounds: blank for none. */
const sparkOf = (hours: readonly number[]): string => {
  const most = Math.max(...hours)

  return hours
    .map((count) =>
      count > 0 ? (SPARK[Math.ceil((count / most) * SPARK.length) - 1] ?? '█') : ' ',
    )
    .join('')
}

/** Each share as its name, its focus and its rounds, in columns. */
const shareLines = (
  shares: readonly Share[],
  prefix: string,
  width: number,
): string[] => {
  const rows = shares.map((share) => ({
    name: `${prefix}${share.name}`,
    span: spanText(share.focusMs),
    count: plural(share.rounds, 'round'),
  }))
  const spanWidth = Math.max(...rows.map((row) => row.span.length))
  const countWidth = Math.max(...rows.map((row) => row.count.length))
  const nameWidth = Math.max(
    1,
    Math.min(
      Math.max(...rows.map((row) => widthOf(row.name))),
      width - spanWidth - countWidth - 4,
    ),
  )

  return rows.map(
    ({ name, span, count }) =>
      `${cut(name, nameWidth).padEnd(nameWidth + name.length - widthOf(name))}  ${span.padStart(spanWidth)}  ${count.padStart(countWidth)}`,
  )
}

/**
 * Draws the report pane on every surface from what `load` reads through the
 * store's `get`: never `$` itself, which the host follows into no function
 * handed in. The pane draws again whenever `historyVersion` is bumped.
 */
export const registerReport = (on: On, load: ReportLoad): void => {
  on('ui.render', { component: 'Pane', requestId: REPORT_PANE }, async ($, e) => {
    await read($, historyVersion)
    const { history, goal } = await load((key) => $.store.get(key))
    const report = insightsOf(history, await $.clock.now(), goal)
    const width = Math.max(1, e.props.bodyColumns)
    const { Box, Button, Text } = $.ui.resolve(e)
    const close = (): void => {
      void $.ui.close({ id: REPORT_PANE }).catch(() => undefined)
    }
    const closer = (
      <Box>
        <Button key="close" role="dismiss" onPress={close}>
          Close
        </Button>
      </Box>
    )

    if (report.total.rounds === 0 && report.total.focusMs === 0) {
      return (
        <Box flexDirection="column" gap={1}>
          <Text>{EMPTY_TEXT}</Text>
          {closer}
        </Box>
      )
    }

    const rows = heatRows(report.weeks, width)
    const heat =
      e.surface === 'terminal'
        ? heatRaster($.ui.resolve(e).Raster, rows)
        : rows.map((row) => <Text wrap="truncate">{row}</Text>)
    const weekFocusMs = report.week.reduce((sum, bar) => sum + bar.focusMs, 0)
    const hasHours = report.hours.some((count) => count > 0)

    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="column">
          {packed(headerOf(report), width).map((line) => (
            <Text bold>{line}</Text>
          ))}
        </Box>
        <Box flexDirection="column">
          <Text dimColor>Last 7 days</Text>
          {weekLines(report.week, report.today.day, width).map((line) => (
            <Text bold={line.isStrong} dimColor={line.isDim} wrap="truncate">
              {line.text}
            </Text>
          ))}
        </Box>
        <Box flexDirection="column">
          <Text dimColor>Last 12 weeks</Text>
          {heat}
          <Text dimColor>{`less ${HEAT.join(' ')} more`}</Text>
        </Box>
        {hasHours && (
          <Box flexDirection="column">
            <Text dimColor>Rounds by hour, last 30 days</Text>
            <Text wrap="truncate">{sparkOf(report.hours)}</Text>
            <Text dimColor wrap="truncate">
              {AXIS}
            </Text>
          </Box>
        )}
        {report.projects.length > 0 && (
          <Box flexDirection="column">
            <Text dimColor>Projects, last 30 days</Text>
            {shareLines(report.projects, '', width).map((line) => (
              <Text wrap="truncate">{line}</Text>
            ))}
          </Box>
        )}
        {report.tags.length > 0 && (
          <Box flexDirection="column">
            <Text dimColor>Tags, last 30 days</Text>
            {shareLines(report.tags, '#', width).map((line) => (
              <Text wrap="truncate">{line}</Text>
            ))}
          </Box>
        )}
        {weekFocusMs > 0 && (
          <Text>{`Claude worked ${Math.round(report.claudeShare * 100)}% of your focus time in the last 7 days.`}</Text>
        )}
        {closer}
      </Box>
    )
  })
}
