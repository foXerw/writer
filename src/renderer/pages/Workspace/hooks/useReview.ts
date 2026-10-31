// M6 T5：章节审阅的编排 hook——逐章顺序 chat(feature='review') → 信封解析 → 五字段盖章 →
// review:saveRun（部分失败隔离）→ 转化（opinionToChange → proposal:save/appendChanges →
// markConverted）。本文件是逻辑半区：无 UI、无 toast——所有面向用户的呈现经回调/返回值
// 交对话框（ReviewDialog，UI 半区接线），对齐 brief「not-configured 是对话框可见错误、非 toast」。
//
// 生命周期纪律（逐字对齐 useOrganize 先例）：
// - mountedRef 防卸载后 setState；argsRef 每渲染刷新——长流程 await 之后必须读到最新闭包
//   （编辑器缓冲 getBufferChapter、projectPath、回调）；
// - runningRef 并发门：在途期间第二次 runReview 直接返回 {kind:'busy'}（一书架一审阅）；
// - activeRequestIdRef 只存「当前在途一个」：取消按钮的唯一句柄，终态即清空；
// - cancel() = 停循环（cancelRef，后续章不再发起）+ cancel 在途 requestId；已完成的章留存
//   （saveRun 每章成功即落账本，天然部分成功）；
// - 取消口径（T6 carry-in 1）：被取消的章计入 cancelledChapters、**不**入 failed——
//   「失败 N 章」只报真失败，取消章由对话框以「已取消 N 章」单独呈报。
//
// 预算（carry-in a，T2 评审结转）：buildReviewPrompt 的 maxTokens 入参身兼输出上限+输入闸门
// 双职，直接传输出上限会误拒大章。编排侧自算：estimateReviewTokens 逐章与 REVIEW_INPUT_TOKEN_CAP
// 比较（**单请求=单章**口径，spec：多章是 N 次调用不是 1 次大调用），超顶在任何请求发起之前
// 整体拒绝（零花费）；过闸后给 builder 传同一常量作 maxTokens，令其闸门恒不触发（builder 的
// maxTokens 至此只保留「形式必填」的意义），chat 请求的 maxTokens 用独立的输出上限常量。
//
// 落账口径（brief/计划钉死）：parseReviewOpinions 返回 ParsedOpinion（无信封五字段），本层
// 盖 id=randomUUID / createdAt=now / model=实发槽解析值（models.review > defaultModel，
// resolveModelLabel 复刻 chatService 解析序）/ status='open' / stale=false 后 saveRun；
// 主进程存储层会再把 model 覆写盖到全部新入意见上（双保险，漏盖/串槽拧得回）。
// carry-in b：parse 静默丢坏条（全丢时与「无意见」不可辨）——droppedOpinionCount 对 raw 信封
// 条目数自算「N 进 M 弃」，随 onChapterDone 交对话框提示行。
// carry-in c：转化并入遇 PROPOSAL_APPEND_TARGET（getAll 与 append 之间提案被消化的竞态）→
// 重查 pending 一次：有则对新 id 重试 append、无则回落 proposal:save 新建；其它错误经
// proposalErrorText 中文归一后以返回值面呈（对话框展示，含可重试文案——词表已备）。
// 软意见/驳回竞态防线：markReviewConverted 拒 stale（spec Q4）——convert 在**任何盘写之前**
// 先验 status/stale，绝不先烧提案槽位再被账本拒（那会留下无主提案）。
//
// 隐私红线（裁定 9 同款）：parse 失败只 console 记章 id 与输出长度，AI 原文绝不落日志。
import { useCallback, useEffect, useRef, useState } from 'react'
import { useAI } from '../../../hooks/useAI'
import {
  useAiData,
  useAISettings,
  useChapter,
  useCharacter,
  useNarrative,
  useProposal,
  useReview as useReviewIPC,
  useSetting
} from '../../../hooks/useIPC'
import { aiErrorToast } from '../../../services/aiErrorText'
import { proposalErrorText } from '../../../services/proposalErrors'
import { withLedgerLoudError } from './ledgerFallback'
import { extractJsonLoose } from '@/common/jsonLoose'
import { isUnsettled, newProposalId } from '@/common/proposal'
import type { ProposalChange, ProposalFile } from '@/common/proposal'
import { buildReviewPrompt, estimateReviewTokens, parseReviewOpinions, reviewCardLine } from '@/common/reviewContext'
import { opinionToChange } from '@/common/reviewConvert'
import type { ReviewTargetCandidate } from '@/common/reviewConvert'
import type { ReviewOpinion } from '@/common/reviewTypes'
import type { Chapter } from '@/common/ipc'
import type { AiErrorEvent } from '@/common/ai-types'

/**
 * 审阅输入预算硬顶（token，估算口径单源 estimateReviewTokens=正文码点/2）：
 * 48000 ≈ 9.6 万字单章——正常章远在其下，只有病理超长章/粘贴全文才会撞顶
 * （撞顶=对话框拒绝并提示收窄，spec §预算）。换数值只改这里。
 */
const REVIEW_INPUT_TOKEN_CAP = 48_000

/** 审阅输出上限（进 chat 请求）：意见信封 JSON 六类若干条，8192 富余（organize clamp 上限同档）。 */
const REVIEW_OUTPUT_MAX_TOKENS = 8192

/** 空闲上限（ms）：连续 180s 无流增量判死（organize 同款——审阅输出长、逐章在途久）。 */
const REVIEW_IDLE_TIMEOUT_MS = 180_000

/** 解析失败兜底文案（固定，绝不含原文片段）。 */
const PARSE_FAIL_TEXT = 'AI 输出无法解析为审阅意见，请重试'

// ---------------------------------------------------------------------------
// 纯函数切片（本文件导出、useReview.test.ts 单测钉死——无 jsdom 先例同 useCompletion）
// ---------------------------------------------------------------------------

/**
 * 「N 进 M 弃」的弃数（carry-in b）：raw 顶层 opinions 数组条目数 − parsed 存活数。
 * 条目按 JSON 数组长度计（null/字符串等坏条目也算「进」——它们正是被校验静默丢弃的）；
 * raw 抠不出 JSON/形状不合时算 0（那是 parse-failed 整章失败路径，本函数只在 ok 后调用）。
 */
export function droppedOpinionCount(raw: string, parsedCount: number): number {
  let entries = 0
  try {
    const parsed: unknown = extractJsonLoose(raw)
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const list = (parsed as Record<string, unknown>).opinions
      if (Array.isArray(list)) entries = list.length
    }
  } catch {
    entries = 0
  }
  return Math.max(0, entries - parsedCount)
}

/**
 * PROPOSAL_APPEND_TARGET 竞态三分（carry-in c；纯决策，重查 I/O 在调用方）：
 * - 非 APPEND_TARGET（含 IPC 包装后的其它 PROPOSAL_* 与任意异常）→ 'rethrow'：翻译后原样面呈；
 * - APPEND_TARGET + 重查后本章又有 unsettled 提案 → 'retry'：对新目标重试一次 append；
 * - APPEND_TARGET + 重查无 pending → 'fallback-new'：回落 proposal:save 新建。
 * 前缀整词匹配（\b 尾锚）：id/正文偶然出现的子串不得冒充竞态被吞。
 */
export function appendRetryDecision(
  rawError: string,
  recheckedPending: { id: string } | null | undefined
): 'retry' | 'fallback-new' | 'rethrow' {
  if (!/PROPOSAL_APPEND_TARGET\b/.test(rawError)) return 'rethrow'
  return recheckedPending ? 'retry' : 'fallback-new'
}

/** 徽标计数谓词：status=open 计入（含 stale=true——「上次未重现」仍是待处理意见）。 */
export function countOpenOpinions(list: readonly ReviewOpinion[]): number {
  return list.filter((o) => o.status === 'open').length
}

// ---------------------------------------------------------------------------
// 类型面
// ---------------------------------------------------------------------------

/** 每章错误节 kind（对话框按章呈现；'cancelled' 与真失败区分展示）。 */
export type ReviewChapterErrorKind = 'not-found' | 'cancelled' | 'ai' | 'parse' | 'save'

/**
 * 逐章流式回调面（全部经 argsRef 现读现调，UI 半区可传内联闭包）：
 * - onChapterStart：该章请求已发起（对话框落「进行中」节）；
 * - onChunk：该章原始增量（节流呈现归对话框）；
 * - onChapterDone：该章 saveRun 成功，opinions=**合并后全集**（账本真相：新入+留存 stale/
 *   dismissed/converted），droppedCount=本次解析弃条数（carry-in b 提示行）；
 * - onChapterError：该章失败（部分失败隔离——旧账本原样留存，message 已中文归一）。
 */
export interface ReviewDeps {
  projectPath?: string
  /** 书名（进 prompt【书名】块）。 */
  bookName?: string
  /**
   * 取「此刻」标题与正文：优先编辑器缓冲（作者所见即所审，锚 quote 逐字铁律要求出处
   * 与缓冲一致）；null = 缓冲没有这章，回落磁盘（useOrganize 同款）。
   */
  getBufferChapter: (chapterId: string) => { title: string; body: string } | null
  onChapterStart?: (chapterId: string) => void
  onChunk?: (chapterId: string, text: string) => void
  onChapterDone?: (
    chapterId: string,
    done: { opinions: ReviewOpinion[]; droppedCount: number }
  ) => void
  onChapterError?: (chapterId: string, kind: ReviewChapterErrorKind, message: string) => void
}

/** runReview 整体结果（逐章进度走回调；本返回值给调用方收尾/对话框错误节呈现）。 */
export type ReviewRunResult =
  | {
      kind: 'ok'
      reviewed: string[]
      /** 真失败章（不含取消章——carry-in 1）。 */
      failed: string[]
      /** 被取消的在途章（onError kind='cancelled'）；与 failed 互斥。 */
      cancelledChapters: string[]
      cancelled: boolean
    }
  /** 并发门：已有审阅在途。 */
  | { kind: 'busy' }
  | { kind: 'no-project' }
  /** 未配置 AI（对话框可见错误节，**不是 toast**——brief 钉死）。 */
  | { kind: 'not-configured' }
  /** 装配期拒绝（任何请求发起之前，零花费；estimated 供「收窄范围」文案）。 */
  | { kind: 'over-budget'; estimated: number }
  /** 意外上抛（台账 fail-loud 等）：message 已中文归一，对话框错误节展示。 */
  | { kind: 'error'; message: string }

/** convert 结果：need-target 交 UI 选择器 Modal；error.message 对话框展示（carry-in c 可重试）。 */
export type ReviewConvertOutcome =
  | { kind: 'converted'; proposalId: string }
  | { kind: 'need-target'; candidates: ReviewTargetCandidate[] }
  | { kind: 'invalid'; reason: string }
  /** proposalId 在场 = 提案已落盘但 markConverted 失败（对话框须提示「已入提案、账本未盖章」）。 */
  | { kind: 'error'; message: string; proposalId?: string }

export interface ReviewController {
  /** 在途标志（工具栏按钮 loading/禁用）。 */
  reviewing: boolean
  /** 逐章顺序审阅 chapterIds（≤5 连续章的范围上限是 UI 选择面职责，本层不设门禁）。 */
  runReview: (chapterIds: string[]) => Promise<ReviewRunResult>
  /** 取消：停循环 + cancel 在途 requestId（已完成章留存）。 */
  cancel: () => Promise<void>
  /** 驳回（唯一写入口 review:dismiss）；返回该章更新后全集。REVIEW_* 平文原样抛穿（对话框错误节经 reviewErrors 归一）。 */
  dismiss: (opinion: ReviewOpinion) => Promise<ReviewOpinion[]>
  /** 转化（仅 hard+open 非 stale）；overrideTargetId = need-target 选择器回填重走。 */
  convert: (opinion: ReviewOpinion, overrideTargetId?: string) => Promise<ReviewConvertOutcome>
}

/** AiSettingsView → 实发模型名：复刻 chatService 解析序（feature 槽 > 默认模型）。 */
function resolveModelLabel(view: { defaultModel: string; models?: { review?: string } }): string {
  const reviewModel = (view.models?.review ?? '').trim()
  return reviewModel !== '' ? reviewModel : (view.defaultModel ?? '').trim()
}

/** 掩码视图的配置齐全判定（useOrganize 同款 view 侧等价式）。 */
function isConfiguredView(view: { protocol?: string; baseUrl?: string; hasKey: boolean }): boolean {
  return Boolean(view.protocol) && Boolean(view.baseUrl) && view.hasKey
}

/**
 * 意见 id（信封五字段之一，纯函数层不碰随机）：Web Crypto randomUUID，
 * 极端环境退化兜底（organizeResult.newChangeId 同款姿态——校验器只要求非空字符串）。
 */
function newUuid(prefix: string): string {
  const c = globalThis.crypto
  if (c && typeof c.randomUUID === 'function') return c.randomUUID()
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
}

/** change 缺 cid 即盖新鲜 cid（organizeResult M4c-1 口径；append 侧存储层也会兜底补盖）。 */
function withCid(change: ProposalChange): ProposalChange {
  const cid = typeof change.cid === 'string' && change.cid.trim() !== '' ? change.cid : newUuid('cid')
  return { ...change, cid }
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useReview(deps: ReviewDeps): ReviewController {
  const { chat, cancel: cancelAI } = useAI()
  const { getAISettings } = useAISettings()
  const { getAllChapters } = useChapter()
  const { getAllCharacters } = useCharacter()
  const { getAllSettings } = useSetting()
  const { getForeshadowLedger } = useNarrative()
  const { readAiData } = useAiData()
  const { getAllProposals, saveProposal, appendProposalChanges } = useProposal()
  const { saveReviewRun, dismissReviewOpinion, markReviewConverted } = useReviewIPC()

  const [reviewing, setReviewing] = useState(false)

  const runningRef = useRef(false)
  // 停循环旗标：cancel() 置 true——当前在途章由 cancelAI(requestId) 掐，后续章不再发起
  const cancelRef = useRef(false)
  const activeRequestIdRef = useRef<string | null>(null)
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  // deps 镜像 ref：长流程 await 之后读最新闭包（同 useOrganize 的 argsRef 惯用法）
  const argsRef = useRef(deps)
  argsRef.current = deps

  /** 每章错误节（含 not-found 的定稿文案）：message 一律中文可读，绝不含 AI 原文。 */
  const fireChapterError = useCallback(
    (chapterId: string, kind: ReviewChapterErrorKind, message: string): void => {
      argsRef.current.onChapterError?.(chapterId, kind, message)
    },
    []
  )

  /**
   * 单章 chat（useOrganize.runChat 同款 Promise 收敛）：chunk 累加全文并转发回调；
   * 失败终态就地 fireChapterError（'cancelled' 与真失败分 kind），返回值只表达成/败。
   */
  const runChapterChat = useCallback(
    async (
      projectPath: string,
      chapterId: string,
      prompt: { system: string; user: string }
    ): Promise<{ ok: true; text: string } | { ok: false; cancelled: boolean }> => {
      let text = ''
      let terminal: 'done' | 'error' | null = null
      let cancelledTerminal = false
      await new Promise<void>((resolve) => {
        void chat(
          {
            projectPath,
            feature: 'review', // 主进程按 settings.models.review > defaultModel 解析并记账
            model: undefined,
            messages: [
              { role: 'system', content: prompt.system },
              { role: 'user', content: prompt.user }
            ],
            maxTokens: REVIEW_OUTPUT_MAX_TOKENS,
            timeoutMs: REVIEW_IDLE_TIMEOUT_MS
          },
          {
            onChunk: (t) => {
              text += t
              argsRef.current.onChunk?.(chapterId, t)
            },
            onDone: () => {
              terminal = 'done'
              activeRequestIdRef.current = null
              resolve()
            },
            onError: (kind, detail) => {
              terminal = 'error'
              cancelledTerminal = kind === 'cancelled'
              activeRequestIdRef.current = null
              fireChapterError(
                chapterId,
                cancelledTerminal ? 'cancelled' : 'ai',
                aiErrorToast(kind, detail)
              )
              resolve()
            }
          }
        ).then((requestId) => {
          // 受理（或受理前失败）后才 resolve 出 id：已终态则不再存（陈旧 id 无取消语义）
          if (terminal === null) activeRequestIdRef.current = requestId
        })
      })
      return terminal === 'done' ? { ok: true, text } : { ok: false, cancelled: cancelledTerminal }
    },
    [chat, fireChapterError]
  )

  const runReview = useCallback(
    async (chapterIds: string[]): Promise<ReviewRunResult> => {
      if (runningRef.current) return { kind: 'busy' } // 并发门：在途二次发起 no-op
      const { projectPath, bookName, getBufferChapter } = argsRef.current
      if (!projectPath) return { kind: 'no-project' }
      runningRef.current = true
      cancelRef.current = false
      setReviewing(true)
      const reviewed: string[] = []
      const failed: string[] = []
      const cancelledChapters: string[] = [] // carry-in 1：取消章不入 failed，「失败 N 章」只报真失败
      try {
        const view = await getAISettings()
        if (!isConfiguredView(view)) return { kind: 'not-configured' }
        const modelLabel = resolveModelLabel(view)

        // —— 上下文原料：渲染层组装（复用既有读通道，零新增聚合；台账 fail-loud，整理侧同款）——
        const [chapters, characters, world, ledger, aiData] = await Promise.all([
          getAllChapters(projectPath),
          getAllCharacters(projectPath),
          getAllSettings(projectPath),
          withLedgerLoudError(() => getForeshadowLedger(projectPath)),
          readAiData(projectPath)
        ])
        const diskById = new Map(chapters.map((c: Chapter) => [c.id, c]))
        const targets: { id: string; title: string; body: string }[] = []
        for (const id of chapterIds) {
          const disk = diskById.get(id)
          if (!disk) {
            // 章已删/幻觉 id：该章错误节，其余章照跑（部分失败隔离）
            failed.push(id)
            fireChapterError(id, 'not-found', '章节不存在或已被删除，无法审阅')
            continue
          }
          const buffered = getBufferChapter(id)
          targets.push({
            id,
            title: buffered?.title ?? disk.title,
            body: buffered?.body ?? disk.content
          })
        }

        // —— 预算闸（carry-in a）：单请求=单章逐章估，任何发起之前整体拒绝，零花费 ——
        let worstEstimate = 0
        for (const t of targets) worstEstimate = Math.max(worstEstimate, estimateReviewTokens([t]))
        if (worstEstimate > REVIEW_INPUT_TOKEN_CAP) {
          return { kind: 'over-budget', estimated: worstEstimate }
        }

        // —— 全章共用背景（cards/台账）：装配一次，N 次请求同一语境 ——
        const cards = [...characters.map(reviewCardLine), ...world.map(reviewCardLine)]
        const openForeshadow = ledger.entries
          .filter((e) => e.status === 'open')
          .map((e) => {
            const planted = diskById.get(e.plantedChapterId)
            return `- ${e.title}（埋于《${planted?.title ?? '未知章节'}》：${e.plannedPayoffNote.trim() || '未定'}）`
          })

        for (const t of targets) {
          if (cancelRef.current) break // 停循环：已完成章留存，未发起章不再花 token
          argsRef.current.onChapterStart?.(t.id)
          // builder 的 maxTokens 位传输入帽本身（本层已对同一常量预闸，其内部门恒不触发；
          // 输出上限走 chat.maxTokens，双职就此解耦）
          const built = buildReviewPrompt({
            bookName: bookName ?? '',
            synopsis: aiData.meta.synopsis,
            chapters: [t],
            cards,
            openForeshadow,
            maxTokens: REVIEW_INPUT_TOKEN_CAP
          })
          if (built.kind !== 'ok') {
            // 防御分支：与本层预闸同式同值，理论不可达
            failed.push(t.id)
            fireChapterError(t.id, 'ai', `本章估算 ${built.estimated} token 超输入预算，请收窄范围`)
            continue
          }
          const out = await runChapterChat(projectPath, t.id, built)
          if (!out.ok) {
            // 错误节已在 onError 发出（ai/cancelled）；取消章单列不入 failed（carry-in 1）
            if (out.cancelled) cancelledChapters.push(t.id)
            else failed.push(t.id)
            continue
          }
          const parsed = parseReviewOpinions(out.text, t.id)
          if (parsed.kind === 'parse-failed') {
            // 隐私红线：只记章 id 与长度，AI 原文绝不落日志（useOrganize 裁定 9 同款）
            console.error(
              `[useReview] ${PARSE_FAIL_TEXT}（章 ${t.id}，输出长度 ${out.text.length}）`
            )
            fireChapterError(t.id, 'parse', PARSE_FAIL_TEXT)
            failed.push(t.id)
            continue
          }
          // —— 五字段盖章（本任务责任田：纯函数层不碰时钟与随机）——
          const stamped: ReviewOpinion[] = parsed.opinions.map((p) => ({
            ...p,
            id: newUuid('review'),
            createdAt: new Date().toISOString(),
            model: modelLabel,
            status: 'open',
            stale: false
          }))
          try {
            const merged = await saveReviewRun(projectPath, t.id, stamped, modelLabel)
            argsRef.current.onChapterDone?.(t.id, {
              opinions: merged,
              droppedCount: droppedOpinionCount(out.text, parsed.opinions.length)
            })
            reviewed.push(t.id)
          } catch (err) {
            // REVIEW_TOO_MANY/REVIEW_CHAPTER_MISSING/REVIEW_INVALID 原样上抛（本层不翻译，保持
            // kind='save' 语义纯正——对话框错误节按 carry-in 2 经 reviewErrors 词表归一），
            // 旧账本因 saveRun 的「校验先于任何盘操作」天然留存
            const raw = err instanceof Error ? err.message : String(err)
            console.error('[useReview] 审阅账本落盘失败:', raw)
            fireChapterError(t.id, 'save', raw)
            failed.push(t.id)
          }
        }
        return { kind: 'ok', reviewed, failed, cancelledChapters, cancelled: cancelRef.current }
      } catch (err) {
        const raw = err instanceof Error ? err.message : String(err)
        console.error('[useReview] 审阅流程异常:', err)
        return { kind: 'error', message: raw }
      } finally {
        runningRef.current = false
        activeRequestIdRef.current = null // 取消句柄随批次收尾（任何路径不留陈旧 id）
        if (mountedRef.current) setReviewing(false)
      }
    },
    [
      getAllChapters,
      getAllCharacters,
      getAllSettings,
      getForeshadowLedger,
      readAiData,
      getAISettings,
      runChapterChat,
      saveReviewRun,
      fireChapterError
    ]
  )

  const cancel = useCallback(async (): Promise<void> => {
    cancelRef.current = true // 先停循环：即便在途章已自行收尾，也不会有下一章
    const requestId = activeRequestIdRef.current
    if (!runningRef.current || !requestId) return // 不在途 / 装配窗口（毫秒级）无句柄：no-op
    try {
      await cancelAI(requestId)
      // 触发 abort 后 'cancelled' 终态经 onError → 该章错误节呈现；成功收尾则照常赢
    } catch (err) {
      console.error('[useReview] 取消请求失败:', err)
    }
  }, [cancelAI])

  const dismiss = useCallback(
    async (opinion: ReviewOpinion): Promise<ReviewOpinion[]> => {
      const { projectPath } = argsRef.current
      if (!projectPath) throw new Error('未打开项目书，无法驳回意见')
      // REVIEW_MISSING/REVIEW_NOT_OPEN 等平文原样抛穿——对话框错误节经 reviewErrors 归一（无 toast 面）
      return dismissReviewOpinion(projectPath, opinion.chapterId, opinion.id)
    },
    [dismissReviewOpinion]
  )

  /** 转化盖章（提案落盘之后、账本指针之前）；失败携 proposalId 面呈（提案已存在，绝不静默）。 */
  const stampConverted = useCallback(
    async (
      projectPath: string,
      opinion: ReviewOpinion,
      proposalId: string
    ): Promise<ReviewConvertOutcome> => {
      try {
        await markReviewConverted(projectPath, opinion.chapterId, opinion.id, proposalId)
        return { kind: 'converted', proposalId }
      } catch (err) {
        const raw = err instanceof Error ? err.message : String(err)
        console.error('[useReview] 转化盖章失败（提案已落盘）:', raw)
        return { kind: 'error', message: raw, proposalId }
      }
    },
    [markReviewConverted]
  )

  /** 新建提案文件路径（本章无 unsettled 提案）：aiModel 用意见自身的 model（产出内容的模型）。 */
  const saveNewProposal = useCallback(
    async (
      projectPath: string,
      opinion: ReviewOpinion,
      change: ProposalChange
    ): Promise<ReviewConvertOutcome> => {
      const file: ProposalFile = {
        id: newProposalId(opinion.chapterId, Date.now()),
        chapterId: opinion.chapterId,
        createdAt: new Date().toISOString(),
        aiModel: opinion.model,
        status: 'pending',
        changes: [withCid(change)]
      }
      try {
        await saveProposal(projectPath, file)
      } catch (err) {
        // PROPOSAL_DUPLICATE（竞态：刚被别的入口建了 pending）等经词表中文归一
        const raw = err instanceof Error ? err.message : String(err)
        console.error('[useReview] 转化新建提案失败:', raw)
        return { kind: 'error', message: proposalErrorText(raw) }
      }
      return stampConverted(projectPath, opinion, file.id)
    },
    [saveProposal, stampConverted]
  )

  const convert = useCallback(
    async (
      opinion: ReviewOpinion,
      overrideTargetId?: string
    ): Promise<ReviewConvertOutcome> => {
      const { projectPath } = argsRef.current
      if (!projectPath) return { kind: 'error', message: '未打开项目书，无法转化意见' }
      // spec Q4 前置守卫（stale/dismissed/converted 不可转化）：在任何盘写**之前**拦，
      // 免得先建提案再被 markConverted 的 REVIEW_NOT_OPEN 拒下、留下无主提案
      if (opinion.status !== 'open' || opinion.stale) {
        return { kind: 'invalid', reason: `not-open:${opinion.status}${opinion.stale ? '+stale' : ''}` }
      }
      let characters
      let world
      try {
        [characters, world] = await Promise.all([
          getAllCharacters(projectPath),
          getAllSettings(projectPath)
        ])
      } catch (err) {
        const raw = err instanceof Error ? err.message : String(err)
        console.error('[useReview] 转化上下文装载失败:', raw)
        return { kind: 'error', message: proposalErrorText(raw) }
      }
      const eff: ReviewOpinion = overrideTargetId
        ? { ...opinion, targetEntityId: overrideTargetId }
        : opinion
      const mapped = opinionToChange(eff, { characters, world })
      if (mapped.kind === 'need-target') return mapped // 选择器候选（UI 半区 Modal 回填重走）
      if (mapped.kind === 'invalid') return mapped // 软类/未知类：invalid('soft-not-convertible')
      const change = mapped.change

      try {
        const proposals = await getAllProposals(projectPath)
        const pending = proposals.find(
          (p) => p.chapterId === opinion.chapterId && isUnsettled(p)
        )
        if (!pending) return await saveNewProposal(projectPath, opinion, change)
        try {
          await appendProposalChanges(projectPath, pending.id, [withCid(change)])
          return await stampConverted(projectPath, opinion, pending.id)
        } catch (err) {
          const raw = err instanceof Error ? err.message : String(err)
          // —— carry-in (c) 竞态三分：非 APPEND_TARGET 直面呈；是则重查 pending 一次 ——
          if (appendRetryDecision(raw, null) === 'rethrow') {
            console.error('[useReview] 转化并入提案失败:', raw)
            return { kind: 'error', message: proposalErrorText(raw) }
          }
          const rechecked = (await getAllProposals(projectPath)).find(
            (p) => p.chapterId === opinion.chapterId && isUnsettled(p)
          )
          const decision = appendRetryDecision(raw, rechecked)
          if (decision === 'retry' && rechecked) {
            try {
              await appendProposalChanges(projectPath, rechecked.id, [withCid(change)])
              return await stampConverted(projectPath, opinion, rechecked.id)
            } catch (err2) {
              const raw2 = err2 instanceof Error ? err2.message : String(err2)
              console.error('[useReview] 转化并入重试仍失败:', raw2)
              return { kind: 'error', message: proposalErrorText(raw2) }
            }
          }
          return await saveNewProposal(projectPath, opinion, change)
        }
      } catch (err) {
        const raw = err instanceof Error ? err.message : String(err)
        console.error('[useReview] 转化流程失败:', raw)
        return { kind: 'error', message: proposalErrorText(raw) }
      }
    },
    [getAllCharacters, getAllSettings, getAllProposals, appendProposalChanges, saveNewProposal, stampConverted]
  )

  return { reviewing, runReview, cancel, dismiss, convert }
}

// AI 错误 kind 形状引用（runChapterChat onError 形参由 useAI 回调推导，此处仅钉类型可读性）
export type ReviewAIErrorKind = AiErrorEvent['kind']
