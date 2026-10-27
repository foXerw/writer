// OpenAI 兼容协议适配器（M4a Task 3）——本目录之外绝不发 HTTP。
// 覆盖 OpenAI 本体 + DeepSeek/Kimi/通义/OpenRouter 等兼容端点。
// 用量：请求体固定带 stream_options.include_usage（多数兼容端点接受；个别老端点若
// 因此报错属对端 bug，记入 BOOK of errors）；响应缺 usage 时如实报 0，估算兜底归调用方。

import type { AiSettings } from '../../../../src/common/ai-types'
import type { AiProvider, ChatRequestInput, ProviderChatOptions, ProviderChatResult, ProviderUsage } from './types'
import { AiCallError } from './types'
import {
  ensureOk,
  guardedFetch,
  joinUrl,
  linkSignal,
  mapStreamError,
  redactKey,
  sseEvents
} from './http'

interface OpenaiUsagePayload {
  prompt_tokens?: unknown
  completion_tokens?: unknown
  prompt_tokens_details?: { cached_tokens?: unknown }
}

interface OpenaiErrorPayload {
  message?: unknown
  type?: unknown
  code?: unknown
  status?: unknown
}

interface OpenaiChunkPayload {
  choices?: { delta?: { content?: unknown } }[]
  usage?: OpenaiUsagePayload
  // 部分网关在 200 流里夹带 {"error":{…}}——与 anthropic error 事件对称处理
  error?: OpenaiErrorPayload
}

/** 从 error 对象里能抠出 HTTP 语义（status/code 为三位数）就用它分类，否则归 provider。 */
function embeddedHttpStatus(err: OpenaiErrorPayload): number | undefined {
  for (const v of [err.status, err.code]) {
    if (typeof v === 'number' && v >= 100 && v <= 599) return v
    if (typeof v === 'string' && /^\d{3}$/.test(v)) return Number(v)
  }
  return undefined
}

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0
}

function buildBody(model: string, req: ChatRequestInput): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model,
    messages: req.messages,
    stream: true,
    stream_options: { include_usage: true }
  }
  if (typeof req.temperature === 'number') body.temperature = req.temperature
  if (typeof req.maxTokens === 'number') body.max_tokens = req.maxTokens
  return body
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
      joinUrl(settings.baseUrl, '/chat/completions'),
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${settings.apiKey}`
        },
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
      if (ev.data === '[DONE]') break
      let payload: OpenaiChunkPayload
      try {
        payload = JSON.parse(ev.data) as OpenaiChunkPayload
      } catch {
        continue // 坏 JSON 行：跳过不中断（宁缺毋烂）
      }
      if (payload.error) {
        const status = embeddedHttpStatus(payload.error)
        const kind = status === 401 || status === 403 ? 'auth' : 'provider'
        const detail = String(payload.error.message ?? payload.error.type ?? payload.error.code ?? '未知错误')
        throw new AiCallError(kind, `流式响应携带错误：${redactKey(detail, settings.apiKey)}`)
      }
      const piece = payload.choices?.[0]?.delta?.content
      if (typeof piece === 'string' && piece.length > 0) {
        text += piece
        onChunk(piece)
      }
      const usage = payload.usage
      if (usage) {
        promptTokens = num(usage.prompt_tokens)
        completionTokens = num(usage.completion_tokens)
        const cached = usage.prompt_tokens_details?.cached_tokens
        if (typeof cached === 'number') cachedTokens = num(cached)
      }
    }

    const result: ProviderUsage = { promptTokens, completionTokens }
    if (cachedTokens !== undefined) result.cachedTokens = cachedTokens
    return { text, usage: result }
  } catch (err) {
    mapStreamError(err, linked)
  } finally {
    linked.cleanup()
  }
}

async function testConnection(
  settings: AiSettings,
  _model?: string
): Promise<{ ok: true; sample: string }> {
  const linked = linkSignal()
  try {
    const resp = await guardedFetch(
      joinUrl(settings.baseUrl, '/models'),
      {
        method: 'GET',
        headers: { authorization: `Bearer ${settings.apiKey}` },
        signal: linked.signal
      },
      linked
    )
    await ensureOk(resp, settings.apiKey)
    const json = (await resp.json()) as { data?: unknown }
    // 简报「取 1 条」：报首条模型 id 作为连通性证据，而非计数
    const first = Array.isArray(json?.data) ? (json.data as { id?: unknown }[])[0] : undefined
    const firstId = first && typeof first.id === 'string' && first.id !== '' ? first.id : '(无模型条目)'
    return { ok: true, sample: `models: ${firstId}` }
  } catch (err) {
    mapStreamError(err, linked)
  } finally {
    linked.cleanup()
  }
}

export const openaiProvider: AiProvider = { chat, testConnection }
