// M6 T5（UI 半区）章节审阅对话框：范围选择 → 逐章流式呈现 → 意见行（跳转/驳回/转化）→
// 目标选择器 Modal。编排全在 useReview（逻辑半区，本文件只消费不重建）；对话框常驻挂载
// （Modal 的 open 只控显隐），审阅在途期间关闭对话框不掐流程——runReview 的取消只有
// 「取消审阅」按钮一条路，与 useOrganize 的取消语义一致。
//
// 呈现契约（逐字对齐逻辑半区 handoff）：
// - runReview 返回值全部是对话框内错误节（无 toast）：busy/not-configured/over-budget/error；
// - onChapterDone.opinions = 合并后全集（账本真相），整章替换呈现；droppedCount>0 时出
//   「N 条意见进、M 条格式坏被弃」提示行（carry-in b 面呈——N=新增入库数+弃数，按 run 前
//   快照 id 集合对账）；
// - onChapterError：'cancelled' 出取消节（无重试按钮），'ai'/'parse'/'save'/'not-found'
//   出错误节+重试（重试=对该单章再 runReview，部分失败隔离语义）；
// - REVIEW_* 通道错误（dismiss/账本读/saveRun 落盘/markConverted）经 services/reviewErrors 中文词表
//   归一展示（T6 carry-in 2，此前顾虑 2 的平文原样已由词表接管；proposal 域错误仍走 proposalErrors）；
// - convert 'error'+proposalId = 「已入提案、账本未盖章」专属文案（顾虑 3，绝不与通用错误混同）；
// - ≤5 连续章上限是本选择器的职责（hook 不设门禁，顾虑 1）：违规选择整次拒绝并给原因；
// - need-target 候选显示序按 localeCompare('zh') 重排（carry-in e——纯函数层的码元序是
//   测试确定性口径，中文人名的人眼可读排序归 UI）。
//
// 意见行动作面（spec 拍板）：跳转=relocateAnchor found→onReveal（关对话框露出编辑器高亮），
// found:false→「锚已失」灰态禁跳转；驳回=review:dismiss（返回全集刷该章）；转化=仅
// hard+open 非 stale（软意见行根本不出转化钮——hook 会兜底拒，UI 先过滤是口径而非冗余）；
// stale 行灰 + 「上次未重现」+ 转化禁用；converted 行只读 + 提案指针文本。
//
// 零新增依赖/通道；组件层无单测（纯逻辑 T1-T5 已钉）；样式走 global.css token 作用域类，
// 无 !important。Tag 预设色沿用 ProposalReviewDialog 先例（OP_COLOR 同款姿态），severity
// 分组头 + 类别标签双色呈现。
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Button, Empty, Modal, Select, Space, Spin, Tag, Tooltip, Typography } from 'antd'
import { useReview } from '../../pages/Workspace/hooks/useReview'
import { useReview as useReviewIpc } from '../../hooks/useIPC'
import { reviewErrorText } from '../../services/reviewErrors'
import { relocateAnchor } from '@/common/reviewTypes'
import type { ReviewOpinion } from '@/common/reviewTypes'
import type { ReviewTargetCandidate } from '@/common/reviewConvert'
import type { ReviewChapterErrorKind, ReviewConvertOutcome, ReviewRunResult } from '../../pages/Workspace/hooks/useReview'
import type { Chapter } from '@/common/ipc'

const { Text } = Typography

/** 连续章范围硬上限（spec：N 章 = N 次单章请求；预算与取消体验都要求小 N）。 */
const RANGE_MAX_CHAPTERS = 5

/** 流式增量并入渲染的节流间隔（ms）：chunk 高频期 250ms 合并一次 setState。 */
const STREAM_FLUSH_MS = 250

/** 流式区只呈现尾部这么多个码元（全量文本进内存，展示截尾防 Modal 长蛇）。 */
const STREAM_TAIL = 800

const CATEGORY_LABEL: Record<ReviewOpinion['category'], string> = {
  'foreshadow-unresolved': '伏笔未回收',
  'setting-conflict': '设定冲突',
  'motivation-break': '动机断裂',
  pacing: '节奏拖沓',
  flatness: '人物扁平',
  'prose-craft': '文笔打磨'
}

/** 类别标签色（antd 预设色板，ProposalReviewDialog OP_COLOR 先例同款；硬三类暖系/软三类冷系）。 */
const CATEGORY_COLOR: Record<ReviewOpinion['category'], string> = {
  'foreshadow-unresolved': 'purple',
  'setting-conflict': 'orange',
  'motivation-break': 'red',
  pacing: 'blue',
  flatness: 'cyan',
  'prose-craft': 'green'
}

/** 可重试的错误 kind（'cancelled' 与账本读失败无 errorKind 者不出重试钮）。 */
function isRetryable(kind: ReviewChapterErrorKind | undefined): boolean {
  return kind === 'ai' || kind === 'parse' || kind === 'save' || kind === 'not-found'
}

/** invalid 原因的中文归一（soft-not-convertible 是恒常见路；未知原因保留平文）。 */
function invalidText(reason: string): string {
  if (reason.startsWith('soft-not-convertible')) return '软性感受类意见只可驳回，不能转化为提案'
  return `该意见不可转化：${reason}`
}

interface ChapterProgress {
  phase: 'running' | 'done' | 'error' | 'cancelled'
  /** 该章原始增量全文（展示截尾，节流并入）。 */
  streamed: string
  errorKind?: ReviewChapterErrorKind
  errorMessage?: string
  /** carry-in b：本次解析被弃条数（>0 才出提示行）。 */
  droppedCount: number
  /** 本次新增入库条数（run 前快照 id 对账，「N 进」的 N 的一半）。 */
  addedCount: number
}

type RunNotice = { type: 'error' | 'warning' | 'info'; text: string }

interface ReviewDialogProps {
  open: boolean
  onClose: () => void
  projectPath?: string
  bookName?: string
  chapters: Chapter[]
  currentChapterId: string | null
  /**
   * 「此刻」标题与正文（useOrganize 同款缓冲优先）：当前章 = 编辑器实时缓冲（未保存编辑
   * 也可审、锚坐标与编辑器所见严格一致），非当前章/无缓冲 = null 由面板回落磁盘列表内容。
   */
  getBufferChapter: (chapterId: string) => { title: string; body: string } | null
  /** 跳转：Workspace 负责（必要时先开章）→ MonacoEditor.revealAndHighlight。 */
  onReveal: (chapterId: string, startOffset: number, endOffset: number) => void
  /** 在途标志上交（工具栏按钮禁用）；对话框持有 useReview 单实例，Workspace 不重复挂。 */
  onReviewingChange: (reviewing: boolean) => void
  /** 账本变化（新入/驳回/转化）→ 徽标计数刷新。 */
  onLedgerChanged: () => void
  /** 提案落盘（转化）→ 整理侧未消化提案徽章刷新。 */
  onProposalsChanged: () => void
}

function ReviewDialog({
  open,
  onClose,
  projectPath,
  bookName,
  chapters,
  currentChapterId,
  getBufferChapter,
  onReveal,
  onReviewingChange,
  onLedgerChanged,
  onProposalsChanged
}: ReviewDialogProps) {
  const ordered = useMemo(() => [...chapters].sort((a, b) => a.order - b.order), [chapters])
  const titleById = useMemo(() => new Map(ordered.map((c) => [c.id, c.title || '无题'])), [ordered])

  const [selected, setSelected] = useState<string[]>([])
  const [rangeHint, setRangeHint] = useState<string | null>(null)
  const [progress, setProgress] = useState<Record<string, ChapterProgress>>({})
  const [opinions, setOpinions] = useState<Record<string, ReviewOpinion[]>>({})
  const [runNotice, setRunNotice] = useState<RunNotice | null>(null)
  // 意见行级错误/提示（key=opinionId：驳回抛穿的 REVIEW_* 平文、转化失败文案）
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({})
  const [rowNotices, setRowNotices] = useState<Record<string, string>>({})
  const [busyOpinionId, setBusyOpinionId] = useState<string | null>(null)
  const [selector, setSelector] = useState<{ opinion: ReviewOpinion; candidates: ReviewTargetCandidate[] } | null>(null)
  const [selectorTargetId, setSelectorTargetId] = useState<string | null>(null)

  // run 前各章意见 id 快照（「N 进」对账基准；onChapterDone 时与新全集做差）
  const prevIdsRef = useRef(new Map<string, Set<string>>())
  // 流式节流：chunk 先入累积表，250ms 合并一次 setState（终章即清）
  const streamAccumRef = useRef(new Map<string, string>())
  const flushTimerRef = useRef<number | null>(null)

  const { getReviewOpinions } = useReviewIpc()

  /**
   * 锚判定/跳转坐标的正文源：当前章（有缓冲）= 编辑器实时内容——relocateAnchor 的
   * startOffset/endOffset 与 Monaco 模型逐字一致，高亮绝不错位；其余章 = 会话磁盘列表
   * 内容，跳章 openChapter 后编辑器显示的正是同一字符串（useEditorSession.selectChapter
   * 直接以该对象回灌 editorContent）。null = 章已不在会话（呈现为锚已失）。
   */
  const bodyFor = useCallback(
    (chapterId: string): string | null =>
      getBufferChapter(chapterId)?.body ?? ordered.find((c) => c.id === chapterId)?.content ?? null,
    [getBufferChapter, ordered]
  )

  const flushStreams = useCallback(() => {
    flushTimerRef.current = null
    const snapshot = new Map(streamAccumRef.current)
    if (snapshot.size === 0) return
    setProgress((prev) => {
      const next = { ...prev }
      for (const [id, text] of snapshot) {
        const p = next[id]
        if (p && p.phase === 'running') next[id] = { ...p, streamed: text }
      }
      return next
    })
  }, [])

  const review = useReview({
    projectPath,
    bookName,
    // 缓冲直通（未保存编辑可审——与锚判定同一实时源；null 时 hook 自回落磁盘内容）
    getBufferChapter,
    onChapterStart: (chapterId) => {
      setProgress((prev) => ({
        ...prev,
        [chapterId]: { phase: 'running', streamed: '', droppedCount: 0, addedCount: 0 }
      }))
    },
    onChunk: (chapterId, text) => {
      streamAccumRef.current.set(chapterId, (streamAccumRef.current.get(chapterId) ?? '') + text)
      if (flushTimerRef.current === null) {
        flushTimerRef.current = window.setTimeout(flushStreams, STREAM_FLUSH_MS)
      }
    },
    onChapterDone: (chapterId, done) => {
      streamAccumRef.current.delete(chapterId)
      // 「本次新入库 N 条」= 合并后全集里 id 不在 run 前快照的条数（对账）。
      // T5 评审 minor 3：这是纯展示口径，非账本真相——若该章 run 前快照未预加载成功
      // （prevIds 为空集，如 loadLedger 尚未回或读失败），N 会把整章旧意见都算作「新入库」而虚高。
      // 落账的真相以 review:get 重读为准；此处只在快照存在时对账，不改盘、不驱动任何写路径，
      // 故快照缺位时宁可虚高也不误报「0 条」，保持「N 进」显示（display-only，不加数据门）。
      const prevIds = prevIdsRef.current.get(chapterId) ?? new Set<string>()
      const added = done.opinions.filter((o) => !prevIds.has(o.id)).length
      setOpinions((p) => ({ ...p, [chapterId]: done.opinions }))
      setProgress((p) => ({
        ...p,
        [chapterId]: { phase: 'done', streamed: '', droppedCount: done.droppedCount, addedCount: added }
      }))
      onLedgerChanged()
    },
    onChapterError: (chapterId, kind, message) => {
      streamAccumRef.current.delete(chapterId)
      setProgress((p) => ({
        ...p,
        [chapterId]: {
          phase: kind === 'cancelled' ? 'cancelled' : 'error',
          streamed: '',
          errorKind: kind,
          // carry-in 2：仅 'save' 节携带 REVIEW_* 平文（saveRun catch 原样）→ 中文词表归一；
          // ai/cancelled 已是 aiErrorToast 中文、parse/not-found 是定稿散文，不可二次包裹。
          errorMessage: kind === 'save' ? reviewErrorText(message) : message,
          droppedCount: 0,
          addedCount: 0
        }
      }))
    }
  })

  // 在途标志上交（工具栏禁用/取消态）
  useEffect(() => {
    onReviewingChange(review.reviewing)
  }, [review.reviewing, onReviewingChange])

  // 卸载清节流定时器（setState 由 hook 的 mountedRef 兜底，这里只掐裸 timer）
  useEffect(() => {
    return () => {
      if (flushTimerRef.current !== null) window.clearTimeout(flushTimerRef.current)
    }
  }, [])

  /** 读某章账本进面板（失败=该章错误节，REVIEW_* 经 reviewErrorText 中文归一）。 */
  const loadLedger = useCallback(
    async (chapterId: string): Promise<void> => {
      if (!projectPath) return
      try {
        const list = await getReviewOpinions(projectPath, chapterId)
        setOpinions((prev) => ({ ...prev, [chapterId]: list }))
        setProgress((prev) => {
          const p = prev[chapterId]
          // 账本读失败遗留的错误节（无 errorKind 者）在成功后清掉；审阅在途/有真错误的不动
          if (p && p.phase === 'error' && p.errorKind === undefined) {
            const next = { ...prev }
            delete next[chapterId]
            return next
          }
          return prev
        })
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error('[ReviewDialog] 审阅账本读取失败:', msg)
        setProgress((prev) => ({
          ...prev,
          [chapterId]: { phase: 'error', streamed: '', errorMessage: reviewErrorText(msg), droppedCount: 0, addedCount: 0 }
        }))
      }
    },
    [projectPath, getReviewOpinions]
  )

  // 打开对话框 = 范围重置为当前章 + 拉新鲜账本（入口契约同 ProposalReviewDialog：不吃陈旧缓存）
  useEffect(() => {
    if (!open) return
    const initial = currentChapterId ? [currentChapterId] : []
    setSelected(initial)
    setRangeHint(null)
    setRunNotice(null)
    setRowErrors({})
    setRowNotices({})
    setSelector(null)
    if (initial.length > 0) void loadLedger(initial[0])
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 只在打开瞬间重置（currentChapterId 变化不重放）
  }, [open])

  // 在途期间新增选择的章（或缓冲外章）没有账本快照 → 补拉，保证呈现与「N 进」对账有基准
  useEffect(() => {
    if (!open) return
    for (const id of selected) {
      if (!(id in opinions)) void loadLedger(id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 只按「缺哪章补哪章」触发
  }, [open, selected])

  /** 范围选择校验：连续（在 order 序上索引相邻）+ ≤5；违规整次拒绝并给原因（顾虑 1 的落点）。 */
  const handleRangeChange = (ids: string[]): void => {
    if (ids.length === 0) {
      setSelected([])
      setRangeHint(null)
      return
    }
    const indices = ids.map((id) => ordered.findIndex((c) => id === c.id)).filter((i) => i >= 0)
    if (indices.length !== ids.length) return // 幽灵 id（刚被外删）：忽略本次改动，等列表刷新
    const span = Math.max(...indices) - Math.min(...indices) + 1
    if (span !== ids.length) {
      setRangeHint('一次只能审阅连续章节——所选范围中间有跳开的章，已保留上一次范围')
      return
    }
    if (ids.length > RANGE_MAX_CHAPTERS) {
      setRangeHint(`一次最多审阅 ${RANGE_MAX_CHAPTERS} 个连续章节（逐章各发一次 AI 请求，范围越大等待越久），已保留上一次范围`)
      return
    }
    setRangeHint(null)
    setSelected(ids)
  }

  const applyRunResult = useCallback((res: ReviewRunResult): void => {
    switch (res.kind) {
      case 'ok': {
        if (res.cancelled) {
          // carry-in 1：取消章（cancelledChapters）不计入「失败」——它们是被主动掐断的在途章，
          // 不是审阅失败；真失败章另算，两者分列。
          const failedTxt = res.failed.length > 0 ? `、失败 ${res.failed.length} 章` : ''
          setRunNotice({
            type: 'info',
            text: `审阅已取消：完成 ${res.reviewed.length} 章、已取消 ${res.cancelledChapters.length} 章${failedTxt}（已完成章的意见已留存账本）`
          })
        } else if (res.failed.length > 0) {
          setRunNotice({ type: 'warning', text: `审阅结束：${res.reviewed.length} 章成功、${res.failed.length} 章失败（各章错误节可见）` })
        } else if (res.reviewed.length > 0) {
          setRunNotice({ type: 'info', text: `审阅完成：${res.reviewed.length} 章` })
        } else {
          setRunNotice({ type: 'warning', text: '没有章节被审阅（范围外或章已删除）' })
        }
        break
      }
      case 'busy':
        setRunNotice({ type: 'warning', text: '已有审阅在途，请等待完成或先取消' })
        break
      case 'no-project':
        setRunNotice({ type: 'error', text: '未打开书籍，无法审阅' })
        break
      case 'not-configured':
        setRunNotice({ type: 'error', text: '尚未配置 AI 服务：请在「设置」中填好协议、接口地址与密钥后重试' })
        break
      case 'over-budget':
        setRunNotice({
          type: 'error',
          text: `装配估算约 ${res.estimated} token，已超过单章输入预算——请收窄范围（剔除超长章节）后重试，本次未发起、零花费`
        })
        break
      case 'error':
        // 装配期意外上抛（book/chapter/narrative 读盘、台账 fail-loud 等——非 review 通道，
        // REVIEW_* 已在 saveRun/markConverted 各自的捕获里归一，不会到这）。平文原样。
        setRunNotice({ type: 'error', text: res.message })
        break
      default:
        break
    }
  }, [])

  const startReview = (chapterIds: string[]): void => {
    if (chapterIds.length === 0) {
      setRunNotice({ type: 'warning', text: '请先选择审阅范围（默认当前章）' })
      return
    }
    setRunNotice(null)
    for (const id of chapterIds) {
      prevIdsRef.current.set(id, new Set((opinions[id] ?? []).map((o) => o.id)))
    }
    void review.runReview(chapterIds).then(applyRunResult)
  }

  // —— 意见行三动作 ——
  const handleJump = (o: ReviewOpinion, start: number, end: number): void => {
    onReveal(o.chapterId, start, end)
    onClose() // 高亮在编辑器里，Modal 遮着看不见——跳转即关对话框
  }

  const handleDismiss = async (o: ReviewOpinion): Promise<void> => {
    if (busyOpinionId) return
    setBusyOpinionId(o.id)
    try {
      const list = await review.dismiss(o) // controller 抛穿原样，下方 catch 经 reviewErrorText 归一
      setOpinions((prev) => ({ ...prev, [o.chapterId]: list }))
      setRowErrors((prev) => {
        const next = { ...prev }
        delete next[o.id]
        return next
      })
      onLedgerChanged()
    } catch (err) {
      // carry-in 2：review:dismiss 抛穿的 REVIEW_*（MISSING/NOT_OPEN/BAD_REVIEW_CHAPTER_ID）中文归一
      const raw = err instanceof Error ? err.message : String(err)
      setRowErrors((prev) => ({ ...prev, [o.id]: reviewErrorText(raw) }))
    } finally {
      setBusyOpinionId(null)
    }
  }

  const handleConvertOutcome = async (o: ReviewOpinion, res: ReviewConvertOutcome): Promise<void> => {
    if (res.kind === 'converted') {
      setRowNotices((prev) => ({ ...prev, [o.id]: `已转入提案 ${res.proposalId}，可在提案审阅面板逐条采纳` }))
      if (projectPath) {
        try {
          const list = await getReviewOpinions(projectPath, o.chapterId)
          setOpinions((prev) => ({ ...prev, [o.chapterId]: list }))
        } catch (err) {
          console.error('[ReviewDialog] 转化后账本重读失败:', err)
        }
      }
      onLedgerChanged()
      onProposalsChanged() // 整理侧未消化提案徽章同步（转化=新提案落盘）
      return
    }
    if (res.kind === 'need-target') {
      setSelectorTargetId(null)
      setSelector({ opinion: o, candidates: res.candidates })
      return
    }
    if (res.kind === 'invalid') {
      setRowErrors((prev) => ({ ...prev, [o.id]: invalidText(res.reason) }))
      return
    }
    // 顾虑 3：提案已落盘、markConverted 失败——专属文案，绝不与通用错误混同。
    // carry-in 2：携 proposalId 的错误只来自 stampConverted（markConverted 抛 REVIEW_*），中文归一；
    // 无 proposalId 者已在 useReview 经 proposalErrorText 归一（提案域散文），不可二次包裹。
    if (res.proposalId) {
      setRowErrors((prev) => ({
        ...prev,
        [o.id]: `已入提案、账本未盖章（提案 ${res.proposalId}）：${reviewErrorText(res.message)}——重试转化会重复并入该提案，请先刷新核对`
      }))
    } else {
      setRowErrors((prev) => ({ ...prev, [o.id]: res.message }))
    }
  }

  const handleConvert = async (o: ReviewOpinion, overrideTargetId?: string): Promise<void> => {
    if (busyOpinionId) return
    setBusyOpinionId(o.id)
    try {
      const res = await review.convert(o, overrideTargetId)
      await handleConvertOutcome(o, res)
    } finally {
      setBusyOpinionId(null)
    }
  }

  // —— 渲染 ——
  const renderOpinionRow = (o: ReviewOpinion): React.ReactNode => {
    const body = bodyFor(o.chapterId)
    const located = body !== null ? relocateAnchor(body, o.anchor) : { found: false as const }
    const isStale = o.status === 'open' && o.stale
    const rowClass = [
      'review-opinion',
      isStale ? 'review-opinion--stale' : '',
      o.status === 'dismissed' ? 'review-opinion--dismissed' : ''
    ]
      .filter(Boolean)
      .join(' ')
    const convertible = o.severity === 'hard' && o.status === 'open' && !o.stale
    return (
      <div key={o.id} className={rowClass}>
        <div className="review-opinion-head">
          <Tag color={CATEGORY_COLOR[o.category]}>{CATEGORY_LABEL[o.category]}</Tag>
          {isStale ? <Tag className="review-tag-muted">上次未重现</Tag> : null}
          {o.status === 'dismissed' ? <Tag className="review-tag-muted">已驳回</Tag> : null}
          {o.status === 'converted' ? <Tag className="review-tag-muted">已转化</Tag> : null}
          {!located.found && o.status === 'open' ? <Tag className="review-tag-lost">锚已失</Tag> : null}
          <Text className="review-meta">{o.model} · {dayLike(o.createdAt)}</Text>
        </div>
        <div className="review-text">{o.text}</div>
        {o.suggestion ? <div className="review-suggestion">建议：{o.suggestion}</div> : null}
        <blockquote className="review-quote">“{o.anchor.quote}”（第 {o.anchor.paraIndex + 1} 段）</blockquote>
        <div className="review-actions">
          {located.found ? (
            <Button size="small" onClick={() => handleJump(o, located.startOffset, located.endOffset)}>跳转</Button>
          ) : (
            <Tooltip title={o.status === 'open' ? '锚句在本章正文中已找不到（可能被改写），无法高亮定位' : '该意见锚点未命中，无法定位'}>
              <Button size="small" disabled>跳转</Button>
            </Tooltip>
          )}
          {o.status === 'open' ? (
            <Button size="small" danger loading={busyOpinionId === o.id} onClick={() => void handleDismiss(o)}>
              驳回
            </Button>
          ) : null}
          {o.severity === 'hard' && o.status === 'open' ? (
            convertible ? (
              <Button size="small" type="primary" loading={busyOpinionId === o.id} onClick={() => void handleConvert(o)}>
                转化
              </Button>
            ) : (
              <Tooltip title="「上次未重现」的意见先重审确认后再转化，避免把陈旧判断写进设定">
                <Button size="small" disabled>转化</Button>
              </Tooltip>
            )
          ) : null}
          {o.status === 'converted' && o.proposalId ? (
            <span className="review-proposal-ref">提案 {o.proposalId}</span>
          ) : null}
        </div>
        {rowErrors[o.id] ? <div className="review-row-error">{rowErrors[o.id]}</div> : null}
        {rowNotices[o.id] ? <div className="review-row-notice">{rowNotices[o.id]}</div> : null}
      </div>
    )
  }

  const renderChapterSection = (chapterId: string): React.ReactNode => {
    const list = opinions[chapterId] ?? []
    const p = progress[chapterId]
    const hard = list.filter((o) => o.severity === 'hard')
    const soft = list.filter((o) => o.severity === 'soft')
    return (
      <div key={chapterId} className="review-chapter">
        <div className="review-chapter-head">
          <Text className="review-chapter-title">{titleById.get(chapterId) ?? '（章节已删除）'}</Text>
          {p?.phase === 'running' ? <Spin size="small" /> : null}
          {p?.phase === 'done' ? <Text className="review-meta">已完成</Text> : null}
        </div>
        {p?.phase === 'running' && p.streamed ? (
          <div className="review-stream">{p.streamed.slice(-STREAM_TAIL)}</div>
        ) : null}
        {p?.phase === 'cancelled' ? (
          <div className="review-cancelled">本章审阅已取消（之前完成的章节不受影响）</div>
        ) : null}
        {p?.phase === 'error' ? (
          <div className="review-error-section">
            <div className="review-error">{p.errorMessage ?? '本章审阅失败'}</div>
            {isRetryable(p.errorKind) ? (
              <Button size="small" onClick={() => startReview([chapterId])} disabled={review.reviewing}>
                重试本章
              </Button>
            ) : null}
          </div>
        ) : null}
        {p?.phase === 'done' && p.droppedCount > 0 ? (
          <div className="review-dropped">
            {p.addedCount + p.droppedCount} 条意见进、{p.droppedCount} 条格式坏被弃
          </div>
        ) : null}
        {p?.phase === 'done' && p.droppedCount === 0 ? (
          <div className="review-meta">本次新入库 {p.addedCount} 条意见</div>
        ) : null}
        {hard.length > 0 ? (
          <div className="review-group">
            <div className="review-group-head review-group-head--hard">硬伤（可转提案）· {hard.length} 条</div>
            {hard.map(renderOpinionRow)}
          </div>
        ) : null}
        {soft.length > 0 ? (
          <div className="review-group">
            <div className="review-group-head review-group-head--soft">软性感受（仅驳回）· {soft.length} 条</div>
            {soft.map(renderOpinionRow)}
          </div>
        ) : null}
        {list.length === 0 && p?.phase !== 'running' && p?.phase !== 'error' && p?.phase !== 'cancelled' ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="本章暂无审阅意见" />
        ) : null}
      </div>
    )
  }

  return (
    <>
      <Modal
        className="chapter-review-modal"
        title="章节 AI 审阅"
        open={open}
        onCancel={onClose}
        width={920}
        footer={
          <div className="review-footer">
            <span className="review-meta">意见按章分账本存储；驳回后重审不再复现（同章抑制）</span>
            <Space>
              {review.reviewing ? (
                <Button danger onClick={() => void review.cancel()}>取消审阅</Button>
              ) : null}
              <Button onClick={onClose}>关闭</Button>
            </Space>
          </div>
        }
      >
        <div className="review-toolbar">
          <Select
            mode="multiple"
            className="review-range"
            placeholder="审阅范围（默认当前章，可选连续章节）"
            value={selected}
            onChange={handleRangeChange}
            maxTagCount="responsive"
            optionFilterProp="label"
            options={ordered.map((c, i) => ({ value: c.id, label: `${i + 1}. ${c.title || '无题'}` }))}
            disabled={review.reviewing}
          />
          <Button
            type="primary"
            loading={review.reviewing}
            disabled={selected.length === 0 || !projectPath}
            onClick={() => startReview(selected)}
          >
            {selected.length > 1 ? `审阅这 ${selected.length} 章` : '开始审阅'}
          </Button>
        </div>
        {rangeHint ? <div className="review-range-hint">{rangeHint}</div> : null}
        {runNotice ? (
          <Alert className="review-run-notice" type={runNotice.type} showIcon message={runNotice.text} />
        ) : null}
        <div className="review-body">
          {selected.length === 0 ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="选择章节后开始审阅" />
          ) : (
            selected.map(renderChapterSection)
          )}
        </div>
      </Modal>
      <Modal
        className="review-target-modal"
        title="选择关联实体"
        open={selector !== null}
        okText="按所选实体转化"
        okButtonProps={{ disabled: selectorTargetId === null }}
        onOk={() => {
          if (selector && selectorTargetId) {
            const { opinion } = selector
            setSelector(null)
            void handleConvert(opinion, selectorTargetId)
          }
        }}
        onCancel={() => setSelector(null)}
      >
        <div className="review-target-hint">
          这条意见没有指明（或指错了）要改哪个实体——请从下表中选择目标后转化。
        </div>
        <Select
          className="review-target-select"
          placeholder="选择目标实体"
          showSearch
          value={selectorTargetId ?? undefined}
          onChange={(v) => setSelectorTargetId(v as string)}
          optionFilterProp="label"
          options={(selector?.candidates ?? [])
            // carry-in e：纯函数层的码元序保测试确定性；人眼按中文拼音序读，UI 侧重排
            .slice()
            .sort((a, b) => a.name.localeCompare(b.name, 'zh'))
            .map((c) => ({ value: c.id, label: c.name }))}
        />
      </Modal>
    </>
  )
}

/** createdAt 紧凑展示（本地时区 MM-DD HH:mm；非法值原样截断，绝不 throw）。 */
function dayLike(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso.slice(0, 16)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export default ReviewDialog
