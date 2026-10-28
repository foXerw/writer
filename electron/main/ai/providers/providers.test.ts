// Provider 适配器测试（M4a Task 3）。
// 全部离线：http.fetch 被 vi.spyOn 替换为假 fetch，绝无真实网络/密钥。
// 钉死的安全不变量：错误 message 只含 status + 截断响应体，绝不回显请求头
// （SENTINEL_KEY 会出现在每次请求头里——任何失败用例都要反向证明它没漏进 message）。
// 注入模式：两个 provider 都调用共享 `http.fetch`（providers/http.ts），测试只 spy 这一个接缝。
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AiChatRequest, AiSettings } from '../../../../src/common/ai-types'
import { ensureOk, http, linkSignal, redactKey } from './http'
import { getProvider } from './index'
import { AiCallError } from './types'

const SENTINEL_KEY = 'sk-sen…9876'

const validSettings = (over: Partial<AiSettings> = {}): AiSettings => ({
  protocol: 'openai',
  baseUrl: 'https://api.example.com/v1',
  apiKey: SENTINEL_KEY,
  defaultModel: 'model-default',
  models: {},
  ...over
})

const req = (over: Partial<Pick<AiChatRequest, 'messages' | 'temperature' | 'maxTokens'>> = {}) => ({
  messages: [
    { role: 'user' as const, content: '写开头' },
    { role: 'assistant' as const, content: '好的' },
    { role: 'user' as const, content: '开始' }
  ],
  ...over
})

/** 记录每次 http.fetch 调用（url 字符串化 + init），供断言。 */
interface Call {
  url: string
  init: RequestInit
}
function mockFetch(handler: (...args: Parameters<typeof fetch>) => Promise<Response>) {
  const calls: Call[] = []
  vi.spyOn(http, 'fetch').mockImplementation(async (...args) => {
    calls.push({ url: String(args[0]), init: (args[1] ?? {}) as RequestInit })
    return handler(...args)
  })
  return calls
}

function jsonResponse(payload: unknown, init: ResponseInit = {}): Promise<Response> {
  return Promise.resolve(
    new Response(JSON.stringify(payload), {
      status: 200,
      headers: { 'content-type': 'application/json' },
      ...init
    })
  )
}

function splitBytes(text: string, size: number): Uint8Array[] {
  const bytes = new TextEncoder().encode(text)
  const out: Uint8Array[] = []
  for (let i = 0; i < bytes.length; i += size) out.push(bytes.slice(i, i + size))
  if (out.length === 0) out.push(new Uint8Array(0))
  return out
}

/** 把 SSE 文本按固定字节大小切块 → 真 Response（ReadableStream body），制造跨行边界。 */
function sseResponse(sseText: string, chunkSize = 7): Response {
  const chunks = splitBytes(sseText, chunkSize)
  let i = 0
  const body = new ReadableStream<Uint8Array>({
    pull(ctrl) {
      if (i < chunks.length) ctrl.enqueue(chunks[i++])
      else ctrl.close()
    }
  })
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })
}

function abortError(): Error {
  const e = new Error('The operation was aborted')
  e.name = 'AbortError'
  return e
}

/** 假 fetch：像 undici 一样在 abort 时 reject AbortError（含已 abort 的起步态）。 */
function hangUntilAbort(...args: Parameters<typeof fetch>): Promise<Response> {
  const signal = (args[1] ?? {}).signal
  if (!signal) throw new Error('测试假 fetch 必须收到 signal')
  if (signal.aborted) return Promise.reject(abortError())
  return new Promise<Response>((_, reject) => {
    signal.addEventListener('abort', () => reject(abortError()), { once: true })
  })
}

function captureError(fn: () => Promise<unknown>): Promise<AiCallError> {
  return fn().then(
    () => {
      throw new Error('期望抛出 AiCallError，但成功返回')
    },
    (err: unknown) => {
      expect(err).toBeInstanceOf(AiCallError)
      return err as AiCallError
    }
  )
}

afterEach(() => {
  vi.restoreAllMocks()
})

// ==================== OpenAI 兼容 ====================

describe('openaiProvider.chat（SSE 流式）', () => {
  it('happy：跨 chunk 断行 + CRLF + 注释行 + 末块 usage + [DONE] 终止', async () => {
    const sse = [
      ': keep-alive comment\r\n',
      '\r\n',
      'data: {"id":"c1","choices":[{"index":0,"delta":{"role":"assistant","content":""}}]}\r\n\r\n',
      'data: {"choices":[{"index":0,"delta":{"content":"你好"}}]}\r\n\r\n',
      'data: {"choices":[{"index":0,"delta":{"content":"，世界"}}]}\r\n\r\n',
      'data: {"choices":[],"usage":{"prompt_tokens":11,"completion_tokens":7,"prompt_tokens_details":{"cached_tokens":3}}}\r\n\r\n',
      'data: [DONE]\r\n\r\n'
    ].join('')
    const calls = mockFetch(async () => sseResponse(sse, 7))

    const onChunk = vi.fn()
    const result = await getProvider(validSettings()).chat(
      validSettings({ baseUrl: 'https://api.example.com/v1/' }), // 尾斜杠归一
      'gpt-test',
      req({ temperature: 0.3, maxTokens: 900 }),
      onChunk
    )

    expect(result.text).toBe('你好，世界')
    expect(onChunk.mock.calls.map((c) => c[0])).toEqual(['你好', '，世界'])
    expect(result.usage).toEqual({ promptTokens: 11, completionTokens: 7, cachedTokens: 3 })

    const call = calls[0]
    expect(call.url).toBe('https://api.example.com/v1/chat/completions')
    expect(call.init.method).toBe('POST')
    expect((call.init.headers as Record<string, string>).authorization).toBe(`Bearer ${SENTINEL_KEY}`)
    const body = JSON.parse(String(call.init.body))
    expect(body).toMatchObject({
      model: 'gpt-test',
      stream: true,
      stream_options: { include_usage: true },
      temperature: 0.3,
      max_tokens: 900
    })
    expect(body.messages).toEqual(req().messages)
  })

  it('无 usage 块 → 用量记 0（provider 只报所见，估算归调用方）', async () => {
    const sse =
      'data: {"choices":[{"delta":{"content":"a"}}]}\n\n' +
      'data: {"choices":[{"delta":{"content":"b"}}]}\n\n' +
      'data: [DONE]\n\n'
    mockFetch(async () => sseResponse(sse, 11))

    const result = await getProvider(validSettings()).chat(validSettings(), 'm', req(), () => {})
    expect(result.text).toBe('ab')
    expect(result.usage).toEqual({ promptTokens: 0, completionTokens: 0 })
  })

  it('data 行 JSON 损坏 → 跳过该事件不中断流', async () => {
    const sse =
      'data: {"choices":[{"delta":{"content":"好"}}]}\n\n' +
      'data: {broken json!!\n\n' +
      'data: {"choices":[{"delta":{"content":"的"}}]}\n\n' +
      'data: [DONE]\n\n'
    mockFetch(async () => sseResponse(sse, 9))

    const result = await getProvider(validSettings()).chat(validSettings(), 'm', req(), () => {})
    expect(result.text).toBe('好的')
  })

  it('401 → kind auth；message 含 status+响应体摘要（≤300）；绝不含请求头密钥（sentinel 反向证明）', async () => {
    const longBody = 'BAD-KEY ' + 'x'.repeat(500)
    const calls = mockFetch(async () => new Response(longBody, { status: 401 }))

    const err = await captureError(() =>
      getProvider(validSettings()).chat(validSettings(), 'm', req(), () => {})
    )
    expect(err.kind).toBe('auth')
    expect(err.message).toContain('401')
    expect(err.message).toContain('BAD-KEY')
    expect(err.message.length).toBeLessThanOrEqual(300)
    expect(err.message).not.toContain(SENTINEL_KEY)
    // 阳性对照：密钥确实进了请求头——泄露只可能来自我们自己拼消息
    expect(String(JSON.stringify(calls[0].init.headers))).toContain(SENTINEL_KEY)
  })

  it('429（非 401/403 的 !ok）→ kind provider', async () => {
    mockFetch(async () => new Response('{"error":"rate limited"}', { status: 429 }))
    const err = await captureError(() =>
      getProvider(validSettings()).chat(validSettings(), 'm', req(), () => {})
    )
    expect(err.kind).toBe('provider')
    expect(err.message).toContain('429')
    expect(err.message).toContain('rate limited')
    expect(err.message).not.toContain(SENTINEL_KEY)
  })

  it('fetch reject TypeError（DNS/断网）→ kind network', async () => {
    mockFetch(async () => {
      throw new TypeError('fetch failed')
    })
    const err = await captureError(() =>
      getProvider(validSettings()).chat(validSettings(), 'm', req(), () => {})
    )
    expect(err.kind).toBe('network')
    expect(err.message).not.toContain(SENTINEL_KEY)
  })

  it('超时 abort → kind timeout（独立于取消）', async () => {
    mockFetch(async (...args) => hangUntilAbort(...args))
    const err = await captureError(() =>
      getProvider(validSettings()).chat(validSettings(), 'm', req(), () => {}, { timeoutMs: 10 })
    )
    expect(err.kind).toBe('timeout')
  })

  it('外部 signal 取消 → kind cancelled', async () => {
    mockFetch(async (...args) => hangUntilAbort(...args))
    const ctrl = new AbortController()
    const p = getProvider(validSettings()).chat(validSettings(), 'm', req(), () => {}, {
      signal: ctrl.signal
    })
    await new Promise((r) => setTimeout(r, 5))
    ctrl.abort()
    const err = await captureError(() => p)
    expect(err.kind).toBe('cancelled')
  })

  it('流中途取消（已出响应头、正文未读完时 abort）→ kind cancelled', async () => {
    const ctrl = new AbortController()
    mockFetch(async () => {
      const stuck = new ReadableStream<Uint8Array>({
        start(c) {
          ctrl.signal.addEventListener('abort', () => c.error(abortError()), { once: true })
        }
      })
      return new Response(stuck, { status: 200 })
    })
    const p = getProvider(validSettings()).chat(validSettings(), 'm', req(), () => {}, {
      signal: ctrl.signal
    })
    await new Promise((r) => setTimeout(r, 5)) // 让 chat 进入读流阶段
    ctrl.abort()
    const err = await captureError(() => p)
    expect(err.kind).toBe('cancelled')
  })
})

// ==================== Anthropic ====================

describe('anthropicProvider.chat（SSE 事件流）', () => {
  const anthropicSse = [
    'event: message_start',
    'data: {"type":"message_start","message":{"id":"msg_1","usage":{"input_tokens":9,"cache_read_input_tokens":2}}}',
    '',
    'event: content_block_start',
    'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}',
    '',
    'event: ping',
    'data: {"type":"ping"}',
    '',
    'event: content_block_delta',
    'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"第一章"}}',
    '',
    'event: content_block_delta',
    'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"完"}}',
    '',
    'event: message_delta',
    'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":5}}',
    '',
    'event: message_stop',
    'data: {"type":"message_stop"}',
    '',
    ''
  ].join('\n')

  it('happy：system 拆顶层 + 默认 max_tokens 4096 + 命名事件 + 双事件 usage 合并', async () => {
    const calls = mockFetch(async () => sseResponse(anthropicSse, 13))

    const onChunk = vi.fn()
    const result = await getProvider(validSettings({ protocol: 'anthropic' })).chat(
      validSettings({ protocol: 'anthropic', baseUrl: 'https://api.anthropic.example/' }),
      'claude-test',
      {
        messages: [
          { role: 'system', content: 'S1' },
          { role: 'system', content: 'S2' },
          { role: 'user', content: 'U1' },
          { role: 'assistant', content: 'A1' },
          { role: 'user', content: 'U2' }
        ],
        temperature: 1
      },
      onChunk
    )

    expect(result.text).toBe('第一章完')
    expect(onChunk.mock.calls.map((c) => c[0])).toEqual(['第一章', '完'])
    expect(result.usage).toEqual({ promptTokens: 9, completionTokens: 5, cachedTokens: 2 })

    const call = calls[0]
    expect(call.url).toBe('https://api.anthropic.example/v1/messages')
    const headers = call.init.headers as Record<string, string>
    expect(headers['x-api-key']).toBe(SENTINEL_KEY)
    expect(headers['anthropic-version']).toBe('2023-06-01')
    const body = JSON.parse(String(call.init.body))
    expect(body).toMatchObject({
      model: 'claude-test',
      max_tokens: 4096,
      system: 'S1\n\nS2',
      stream: true,
      temperature: 1
    })
    expect(body.messages).toEqual([
      { role: 'user', content: 'U1' },
      { role: 'assistant', content: 'A1' },
      { role: 'user', content: 'U2' }
    ])
  })

  it('显式 maxTokens 覆盖默认 4096', async () => {
    const calls = mockFetch(async () => sseResponse(anthropicSse, 17))
    await getProvider(validSettings({ protocol: 'anthropic' })).chat(
      validSettings({ protocol: 'anthropic' }),
      'claude-test',
      req({ maxTokens: 512 }),
      () => {}
    )
    const body = JSON.parse(String(calls[0].init.body))
    expect(body.max_tokens).toBe(512)
  })

  it('error 事件 → kind provider + 供应商错误消息', async () => {
    const sse =
      'event: error\ndata: {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}\n\n'
    mockFetch(async () => sseResponse(sse, 5))
    const err = await captureError(() =>
      getProvider(validSettings({ protocol: 'anthropic' })).chat(
        validSettings({ protocol: 'anthropic' }),
        'm',
        req(),
        () => {}
      )
    )
    expect(err.kind).toBe('provider')
    expect(err.message).toContain('Overloaded')
    expect(err.message).not.toContain(SENTINEL_KEY)
  })

  it('403 → kind auth，不回显密钥', async () => {
    mockFetch(async () => new Response('{"error":{"message":"forbidden"}}', { status: 403 }))
    const err = await captureError(() =>
      getProvider(validSettings({ protocol: 'anthropic' })).chat(
        validSettings({ protocol: 'anthropic' }),
        'm',
        req(),
        () => {}
      )
    )
    expect(err.kind).toBe('auth')
    expect(err.message).toContain('403')
    expect(err.message).not.toContain(SENTINEL_KEY)
  })
})

// extractJsonLoose 的「四路」测试随函数迁移至 src/common/jsonLoose.test.ts（M4b Task 4 裁定 3）。

// ==================== 密钥回显脱敏（远端文本进 err.message 前必经 redactKey） ====================

describe('redactKey：网关回显请求头密钥的防线', () => {
  it('单元：多处出现全替换；<8 短密钥不脱敏（太短无泄露价值，且会误伤常用词）；空/缺省直通', () => {
    expect(redactKey(`a ${SENTINEL_KEY} b ${SENTINEL_KEY}`, SENTINEL_KEY)).toBe('a [已脱敏] b [已脱敏]')
    expect(redactKey('abc abc abc', 'abc')).toBe('abc abc abc')
    expect(redactKey('keep me', '')).toBe('keep me')
    expect(redactKey('keep me', undefined)).toBe('keep me')
  })

  it('openai 401 响应体回显 Bearer 密钥 → message 只见 [已脱敏]，不见明文', async () => {
    mockFetch(async () =>
      new Response(`Unauthorized: bad token in Authorization: Bearer ${SENTINEL_KEY}`, { status: 401 })
    )
    const err = await captureError(() =>
      getProvider(validSettings()).chat(validSettings(), 'm', req(), () => {})
    )
    expect(err.kind).toBe('auth')
    expect(err.message).toContain('401')
    expect(err.message).toContain('[已脱敏]')
    expect(err.message).not.toContain(SENTINEL_KEY)
  })

  it('anthropic error 事件消息回显 x-api-key → 脱敏', async () => {
    const sse = `event: error\ndata: {"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key: ${SENTINEL_KEY}"}}\n\n`
    mockFetch(async () => sseResponse(sse, 9))
    const err = await captureError(() =>
      getProvider(validSettings({ protocol: 'anthropic' })).chat(
        validSettings({ protocol: 'anthropic' }),
        'm',
        req(),
        () => {}
      )
    )
    expect(err.kind).toBe('provider')
    expect(err.message).toContain('[已脱敏]')
    expect(err.message).not.toContain(SENTINEL_KEY)
  })

  it('openai 流中 200 夹带 data {"error":{...}}（网关怪癖）→ 按内嵌 status 分类且脱敏', async () => {
    const sse =
      'data: {"choices":[{"delta":{"content":"半"}}]}\n\n' +
      `data: {"error":{"message":"key revoked: ${SENTINEL_KEY}","status":401}}\n\n` +
      'data: [DONE]\n\n'
    mockFetch(async () => sseResponse(sse, 8))
    const err = await captureError(() =>
      getProvider(validSettings()).chat(validSettings(), 'm', req(), () => {})
    )
    expect(err.kind).toBe('auth') // 内嵌 401 → auth；无 status 时归 provider
    expect(err.message).toContain('[已脱敏]')
    expect(err.message).not.toContain(SENTINEL_KEY)
  })
})

// ==================== 空闲重置超时语义（M4a 终审结转，M4b Task 0） ====================

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/**
 * 节奏化假流：每帧间隔 gapMs 真实等待；帧尽后可选「静默」（read 停摆直到 abort）。
 * abort → c.error(AbortError)，与真实 undici body 被 signal 掐死同形（pending read 拒绝上抛）。
 */
function pacedStreamFetch(frames: string[], gapMs: number, silentAfter: boolean) {
  return async (...args: Parameters<typeof fetch>): Promise<Response> => {
    const init = (args[1] ?? {}) as RequestInit
    const signal = init.signal as AbortSignal
    if (!signal) throw new Error('测试假 fetch 必须收到 signal')
    const encoder = new TextEncoder()
    let i = 0
    let releaseSilence: () => void = () => {}
    const silenceGate = new Promise<void>((r) => {
      releaseSilence = r
    })
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        signal.addEventListener(
          'abort',
          () => {
            releaseSilence()
            c.error(abortError())
          },
          { once: true }
        )
      },
      pull(c) {
        if (i < frames.length) {
          return sleep(gapMs).then(() => c.enqueue(encoder.encode(frames[i++])))
        }
        if (silentAfter) return silenceGate // 流静默：读侧停摆，等空闲计时器掐死
        c.close()
        return Promise.resolve()
      }
    })
    return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })
  }
}

describe('linkSignal 空闲语义（timeoutMs = 活动上限，非总时长）', () => {
  it('分段活动各自 < idleMs 但总时长超出 → 不误杀；随后静默 > idleMs → timeout；abort 后活动无效', async () => {
    const linked = linkSignal({ timeoutMs: 80 })
    try {
      await sleep(50)
      linked.noteActivity()
      await sleep(50)
      // 总时长 100ms > 80ms 空闲上限——旧「总时长」语义此刻早已杀；新语义距上次活动仅 50ms < 80，未死
      expect(linked.signal.aborted).toBe(false)
      await sleep(100)
      // 距上次活动 ~150ms > 80ms → 空闲窗口耗尽
      expect(linked.signal.aborted).toBe(true)
      expect(linked.cause()).toBe('timeout')
      linked.noteActivity() // abort 后的活动必须无效（不得复活计时器）
      expect(linked.cause()).toBe('timeout')
    } finally {
      linked.cleanup()
    }
  })

  it('外部取消归因不受 noteActivity 影响 → cause cancelled', () => {
    const ctrl = new AbortController()
    const linked = linkSignal({ signal: ctrl.signal, timeoutMs: 5000 })
    linked.noteActivity()
    ctrl.abort()
    expect(linked.cause()).toBe('cancelled')
    linked.cleanup()
  })

  it('cleanup 后 noteActivity 永久失效（closed 分支不得重新起计时器——T6 sweep）', async () => {
    const linked = linkSignal({ timeoutMs: 60 })
    linked.cleanup() // 析构时刻意不 abort：只要求「活动无从续命」
    linked.noteActivity()
    await sleep(150) // 若 closed 分支仍起表，60ms 时 signal 就该 aborted
    expect(linked.signal.aborted).toBe(false)
    expect(linked.cause()).toBe(null)
  })
})

describe('流阶段空闲重置（provider 端到端判别）', () => {
  it('openai：20 帧 × 10ms（总 ~200ms）在 idleMs=100 下 → 正常完成（旧总时长语义会在 ~100ms 杀）', async () => {
    const frames = Array.from(
      { length: 20 },
      (_, i) => `data: {"choices":[{"delta":{"content":"x${i}"}}]}\n\n`
    )
    mockFetch(pacedStreamFetch(frames, 10, false))
    const result = await getProvider(validSettings()).chat(
      validSettings(),
      'm',
      req(),
      () => {},
      { timeoutMs: 100 }
    )
    expect(result.text).toBe(Array.from({ length: 20 }, (_, i) => `x${i}`).join(''))
  })

  it('openai：一帧后流静默超过 idleMs=100 → AiCallError kind timeout', async () => {
    mockFetch(pacedStreamFetch(['data: {"choices":[{"delta":{"content":"x"}}]}\n\n'], 5, true))
    const err = await captureError(() =>
      getProvider(validSettings()).chat(validSettings(), 'm', req(), () => {}, { timeoutMs: 100 })
    )
    expect(err.kind).toBe('timeout')
  })

  it('anthropic：节奏化事件流（ping/delta 共 11 帧）在 idleMs=60 下 → 正常完成', async () => {
    const frames = [
      'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":3}}}\n\n',
      'event: ping\ndata: {"type":"ping"}\n\n',
      ...Array.from(
        { length: 8 },
        (_, i) =>
          `event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"x${i}"}}\n\n`
      ),
      'event: message_stop\ndata: {"type":"message_stop"}\n\n'
    ]
    mockFetch(pacedStreamFetch(frames, 10, false))
    const onChunk = vi.fn()
    const result = await getProvider(validSettings({ protocol: 'anthropic' })).chat(
      validSettings({ protocol: 'anthropic' }),
      'm',
      req(),
      onChunk,
      { timeoutMs: 60 }
    )
    expect(result.text).toBe('x0x1x2x3x4x5x6x7')
    expect(onChunk).toHaveBeenCalledTimes(8)
  })
})

// ==================== getProvider 路由 ====================

describe('getProvider', () => {
  it('按 protocol 路由到对应适配器（以 URL 形状为证）', async () => {
    const calls = mockFetch(async () => sseResponse('data: [DONE]\n\n', 4))
    await getProvider(validSettings()).chat(validSettings(), 'm', req(), () => {})
    await getProvider(validSettings({ protocol: 'anthropic' })).chat(
      validSettings({ protocol: 'anthropic' }),
      'm',
      req(),
      () => {}
    )
    expect(calls.map((c) => c.url)).toEqual([
      'https://api.example.com/v1/chat/completions',
      'https://api.example.com/v1/v1/messages'
    ])
  })

  it('未知协议 → AiCallError kind provider', () => {
    const bad = { ...validSettings(), protocol: 'gemini' } as unknown as AiSettings
    try {
      getProvider(bad)
      expect.unreachable()
    } catch (err) {
      expect(err).toBeInstanceOf(AiCallError)
      expect((err as AiCallError).kind).toBe('provider')
      expect((err as AiCallError).message).toContain('gemini')
    }
  })
})

// ==================== testConnection ====================

describe('testConnection', () => {
  it('openai：GET /models → 首条模型 id（简报「取 1 条」），带 Bearer', async () => {
    const calls = mockFetch(async () => jsonResponse({ data: [{ id: 'm1' }, { id: 'm2' }, { id: 'm3' }] }))
    const result = await getProvider(validSettings()).testConnection(validSettings())
    expect(result).toEqual({ ok: true, sample: 'models: m1' })
    expect(calls[0].url).toBe('https://api.example.com/v1/models')
    expect(calls[0].init.method).toBe('GET')
    expect((calls[0].init.headers as Record<string, string>).authorization).toBe(`Bearer ${SENTINEL_KEY}`)
  })

  it('openai：401 → kind auth 且不泄露密钥', async () => {
    mockFetch(async () => new Response('{"error":"unauthorized"}', { status: 401 }))
    const err = await captureError(() => getProvider(validSettings()).testConnection(validSettings()))
    expect(err.kind).toBe('auth')
    expect(err.message).not.toContain(SENTINEL_KEY)
  })

  it('anthropic：最小 1-token ping → {ok, sample:"ok"}', async () => {
    const calls = mockFetch(async () => jsonResponse({ id: 'msg_ping', content: [] }))
    const result = await getProvider(validSettings({ protocol: 'anthropic' })).testConnection(
      validSettings({ protocol: 'anthropic' }),
      'claude-probe'
    )
    expect(result).toEqual({ ok: true, sample: 'ok' })
    expect(calls[0].url).toBe('https://api.example.com/v1/v1/messages')
    const body = JSON.parse(String(calls[0].init.body))
    expect(body).toMatchObject({ model: 'claude-probe', max_tokens: 1 })
    expect(body.messages).toEqual([{ role: 'user', content: 'ping' }])
    expect((calls[0].init.headers as Record<string, string>)['x-api-key']).toBe(SENTINEL_KEY)
  })

  it('anthropic：model 与 defaultModel 都缺 → not-configured（不发请求）', async () => {
    const calls = mockFetch(async () => jsonResponse({}))
    const settings = validSettings({ protocol: 'anthropic', defaultModel: '' })
    const err = await captureError(() => getProvider(settings).testConnection(settings))
    expect(err.kind).toBe('not-configured')
    expect(calls.length).toBe(0)
  })
})

// ==================== ensureOk：先脱敏后截断（Task 3 复审 FOLD，Task 4 落测） ====================

describe('ensureOk 截断/脱敏顺序不变量', () => {
  it('长密钥横跨截断线：旧序「先截后遮」会漏出头碎片（本用例可判新旧序）', async () => {
    // LONG_KEY 从 index 280 起（32 字符，跨过 slice(0,300) 线）。旧序：截断只剩前 20 字符，
    // redactKey 找不到完整串 → AiCallError 的 capMessage 再裁到 message[0..296]（前缀 10 字），
    // capped[280..286] 的 `sk-sent` 明文头仍能活到最终 message。新序先脱敏，绝无此段。
    const LONG_KEY = 'sk-sentinel-key-0123456789abcdef'
    const body = 'A'.repeat(280) + LONG_KEY + 'B'.repeat(100)
    const err = await captureError(() => ensureOk(new Response(body, { status: 401 }), LONG_KEY))
    expect(err.kind).toBe('auth')
    expect(err.message).not.toContain(LONG_KEY)
    expect(err.message).not.toContain('sk-sent') // 连 7 字符的头碎片都不许在
    expect(err.message).not.toContain('0123456789')
    expect(err.message.length).toBeLessThanOrEqual(300)
  })

  it('短体内含密钥 → 正常脱敏；空体只报 status；读体失败有占位', async () => {
    const err = await captureError(() => ensureOk(new Response(`bad ${SENTINEL_KEY} bad`, { status: 403 }), SENTINEL_KEY))
    expect(err.message).toContain('[已脱敏]')
    expect(err.message).not.toContain('sk-sen')
    const err2 = await captureError(() => ensureOk(new Response('', { status: 500 })))
    expect({ kind: err2.kind, message: err2.message }).toEqual({ kind: 'provider', message: 'HTTP 500' })
  })
})
