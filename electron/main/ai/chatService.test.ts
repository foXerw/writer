// chatService 测试（M4a Task 4）。全部离线：假 provider 经 setProviderOverride 注入，
// settings 经 vi.mock('./settings') 替身（顺带绕开 electron app.getPath）。钉死：
// ① chunk 顺序 = provider onChunk 顺序，done 携 usage 且账本落盘（tmp 书目录）；
// ② 受理前失败（not-configured/busy/未配置模型/形状非法）同步 reject `[kind] …` 且**不发任何事件**
//    ——busy 走事件会误杀在途原请求，这是契约不是巧合；
// ③ 受理后 AiCallError.kind 直通 ai:error；非 AiCallError 归 provider；
// ④ cancel 幂等 abort；⑤ 并发多 requestId 零串台；⑥ finally 清理用毕即可复用同 id。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AiChatRequest, AiSettings } from '../../../src/common/ai-types'
import type { AiProvider, ChatRequestInput, ProviderChatOptions, ProviderChatResult } from './providers/types'
import { AiCallError } from './providers/types'
import type { ChatEventSender } from './chatService'
import { cancelChat, inflightCount, setProviderOverride, startChat } from './chatService'
import { mkTmpBook } from '../../../tests/tmp'

// —— settings 替身（工厂内只引用 hoisted 持有器；真实 settings 的 electron 依赖被整体绕过）
const holder = vi.hoisted(() => ({
  settings: {
    protocol: 'openai',
    baseUrl: 'https://api.test',
    apiKey: 'sk-test-key',
    defaultModel: 'D',
    models: {}
  } as unknown
}))
vi.mock('./settings', () => ({
  loadSettings: () => holder.settings
}))

function resetSettings(over: Partial<AiSettings> = {}): void {
  holder.settings = {
    protocol: 'openai',
    baseUrl: 'https://api.test',
    apiKey: 'sk-test-key',
    defaultModel: 'D',
    models: {},
    ...over
  }
}

// —— 事件替身窗口
interface Emitted {
  channel: string
  payload: Record<string, unknown>
}
function fakeSender(): { events: Emitted[]; sender: ChatEventSender; setDestroyed: (v: boolean) => void } {
  const events: Emitted[] = []
  let destroyed = false
  return {
    events,
    sender: {
      send: (channel, payload) => {
        events.push({ channel, payload: payload as Record<string, unknown> })
      },
      isDestroyed: () => destroyed
    },
    setDestroyed: (v: boolean) => {
      destroyed = v
    }
  }
}

const okResult = (over: Partial<ProviderChatResult> = {}): ProviderChatResult => ({
  usage: { promptTokens: 11, completionTokens: 7 },
  text: '',
  ...over
})

const providerStub = (chat: AiProvider['chat']): AiProvider => ({
  chat,
  testConnection: async () => ({ ok: true, sample: '' })
})

const baseReq = (over: Partial<AiChatRequest> = {}): AiChatRequest => ({
  requestId: 'r1',
  feature: 'completion',
  messages: [{ role: 'user', content: 'hi' }],
  ...over
})

/** 排空微任务+若干计时器轮（并发用例里 provider 内部有 setTimeout 交错）。 */
async function settle(rounds = 8): Promise<void> {
  for (let i = 0; i < rounds; i++) await new Promise((r) => setTimeout(r, 0))
}

beforeEach(() => {
  resetSettings()
})

afterEach(() => {
  setProviderOverride(null)
})

describe('startChat happy path', () => {
  it('chunk 顺序→事件顺序；done 携 usage；projectPath 存在则账本落盘；opts 转发 signal/timeout', async () => {
    let seenModel = ''
    let seenOpts: ProviderChatOptions | undefined
    setProviderOverride(
      providerStub(async (_s, model, _r, onChunk, opts) => {
        seenModel = model
        seenOpts = opts
        onChunk('你')
        await new Promise((r) => setTimeout(r, 0))
        onChunk('好')
        return okResult({ usage: { promptTokens: 11, completionTokens: 7, cachedTokens: 3 } })
      })
    )
    const book = mkTmpBook()
    const { events, sender } = fakeSender()
    const ack = startChat(sender, baseReq({ projectPath: book, temperature: 0.5 }))

    expect(ack).toEqual({ accepted: true })
    await settle()
    expect(events.map((e) => e.channel)).toEqual(['ai:chunk', 'ai:chunk', 'ai:done'])
    expect(events[0].payload).toEqual({ requestId: 'r1', text: '你' })
    expect(events[1].payload).toEqual({ requestId: 'r1', text: '好' })
    expect(events[2].payload).toEqual({
      requestId: 'r1',
      usage: { promptTokens: 11, completionTokens: 7, cachedTokens: 3 }
    })
    // 账本：一行，feature/model 与请求解析一致
    const line = readFileSync(join(book, '.ai', 'usage.jsonl'), 'utf-8')
    expect(line.split('\n').filter((l) => l !== '')).toHaveLength(1)
    const rec = JSON.parse(line) as Record<string, unknown>
    expect({ feature: rec.feature, model: rec.model, promptTokens: rec.promptTokens, completionTokens: rec.completionTokens, cachedTokens: rec.cachedTokens })
      .toEqual({ feature: 'completion', model: 'D', promptTokens: 11, completionTokens: 7, cachedTokens: 3 })
    expect(String(rec.ts)).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    // provider 收到合并后的对话输入与取消/空闲超时接缝（M4b Task 0：默认 45_000 空闲语义）
    expect(seenModel).toBe('D')
    expect(seenOpts?.signal).toBeInstanceOf(AbortSignal)
    expect(seenOpts?.timeoutMs).toBe(45_000)
    expect(inflightCount()).toBe(0)
  })

  it('timeoutMs 透传：合法 req.timeoutMs 覆盖默认空闲窗口；非法值回退默认', async () => {
    const seen: (ProviderChatOptions | undefined)[] = []
    setProviderOverride(
      providerStub(async (_s, _m, _r, _oc, opts) => {
        seen.push(opts)
        return okResult()
      })
    )
    const { sender } = fakeSender()
    startChat(sender, baseReq({ timeoutMs: 120_000 }))
    startChat(sender, baseReq({ requestId: 'r2', timeoutMs: -1 }))
    startChat(sender, baseReq({ requestId: 'r3', timeoutMs: 'oops' as never }))
    startChat(sender, baseReq({ requestId: 'r4', timeoutMs: 0 })) // 0 也是非法值（>0 门）——T6 sweep 显式钉
    await settle()
    expect(seen.map((o) => o?.timeoutMs)).toEqual([120_000, 45_000, 45_000, 45_000])
  })

  it('无 projectPath：done 照常回，账本零落盘', async () => {
    setProviderOverride(providerStub(async () => okResult()))
    const book = mkTmpBook()
    const { events, sender } = fakeSender()
    startChat(sender, baseReq()) // projectPath 缺省
    await settle()
    expect(events.map((e) => e.channel)).toEqual(['ai:done'])
    expect(existsSync(join(book, '.ai'))).toBe(false)
  })

  it('model 解析：req.model > models[feature] > defaultModel', async () => {
    const seen: string[] = []
    setProviderOverride(
      providerStub(async (_s, model) => {
        seen.push(model)
        return okResult()
      })
    )
    const { sender } = fakeSender()
    resetSettings({ models: { completion: 'C' } })
    startChat(sender, baseReq({ model: 'M' }))
    startChat(sender, baseReq({ requestId: 'r2' })) // models.completion 覆盖生效
    startChat(sender, baseReq({ requestId: 'r3', feature: 'review' })) // 无 review 覆盖 → defaultModel
    await settle()
    expect(seen).toEqual(['M', 'C', 'D'])
  })

  it('全部模型为空 → 同步 [not-configured] 未配置模型；provider 不被触碰、零事件', async () => {
    const chat = vi.fn(async () => okResult())
    setProviderOverride(providerStub(chat))
    resetSettings({ defaultModel: '' })
    const { events, sender } = fakeSender()
    expect(() => startChat(sender, baseReq())).toThrow('[not-configured] 未配置模型')
    expect(() => startChat(sender, baseReq({ requestId: 'r2', feature: 'review' }))).toThrow('[not-configured]')
    await settle()
    expect(chat).not.toHaveBeenCalled()
    expect(events).toHaveLength(0)
    expect(inflightCount()).toBe(0)
  })

  it('窗口已销毁：静默哑火但不抛（结果无处安放）', async () => {
    setProviderOverride(providerStub(async () => okResult()))
    const { events, sender, setDestroyed } = fakeSender()
    setDestroyed(true)
    startChat(sender, baseReq())
    await settle()
    expect(events).toHaveLength(0)
    expect(inflightCount()).toBe(0)
  })
})

describe('受理前同步失败（不发事件）', () => {
  it('未配置（缺 key / 缺 baseUrl）→ [not-configured]，provider 不触碰、零事件', async () => {
    const chat = vi.fn(async () => okResult())
    setProviderOverride(providerStub(chat))
    const { events, sender } = fakeSender()
    resetSettings({ apiKey: '' })
    expect(() => startChat(sender, baseReq())).toThrow(/^\[not-configured\]/)
    resetSettings({ apiKey: 'sk-test-key', baseUrl: '' })
    expect(() => startChat(sender, baseReq({ requestId: 'r2' }))).toThrow(/^\[not-configured\]/)
    await settle()
    expect(chat).not.toHaveBeenCalled()
    expect(events).toHaveLength(0)
  })

  it('形状非法（requestId 空串 / messages 非数组）→ [provider]', () => {
    setProviderOverride(providerStub(async () => okResult()))
    const { sender } = fakeSender()
    expect(() => startChat(sender, baseReq({ requestId: '' }))).toThrow(/^\[provider\]/)
    expect(() => startChat(sender, { ...baseReq(), messages: 'oops' as never })).toThrow(/^\[provider\]/)
  })

  it('feature 白名单（Task 6）：未知/缺省 feature → [provider] 同步拒，先于在途表与账本写入', async () => {
    const chat = vi.fn(async () => okResult())
    setProviderOverride(providerStub(chat))
    const book = mkTmpBook()
    const { events, sender } = fakeSender()
    expect(() =>
      startChat(sender, baseReq({ feature: 'summarize' as never, projectPath: book }))
    ).toThrow(/^\[provider\]/)
    expect(() =>
      startChat(sender, baseReq({ requestId: 'r2', feature: undefined as never, projectPath: book }))
    ).toThrow(/^\[provider\]/)
    await settle()
    expect(chat).not.toHaveBeenCalled()
    expect(events).toHaveLength(0)
    expect(inflightCount()).toBe(0)
    expect(existsSync(join(book, '.ai'))).toBe(false) // 账本路径从未被触碰
  })

  it('busy：同 requestId 在途重复 → 后到同步 reject；在途原请求毫发无伤；善后可复用同 id', async () => {
    let release!: () => void
    setProviderOverride(
      providerStub(
        () =>
          new Promise<ProviderChatResult>((resolve) => {
            release = () => resolve(okResult())
          })
      )
    )
    const first = fakeSender()
    startChat(first.sender, baseReq())
    const dup = fakeSender()
    expect(() => startChat(dup.sender, baseReq())).toThrow(/^\[busy\]/)
    // 关键不变量：busy 绝不以 ai:error 形式打扰在途原请求（事件按 requestId 分发会误杀它）
    expect(first.events).toHaveLength(0)
    release()
    await settle()
    expect(first.events.map((e) => e.channel)).toEqual(['ai:done'])
    expect(inflightCount()).toBe(0)
    // 同 id 复用成功 = finally 清理确实发生
    let release2!: () => void
    setProviderOverride(
      providerStub(
        () =>
          new Promise<ProviderChatResult>((resolve) => {
            release2 = () => resolve(okResult())
          })
      )
    )
    expect(startChat(first.sender, baseReq())).toEqual({ accepted: true })
    release2()
    await settle()
  })
})

describe('受理后失败 → ai:error（事件侧唯一终态）', () => {
  it('AiCallError 的 kind/message 原样直通', async () => {
    setProviderOverride(
      providerStub(async () => {
        throw new AiCallError('auth', 'HTTP 401: key rejected')
      })
    )
    const { events, sender } = fakeSender()
    startChat(sender, baseReq())
    await settle()
    expect(events).toHaveLength(1)
    expect(events[0].channel).toBe('ai:error')
    expect(events[0].payload).toEqual({ requestId: 'r1', kind: 'auth', message: 'HTTP 401: key rejected' })
    expect(inflightCount()).toBe(0)
  })

  it('非 AiCallError（provider 实现缺陷）→ 归 provider，message 不带原始异常正文', async () => {
    setProviderOverride(
      providerStub(async () => {
        throw new TypeError('内部实现细节-不应泄露')
      })
    )
    const { events, sender } = fakeSender()
    startChat(sender, baseReq())
    await settle()
    expect(events[0].payload).toMatchObject({ kind: 'provider', requestId: 'r1' })
    expect(String(events[0].payload.message)).toContain('TypeError')
    expect(String(events[0].payload.message)).not.toContain('内部实现细节')
  })

  it('未知协议且未注入 override：getProvider 抛 AiCallError → ai:error provider（受理后路径）', async () => {
    setProviderOverride(null)
    resetSettings({ protocol: 'gemini' as unknown as AiSettings['protocol'] })
    const { events, sender } = fakeSender()
    expect(startChat(sender, baseReq())).toEqual({ accepted: true })
    await settle()
    expect(events).toHaveLength(1)
    expect(events[0].channel).toBe('ai:error')
    expect(events[0].payload).toMatchObject({ kind: 'provider' })
    expect(String(events[0].payload.message)).toContain('未知的 AI 协议')
  })

  it('done 之后账本写失败也不影响事件（只 warn）', async () => {
    setProviderOverride(providerStub(async () => okResult()))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const book = mkTmpBook()
    const blocker = join(book, '.ai')
    writeFileSync(blocker, 'x') // .ai 被普通文件占位 → mkdir 炸
    const { events, sender } = fakeSender()
    startChat(sender, baseReq({ projectPath: blocker })) // projectPath 本身是文件路径更炸
    await settle()
    expect(events.map((e) => e.channel)).toEqual(['ai:done'])
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})

describe('cancelChat', () => {
  it('abort 在途请求：provider 收到 signal → AiCallError(cancelled) → ai:error；重复/未知 id 返回 false', async () => {
    setProviderOverride(
      providerStub(
        (_s, _r0, _r1, _oc, opts) =>
          new Promise<ProviderChatResult>((_, reject) => {
            opts?.signal?.addEventListener('abort', () => reject(new AiCallError('cancelled', 'AI 请求已被取消')), { once: true })
          })
      )
    )
    const { events, sender } = fakeSender()
    startChat(sender, baseReq())
    expect(inflightCount()).toBe(1)
    expect(cancelChat('r1')).toBe(true)
    expect(cancelChat('r1')).toBe(false) // 在途但已取消过 → false（幂等且诚实）
    await settle()
    expect(events).toHaveLength(1)
    expect(events[0].channel).toBe('ai:error')
    expect(events[0].payload).toEqual({ requestId: 'r1', kind: 'cancelled', message: 'AI 请求已被取消' })
    expect(inflightCount()).toBe(0)
    expect(cancelChat('r1')).toBe(false) // 已善后 → false
    expect(cancelChat('nope')).toBe(false)
  })

  it('cancel 不影响其他在途请求（按 id 精确命中）', async () => {
    const gates = new Map<string, () => void>()
    setProviderOverride(
      providerStub((_s, _m, req, _oc, opts) => {
        const marker = req.messages[0].content
        return new Promise<ProviderChatResult>((resolve, reject) => {
          gates.set(marker, () => resolve(okResult()))
          opts?.signal?.addEventListener('abort', () => reject(new AiCallError('cancelled', '取消')), { once: true })
        })
      })
    )
    const a = fakeSender()
    const b = fakeSender()
    startChat(a.sender, baseReq({ requestId: 'idA', messages: [{ role: 'user', content: 'A' }] }))
    startChat(b.sender, baseReq({ requestId: 'idB', messages: [{ role: 'user', content: 'B' }] }))
    expect(cancelChat('idA')).toBe(true)
    await settle()
    expect(a.events.map((e) => [e.channel, e.payload.kind])).toEqual([['ai:error', 'cancelled']])
    expect(b.events).toHaveLength(0) // B 毫发无伤、仍在途
    gates.get('B')?.()
    await settle()
    expect(b.events.map((e) => e.channel)).toEqual(['ai:done'])
    expect(inflightCount()).toBe(0)
    gates.clear()
  })
})

describe('终态与死窗护栏（评审 FOLD Minors）', () => {
  it('provider settle 后违约回访 onChunk：done/error 之后的迟到 chunk 一律丢弃', async () => {
    let stray!: (t: string) => void
    setProviderOverride(
      providerStub(async (_s, _m, _r, onChunk) => {
        stray = onChunk
        onChunk('首')
        return okResult()
      })
    )
    const doneCase = fakeSender()
    startChat(doneCase.sender, baseReq())
    await settle()
    stray('迟到') // resolve 后回访
    expect(doneCase.events.map((e) => e.channel)).toEqual(['ai:chunk', 'ai:done'])

    let stray2!: (t: string) => void
    setProviderOverride(
      providerStub(async (_s, _m, _r, onChunk) => {
        stray2 = onChunk
        throw new AiCallError('network', '断线')
      })
    )
    const errCase = fakeSender()
    startChat(errCase.sender, baseReq({ requestId: 'r9' }))
    await settle()
    stray2('幽灵') // reject 后回访
    expect(errCase.events.map((e) => e.channel)).toEqual(['ai:error'])
  })

  it('流中途窗口销毁：下一次 emit 即 abort 控制器（不再为死窗烧配额），事件全程哑火', async () => {
    let pushChunk!: (t: string) => void
    let seenSignal!: AbortSignal
    setProviderOverride(
      providerStub((_s, _m, _r, onChunk, opts) => {
        pushChunk = onChunk
        seenSignal = opts?.signal as AbortSignal
        return new Promise<ProviderChatResult>((_, reject) => {
          seenSignal.addEventListener('abort', () => reject(new AiCallError('cancelled', '窗口已亡')), { once: true })
        })
      })
    )
    const { events, sender, setDestroyed } = fakeSender()
    startChat(sender, baseReq())
    await settle()
    expect(seenSignal.aborted).toBe(false)
    setDestroyed(true)
    pushChunk('无人收听') // 窗口死后的第一次 emit → 触发 abort → provider reject → error emit 亦哑火
    await settle()
    expect(seenSignal.aborted).toBe(true)
    expect(events).toHaveLength(0)
    expect(inflightCount()).toBe(0)
  })
})

describe('并发隔离（多 requestId 零串台）', () => {
  it('两请求交错出流：每条事件的 requestId 与自家 chunk/done 严格配对', async () => {
    setProviderOverride(
      providerStub(async (_s, _m, req: ChatRequestInput, onChunk) => {
        const marker = req.messages[0].content // 'A' | 'B'
        onChunk(`${marker}1`)
        await new Promise((r) => setTimeout(r, 0)) // 让另一路插队
        onChunk(`${marker}2`)
        return { usage: { promptTokens: marker.charCodeAt(0), completionTokens: 2 }, text: '' }
      })
    )
    const a = fakeSender()
    const b = fakeSender()
    expect(startChat(a.sender, baseReq({ requestId: 'idA', messages: [{ role: 'user', content: 'A' }] }))).toEqual({ accepted: true })
    expect(startChat(b.sender, baseReq({ requestId: 'idB', messages: [{ role: 'user', content: 'B' }] }))).toEqual({ accepted: true })
    await settle(20)
    expect(a.events.map((e) => e.channel)).toEqual(['ai:chunk', 'ai:chunk', 'ai:done'])
    expect(b.events.map((e) => e.channel)).toEqual(['ai:chunk', 'ai:chunk', 'ai:done'])
    for (const e of a.events) expect(e.payload.requestId).toBe('idA')
    for (const e of b.events) expect(e.payload.requestId).toBe('idB')
    expect(a.events.slice(0, 2).map((e) => e.payload.text)).toEqual(['A1', 'A2'])
    expect(b.events.slice(0, 2).map((e) => e.payload.text)).toEqual(['B1', 'B2'])
    expect(a.events[2].payload).toMatchObject({ usage: { promptTokens: 65, completionTokens: 2 } })
    expect(b.events[2].payload).toMatchObject({ usage: { promptTokens: 66, completionTokens: 2 } })
    expect(inflightCount()).toBe(0)
  })
})
