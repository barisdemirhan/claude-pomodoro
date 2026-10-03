// What the report pane shows, told from the history alone: the days, weeks
// and hours of focus, and where it went. Nothing of Claude Code is in it.

import { bestStreakOf, dayOf, dayTotals, streakOf, totalOf } from './history'
import type { Day, History, Round } from './history'
import { toCount } from './values'

export type DayBar = { day: string; rounds: number; focusMs: number }
export type Share = { name: string; rounds: number; focusMs: number }
export type Insights = {
  today: DayBar
  /** The daily goal in rounds: 0 for none. */
  goal: number
  /** Days in a row with a focus round, up to today. */
  streak: number
  /** The most days in a row there ever was one. */
  best: number
  total: Day
  /** The last 7 days, oldest first, today last. */
  week: DayBar[]
  /**
   * The last 12 weeks, oldest first, each a column of its days from Monday:
   * the current week's stops at today.
   */
  weeks: DayBar[][]
  /** Done rounds by the hour they began, over the last 30 days. */
  hours: number[]
  /** The 5 projects with the most focus over the last 30 days. */
  projects: Share[]
  /** The 5 tags with the most focus over the last 30 days. */
  tags: Share[]
  /** How much of the last 7 days' focus Claude worked through: 0 to 1. */
  claudeShare: number
}

const WEEK_DAYS = 7
const WEEKS = 12
const RECENT_DAYS = 30
const HOURS = 24
const TOP = 5
const NO_DAY: Day = { rounds: 0, focusMs: 0 }

const barOf = (days: Readonly<Record<string, Day>>, day: string): DayBar => ({
  day,
  ...(days[day] ?? NO_DAY),
})

/** The rounds that ended on one of the last `count` days, today the last. */
const endedWithin = (
  history: History,
  now: number,
  count: number,
): Round[] => {
  const first = dayOf(now, count - 1)
  const today = dayOf(now)

  return history.rounds.filter((round) => {
    const day = dayOf(round.end)

    return day >= first && day <= today
  })
}

/** Each of the 12 weeks up to today, its days from Monday on. */
const weeksOf = (
  days: Readonly<Record<string, Day>>,
  now: number,
): DayBar[][] => {
  const sinceMonday = (new Date(now).getDay() + 6) % WEEK_DAYS

  return Array.from({ length: WEEKS }, (_, week) => {
    const monday = sinceMonday + (WEEKS - 1 - week) * WEEK_DAYS

    return Array.from({ length: WEEK_DAYS }, (_, weekday) => monday - weekday)
      .filter((daysBack) => daysBack >= 0)
      .map((daysBack) => barOf(days, dayOf(now, daysBack)))
  })
}

const hoursOf = (rounds: readonly Round[]): number[] => {
  const hours = Array.from({ length: HOURS }, () => 0)

  rounds
    .filter((round) => round.status === 'done')
    .forEach((round) => {
      const hour = new Date(round.start).getHours()
      hours[hour] = (hours[hour] ?? 0) + 1
    })

  return hours
}

/** The names with the most focus, each with its focus and its done rounds. */
const topOf = (
  rounds: readonly Round[],
  namesOf: (round: Round) => readonly string[],
): Share[] => {
  const shares = new Map<string, Share>()

  rounds.forEach((round) =>
    namesOf(round).forEach((name) => {
      const kept = shares.get(name) ?? { name, rounds: 0, focusMs: 0 }

      shares.set(name, {
        name,
        rounds: kept.rounds + (round.status === 'done' ? 1 : 0),
        focusMs: kept.focusMs + round.focusMs,
      })
    }),
  )

  return [...shares.values()]
    .filter((share) => share.rounds > 0 || share.focusMs > 0)
    .sort(
      (a, b) =>
        b.focusMs - a.focusMs ||
        b.rounds - a.rounds ||
        a.name.localeCompare(b.name),
    )
    .slice(0, TOP)
}

const claudeShareOf = (rounds: readonly Round[]): number => {
  const focusMs = rounds.reduce((sum, round) => sum + round.focusMs, 0)
  const claudeMs = rounds.reduce((sum, round) => sum + round.claudeMs, 0)

  return focusMs > 0 ? Math.min(claudeMs / focusMs, 1) : 0
}

/**
 * The report as of `now`. Days count a round on the day it ended, as the
 * stats do; projects, tags, hours and Claude's share come from the rounds
 * alone, the days kept as totals having none of that.
 */
export const insightsOf = (
  history: History,
  now: number,
  goal: number,
): Insights => {
  const days = dayTotals(history)
  const recent = endedWithin(history, now, RECENT_DAYS)

  return {
    today: barOf(days, dayOf(now)),
    goal: toCount(goal),
    streak: streakOf(days, now),
    best: bestStreakOf(days),
    total: totalOf(days),
    week: Array.from({ length: WEEK_DAYS }, (_, index) =>
      barOf(days, dayOf(now, WEEK_DAYS - 1 - index)),
    ),
    weeks: weeksOf(days, now),
    hours: hoursOf(recent),
    projects: topOf(recent, (round) => round.projects),
    tags: topOf(recent, (round) => round.tags),
    claudeShare: claudeShareOf(endedWithin(history, now, WEEK_DAYS)),
  }
}
