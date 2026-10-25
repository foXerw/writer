import { useEffect, useRef } from 'react'

// 自动保存 —— Task 7 替代 services/autoSave.ts（Task 5 过渡文件，已删除）。
// 语义同现状：定时器只负责周期触发 flush；是否真正写盘由 flush 内部 dirty 门控决定。
export function useAutoSave(args: {
  enabled: boolean
  intervalMs: number
  chapterId: string | null
  flush: () => void
}): void {
  const { enabled, intervalMs, chapterId, flush } = args

  // 镜像最新 flush 闭包（语义同原 flushIfDirtyRef），定时器不随函数身份变化重建
  const flushRef = useRef(flush)
  useEffect(() => {
    flushRef.current = flush
  })

  useEffect(() => {
    if (!chapterId || !enabled) return
    const timer = setInterval(() => {
      flushRef.current()
    }, intervalMs)
    return () => clearInterval(timer)
    // 故意只依赖章节 id（切换章时重启定时器），非整个章节对象
  }, [chapterId, enabled, intervalMs])
}
