// Provider 抽象契约（M4a Task 3）。Task 4 chatService 只依赖本文件的形状，
// 名字与签名逐字对齐计划简报——任何改动都要同步 chatService。
//
// 错误纪律（全目录共用）：AiCallError.message 是「可上 IPC」的文本——
// 永远不包含请求头/密钥（构造点只拼 status、截断响应体、错误名），且整体 ≤300 字符。

import type { AiChatRequest, AiErrorEvent, AiSettings } from '../../../../src/common/ai-types'

/** chat 的对话输入切片（messages/temperature/maxTokens 之外不归 provider 管） */
export type ChatRequestInput = Pick<AiChatRequest, 'messages' | 'temperature' | 'maxTokens'>

export interface ProviderUsage {
  promptTokens: number
  completionTokens: number
  cachedTokens?: number
}

export interface ProviderChatResult {
  usage: ProviderUsage
  text: string
}

export interface ProviderChatOptions {
  signal?: AbortSignal
  /**
   * 空闲上限毫秒（默认 30_000）：计「距上一次流活动的静默时长」，非总时长——
   * 流阶段每次 SSE body read / chunk 行经 linkSignal.noteActivity 重置计时器；
   * 连接阶段不重置（一次性上限）。无流的调用方（testConnection）自然退化为总时长。
   */
  timeoutMs?: number
}

export interface AiProvider {
  chat(
    settings: AiSettings,
    model: string,
    req: ChatRequestInput,
    onChunk: (t: string) => void,
    opts?: ProviderChatOptions
  ): Promise<ProviderChatResult>
  /** 成功才 resolve；失败一律抛 AiCallError（分类同 chat，供 UI 归因） */
  testConnection(settings: AiSettings, model?: string): Promise<{ ok: true; sample: string }>
}

/**
 * 供应商调用失败的统一错误。kind 复用 AiErrorEvent['kind'] 词表（IPC 直转，不再翻译）。
 * message 已由构造方保证：截断 ≤300 字符、不含任何请求头内容。
 */
export class AiCallError extends Error {
  readonly kind: AiErrorEvent['kind']

  constructor(kind: AiErrorEvent['kind'], message: string) {
    super(capMessage(message))
    this.name = 'AiCallError'
    this.kind = kind
  }
}

/** 错误消息总长硬上限（含前缀）：超出保留头部信息、尾部省略号。 */
export function capMessage(msg: string): string {
  return msg.length <= 300 ? msg : `${msg.slice(0, 297)}…`
}

// extractJsonLoose 已迁至 src/common/jsonLoose.ts（M4b Task 4 裁定 3：主/渲染共用、
// 单一来源、无 re-export shim——消费方一律直接 import 该模块）。
