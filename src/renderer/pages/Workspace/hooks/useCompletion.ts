// M5 Task 5：实时补全（ghost text）的编排 hook——T2 状态机唯一的驱动者。
//
// 分工宪法：所有「该不该发火」的裁决都在 nextCompletionState（纯表），本文件只做三件事：
// ① 把编辑器/设置/路由信号翻译成状态机事件；② 执行 fire:'request'/'abort' 旁路效应
//（装配→chat、掐流→清鬼影）；③ 用代际令牌（genRef）封死「异步迟到包复活 ghost」——
// 装配是多次 await 的慢路径，await 期间任何 abort（切章/关功能/采纳/组合输入）都必须让
// 在途装配整体作废，而不是把半路结果贴到已经换了现场的编辑器上。
//
// 编排裁定（spec §6 + T2/T4 评审结转）：
// - 停笔钟在本层：contentChanged 后 900ms 派发 pauseTick，发不发由机器复核；
// - 每次布防前重读 getAISettings（设置变更无 watch 通道，毫秒级读可接受）；翻false→
//   派发 disabled——T2 评审 carry-in：不派则 armed 能活过关→开周期；
// - 流式期间任何键入/光标挪动 = 作者自己接管 → dismiss（ghost 锚点在旧光标，继续
//   贴随是「鬼影瞬移」级打扰）；采纳在途流剩余 chunk 一律作废（Tab 收的是「眼前这段」，
//   后续文本的落点预期已错位）；
// - 错误全 kind 静默（completionSilentKinds 集合 = ai-types 全集，单测钉死）：补全失败
//   绝不弹任何 toast/弹窗——写作流被打断一次就够关掉功能；失败同时 dismiss 记冷却，
//   防坏配置下每次停笔都再撞一次；
// - accept 不进冷却（机器语义），采纳后的再布防由 executeEdits 触发的 contentChanged 自然完成；
// - 装配读通道复用 getAllCharacters/getAllSettings/book:readAiData（useOrganize 先例，
//   零新增 IPC）。plotlines/choices/ledger 三路刻意不读：T1 只有角色/词条两种卡投影，
//   其余实体无卡形态，补全是延迟敏感小请求，不为拿不到的卡多开三路读。
//
// 无 jsdom：纯切片/策略表单测（useCompletion.test.ts），编排交互面由 T6 CDP 冒烟兜底。
import { useCallback, useEffect, useRef, type RefObject } from 'react'
import { useAI } from '../../../hooks/useAI'
import { useAiData, useAISettings, useCharacter, useSetting } from '../../../hooks/useIPC'
import type { MonacoEditorHandle } from '../../../components/Editor/MonacoEditor'
import { EMPTY_LEDGER } from './ledgerFallback'
import { buildCompletionPrompt, entitiesForChapter, projectCharacterCard, projectWorldCard } from '@/common/completionContext'
import {
  initialCompletionState,
  nextCompletionState,
  type CompletionEvent,
  type CompletionState,
  type CompletionTriggerConfig
} from '@/common/completionTrigger'
import { buildEntityChapterRefs } from '@/common/entityRefs'
import type { AiErrorKind } from '@/common/ai-types'

/** 停笔阈值（spec §6：900ms debounce）。 */
const COMPLETION_DEBOUNCE_MS = 900
/** dismiss 后同前缀静默窗（spec §6：3s）。 */
const COMPLETION_COOLDOWN_MS = 3000
/** 首块看门狗：受理后 4s 无首字 abort（spec §2 延迟预算）。 */
const COMPLETION_FIRST_CHUNK_TIMEOUT_MS = 4000
/** 补全输出上限（小请求，续 ≤3 句）。 */
const COMPLETION_MAX_TOKENS = 300
/** 光标前正文保留上限（码点，spec §6：~1500 字）。 */
const PROSE_BEFORE_MAX_CHARS = 1500

/**
 * 光标前正文的码点安全尾切片：取 full[0..cursorOffset) 的尾部 maxChars 个码点。
 * cursorOffset 是 UTF-16 码元偏移（Monaco getOffsetAt 口径），切点可能落在代理对
 * 中间——孤立高半码元（0xD800–0xDBFF）残尾必须丢弃，否则半个 emoji 进 prompt 即
 * 字面乱码；这比「按码元盲切」多一步，也正是单测钉死的边界。
 */
export function sliceProseBefore(full: string, cursorOffset: number, maxChars: number): string {
  if (full === '' || maxChars <= 0) return ''
  const end = Math.max(0, Math.min(cursorOffset, full.length))
  if (end === 0) return ''
  const head = full.slice(0, end)
  const lastUnit = head.charCodeAt(head.length - 1)
  const safe = lastUnit >= 0xd800 && lastUnit <= 0xdbff ? head.slice(0, -1) : head
  if (safe === '') return ''
  const cps = Array.from(safe)
  return cps.length <= maxChars ? safe : cps.slice(cps.length - maxChars).join('')
}

/**
 * 补全静默策略表（全 kind = 一律只 console.warn）：刻意手抄而非引 AI_ERROR_KINDS——
 * 单测断言两表集合相等，新 kind 进 ai-types 而这里没跟上即红灯，逼一次显式表态。
 */
export const completionSilentKinds: readonly AiErrorKind[] = [
  'not-configured',
  'auth',
  'network',
  'timeout',
  'provider',
  'cancelled',
  'busy'
]

export interface CompletionDeps {
  projectPath?: string
  /** 书名（进 prompt【书名】行；Workspace 的 projectName 即 book.json name）。 */
  bookName: string
  currentChapterId: string | null
  /** 书序章 id 表（buildEntityChapterRefs 的悬挂过滤与排序基准）。 */
  orderedChapterIds: string[]
  editorRef: RefObject<MonacoEditorHandle>
}

/** Workspace 把编辑器信号/键位回调转交本 hook 的接线面（全部稳定引用）。 */
export interface CompletionBinding {
  onEditorReady: () => void
  onEditorContentChanged: () => void
  onCursorMoved: (suffixEmpty: boolean) => void
  onCompositionStart: () => void
  onCompositionEnd: () => void
  onEditorBlur: () => void
  onAcceptGhost: () => void
  onDismissGhost: () => void
  /** 离开写作视图（MonacoEditor 即将卸载）：喂 viewSwitch 并终结「就绪」判定。 */
  onLeaveWriteView: () => void
}

export function useCompletion(deps: CompletionDeps): CompletionBinding {
  const { chat, cancel: cancelAI } = useAI()
  const { getAISettings } = useAISettings()
  const { getAllCharacters } = useCharacter()
  const { getAllSettings } = useSetting()
  const { readAiData } = useAiData()

  // 长流程 await 之后读最新闭包（saveRef 惯用法）：bookName/chapterId/编辑器句柄都不能吃渲染期旧值
  const argsRef = useRef(deps)
  argsRef.current = deps

  const stateRef = useRef<CompletionState>(initialCompletionState())
  // enabled 初值 false：opt-in 功能的保守默认，首次读设置回包前机器不可能发火
  const cfgRef = useRef<CompletionTriggerConfig>({
    enabled: false,
    debounceMs: COMPLETION_DEBOUNCE_MS,
    cooldownMs: COMPLETION_COOLDOWN_MS
  })
  const readyRef = useRef(false) // carry-in (c)：monaco 异步创建完成前绝不允许布防
  const mountedRef = useRef(true)
  const pauseTimerRef = useRef<number | null>(null)
  const firstChunkTimerRef = useRef<number | null>(null)
  const requestIdRef = useRef<string | null>(null)
  const accRef = useRef('')
  // 代际令牌：request/abort/accept/卸载全部经 bump 作废「已上路但还没落地」的异步步骤
  const genRef = useRef(0)
  const runRequestRef = useRef<() => Promise<void>>(async () => {})

  const clearPauseTimer = useCallback(() => {
    if (pauseTimerRef.current !== null) {
      window.clearTimeout(pauseTimerRef.current)
      pauseTimerRef.current = null
    }
  }, [])
  const clearFirstChunkTimer = useCallback(() => {
    if (firstChunkTimerRef.current !== null) {
      window.clearTimeout(firstChunkTimerRef.current)
      firstChunkTimerRef.current = null
    }
  }, [])

  /** 掐在途、抹鬼影、清记账——不写冷却/lastPrefix（那是 dismiss 事件的专属语义）。 */
  const abortLive = useCallback(() => {
    genRef.current++ // 先作废后掐：chunk 可能已在 IPC 回程路上，代际不符即丢弃呈现
    clearFirstChunkTimer()
    const id = requestIdRef.current
    requestIdRef.current = null
    accRef.current = ''
    if (id) void cancelAI(id).catch((err) => console.warn('[useCompletion] 取消在途请求失败（无害）:', err))
    argsRef.current.editorRef.current?.clearGhost()
  }, [cancelAI, clearFirstChunkTimer])

  /** 唯一的状态机入口：纯表裁决，旁路效应只认 fire。 */
  const feed = useCallback((event: CompletionEvent) => {
    const result = nextCompletionState(stateRef.current, event, cfgRef.current)
    stateRef.current = result.state
    if (result.fire === 'request') void runRequestRef.current()
    else if (result.fire === 'abort') abortLive()
  }, [abortLive])

  /** 拒绝式收尾：掐流 + 清鬼影 + 记冷却（idle 相位不喂 dismiss，避免无现场乱记账）。 */
  const dismissNow = useCallback(() => {
    abortLive()
    if (stateRef.current.phase !== 'idle') feed({ type: 'dismiss', at: Date.now() })
  }, [abortLive, feed])

  /** 布防前重读开关（spec 裁定）；true→false 派发 disabled（T2 评审 carry-in）。 */
  const refreshSettings = useCallback(() => {
    void getAISettings()
      .then((view) => {
        if (!mountedRef.current) return
        const next = view.completionEnabled
        const prev = cfgRef.current.enabled
        cfgRef.current.enabled = next
        if (prev && !next) feed({ type: 'disabled' })
      })
      .catch((err) => console.warn('[useCompletion] 设置重读失败（维持当前开关判定）:', err))
  }, [getAISettings, feed])

  const runRequest = useCallback(async (): Promise<void> => {
    const { projectPath, bookName, currentChapterId, orderedChapterIds, editorRef } = argsRef.current
    const editor = editorRef.current
    if (!projectPath || !editor || !readyRef.current) {
      dismissNow() // 机器已置 requesting 却无处落地：用 dismiss 收回（冷却比 idle 更保守）
      return
    }
    const gen = ++genRef.current
    accRef.current = ''
    const window1 = editor.getProseWindow()
    // 布防到发火的窗口里光标可能被纯移动带进正文：结果没有合法落点，直接作废
    if (window1.before === '' || window1.after !== '') {
      dismissNow()
      return
    }
    const proseBefore = sliceProseBefore(window1.before, window1.before.length, PROSE_BEFORE_MAX_CHARS)
    let cards: string[]
    let synopsis: string
    try {
      const [characters, world, aiData] = await Promise.all([
        getAllCharacters(projectPath),
        getAllSettings(projectPath),
        readAiData(projectPath)
      ])
      if (!mountedRef.current || genRef.current !== gen) return // 装配在途被 abort：整体作废
      const refs = buildEntityChapterRefs({
        index: aiData.entityIndex,
        characters,
        world,
        plotlines: [], // 见文件头裁定：其余实体类型无卡投影，不为卡多开读通道
        choices: [],
        ledger: EMPTY_LEDGER,
        orderedChapterIds
      })
      const entityIds = entitiesForChapter(refs, currentChapterId ?? '')
      const characterById = new Map(characters.map((c) => [c.id, c]))
      const worldById = new Map(world.map((w) => [w.id, w]))
      cards = []
      for (const entityId of entityIds) {
        const character = characterById.get(entityId)
        if (character) {
          cards.push(projectCharacterCard(character))
          continue
        }
        const entry = worldById.get(entityId)
        if (entry) cards.push(projectWorldCard(entry))
      }
      synopsis = aiData.meta.synopsis
    } catch (err) {
      console.warn('[useCompletion] 上下文装配读取失败（静默）:', err)
      dismissNow()
      return
    }
    // 出网最后一道复核：装配 await 期间光标可能挪位/正文可能又动了（动了的话机器只在
    // 在途相位记了账、不会重新布防，这次请求的锚点已陈旧）——作废比贴错地方正确。
    const window2 = editor.getProseWindow()
    if (!readyRef.current || window2.before !== window1.before || window2.after !== '') {
      dismissNow()
      return
    }
    const prompt = buildCompletionPrompt({
      proseBefore,
      proseAfter: window2.after,
      cards,
      bookName,
      synopsis,
      maxChars: PROSE_BEFORE_MAX_CHARS
    })
    let firstChunkArrived = false
    const requestId = await chat(
      {
        projectPath,
        feature: 'completion', // 主进程按 models.completion > defaultModel 解析并记账
        messages: [
          { role: 'system', content: prompt.system },
          { role: 'user', content: prompt.user }
        ],
        maxTokens: COMPLETION_MAX_TOKENS
      },
      {
        onChunk: (text) => {
          if (!mountedRef.current || genRef.current !== gen) return // 迟到包：无处可插即无处可显
          if (!firstChunkArrived) {
            firstChunkArrived = true
            clearFirstChunkTimer()
            feed({ type: 'firstChunk' })
          } else {
            feed({ type: 'chunk' })
          }
          accRef.current += text
          // 呈现只在 streaming 相位：机器若已被 abort 收回 idle，这里的 setGhost 永不执行
          if (stateRef.current.phase === 'streaming') {
            argsRef.current.editorRef.current?.setGhost(accRef.current)
          }
        },
        onDone: () => {
          // 成功终态不额外动 ghost：去留是作者的决定（Tab 采纳 / Esc 拒），直到那时灰字都在
          if (genRef.current === gen) {
            requestIdRef.current = null
            clearFirstChunkTimer()
          }
        },
        onError: (kind, message) => {
          if (genRef.current !== gen) return
          // 静默策略（spec 铁律：写作流内绝不弹错）：全 kind 只 console.warn；
          // 不在策略表里的 kind（表漂移）升 error 级留痕——测试早已红灯，这里是最后防线
          if ((completionSilentKinds as readonly string[]).includes(kind)) {
            console.warn(`[useCompletion] 补全静默失败（${kind}）: ${message}`)
          } else {
            console.error(`[useCompletion] 未登记错误 kind（请更新策略表）: ${kind}`)
          }
          dismissNow() // 失败也进冷却：坏配置不该每次停笔都再撞一遍
        }
      }
    )
    if (!mountedRef.current || genRef.current !== gen) {
      // 受理窗口期被 abort：id 不当句柄持有，直接掐灭（cancel 对已终态 id 返回 false，无害）
      void cancelAI(requestId).catch(() => {})
      return
    }
    requestIdRef.current = requestId
    // 4s 首字看门狗（受理后起钟；首块到达即拆）。requestSent 事件刻意不喂：pauseTick 已把
    // 相位置 requesting，机器里的 requestSent 只是乱序兜底，正常链路上喂它是纯冗余。
    clearFirstChunkTimer()
    firstChunkTimerRef.current = window.setTimeout(() => {
      firstChunkTimerRef.current = null
      if (genRef.current === gen && !firstChunkArrived) dismissNow()
    }, COMPLETION_FIRST_CHUNK_TIMEOUT_MS)
  }, [chat, cancelAI, clearFirstChunkTimer, dismissNow, feed, getAllCharacters, getAllSettings, readAiData])
  runRequestRef.current = runRequest

  const onEditorContentChanged = useCallback(() => {
    if (!readyRef.current) return // carry-in (c)：未就绪窗口的 onChange 一律不吃
    const editor = argsRef.current.editorRef.current
    if (!editor) return
    refreshSettings()
    const { before, after } = editor.getProseWindow()
    if (before === '' && after === '') return // 空文档（或未就绪同形窗口）：无文可续
    // 流式期键入 = 作者自己接管这支笔（ghost 锚点还钉在旧光标位）→ 先 dismiss 再按新文布防
    if (stateRef.current.phase === 'streaming') dismissNow()
    feed({ type: 'contentChanged', prefix: before, suffixEmpty: after === '', at: Date.now() })
    clearPauseTimer()
    pauseTimerRef.current = window.setTimeout(() => {
      pauseTimerRef.current = null
      if (!readyRef.current) return
      feed({ type: 'pauseTick', at: Date.now() })
    }, COMPLETION_DEBOUNCE_MS)
  }, [clearPauseTimer, dismissNow, feed, refreshSettings])

  const onCursorMoved = useCallback((suffixEmpty: boolean) => {
    if (!readyRef.current) return
    const phase = stateRef.current.phase
    // 流式期光标挪动：setGhost 每次按实时光标锚定，鬼影会「跟着光标瞬移」，且 Tab 落点
    // 预期已错位——最简正确 = 立刻 dismiss。请求在途而光标挪进正文（非文末）同理作废。
    if (phase === 'streaming' || (phase === 'requesting' && !suffixEmpty)) dismissNow()
    feed({ type: 'cursorMoved', suffixEmpty })
  }, [dismissNow, feed])

  const onCompositionStart = useCallback(() => {
    // 机器语义：armed 撤防、在途 abort（fire:'abort' → abortLive 掐流清鬼影）——
    // 拼音串上屏前的任何 ghost 都是串字事故现场
    feed({ type: 'compositionStart' })
  }, [feed])

  const onCompositionEnd = useCallback(() => {
    // 只解禁 composing，绝不复臂：上屏后的新 contentChanged 才是合法布防信号（机器宪法）
    feed({ type: 'compositionEnd' })
  }, [feed])

  const onEditorBlur = useCallback(() => {
    // 焦点离编辑器的鬼影/在途请求没有服役对象（Esc 键位也随焦点走了）→ dismiss
    if (stateRef.current.phase !== 'idle' || argsRef.current.editorRef.current?.getGhost()) dismissNow()
  }, [dismissNow])

  const onAcceptGhost = useCallback(() => {
    if (!readyRef.current) return
    const editor = argsRef.current.editorRef.current
    if (!editor) return
    const text = editor.getGhost()
    if (text === '') return
    // 顺序即语义：先喂 accept（机器：idle、绝不记冷却——采纳不是被打扰），
    // 再作废在途流（Tab 收的是「眼前这段」，后续 chunk 的落点预期已错位），
    // 最后 executeEdits 插字：它同步触发的 onChange 会从 idle 自然再布防（采纳即续写链）。
    feed({ type: 'accept' })
    abortLive()
    editor.insertAtCursor(text)
  }, [abortLive, feed])

  const onDismissGhost = useCallback(() => {
    dismissNow()
  }, [dismissNow])

  const onLeaveWriteView = useCallback(() => {
    readyRef.current = false // MonacoEditor 随视图卸载，「就绪」判定一并终结
    clearPauseTimer()
    feed({ type: 'viewSwitch' }) // 在途 → fire:'abort'，鬼影不跨视图存活（机器败局 4）
  }, [clearPauseTimer, feed])

  const onEditorReady = useCallback(() => {
    readyRef.current = true
    refreshSettings() // 首次布防前的开关读取
  }, [refreshSettings])

  // 切章 = 语境整体更换：在途必掐、ghost 必灭（机器败局 4 的章侧腿）。
  // 视图态恢复/setValue 触发的 contentChanged 会排在本 effect 之后先布防再被本章的
  // chapterSwitch 收回 idle——净效果 = 换章后必须重新键入才可能出 ghost，正是所求。
  const prevChapterIdRef = useRef(deps.currentChapterId)
  useEffect(() => {
    if (prevChapterIdRef.current === deps.currentChapterId) return
    prevChapterIdRef.current = deps.currentChapterId
    clearPauseTimer()
    feed({ type: 'chapterSwitch' })
  }, [deps.currentChapterId, clearPauseTimer, feed])

  // 卸载收尾：视图都没了，在途请求不该继续烧 token；鬼影随组件销毁，这里只补网络侧断尾
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      clearPauseTimer()
      clearFirstChunkTimer()
      const id = requestIdRef.current
      requestIdRef.current = null
      if (id) void cancelAI(id).catch(() => {})
    }
  }, [cancelAI, clearFirstChunkTimer, clearPauseTimer])

  return {
    onEditorReady,
    onEditorContentChanged,
    onCursorMoved,
    onCompositionStart,
    onCompositionEnd,
    onEditorBlur,
    onAcceptGhost,
    onDismissGhost,
    onLeaveWriteView
  }
}
