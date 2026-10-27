// AI 对话编排（M4a Task 4）：ai:chat / ai:cancel 通道的主进程核心。
//
// 失败两分契约（useAI hook 同时兜两条路，T5/T6 依赖此表）：
// ┌ 受理前（同步 reject，Error.message = `[kind] 文本`，不发任何事件）：
// │   · requestId/messages 形状不合法      → kind 'provider'
// │   · feature 不在白名单（Task 6 收口）  → kind 'provider'（账本写入前拒掉，防脏 feature 入册）
// │   · isConfigured(loadSettings()) 失败  → kind 'not-configured'
// │   · model 解析后为空                   → kind 'not-configured'（未配置模型）
// │   · 同 requestId 在途重复              → kind 'busy'
// │     ——busy/not-configured 绝不走 ai:error 事件：事件按 requestId 分发，
// │     重复请求的失败若发事件会误杀「正在途的原请求」的 UI。
// └ 受理后（invoke 已回 {accepted:true}，一切结果只经事件通道，均带 requestId）：
//     · ai:chunk {requestId, text}（0..n 条，provider onChunk 直转）
//     · ai:done  {requestId, usage}（成功尾；usage 与账本同源）
//     · ai:error {requestId, kind, message}（AiCallError 原 kind 直通；其余归 'provider'）
//
// 并发隔离：module 级 Map<requestId, AbortController>；每个请求的 emit 闭包只捕获
// 自己的 requestId 与 sender，多 id 并发互不串台（测试钉死）。
// finally 删除用「控制器身份比对」防 id 复用竞态（旧请求善后时绝不删掉复用同 id 的新控制器）。
//
// 测试接缝：setProviderOverride —— 仅测试注入假 AiProvider；生产恒置 null，
// getProvider(settings) 按协议分发。除此之外本模块不 mock（sender 用结构化替身）。
import type { AiChatRequest, AiUsageRecord } from '../../../src/common/ai-types'
import { AI_FEATURES, isConfigured } from '../../../src/common/ai-types'
import { loadSettings } from './settings'
import { getProvider } from './providers'
import { AiCallError } from './providers/types'
import type { AiProvider } from './providers/types'
import { appendUsage } from './usage'

/** event.sender 的最小形状（真实 WebContents 结构满足；测试传替身，同 watcher.ts 先例）。 */
export interface ChatEventSender {
  send(channel: 'ai:chunk' | 'ai:done' | 'ai:error', payload: unknown): void
  isDestroyed?(): boolean
}

const inflight = new Map<string, AbortController>()
let providerOverride: AiProvider | null = null

/**
 * chat 默认空闲上限（ms，M4b Task 0）：只有「连续 45s 无任何流增量」才判死——
 * 不是总时长。旧 30s 总时长语义会误杀 organize 这类合法长生成（终审结转）。
 * 连接阶段不重置（一次性 45s），流阶段每次 body read/chunk 由 linkSignal.noteActivity 续窗。
 */
const DEFAULT_IDLE_MS = 45_000

/** 渲染层可经 preload 门面送任意 JSON：只认正的有限数，其余（NaN/负/字符串）回退默认。 */
function sanitizeIdleMs(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : DEFAULT_IDLE_MS
}

/** 仅测试使用：注入假 provider；传 null 恢复真实分发。 */
export function setProviderOverride(provider: AiProvider | null): void {
  providerOverride = provider
}

/** 同步受理失败：kind 编进 message 前缀 `[kind] `，hook 侧 parseKind 解包（不另立通道）。 */
function rejectWithKind(kind: string, message: string): never {
  throw new Error(`[${kind}] ${message}`)
}

/**
 * 受理一次对话。返回 {accepted:true} 仅代表「已进入在途」，正文/结果永远走事件通道。
 * 同步 throw 的形状见文件头失败两分契约。
 */
export function startChat(sender: ChatEventSender, request: AiChatRequest): { accepted: true } {
  const req = (request ?? {}) as AiChatRequest
  if (typeof req.requestId !== 'string' || req.requestId === '' || !Array.isArray(req.messages)) {
    rejectWithKind('provider', '对话请求形状不合法（requestId/messages）')
  }
  // 渲染层可经 preload 门面送任意 JSON：feature 必须落在白名单，否则同步拒（先于在途表/账本）
  // 白名单单源 AI_FEATURES（src/common/ai-types）：与账本/面板同一真相。
  if (!AI_FEATURES.includes(req.feature)) {
    rejectWithKind('provider', `未知的 AI 功能：${String(req.feature ?? '(空)')}`)
  }
  const settings = loadSettings()
  if (!isConfigured(settings)) {
    rejectWithKind('not-configured', 'AI 尚未配置（协议/BaseUrl/密钥需齐全）')
  }
  // model 解析：显式 model > 功能覆盖 > 默认模型；空即受理失败（此刻还没有任何在途状态）
  const featureModel = req.feature ? settings.models[req.feature] : undefined
  const model = (typeof req.model === 'string' && req.model !== '' ? req.model : undefined)
    ?? (featureModel && featureModel !== '' ? featureModel : undefined)
    ?? (settings.defaultModel !== '' ? settings.defaultModel : '')
  if (!model) {
    rejectWithKind('not-configured', '未配置模型')
  }
  if (inflight.has(req.requestId)) {
    rejectWithKind('busy', `请求 ${req.requestId} 正在处理中`)
  }

  const controller = new AbortController()
  inflight.set(req.requestId, controller)
  const requestId = req.requestId

  // 闭包只捕获本请求的 sender/requestId——并发多 id 天然隔离。
  // 窗口已销毁：哑火 + abort 在途控制器（绝不为死窗口继续烧供应商配额）。
  const emit = (channel: 'ai:chunk' | 'ai:done' | 'ai:error', payload: unknown): void => {
    try {
      if (sender.isDestroyed?.() === true) {
        controller.abort()
        return
      }
      sender.send(channel, payload)
    } catch {
      // 发送竞态（isDestroyed 检查后才关的窗）：同上，静默丢弃 + 停止燃烧
      controller.abort()
    }
  }

  // 终态位：done/error 发出后本请求对渲染层已盖章。第三方 provider 若违约
  // （resolve/reject 之后仍回访 onChunk），迟到的 chunk 一律丢弃——渲染层
  // 「done 恰为终事件」的不变量由这里兜底，而非指望 provider 自觉。
  let settled = false

  void (async () => {
    try {
      const provider = providerOverride ?? getProvider(settings)
      const result = await provider.chat(
        settings,
        model,
        { messages: req.messages, temperature: req.temperature, maxTokens: req.maxTokens },
        (text: string) => {
          if (!settled) emit('ai:chunk', { requestId, text })
        },
        { signal: controller.signal, timeoutMs: sanitizeIdleMs(req.timeoutMs) }
      )
      if (typeof req.projectPath === 'string' && req.projectPath !== '') {
        const rec: AiUsageRecord = {
          ts: new Date().toISOString(),
          feature: req.feature,
          model,
          promptTokens: result.usage.promptTokens,
          completionTokens: result.usage.completionTokens,
          cachedTokens: result.usage.cachedTokens
        }
        appendUsage(req.projectPath, rec) // 内部容错：记账失败只 warn，不影响 done
      }
      settled = true
      emit('ai:done', { requestId, usage: result.usage })
    } catch (err) {
      settled = true // 先盖章：error 之后 provider 若回访 onChunk，也休想再吐半个字
      const callErr =
        err instanceof AiCallError
          ? err
          : new AiCallError(
              'provider',
              `AI 调用异常：${String((err as Error | undefined)?.name ?? 'UnknownError')}`
            )
      // AiCallError.message 构造点已保证 ≤300 且经 redactKey——跨 IPC 前无需二次脱敏。
      emit('ai:error', { requestId, kind: callErr.kind, message: callErr.message })
    } finally {
      // 身份比对：复用同 requestId 的新请求在途时，旧请求善后不得误删新控制器
      if (inflight.get(requestId) === controller) inflight.delete(requestId)
    }
  })()

  return { accepted: true }
}

/**
 * 取消在途请求。幂等且诚实：在途且首次取消 → true（触发 abort）；
 * 已取消过/已善后/未知 id → false。abort 后 provider 以 AiCallError('cancelled')
 * 收尾，ai:error 事件照常发给渲染层（由事件侧完成 UI 清理）。
 */
export function cancelChat(requestId: string): boolean {
  const controller = inflight.get(requestId)
  if (!controller) return false
  const wasPending = !controller.signal.aborted
  controller.abort()
  return wasPending
}

/** 仅测试：在途请求数（生产代码不得依赖）。 */
export function inflightCount(): number {
  return inflight.size
}
