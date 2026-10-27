// Anthropic Messages 协议适配器（M4a Task 3）。
// 与 OpenAI 兼容层的形状差异都在此消化：system 拆顶层、max_tokens 必填（默认 4096）、
// 命名 SSE 事件、usage 分散在 message_start（输入侧）与 message_delta（输出侧）。

import type { AiMessage, AiSettings } from '../../../../src/common/ai-types'
import type { AiProvider, ChatRequestInput, ProviderChatOptions, ProviderChatResult, ProviderUsage } from './types'
import { AiCallError, capMessage } from './types'
import { ensureOk, guardedFetch, joinUrl, linkSignal, mapStreamError, redactKey, sseEvents } from './http'

const ANTHROPIC_VERSION = '2023-06-01'
const DEFAULT_MAX_TOKENS = 4096

interface AnthropicEvent {
  type?: string
  delta?: { type?: string; text?: unknown; stop_reason?: unknown }
  message?: { usage?: { input_tokens?: unknown; cache_read_input_tokens?: unknown } }
  usage?: { output_tokens?: unknown }
  error?: { type?: string; message?: string }
}

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0
}

/** role:'system' 消息拆出顶层 system（\n\n 连接）——Anthropic API 不接受 messages 里的 system。 */
function splitSystem(messages: AiMessage[]): { system?: string; messages: AiMessage[] } {
  const systemParts: string[] = []
  const rest: AiMessage[] = []
  for (const m of messages) {
    if (m.role === 'system') systemParts.push(m.content)
    else rest.push(m)
  }
  const joined = systemParts.join('\n\n')
  return joined.length > 0 ? { system: joined, messages: rest } : { messages: rest }
}

function buildBody(model: string, req: ChatRequestInput): Record<string, unknown> {
  const { system, messages } = splitSystem(req.messages)
  const body: Record<string, unknown> = {
    model,
    max_tokens: typeof req.maxTokens === 'number' ? req.maxTokens : DEFAULT_MAX_TOKENS,
    messages,
    stream: true
  }
  if (system !== undefined) body.system = system
  if (typeof req.temperature === 'number') body.temperature = req.temperature
  return body
}

function headers(settings: AiSettings): Record<string, string> {
  return {
    'content-type': 'application/json',
    'x-api-key': settings.apiKey,
    'anthropic-version': ANTHROPIC_VERSION
  }
}

async function chat(
  settings: AiSettings,
  model: string,
  req: ChatRequestInput,
  onChunk: (t: string) => void,
  opts?: ProviderChatOptions
): Promise<ProviderChatResult> {
  const linked = linkSignal(opts)
  try {
    const resp = await guardedFetch(
      joinUrl(settings.baseUrl, '/v1/messages'),
      {
        method: 'POST',
        headers: headers(settings),
        body: JSON.stringify(buildBody(model, req)),
        signal: linked.signal
      },
      linked
    )
    await ensureOk(resp, settings.apiKey)
    if (!resp.body) throw new AiCallError('provider', '流式响应缺少正文数据')

    let text = ''
    let promptTokens = 0
    let completionTokens = 0
    let cachedTokens: number | undefined
    for await (const ev of sseEvents(resp.body)) {
      let payload: AnthropicEvent
      try {
        payload = JSON.parse(ev.data) as AnthropicEvent
      } catch {
        continue
      }
      switch (ev.event) {
        case 'message_start': {
          const usage = payload.message?.usage
          if (usage) {
            promptTokens = num(usage.input_tokens)
            if (typeof usage.cache_read_input_tokens === 'number') {
              cachedTokens = num(usage.cache_read_input_tokens)
            }
          }
          break
        }
        case 'content_block_delta': {
          const piece = payload.delta?.type === 'text_delta' ? payload.delta.text : undefined
          if (typeof piece === 'string' && piece.length > 0) {
            text += piece
            onChunk(piece)
          }
          break
        }
        case 'message_delta': {
          if (payload.usage) completionTokens = num(payload.usage.output_tokens)
          break
        }
        case 'message_stop':
          break
        case 'error':
          // error 事件正文由远端拼写，可能回显 x-api-key——入 message 前脱敏
          throw new AiCallError(
            'provider',
            capMessage(
              `AI 服务错误：${redactKey(
                String(payload.error?.message ?? payload.error?.type ?? '未知错误'),
                settings.apiKey
              )}`
            )
          )
        default:
          break // ping / content_block_start / content_block_stop …
      }
      if (ev.event === 'message_stop') break
    }

    const usage: ProviderUsage = { promptTokens, completionTokens }
    if (cachedTokens !== undefined) usage.cachedTokens = cachedTokens
    return { text, usage }
  } catch (err) {
    mapStreamError(err, linked)
  } finally {
    linked.cleanup()
  }
}

async function testConnection(
  settings: AiSettings,
  model?: string
): Promise<{ ok: true; sample: string }> {
  // openai 的 /models 探测不需要模型名；Anthropic 没有等价廉价端点，只能发 1-token 最小调用。
  const target = (model ?? '').trim() || settings.defaultModel.trim()
  if (!target) throw new AiCallError('not-configured', '连接测试需要指定模型（或先设置默认模型）')
  const linked = linkSignal()
  try {
    const resp = await guardedFetch(
      joinUrl(settings.baseUrl, '/v1/messages'),
      {
        method: 'POST',
        headers: headers(settings),
        body: JSON.stringify({
          model: target,
          max_tokens: 1,
          messages: [{ role: 'user', content: 'ping' }]
        }),
        signal: linked.signal
      },
      linked
    )
    await ensureOk(resp, settings.apiKey)
    return { ok: true, sample: 'ok' }
  } catch (err) {
    mapStreamError(err, linked)
  } finally {
    linked.cleanup()
  }
}

export const anthropicProvider: AiProvider = { chat, testConnection }
