// provider 层共享 HTTP/SSE 工具 + fetch 注入接缝（M4a Task 3）。
//
// 注入模式（两个 provider 与测试统一遵守，钉死于此）：
//   生产代码只调用 `http.fetch(...)`（属性访问，非裸 fetch）；
//   测试用 `vi.spyOn(http, 'fetch').mockImplementation(...)` 替换——全目录唯一出口，
//   保证 100% 离线可测（vitest node 环境下真实 fetch 存在但绝不会被调到）。
//
// 安全不变量：本文件所有错误文本只拼 status/错误名/截断响应体，绝不读取或回显请求头；
// 远端提供的字符串（响应体、error 事件消息）拼入 message 前必须过 redactKey——
// 网关可能把 Authorization/x-api-key 原样回显在 401/403 正文里。

import { AiCallError, capMessage } from './types'
import type { ProviderChatOptions } from './types'

/** 可替换的 fetch 接缝（见文件头注入模式）。 */
export const http = {
  fetch: (...args: Parameters<typeof fetch>): Promise<Response> => fetch(...args)
}

/**
 * 默认超时（毫秒）。M4b Task 0 起语义为「空闲上限」而非总时长（见 linkSignal）：
 * 流式对话的合法长生成（organize 动辄数分钟）只要持续有增量就永不触发。
 * testConnection 无 chunk 流、noteActivity 无从被调 → 语义自然退化为 30s 总时长——连通性
 * 测试本就该快速结束，无需专门为其区分一套计时（这正是保留此默认值的理由）。
 */
export const DEFAULT_TIMEOUT_MS = 30_000

/** baseUrl + '/path' 归一：剥尾斜杠、补缺失的 '/'（配置里手输尾斜杠是常态）。 */
export function joinUrl(baseUrl: string, suffix: string): string {
  const base = baseUrl.trim().replace(/\/+$/, '')
  return base + (suffix.startsWith('/') ? suffix : `/${suffix}`)
}

export interface LinkedSignal {
  signal: AbortSignal
  /**
   * 报告一次流活动：清掉空闲计时器并重新起计 timeoutMs。
   * 连接建立前不得调用（调用方在 fetch+ensureOk 完成后才开始报）——连接阶段保持
   * 「一次性 timeoutMs 上限」，永不因慢连接无限续命。abort/cleanup 后调用为无效空转。
   */
  noteActivity(): void
  /** abort 归因：'timeout' | 'cancelled' | null（未 abort）。后到的原因忽略。 */
  cause(): 'timeout' | 'cancelled' | null
  /** 解除外部监听 + 清计时器；此后 noteActivity 永久失效。调用方在请求（含流读取）结束后 finally 调用。 */
  cleanup(): void
}

/**
 * 手动组合外部取消信号与超时（不用 AbortSignal.any：Electron28/Node18 运行时可用
 * 但 TS lib 形状不稳，且我们需要自己记录 abort 归因来区分 timeout/cancelled）。
 *
 * timeoutMs 是空闲上限（M4b Task 0 语义变更）：每次 noteActivity 重置计时器；
 * 无流可报活动的调用方（testConnection）自然退化为总时长上限。
 */
export function linkSignal(opts?: ProviderChatOptions): LinkedSignal {
  const controller = new AbortController()
  let cause: 'timeout' | 'cancelled' | null = null
  let timer: ReturnType<typeof setTimeout> | undefined
  const external = opts?.signal
  const idleMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS
  let closed = false

  const abortWith = (reason: 'timeout' | 'cancelled') => {
    if (controller.signal.aborted) return
    cause = reason
    controller.abort()
  }
  const onExternalAbort = () => abortWith('cancelled')

  if (external) {
    if (external.aborted) abortWith('cancelled')
    else external.addEventListener('abort', onExternalAbort)
  }

  const arm = (): void => {
    if (timer !== undefined) clearTimeout(timer)
    timer = undefined
    if (closed || controller.signal.aborted || idleMs <= 0) return
    timer = setTimeout(() => abortWith('timeout'), idleMs)
  }
  arm()

  return {
    signal: controller.signal,
    noteActivity: arm,
    cause: () => cause,
    cleanup: () => {
      closed = true
      if (timer !== undefined) clearTimeout(timer)
      if (external) external.removeEventListener('abort', onExternalAbort)
    }
  }
}

/** undici/DOM 的 abort 形状不稳（DOMException/Error），统一按 name 判定。 */
export function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError'
}

export function abortKind(linked: LinkedSignal): 'timeout' | 'cancelled' {
  return linked.cause() ?? 'cancelled'
}

/** fetch() 调用本身抛错时的分类（abort 归因 / 其余按网络失败）。永不返回。 */
export function classifyFetchError(err: unknown, linked: LinkedSignal): never {
  if (isAbortError(err)) {
    const kind = abortKind(linked)
    throw new AiCallError(kind, kind === 'timeout' ? 'AI 请求超时，已中止' : 'AI 请求已被取消')
  }
  const e = err as Error
  throw new AiCallError('network', capMessage(`网络请求失败：${String(e?.name ?? 'UnknownError')}: ${String(e?.message ?? err)}`))
}

/** 发起 fetch；网络层错误就地分类，成功返回 Response（status 未检查）。 */
export async function guardedFetch(
  url: string,
  init: RequestInit,
  linked: LinkedSignal
): Promise<Response> {
  try {
    return await http.fetch(url, init)
  } catch (err) {
    classifyFetchError(err, linked)
  }
}

/**
 * 远端文本进入 err.message 前的强制脱敏：部分兼容网关会把请求头（含 Bearer 密钥）
 * 回显进 401/403 响应体，而 message 经 Task 4 的 ai:error 跨 IPC 进渲染进程——
 * 明文 apiKey 永不出主进程不变量在此兜底。≥8 字符才替换（更短的串无泄露价值，
 * 且会误伤正文里的常用词）；空/缺省直通。
 */
export function redactKey(text: string, apiKey?: string): string {
  if (!apiKey || apiKey.length < 8) return text
  return text.split(apiKey).join('[已脱敏]')
}

/**
 * 非 2xx → AiCallError：401/403 → auth，其余 → provider；响应体摘要 ≤300 且经 redactKey。
 * 顺序不变量（Task 3 复审 FOLD）：先对全文 redactKey，再截 300——反序时恰好横跨
 * 截断线的密钥只留下前缀碎片，redactKey 找不到完整串就再也遮不掉。
 */
export async function ensureOk(resp: Response, apiKey?: string): Promise<void> {
  if (resp.ok) return
  let bodyText = ''
  try {
    bodyText = (await resp.text()).trim()
  } catch {
    bodyText = '(无法读取响应体)'
  }
  const redacted = redactKey(bodyText, apiKey)
  const capped = redacted.length > 300 ? `${redacted.slice(0, 300)}…[已截断]` : redacted
  const kind = resp.status === 401 || resp.status === 403 ? 'auth' : 'provider'
  throw new AiCallError(kind, `HTTP ${resp.status}${capped ? `: ${capped}` : ''}`)
}

/**
 * 流读取中途/解析期抛错的兜底分类：AiCallError 直通、abort 归因、其余归 provider。
 * （fetch 阶段的网络错已由 classifyFetchError 处理，这里覆盖 body 读错误等。）
 */
export function mapStreamError(err: unknown, linked: LinkedSignal): never {
  if (err instanceof AiCallError) throw err
  if (isAbortError(err)) throw new AiCallError(abortKind(linked), abortKind(linked) === 'timeout' ? 'AI 响应流超时已中止' : 'AI 响应流已被取消')
  const e = err as Error
  throw new AiCallError('provider', capMessage(`AI 响应异常：${String(e?.name ?? 'UnknownError')}`))
}

// ==================== SSE ====================

export interface SseEvent {
  /** `event:` 字段；缺省按 'message'（OpenAI 兼容端点通常不写 event 名） */
  event: string
  /** 多条 `data:` 行按 \n 拼接（SSE 规范） */
  data: string
}

/**
 * 解析 SSE 流为事件序列。覆盖（测试钉死）：跨 chunk 断行缓冲、CRLF、空行分发、
 * `:` 注释行忽略、`id:`/`retry:` 等未知字段忽略、流结束时残行 + 未闭合事件的收尾分发。
 * 用 getReader() 循环而非 body 的异步迭代——后者的类型声明在 DOM lib 不稳，行为一致。
 * onActivity（可选）：每次 body read 拿到数据即回调——注释行/ping 这类「不成帧的字节」
 * 也证明连接活着，空闲计时器必须认它们（M4b Task 0 空闲重置语义的读取侧挂钩）。
 */
export async function* sseEvents(
  body: ReadableStream<Uint8Array>,
  onActivity?: () => void
): AsyncGenerator<SseEvent> {
  const reader = body.getReader()
  const decoder = new TextDecoder('utf-8')
  let pending = ''
  let eventName = ''
  let dataLines: string[] = []

  const consumeLine = (line: string): SseEvent | undefined => {
    if (line === '') {
      if (dataLines.length > 0) {
        const ev: SseEvent = { event: eventName || 'message', data: dataLines.join('\n') }
        eventName = ''
        dataLines = []
        return ev
      }
      eventName = ''
      return undefined
    }
    if (line.startsWith(':')) return undefined // 注释/keep-alive
    if (line.startsWith('event:')) {
      eventName = line.slice(6).trim()
      return undefined
    }
    if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).replace(/^ /, ''))
      return undefined
    }
    return undefined // id: / retry: / 其他字段：本层不需要
  }

  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      onActivity?.()
      pending += decoder.decode(value, { stream: true })
      let nl: number
      while ((nl = pending.indexOf('\n')) >= 0) {
        const raw = pending.slice(0, nl)
        pending = pending.slice(nl + 1)
        const ev = consumeLine(raw.endsWith('\r') ? raw.slice(0, -1) : raw)
        if (ev) yield ev
      }
    }
    pending += decoder.decode()
    if (pending.length > 0) {
      const lastLine = pending.endsWith('\r') ? pending.slice(0, -1) : pending
      const ev = consumeLine(lastLine)
      if (ev) yield ev
    }
    // 无空行收尾的最后一帧（不合规但见过）：仍有 data 就分发
    if (dataLines.length > 0) {
      yield { event: eventName || 'message', data: dataLines.join('\n') }
    }
  } finally {
    reader.releaseLock()
  }
}
