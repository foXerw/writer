import { useState, useEffect, useRef, useCallback } from 'react'
import { useStats } from '../../../hooks/useIPC'
import {
  EMPTY_STATS, addWords, addMinutes, todayWords, todayMinutes,
  computeStreak, recentHistory, STATS_DURATION_TICK_MS, STATS_IDLE_THRESHOLD_MS
} from '../../../services/statsService'
import { countWords } from '@/common/wordCount'
import type { Chapter, StatsData } from '@/common/ipc'

export interface WritingStatsView {
  todayWordCount: number
  todayMinutes: number
  totalWordCount: number
  streak: number
  history: { date: string; words: number; minutes: number }[]
  persistNow: () => void
}

// 写作统计 —— Task 7 自原 Workspace/index.tsx 统计段迁移：
// 加载 stats、countWords 增量（切章重置基线，与 Task 4 口径汇合）、60s 活跃分钟、3s 防抖落盘。
export function useWritingStats(args: {
  projectPath: string | undefined
  chapters: Chapter[]
  editorContent: string
  currentChapterId: string | null
}): WritingStatsView {
  const { projectPath, chapters, editorContent, currentChapterId } = args
  const { getStats, saveStats } = useStats()

  // 今日字数/时长/历史（持久化于项目目录）
  const [stats, setStats] = useState<StatsData>(EMPTY_STATS)
  const statsRef = useRef(stats)
  statsRef.current = stats
  const statsLoadedRef = useRef(false)
  const lastActivityRef = useRef(0)      // 最近一次按键时间戳
  // 镜像 ref：供 persistNow（beforeunload / 返回首页调用）避免陈旧闭包
  const projectPathRef = useRef(projectPath)
  projectPathRef.current = projectPath
  // 增量基线：{ 章节 id, 上一刻字数（countWords 口径） }
  const baselineRef = useRef({ chapterId: currentChapterId, words: countWords(editorContent) })
  const firstRunRef = useRef(true)

  // 载入项目写作统计（原在 loadChapters 内的 getStats 段；仅随 projectPath 加载一次）
  useEffect(() => {
    if (!projectPath) return
    let cancelled = false
    const load = async () => {
      try {
        const loaded = await getStats(projectPath)
        if (!cancelled) setStats(loaded && loaded.dailyHistory ? loaded : EMPTY_STATS)
      } catch (e) {
        console.error('载入统计失败:', e)
        if (!cancelled) setStats(EMPTY_STATS)
      }
      if (!cancelled) statsLoadedRef.current = true
    }
    void load()
    return () => { cancelled = true }
  }, [projectPath, getStats])

  // 字数增量：正向 delta 累计今日（口径 = countWords 差值）；记录活跃时间戳。
  // 切章（currentChapterId 变化）只重置基线，切换本身不计增量、不算活跃。
  useEffect(() => {
    if (firstRunRef.current) {
      firstRunRef.current = false
      baselineRef.current = { chapterId: currentChapterId, words: countWords(editorContent) }
      return
    }
    if (baselineRef.current.chapterId !== currentChapterId) {
      baselineRef.current = { chapterId: currentChapterId, words: countWords(editorContent) }
      return
    }
    const curWords = countWords(editorContent)
    const delta = curWords - baselineRef.current.words
    baselineRef.current = { chapterId: currentChapterId, words: curWords }
    if (delta > 0) {
      setStats(s => addWords(s, delta))
    }
    lastActivityRef.current = Date.now()
  }, [editorContent, currentChapterId])

  // 写作时长：每 60s，若近 IDLE 阈值内有按键则今日 +1 分钟
  useEffect(() => {
    if (!projectPath) return
    const timer = setInterval(() => {
      if (Date.now() - lastActivityRef.current < STATS_IDLE_THRESHOLD_MS) {
        setStats(s => addMinutes(s, 1))
      }
    }, STATS_DURATION_TICK_MS)
    return () => clearInterval(timer)
  }, [projectPath])

  // 统计持久化：变化后防抖 3s 写盘
  useEffect(() => {
    if (!projectPath || !statsLoadedRef.current) return
    const t = setTimeout(() => { void saveStats(projectPath, stats) }, 3000)
    return () => clearTimeout(t)
  }, [stats, projectPath, saveStats])

  // 立即落盘（fire-and-forget）：beforeunload / 返回首页调用
  const persistNow = useCallback(() => {
    if (projectPathRef.current) void saveStats(projectPathRef.current, statsRef.current)
  }, [saveStats])

  return {
    todayWordCount: todayWords(stats),
    todayMinutes: todayMinutes(stats),
    totalWordCount: chapters.reduce((sum, c) => sum + c.wordCount, 0),
    streak: computeStreak(stats),
    history: recentHistory(stats, 14),
    persistNow
  }
}
