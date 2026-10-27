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
  /** 默认 30_000ms */
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

const JSON_FAIL_MESSAGE = '无法解析模型输出的 JSON'

function tryParse(s: string): unknown {
  // 用异常区分「解析失败」与「解析出 undefined/null」
  return JSON.parse(s)
}

/**
 * 宽容解析模型输出的 JSON。四路（测试钉死）：
 * ① 裸 JSON 直接 parse；② ```json / ``` 围栏剥壳再 parse；
 * ③ 前后杂话 → 首个 '{' 起做字符串感知的平衡大括号扫描截取；
 * ④ 全部失败 → AiCallError kind 'provider'（固定文案，不回显原文，防止把怪内容再吐给用户）。
 */
export function extractJsonLoose(raw: string): unknown {
  const text = raw ?? ''
  try {
    return tryParse(text)
  } catch {
    /* fallthrough */
  }

  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(text)
  if (fence) {
    try {
      return tryParse(fence[1].trim())
    } catch {
      /* fallthrough */
    }
  }

  const slice = scanBalancedObject(text)
  if (slice !== undefined) {
    try {
      return tryParse(slice)
    } catch {
      /* fallthrough */
    }
  }

  throw new AiCallError('provider', JSON_FAIL_MESSAGE)
}

/** 从首个 '{' 开始扫描：跳过大括号计数，跳过字符串内部与转义；深度回零即闭合。 */
function scanBalancedObject(s: string): string | undefined {
  const start = s.indexOf('{')
  if (start < 0) return undefined
  let depth = 0
  let inStr = false
  let esc = false
  for (let i = start; i < s.length; i++) {
    const ch = s[i]
    if (inStr) {
      if (esc) esc = false
      else if (ch === '\\') esc = true
      else if (ch === '"') inStr = false
      continue
    }
    if (ch === '"') inStr = true
    else if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) return s.slice(start, i + 1)
    }
  }
  return undefined
}
