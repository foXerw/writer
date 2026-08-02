import type { DayStat, StatsData } from '../../common/ipc'

export const STATS_HISTORY_LIMIT = 90
export const STATS_DURATION_TICK_MS = 60_000   // 活跃计时 tick
export const STATS_IDLE_THRESHOLD_MS = 60_000  // 近 60s 有按键算活跃
export const EMPTY_STATS: StatsData = { dailyHistory: {} }

export function todayKey(d: Date = new Date()): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function ensureToday(stats: StatsData, d: Date = new Date()): StatsData {
  const key = todayKey(d)
  if (stats.dailyHistory[key]) return stats
  return { ...stats, dailyHistory: { ...stats.dailyHistory, [key]: { words: 0, minutes: 0 } } }
}

export function addWords(stats: StatsData, delta: number, d: Date = new Date()): StatsData {
  if (delta <= 0) return stats
  const key = todayKey(d)
  const withToday = ensureToday(stats, d)
  const day: DayStat = withToday.dailyHistory[key] ?? { words: 0, minutes: 0 }
  const next: StatsData = {
    ...withToday,
    dailyHistory: { ...withToday.dailyHistory, [key]: { ...day, words: day.words + delta } }
  }
  return trimHistory(next, d)
}

export function addMinutes(stats: StatsData, minutes: number, d: Date = new Date()): StatsData {
  if (minutes <= 0) return stats
  const key = todayKey(d)
  const withToday = ensureToday(stats, d)
  const day: DayStat = withToday.dailyHistory[key] ?? { words: 0, minutes: 0 }
  const next: StatsData = {
    ...withToday,
    dailyHistory: { ...withToday.dailyHistory, [key]: { ...day, minutes: day.minutes + minutes } }
  }
  return trimHistory(next, d)
}

export function computeStreak(stats: StatsData, d: Date = new Date()): number {
  let streak = 0
  const cursor = new Date(d)
  // 今日尚未写则从昨日起算（streak at risk 但仍展示）
  if ((stats.dailyHistory[todayKey(cursor)]?.words ?? 0) === 0) {
    cursor.setDate(cursor.getDate() - 1)
  }
  while ((stats.dailyHistory[todayKey(cursor)]?.words ?? 0) > 0) {
    streak++
    cursor.setDate(cursor.getDate() - 1)
  }
  return streak
}

export function todayWords(stats: StatsData, d: Date = new Date()): number {
  return stats.dailyHistory[todayKey(d)]?.words ?? 0
}

export function todayMinutes(stats: StatsData, d: Date = new Date()): number {
  return stats.dailyHistory[todayKey(d)]?.minutes ?? 0
}

export function recentHistory(
  stats: StatsData,
  days: number,
  d: Date = new Date()
): { date: string; words: number; minutes: number }[] {
  const out: { date: string; words: number; minutes: number }[] = []
  for (let i = days - 1; i >= 0; i--) {
    const dd = new Date(d)
    dd.setDate(dd.getDate() - i)
    const key = todayKey(dd)
    const day: DayStat = stats.dailyHistory[key] ?? { words: 0, minutes: 0 }
    out.push({ date: key, words: day.words, minutes: day.minutes })
  }
  return out
}

export function trimHistory(stats: StatsData, _d: Date = new Date()): StatsData {
  const keys = Object.keys(stats.dailyHistory).sort() // ISO 日期字典序=时间序
  if (keys.length <= STATS_HISTORY_LIMIT) return stats
  const keep = new Set(keys.slice(keys.length - STATS_HISTORY_LIMIT))
  const dailyHistory: Record<string, DayStat> = {}
  for (const k of Object.keys(stats.dailyHistory)) {
    if (keep.has(k)) dailyHistory[k] = stats.dailyHistory[k]
  }
  return { ...stats, dailyHistory }
}
