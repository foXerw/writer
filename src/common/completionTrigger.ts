// M5 Task 2：实时补全（ghost text）的触发状态机——纯 reducer，零计时器、零 DOM、零 I/O。
// 这是「不打扰」的宪法层：写作流被中断一次就足以让人关掉功能，所以所有闸门都在这里钉死，
// Task 5 的编排 hook 只允许通过本表进出，任何「看起来能发火」的路径都必须过这张表。
//
// 五个败局与本表的对应守卫：
// - IME 拼音上屏前反复触发 contentChanged → compositionStart 撤 arm 且 composing 是发火硬闸门，
//   compositionEnd 也不自动复臂（须等上屏后的新 contentChanged），组合期间绝不可能冒出 ghost；
// - 修订态（光标后有正文）发火会把续文插进句子中间 → contentChanged/cursorMoved 带 suffixEmpty=false
//   即撤 arm，pauseTick 的唯一发火位是 armed，而 armed 只能由「光标在文末」的 contentChanged 布上；
// - 网络分块在 accept 之后迟到 → chunk/firstChunk 在非对应相位一律原样返回（引用不变），
//   迟到的包没有通道改动任何状态；
// - 章节/视图切换遗留活请求或陈旧 ghost → chapterSwitch/viewSwitch/disabled 在途即 fire:'abort' 并回 idle；
// - 同前缀冷却刷屏 → pauseTick 发火要求 prefix≠lastPrefix：被 dismiss 的文案永远不再自动重弹，
//   accept 过的文案同理（正文已变，旧前缀本就该翻页）。
//
// 计时说明：900ms debounce 的钟在 Task 5（pauseTick 由它按静默时长定时派发）；本表仍用
// lastChangeAt 复核 at-lastChangeAt≥debounceMs，作为纵深防御——状态机自己的规矩不外包。
//
// brief 勘误（口径笔误，仿 Task 1 先例以规则可实现性为准）：brief 的 CompletionState 字面量只有
// 四个字段，但其转移规则要求「at-lastChange≥debounce」与「dismiss 记 lastPrefix=prefix」，
// 纯 reducer 若不存这两处信息则规则无从判定。故补两个记账字段 pendingPrefix（最近一次
// contentChanged 的前缀，armed 的候选文案）与 lastChangeAt（最近一次改动时刻）。
// 对 Task 5 无破坏：状态只经 initialCompletionState() 创建、由事件流转，从不手写字面量。
// 勘误二：brief「contentChanged→armed」未区分在途相位——照字面会在一次 fetch 未完时
// 叠发第二次请求。T2 原裁定「在途只记账不重布防」；**终审 minor1 裁定已反转其处置方向**
// （never re-litigate，理由见 closeout 裁定 13 与下方 contentChanged 注释）：在途键入一律
// fire:'abort' 掐在途，新文即时重布防（硬闸门下收回 idle）——单一在途不变量同样由
// 「abort 先行、下一次 pauseTick 才发新火」守住。

/** 触发状态机的相位：idle=没打算请求；armed=已布防待静默；requesting=请求在途；streaming=首包已到。 */
export type CompletionPhase = 'idle' | 'armed' | 'requesting' | 'streaming'

export type CompletionState = {
  phase: CompletionPhase
  /** IME 组合中为 true： composing 是发火硬闸门，且期间一律撤防。 */
  composing: boolean
  /** 此时刻（ms epoch）之前禁止新发火；0=无冷却。仅 dismiss 写入。 */
  cooldownUntil: number
  /** 最近一次「已发火/被撤销」的前缀：同前缀不再自动弹，防刷屏。初始 '' 同时挡住空文档发火。 */
  lastPrefix: string
  /** 最近一次 contentChanged 的前缀（armed 候选文案），发火时抄入 lastPrefix。 */
  pendingPrefix: string
  /** 最近一次 contentChanged 的时刻，供 pauseTick 复核静默时长。 */
  lastChangeAt: number
}

export type CompletionEvent =
  | { type: 'contentChanged'; prefix: string; suffixEmpty: boolean; at: number }
  | { type: 'cursorMoved'; suffixEmpty: boolean }
  | { type: 'pauseTick'; at: number }
  | { type: 'compositionStart' }
  | { type: 'compositionEnd' }
  | { type: 'requestSent' }
  | { type: 'firstChunk' }
  | { type: 'chunk' }
  | { type: 'accept' }
  | { type: 'dismiss'; at: number }
  | { type: 'chapterSwitch' }
  | { type: 'viewSwitch' }
  | { type: 'disabled' }

/** 触发闸门配置：总开关 + 静默阈值 + 被撤销后的冷却（由 Task 5 从偏好注入）。 */
export type CompletionTriggerConfig = {
  enabled: boolean
  debounceMs: number
  cooldownMs: number
}

/** reducer 的旁路效应：'request'=此刻允许发起补全；'abort'=立刻掐掉在途请求与 ghost。 */
export type CompletionTriggerEffect = 'request' | 'abort'

export type CompletionTriggerResult = {
  state: CompletionState
  fire?: CompletionTriggerEffect
}

export function initialCompletionState(): CompletionState {
  return {
    phase: 'idle',
    composing: false,
    cooldownUntil: 0,
    lastPrefix: '',
    pendingPrefix: '',
    lastChangeAt: 0
  }
}

/** 在途相位：abort 只对这两个相位有意义（armed 还没有请求可掐）。 */
function isLive(phase: CompletionPhase): boolean {
  return phase === 'requesting' || phase === 'streaming'
}

export function nextCompletionState(
  s: CompletionState,
  e: CompletionEvent,
  cfg: CompletionTriggerConfig
): CompletionTriggerResult {
  switch (e.type) {
    case 'contentChanged': {
      // 三条硬闸门（disabled/composing/修订态）先到：违例时「armed 也撤」，
      // 但前缀与时刻照记——它们是正文事实，不影响发火判定（phase 已非 armed 即无从发火）。
      const blocked = !cfg.enabled || s.composing || !e.suffixEmpty
      // 在途相位（requesting/streaming）再键入 = 作者自己接管这支笔——终审 minor1 裁定
      // （反转 T2 勘误二的「保持在途」）：与流动态对称，一律 abort 掐在途 + 用新文即时
      // 重布防。ghost 锚定发火瞬间的光标位，再键入注定让它落在陈旧语境里；掐掉一个 <1s
      // 的在途请求 token 成本可忽略，留着它等首包再撤则是写作流里一次实打实的灰字闪现
      // （反目标）。单一在途不变量不破：abort 先行，下一次 pauseTick 才可能发新请求。
      // 撞硬闸门（修订态/被禁/组字中）时同样 abort，但收回 idle 不重布防。
      // （冷却/lastPrefix 不在此记账：键入不是拒绝，dismiss 语义归 dismiss 事件自己。）
      if (isLive(s.phase)) {
        if (blocked) {
          return {
            state: { ...s, phase: 'idle', pendingPrefix: e.prefix, lastChangeAt: e.at },
            fire: 'abort'
          }
        }
        return {
          state: { ...s, phase: 'armed', pendingPrefix: e.prefix, lastChangeAt: e.at },
          fire: 'abort'
        }
      }
      return {
        state: {
          ...s,
          phase: blocked ? 'idle' : 'armed',
          pendingPrefix: e.prefix,
          lastChangeAt: e.at
        }
      }
    }

    case 'cursorMoved': {
      // 光标移进正文=进入修订模式：撤掉待发火意图，避免 ghost 将来到达错误插入点。
      // 不动在途请求——数据先到内存，是否呈现由 Task 5 按相位裁决，切换场景才走 abort。
      if (!e.suffixEmpty && s.phase === 'armed') return { state: { ...s, phase: 'idle' } }
      return { state: s }
    }

    case 'pauseTick': {
      // 唯一发火位。逐条对应「打扰」清单：只从 armed 发（idle/streaming 不重复请求）、
      // composing 不发（IME 期间的停顿不是停笔）、enabled 不发（功能关了是死的）、
      // 静默未满不发（Task 5 已按钟派发，此处复核纵深防御）、
      // 冷却未到期不发（刚被撤销就再弹是骚扰）、同前缀不发（同一句话不该反复出同一建议，
      // 初始 lastPrefix='' 顺带挡住空前缀的空文档请求）。
      const canFire =
        cfg.enabled &&
        !s.composing &&
        s.phase === 'armed' &&
        e.at - s.lastChangeAt >= cfg.debounceMs &&
        e.at >= s.cooldownUntil &&
        s.pendingPrefix !== s.lastPrefix
      if (!canFire) return { state: s }
      // 发火即把候选前缀落账：此后同前缀直到内容真的改变才可能再次触发。
      return { state: { ...s, phase: 'requesting', lastPrefix: s.pendingPrefix }, fire: 'request' }
    }

    case 'compositionStart': {
      // IME 组合开始：composing 置真且所有等待态清零——armed 撤防（拼音中间态绝不是停笔），
      // 在途请求 abort（用户正要改写光标前的字，旧 ghost 已无意义且必须立刻消失）。
      if (isLive(s.phase)) return { state: { ...s, composing: true, phase: 'idle' }, fire: 'abort' }
      return { state: { ...s, composing: true, phase: 'idle' } }
    }

    case 'compositionEnd': {
      // 只解禁 composing，绝不复臂：上屏后的新 contentChanged 才是合法的布防信号。
      // 若在此复臂，等于允许「拼音串刚消失就弹 ghost」，正是最打断心流的一刻。
      return { state: { ...s, composing: false } }
    }

    case 'requestSent': {
      // 正常路径下 pauseTick 已直接置 requesting，此事件是乱序/迟到确认的兜底：
      // 只从 armed 前推；idle/streaming 下原样返回，绝不让陈旧确认把状态拖回在途。
      if (s.phase === 'armed') return { state: { ...s, phase: 'requesting' } }
      return { state: s }
    }

    case 'firstChunk': {
      // 只有等过请求的相位才认首包；abort/idle 之后到达的包属陈旧，state 原样（引用不变）。
      if (s.phase === 'requesting') return { state: { ...s, phase: 'streaming' } }
      return { state: s }
    }

    case 'chunk': {
      // 增量文本走 Task 5 的呈现通道，状态机绝不因 chunk 改动任何字段——
      // 「accept 之后 chunk 迟到仍改动东西」是 Review Focus 点名败局，用引用不变钉死。
      return { state: s }
    }

    case 'accept': {
      // 作者主动收下=这次帮忙有用，绝不记冷却；lastPrefix 保持发火时的落账，
      // 同前缀不重弹（正文已变长，旧前缀的语境已不存在）。
      return { state: { ...s, phase: 'idle' } }
    }

    case 'dismiss': {
      // 作者撤销=被打扰了：冷却 cooldownMs + 把这个前缀记入 lastPrefix，
      // 冷却只管时间窗，lastPrefix 管「这句文案永远不再自动重弹」（除非改出新前缀）。
      return {
        state: {
          ...s,
          phase: 'idle',
          cooldownUntil: e.at + cfg.cooldownMs,
          lastPrefix: s.pendingPrefix
        }
      }
    }

    case 'chapterSwitch':
    case 'viewSwitch':
    case 'disabled': {
      // 离开当前语境（换章/切视图/关掉功能）：在途的必须掐，ghost 不许跨场景存活。
      // 冷却与 lastPrefix 保留——重开功能不该让刚被撤销的建议立刻豁免刷屏。
      const abort = isLive(s.phase)
      const next: CompletionState = { ...s, phase: 'idle' }
      return abort ? { state: next, fire: 'abort' } : { state: next }
    }
  }
}
