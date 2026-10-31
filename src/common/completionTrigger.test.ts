// M5 Task 2 契约测试：补全触发状态机（纯 reducer，零计时器/零 DOM）。
// 钉死 Review Focus 五败局——IME composition 期间开火、修订态（光标后有文）开火、
// accept 后 chunk 迟到仍改动状态、章节/视图切换遗留活请求或陈旧 ghost、同前缀冷却刷屏；
// 外加 debounce 边界（899 不火 / 900 火）、cooldown 边界（到点才火）、
// accept 免冷却 vs dismiss 记冷却的非对称、compositionEnd 不自动复臂（须新输入）、
// 纯函数不改入参。900ms 计时钟在 Task 5，本表只消费 pauseTick。
import { describe, expect, it } from 'vitest'
import type { CompletionEvent, CompletionState, CompletionTriggerConfig } from './completionTrigger'
import { initialCompletionState, nextCompletionState } from './completionTrigger'

const CFG: CompletionTriggerConfig = { enabled: true, debounceMs: 900, cooldownMs: 3000 }
const T0 = 10_000
const P = '夜色漫过旧码头，'
const Q = '夜色漫过新灯塔，'

function run(s: CompletionState, e: CompletionEvent, cfg: CompletionTriggerConfig = CFG) {
  return nextCompletionState(s, e, cfg)
}

/** 从初态经一次正常 contentChanged 得到 armed 态（prefix 默认 P，时刻默认 T0）。 */
function armed(prefix = P, at = T0): CompletionState {
  return run(initialCompletionState(), { type: 'contentChanged', prefix, suffixEmpty: true, at }).state
}

/** 走完 arm→发火→首包 的流动态，供 accept/dismiss/迟到包类用例复用。 */
function streaming(prefix = P, at = T0): CompletionState {
  let s = armed(prefix, at)
  s = run(s, { type: 'pauseTick', at: at + CFG.debounceMs }).state
  return run(s, { type: 'firstChunk' }).state
}

describe('contentChanged 与布防', () => {
  it('光标后为空：contentChanged → armed，记录 pendingPrefix 与 lastChangeAt', () => {
    const s = armed()
    expect(s.phase).toBe('armed')
    expect(s.pendingPrefix).toBe(P)
    expect(s.lastChangeAt).toBe(T0)
  })

  it('修订态（光标后有文）：绝不布防，已 armed 也撤销', () => {
    const s = run(armed(), { type: 'contentChanged', prefix: Q, suffixEmpty: false, at: T0 + 100 }).state
    expect(s.phase).toBe('idle')
    const fresh = run(initialCompletionState(), {
      type: 'contentChanged',
      prefix: P,
      suffixEmpty: false,
      at: T0
    }).state
    expect(fresh.phase).toBe('idle')
  })

  it('enabled=false：contentChanged 不布防，pauseTick 也不发火（总开关优先）', () => {
    const cfg = { ...CFG, enabled: false }
    const s = run(initialCompletionState(), { type: 'contentChanged', prefix: P, suffixEmpty: true, at: T0 }, cfg).state
    expect(s.phase).toBe('idle')
    const r = run(armed(), { type: 'pauseTick', at: T0 + 900 }, cfg)
    expect(r.fire).toBeUndefined()
  })

  it('composing 期间输入（IME 上屏前的中间态）：不布防', () => {
    let s = run(armed(), { type: 'compositionStart' }).state
    s = run(s, { type: 'contentChanged', prefix: Q, suffixEmpty: true, at: T0 + 200 }).state
    expect(s.phase).toBe('idle')
    expect(s.composing).toBe(true)
  })
})

describe('pauseTick 发火闸门', () => {
  it('正常路径：armed 且静默满 debounce → fire request，phase=requesting，lastPrefix 落账', () => {
    const r = run(armed(), { type: 'pauseTick', at: T0 + 900 })
    expect(r.fire).toBe('request')
    expect(r.state.phase).toBe('requesting')
    expect(r.state.lastPrefix).toBe(P)
    expect(r.state.cooldownUntil).toBe(0) // 发火本身不记冷却
  })

  it('差 1ms 未满 debounce：不发火，保持 armed 等待下一个 tick', () => {
    const r = run(armed(), { type: 'pauseTick', at: T0 + 899 })
    expect(r.fire).toBeUndefined()
    expect(r.state.phase).toBe('armed')
  })

  it('idle / streaming 下的 pauseTick 一律不发火（armed 是唯一发火位）', () => {
    expect(run(initialCompletionState(), { type: 'pauseTick', at: T0 + 900 }).fire).toBeUndefined()
    const r = run(streaming(), { type: 'pauseTick', at: T0 + 5000 })
    expect(r.fire).toBeUndefined()
    expect(r.state.phase).toBe('streaming')
  })

  it('同前缀刷屏免疫：accept 同一文案后原样再触发 → prefix===lastPrefix，不发火', () => {
    let s = armed()
    s = run(s, { type: 'pauseTick', at: T0 + 900 }).state
    s = run(s, { type: 'firstChunk' }).state
    s = run(s, { type: 'accept' }).state
    s = run(s, { type: 'contentChanged', prefix: P, suffixEmpty: true, at: T0 + 2000 }).state
    expect(s.phase).toBe('armed')
    const r = run(s, { type: 'pauseTick', at: T0 + 2900 })
    expect(r.fire).toBeUndefined()
    expect(r.state.phase).toBe('armed') // 不消耗 arm，等用户改出新前缀
  })

  it('冷却窗口内新前缀不发火；到点（at===cooldownUntil）即可发火', () => {
    let s = streaming()
    s = run(s, { type: 'dismiss', at: T0 + 1000 }).state
    s = run(s, { type: 'contentChanged', prefix: Q, suffixEmpty: true, at: T0 + 1100 }).state
    expect(run(s, { type: 'pauseTick', at: T0 + 1000 + 3000 - 1 }).fire).toBeUndefined()
    expect(run(s, { type: 'pauseTick', at: T0 + 1000 + 3000 }).fire).toBe('request')
  })

  it('纵深防御：即便出现 armed+composing 的病态组合，pauseTick 也绝不发火', () => {
    const sick = { ...armed(), composing: true }
    const r = run(sick, { type: 'pauseTick', at: T0 + 900 })
    expect(r.fire).toBeUndefined()
  })
})

describe('IME composition', () => {
  it('compositionStart：置 composing 并撤销 armed（布防中的候选词不是请求，不 abort）', () => {
    const r = run(armed(), { type: 'compositionStart' })
    expect(r.fire).toBeUndefined()
    expect(r.state.composing).toBe(true)
    expect(r.state.phase).toBe('idle')
  })

  it('compositionStart：请求在途/流式中必须掐掉（abort+idle），不留陈旧 ghost', () => {
    const r1 = run({ ...armed(), phase: 'requesting' }, { type: 'compositionStart' })
    expect(r1.fire).toBe('abort')
    expect(r1.state.phase).toBe('idle')
    const r2 = run(streaming(), { type: 'compositionStart' })
    expect(r2.fire).toBe('abort')
    expect(r2.state.phase).toBe('idle')
  })

  it('compositionEnd：只清 composing，不自动复臂；须等新 contentChanged 才重新走流程', () => {
    let s = run(armed(), { type: 'compositionStart' }).state
    s = run(s, { type: 'compositionEnd' }).state
    expect(s.composing).toBe(false)
    expect(s.phase).toBe('idle')
    expect(run(s, { type: 'pauseTick', at: T0 + 5000 }).fire).toBeUndefined()
    // 上屏后正常输入 → 恢复正常发火路径
    s = run(s, { type: 'contentChanged', prefix: Q, suffixEmpty: true, at: T0 + 5100 }).state
    expect(run(s, { type: 'pauseTick', at: T0 + 6000 }).fire).toBe('request')
  })
})

describe('请求生命周期', () => {
  it('requestSent：armed→requesting（迟到的确认不复活 idle）', () => {
    expect(run(armed(), { type: 'requestSent' }).state.phase).toBe('requesting')
    const r = run(initialCompletionState(), { type: 'requestSent' })
    expect(r.state.phase).toBe('idle')
    expect(r.fire).toBeUndefined()
  })

  it('firstChunk：requesting→streaming；idle 下是陈旧包，绝不进 streaming', () => {
    let s = armed()
    s = run(s, { type: 'pauseTick', at: T0 + 900 }).state
    expect(run(s, { type: 'firstChunk' }).state.phase).toBe('streaming')
    const stale = run(initialCompletionState(), { type: 'firstChunk' })
    expect(stale.state.phase).toBe('idle')
    expect(stale.fire).toBeUndefined()
  })

  it('chunk：streaming 下状态原样返回（引用不变），ghost 文本不进状态机', () => {
    const s = streaming()
    const r = run(s, { type: 'chunk' })
    expect(r.state).toBe(s)
    expect(r.fire).toBeUndefined()
  })

  it('accept：streaming→idle，不记冷却（作者主动收下不是被打扰）', () => {
    const r = run(streaming(), { type: 'accept' })
    expect(r.state.phase).toBe('idle')
    expect(r.state.cooldownUntil).toBe(0)
    expect(r.fire).toBeUndefined()
  })

  it('accept 之后的迟到 chunk/firstChunk 不得改动任何东西', () => {
    let s = armed()
    s = run(s, { type: 'pauseTick', at: T0 + 900 }).state
    s = run(s, { type: 'firstChunk' }).state
    s = run(s, { type: 'accept' }).state
    const r1 = run(s, { type: 'chunk' })
    expect(r1.state).toBe(s)
    expect(r1.fire).toBeUndefined()
    const r2 = run(s, { type: 'firstChunk' })
    expect(r2.state).toBe(s)
    expect(r2.fire).toBeUndefined()
  })

  it('dismiss：idle + cooldownUntil=at+cooldownMs + lastPrefix 记账', () => {
    const r = run(streaming(), { type: 'dismiss', at: T0 + 1000 })
    expect(r.state.phase).toBe('idle')
    expect(r.state.cooldownUntil).toBe(T0 + 1000 + 3000)
    expect(r.state.lastPrefix).toBe(P)
  })

  it('非对称收尾：dismiss 冷却到期后同前缀仍不再发火，而 accept 后新前缀可立即发火', () => {
    let d = streaming(Q)
    d = run(d, { type: 'pauseTick', at: T0 + 900 }).state
    d = run(d, { type: 'firstChunk' }).state
    d = run(d, { type: 'dismiss', at: T0 + 1000 }).state
    // 冷却已过期，但被撤销的建议文案（前缀 Q）永不再自动弹出
    d = run(d, { type: 'contentChanged', prefix: Q, suffixEmpty: true, at: T0 + 5000 }).state
    expect(run(d, { type: 'pauseTick', at: T0 + 6000 }).fire).toBeUndefined()
    // 对照：accept 不记冷却也不屏蔽新前缀——收下后换个地方停笔应立刻可再触发
    let a = armed()
    a = run(a, { type: 'pauseTick', at: T0 + 900 }).state
    a = run(a, { type: 'firstChunk' }).state
    a = run(a, { type: 'accept' }).state
    a = run(a, { type: 'contentChanged', prefix: Q, suffixEmpty: true, at: T0 + 1000 }).state
    expect(run(a, { type: 'pauseTick', at: T0 + 1900 }).fire).toBe('request')
  })
})

describe('场景切换与总开关', () => {
  it('chapterSwitch / viewSwitch：在途请求一律 abort + idle', () => {
    let s = armed()
    s = run(s, { type: 'pauseTick', at: T0 + 900 }).state
    const r1 = run(s, { type: 'chapterSwitch' })
    expect(r1.fire).toBe('abort')
    expect(r1.state.phase).toBe('idle')
    const r2 = run(streaming(), { type: 'viewSwitch' })
    expect(r2.fire).toBe('abort')
    expect(r2.state.phase).toBe('idle')
  })

  it('chapterSwitch：仅 armed（尚无请求）时静默撤防，不发 abort', () => {
    const r = run(armed(), { type: 'chapterSwitch' })
    expect(r.fire).toBeUndefined()
    expect(r.state.phase).toBe('idle')
  })

  it('disabled 事件：流式中 abort + idle；冷却与 lastPrefix 记账保留（重开不豁免刷屏）', () => {
    let s = streaming()
    s = run(s, { type: 'dismiss', at: T0 + 1000 }).state
    const r = run({ ...s, phase: 'streaming' }, { type: 'disabled' })
    expect(r.fire).toBe('abort')
    expect(r.state.phase).toBe('idle')
    expect(r.state.cooldownUntil).toBe(T0 + 1000 + 3000)
    expect(r.state.lastPrefix).toBe(P)
  })

  it('cursorMoved：光标落进正文（修订态）撤 arm；仍在文末则保持 armed', () => {
    const away = run(armed(), { type: 'cursorMoved', suffixEmpty: false })
    expect(away.fire).toBeUndefined()
    expect(away.state.phase).toBe('idle')
    const back = run(armed(), { type: 'cursorMoved', suffixEmpty: true })
    expect(back.state.phase).toBe('armed')
  })
})

describe('在途请求期间继续打字（终审 minor1 裁定反转 T2「保持在途」：键入=作者接管笔，掐在途+重布防）', () => {
  it('streaming 中再输入：abort 在途 + 新文即时重布防，下一次静默可发新请求', () => {
    const s = streaming()
    const r = run(s, { type: 'contentChanged', prefix: Q, suffixEmpty: true, at: T0 + 2000 })
    expect(r.fire).toBe('abort')
    expect(r.state.phase).toBe('armed')
    expect(r.state.pendingPrefix).toBe(Q)
    expect(r.state.lastChangeAt).toBe(T0 + 2000)
    // 掐流后不留活体：旧请求经 fire:'abort' 已死，静默满后合法发的是【新】请求（单一在途不变量仍在）
    const after = run(r.state, { type: 'pauseTick', at: T0 + 2900 })
    expect(after.fire).toBe('request')
    expect(after.state.phase).toBe('requesting')
  })

  it('requesting 中再输入：与 streaming 对称——abort + armed；迟到首包不改相', () => {
    const s = run(armed(), { type: 'pauseTick', at: T0 + 900 }).state
    const r = run(s, { type: 'contentChanged', prefix: Q, suffixEmpty: true, at: T0 + 1200 })
    expect(r.fire).toBe('abort')
    expect(r.state.phase).toBe('armed')
    // 被掐请求的迟到 firstChunk 进不了 streaming（armed 下 firstChunk 是陈旧包）
    expect(run(r.state, { type: 'firstChunk' }).state.phase).toBe('armed')
    expect(run(r.state, { type: 'pauseTick', at: T0 + 2100 }).fire).toBe('request')
  })

  it('streaming 中转入修订态（光标后有文）：结果已注定无处可插 → abort + idle', () => {
    const r = run(streaming(), { type: 'contentChanged', prefix: Q, suffixEmpty: false, at: T0 + 2000 })
    expect(r.fire).toBe('abort')
    expect(r.state.phase).toBe('idle')
  })

  it('requesting 中功能被关：abort + idle，不许留活体请求', () => {
    const s = run(armed(), { type: 'pauseTick', at: T0 + 900 }).state
    const r = run(s, { type: 'contentChanged', prefix: Q, suffixEmpty: true, at: T0 + 1200 }, { ...CFG, enabled: false })
    expect(r.fire).toBe('abort')
    expect(r.state.phase).toBe('idle')
  })
})

describe('纯函数性', () => {
  it('不改动入参：冻结的 state 过一遍全事件表也不可变、不抛错', () => {
    const frozen = Object.freeze({ ...streaming() })
    const events: CompletionEvent[] = [
      { type: 'contentChanged', prefix: Q, suffixEmpty: true, at: T0 + 700 },
      { type: 'cursorMoved', suffixEmpty: false },
      { type: 'pauseTick', at: T0 + 900 },
      { type: 'compositionStart' },
      { type: 'compositionEnd' },
      { type: 'requestSent' },
      { type: 'firstChunk' },
      { type: 'chunk' },
      { type: 'accept' },
      { type: 'dismiss', at: T0 + 800 },
      { type: 'chapterSwitch' },
      { type: 'viewSwitch' },
      { type: 'disabled' }
    ]
    for (const e of events) {
      const before = JSON.stringify(frozen)
      expect(() => run(frozen, e)).not.toThrow()
      expect(JSON.stringify(frozen)).toBe(before)
    }
  })
})
