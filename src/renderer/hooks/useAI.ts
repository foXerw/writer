// AI 对话 Hook（M4a Task 4）：ai:chat fire-and-forget 通道的渲染层收口。
//
// 监听器池模式（与 useBookEvents 同一纪律，但只挂一次）：
// - hook 实例 mount 时在 ai:chunk/ai:done/ai:error 三个通道各注册 1 个监听（preload 侧
//   removeListener 精确反订阅，绝不 removeAllListeners）；
// - 每次 chat() 只向 handlerMap 登记 {requestId → handlers}，事件按 requestId 分发——
//   并发多请求互不串台；done/error 是终态，分发后立即删除登记（防泄漏）；
// - 卸载时反订阅 + 清空登记（在途结果到达因无主而静默丢弃；主进程侧请求继续跑完，
//   取消须由调用方显式 cancel()）。
//
// 双路失败兜底（契约见 chatService.ts 文件头）：
// - 受理前失败 = invoke reject，message 带 `[kind] ` 前缀 → 这里解包后走同一条 onError，
//   保证组件只见一种错误形状（AiErrorEvent.kind + 纯文本 message）；
// - 受理后失败 = ai:error 事件。已 reject 的 id 会被同步从登记表删除，不会二次触发。
import { useCallback, useEffect, useRef } from 'react'
import type { AiChatRequest, AiErrorEvent } from '@/common/ai-types'

export interface AIChatHandlers {
  /** provider 增量文本（0..n 次） */
  onChunk?: (text: string) => void
  /** 成功终态（恰好一次，随后登记被清理） */
  onDone?: (usage: { promptTokens: number; completionTokens: number; cachedTokens?: number }) => void
  /** 失败终态（受理前 reject 解包与 ai:error 事件都归到这里；恰好一次） */
  onError?: (kind: AiErrorEvent['kind'], message: string) => void
}

export type AIChatRequestWithoutId = Omit<AiChatRequest, 'requestId'>

const KIND_PREFIX_RE = /^\[(not-configured|auth|network|timeout|provider|cancelled|busy)\]\s+/

/**
 * electron ipcMain.handle 的 reject 到渲染层永远裹一层
 * `Error invoking remote method 'ai:chat': Error: …`（本仓库 bookErrors.ts 交过同款学费：
 * 裸 anchored 匹配在真实 IPC 边界必然失配）。归一化三步：①剥头部包装（含可选 `Error: `）；
 * ②裁掉尾部 stack 行（`\n    at …` 起整段丢弃，展示面不背帧栈）；③再对解包后的文本做
 * anchored `[kind] ` 解析——chatService 保证 tag 在 message 头部，所以「剥包装后锚定」
 * 是诚实做法，不做全文扫描（正文字样里出现 `[busy] ` 开头的行不该被误路由）。
 */
const IPC_WRAPPER_RE = /^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/

export function parseKindTaggedError(raw: string): { kind: AiErrorEvent['kind']; message: string } {
  const unwrapped = raw.replace(IPC_WRAPPER_RE, '')
  const nl = unwrapped.indexOf('\n    at ')
  const message = nl >= 0 ? unwrapped.slice(0, nl) : unwrapped
  const m = KIND_PREFIX_RE.exec(message)
  if (!m) return { kind: 'provider', message }
  return { kind: m[1] as AiErrorEvent['kind'], message: message.slice(m[0].length) }
}

function genRequestId(): string {
  // Electron 渲染进程恒为安全上下文，randomUUID 可用；非安全上下文的极小兜底
  const c = globalThis.crypto
  if (c && typeof c.randomUUID === 'function') return c.randomUUID()
  return `ai-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

export function useAI(): {
  chat: (req: AIChatRequestWithoutId, handlers: AIChatHandlers) => Promise<string>
  cancel: (requestId: string) => Promise<boolean>
} {
  const handlerMap = useRef(new Map<string, AIChatHandlers>())

  useEffect(() => {
    const on = window.novelWriter?.on
    if (!on?.aiChunk || !on?.aiDone || !on?.aiError) return // 非 Electron/旧 preload：静默降级
    const map = handlerMap.current

    // 分发即隔离：组件 handler 抛错只 warn（镜像 entityEvents 的监听器隔离纪律）
    const consume = (requestId: string, terminal: boolean, call: (h: AIChatHandlers) => void): void => {
      const h = map.get(requestId)
      if (!h) return // 无主事件（已卸载/已终态/其他窗口发起的 id）：静默丢弃
      if (terminal) map.delete(requestId)
      try {
        call(h)
      } catch (error) {
        console.error('[useAI] 事件 handler 抛错（已隔离）：', error)
      }
    }

    const unsubs = [
      on.aiChunk((event) => consume(event.requestId, false, (h) => h.onChunk?.(event.text))),
      on.aiDone((event) => consume(event.requestId, true, (h) => h.onDone?.(event.usage))),
      on.aiError((event) => consume(event.requestId, true, (h) => h.onError?.(event.kind, event.message)))
    ]
    return () => {
      for (const unsub of unsubs) unsub()
      map.clear()
    }
  }, [])

  /** 发起对话；resolve 出 requestId（供 cancel）。任何失败都只经 handlers 回报，本 promise 不 reject。 */
  const chat = useCallback(async (req: AIChatRequestWithoutId, handlers: AIChatHandlers): Promise<string> => {
    const requestId = genRequestId()
    handlerMap.current.set(requestId, handlers)
    try {
      await window.novelWriter.ai.chat({ ...req, requestId })
    } catch (err) {
      // 受理前失败：不会有后续事件，就地终态清理并解包 kind
      handlerMap.current.delete(requestId)
      const { kind, message } = parseKindTaggedError(String((err as Error)?.message ?? err))
      try {
        handlers.onError?.(kind, message)
      } catch (error) {
        console.error('[useAI] onError handler 抛错（已隔离）：', error)
      }
    }
    return requestId
  }, [])

  /** 取消在途请求；true = 本次调用触发了 abort（重复/未知 id 为 false）。终态清理交给 ai:error。 */
  const cancel = useCallback(async (requestId: string): Promise<boolean> => {
    return window.novelWriter.ai.cancel(requestId)
  }, [])

  return { chat, cancel }
}
