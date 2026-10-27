// 书文件变更事件订阅（Task 9）：window.novelWriter.on.bookChanged 的薄包装——
// mount 订阅、unmount 反订阅（preload 侧 removeListener 精确摘除，镜像 menu.onEvent 先例）。
// handlers 经 ref 镜像读最新闭包：订阅本身不随 handler 身份变化重挂（惯用法同 useAutoSave/
// useEditorSession 的 flushIfDirtyRef），避免事件风暴期间的重复订阅窗口。
import { useEffect, useRef } from 'react'

export interface BookEventHandlers {
  /**
   * 书目录外部变更（主进程 watcher 300ms debounce 合并后的一次广播）。
   * paths = 相对书根、正斜杠、升序去重的变更路径（如 `chapters/<id>.md`）。
   * 注意：本应用自身的写盘在发送前已被 watcher 按自写窗口（~1s）剔除（修订轮2 I1），
   * 常态只有外部改动到达这里；但越窗迟出的自写仍可能漏进——处理方需对「值相同的刷新」
   * 保持无害（静默重拉即可）。应用内数据联动（如图谱刷新）不可依赖本事件，
   * 见 services/entityEvents 的渲染层通知通道（FI-1）。
   */
  onBookChanged: (paths: string[]) => void
}

export function useBookEvents(handlers: BookEventHandlers): void {
  const handlersRef = useRef(handlers)
  useEffect(() => {
    handlersRef.current = handlers
  })

  useEffect(() => {
    const on = window.novelWriter?.on
    if (!on?.bookChanged) return // 非 Electron 环境/旧 preload：静默降级（无自动刷新，功能不残）
    const unsubscribe = on.bookChanged((event) => {
      handlersRef.current.onBookChanged(event.paths)
    })
    return () => {
      unsubscribe()
    }
  }, [])
}
