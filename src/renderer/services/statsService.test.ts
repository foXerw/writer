import { describe, it, expect } from 'vitest'
import { EMPTY_STATS, addWords, computeStreak, todayWords } from './statsService'

describe('statsService smoke tests', () => {
  it('addWords(EMPTY_STATS, 5) -> todayWords() === 5', () => {
    const next = addWords(EMPTY_STATS, 5)
    expect(todayWords(next)).toBe(5)
  })

  it('computeStreak empty data returns 0', () => {
    expect(computeStreak(EMPTY_STATS)).toBe(0)
  })
})
