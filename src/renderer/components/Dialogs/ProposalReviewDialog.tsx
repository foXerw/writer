// M4b T5 差异确认面板（ProposalReviewDialog）：整理闭环的人工确认面——作者逐条审阅
// AI 提案变更，勾选后 采纳（proposal:adopt 写回书数据）/ 驳回（proposal:reject 删条目）。
// 无新通道（proposal:* 全复用）、无单测（纯展示 React，T6 CDP 冒烟兜底）。
//
// 勾选 → 通道参数映射（与 T3 引擎 assertOverwriteConfirmed 逐字对齐，走查表见 task-5-report）：
//   未勾选                     → changeIndexes/confirmedOverwrite 都不含（引擎只见未上报 = 不动）
//   勾选 × 非覆盖条目          → changeIndexes
//   勾选 × overwritesHuman     → changeIndexes + confirmedOverwrite（两个数组同携，缺一引擎必拒
//                               「REFUSED: 未确认覆盖」——UI 的勾选态就是确认态，绝不代答）
//   已采纳（index ∈ appliedIndexes）→ 灰化 ✓已采纳、复选框禁用、绝不进任何数组
//
// 通道 REJECT ≠ 逐条 REFUSED：adopt 引擎在 markSettled 记账失败时会抛穿而实体已落盘
// （T3 顾虑 5 失败窗口）。所以通道错误绝不弹「重试」了事——先 proposal:get 重读真相、
// 用 appliedIndexes 与刚发送的索引做差集，如实告知「N 条实际已生效」，再刷新列表/徽章。
// reject 会给存活条目重排索引（appliedIndexes 同步重映射），故任何 reject 后必须整份重读，
// 勾选集清零——旧索引指向的已不是旧条目（本文件最重要的状态纪律）。
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Button, Checkbox, Empty, List, Modal, Spin, Tag, Tooltip, Typography, message } from 'antd'
import dayjs from 'dayjs'
import { useProposal } from '../../hooks/useIPC'
import { notifyEntitiesChanged } from '../../services/entityEvents'
import type { Chapter } from '@/common/ipc'
import type {
  ProposalAdoptRefusal,
  ProposalChange,
  ProposalEntity,
  ProposalFile,
  ProposalOp
} from '@/common/proposal'

const { Text } = Typography

/** after 摘要的紧凑渲染上限（与 source.quote 的 prompt 约定同刻度，超出截断加省略号）。 */
const AFTER_SUMMARY_MAX = 120

const OP_LABEL: Record<ProposalOp, string> = { create: '新建', update: '更新', delete: '删除' }
const OP_COLOR: Record<ProposalOp, string> = { create: 'green', update: 'blue', delete: 'red' }
const ENTITY_LABEL: Record<ProposalEntity, string> = {
  character: '角色',
  world: '设定',
  plotline: '剧情线',
  choice: '选项',
  foreshadow: '伏笔',
  summary: '摘要',
  index: '索引'
}

interface ProposalReviewDialogProps {
  open: boolean
  onClose: () => void
  projectPath?: string
  /** 会话章列表（章标题分组头用；提案出处章可能已被删——查不到走降级标题）。 */
  chapters: Chapter[]
}

/** after 摘要：JSON.stringify 后截断（delete 无 after，给语义占位）。 */
function summarizeAfter(c: ProposalChange): string {
  if (c.after === undefined) return c.op === 'delete' ? '（删除该条目，无新内容）' : '（无新内容）'
  let s: string
  try {
    s = JSON.stringify(c.after) ?? String(c.after)
  } catch {
    s = '（载荷无法序列化）'
  }
  return s.length > AFTER_SUMMARY_MAX ? `${s.slice(0, AFTER_SUMMARY_MAX)}…` : s
}

/**
 * 窄门口径差异（BOOK_FORMAT §7.5；T3 复审 Minor 2）：update×foreshadow/summary/index 的引擎
 * 会静默丢弃未知兄弟键（vs character/world 整条拒「未知字段」），而提案文件里 after 原样存在。
 * M4b 裁定：面板按 after 的键【原样】渲染（键列表与摘要都吃同一数据源），不做修复——
 * 作者看到的就是文件里写的，引擎的静默窄门属采纳期语义，留 M4c 收口。
 */
function afterKeys(after: unknown): string[] {
  if (typeof after === 'object' && after !== null && !Array.isArray(after)) {
    return Object.keys(after as Record<string, unknown>)
  }
  return []
}

/** 条目是否为「引擎会要求覆盖确认」的形态（overwritesHuman 仅 update 生效，与 T1 校验口径一致）。 */
function needsOverwriteConfirm(c: ProposalChange): boolean {
  return c.op === 'update' && c.overwritesHuman === true
}

/** 越界宽容：appliedIndexes 里指向不存在条目的索引不计入「已采纳」展示数（T1 校验只查形状）。 */
function appliedInRangeCount(p: ProposalFile): number {
  const s = new Set(p.appliedIndexes ?? [])
  return p.changes.filter((_, i) => s.has(i)).length
}

type NavRow =
  | { kind: 'chapter'; key: string; title: string }
  | { kind: 'proposal'; key: string; proposal: ProposalFile }

function ProposalReviewDialog({
  open,
  onClose,
  projectPath,
  chapters
}: ProposalReviewDialogProps) {
  const { getAllProposals, getProposalById, adoptProposalChanges, rejectProposalChanges } =
    useProposal()

  const [proposals, setProposals] = useState<ProposalFile[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<ProposalFile | null>(null)
  const [loadingList, setLoadingList] = useState(false)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [busy, setBusy] = useState(false)
  const [checked, setChecked] = useState<Set<number>>(new Set())
  // 最近一次 adopt 的逐条拒绝（会话态，绝不落盘——提案文件只记 appliedIndexes 这一真相）
  const [refused, setRefused] = useState<ProposalAdoptRefusal[]>([])
  const [notice, setNotice] = useState<string | null>(null)

  const showChannelError = useCallback((context: string, err: unknown): void => {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[ProposalReviewDialog] ${context}:`, msg)
    message.error(`${context}：${msg}`, 8)
  }, [])

  /** 拉未消化提案列表（status==='settled' 不进面板——徽章同口径；返回过滤后列表供调用方判存活）。 */
  const refreshList = useCallback(async (): Promise<ProposalFile[]> => {
    if (!projectPath) return []
    try {
      const all = await getAllProposals(projectPath)
      const list = all.filter((p) => p.status !== 'settled')
      setProposals(list)
      setSelectedId((prev) =>
        prev !== null && list.some((p) => p.id === prev) ? prev : (list[0]?.id ?? null)
      )
      return list
    } catch (err) {
      showChannelError('提案列表读取失败', err)
      return []
    }
  }, [projectPath, getAllProposals, showChannelError])

  /** 点读单份（坏档 PROPOSAL_INVALID 抛穿 → 原样展示；缺失 null 由调用方分流）。 */
  const fetchDetail = useCallback(
    async (id: string): Promise<ProposalFile | null | undefined> => {
      if (!projectPath) return undefined
      try {
        return await getProposalById(projectPath, id)
      } catch (err) {
        showChannelError('提案读取失败', err)
        return undefined
      }
    },
    [projectPath, getProposalById, showChannelError]
  )

  // 打开面板 = 拉一遍新鲜列表（入口契约：徽章点击后绝不吃陈旧缓存）
  useEffect(() => {
    if (!open) return
    setLoadingList(true)
    void refreshList().finally(() => setLoadingList(false))
  }, [open, refreshList])

  // 选中项变化 / 重新打开 = 新鲜点读 + 状态清零（勾选/拒绝/提示都属「这一份提案」，不可跨份携带）
  useEffect(() => {
    if (!open || !selectedId) {
      setDetail(null)
      return
    }
    let cancelled = false
    setChecked(new Set())
    setRefused([])
    setNotice(null)
    setLoadingDetail(true)
    void fetchDetail(selectedId).then((f) => {
      if (cancelled) return
      setDetail(f ?? null)
    })
    return () => {
      cancelled = true
    }
  }, [open, selectedId, fetchDetail])

  const appliedSet = useMemo(() => new Set(detail?.appliedIndexes ?? []), [detail])
  // 只数「实际落在条目上」的采纳（越界索引在列表行里自然不可见，计数同样不计入）
  const appliedCount = useMemo(
    () => (detail ? detail.changes.filter((_, i) => appliedSet.has(i)).length : 0),
    [detail, appliedSet]
  )
  const checkedList = useMemo(
    // 双保险：已采纳索引即便因异常路径混进勾选集也绝不上送（引擎会报「条目已采纳」，
    // 但 create 类条目重放=双胞胎实体，UI 侧先兜一道）
    () => [...checked].filter((i) => !appliedSet.has(i)).sort((a, b) => a - b),
    [checked, appliedSet]
  )

  // 章分组导航：正文顺序排列的章在前，章已删的孤儿提案垫底；同章多份（T4 顾虑：save 不去重）
  // 按 createdAt 新→旧
  const navRows = useMemo<NavRow[]>(() => {
    const byChapter = new Map<string, ProposalFile[]>()
    for (const p of proposals) {
      const arr = byChapter.get(p.chapterId) ?? []
      arr.push(p)
      byChapter.set(p.chapterId, arr)
    }
    for (const arr of byChapter.values()) {
      arr.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
    }
    const rows: NavRow[] = []
    for (const c of [...chapters].sort((a, b) => a.order - b.order)) {
      const items = byChapter.get(c.id)
      if (!items) continue
      rows.push({ kind: 'chapter', key: `h-${c.id}`, title: c.title || '无题' })
      for (const p of items) rows.push({ kind: 'proposal', key: p.id, proposal: p })
      byChapter.delete(c.id)
    }
    for (const [chapterId, items] of byChapter) {
      rows.push({ kind: 'chapter', key: `h-${chapterId}`, title: '（出处章节已删除）' })
      for (const p of items) rows.push({ kind: 'proposal', key: p.id, proposal: p })
    }
    return rows
  }, [proposals, chapters])

  const toggleCheck = useCallback((index: number): void => {
    setChecked((prev) => {
      const next = new Set(prev)
      if (next.has(index)) next.delete(index)
      else next.add(index)
      return next
    })
  }, [])

  // —— 采纳勾选（含「通道 REJECT ≠ 逐条拒绝」的重新同步义务） ——
  const handleAdopt = async (): Promise<void> => {
    if (!projectPath || !detail || busy) return
    const id = detail.id
    const sent = checkedList
    if (sent.length === 0) return
    // overwritesHuman 勾选条目同时进两个数组（引擎通道门：confirmedOverwrite 缺席 = 必拒）
    const confirmedOverwrite = sent.filter((i) => needsOverwriteConfirm(detail.changes[i]))
    setBusy(true)
    setNotice(null)
    try {
      const result = await adoptProposalChanges(projectPath, id, sent, confirmedOverwrite)
      setRefused(result.refused)
      setChecked((prev) => {
        const next = new Set(prev)
        for (const i of result.applied) next.delete(i)
        return next
      })
      if (result.applied.length > 0) {
        message.success(`采纳 ${result.applied.length} 条 / 拒绝 ${result.refused.length} 条`)
        // 裁定 7：实体广播驱动徽章回落 + 图谱联动（useOrganize 订阅 entityEvents）
        notifyEntitiesChanged()
      } else if (result.refused.length > 0) {
        message.warning('采纳 0 条——拒绝原因见条目内红字')
      } else {
        message.info('没有条目被处理')
      }
      // 重读真相：✓已采纳灰化以盘上 appliedIndexes 为准；整份消化后从列表退场（settled）
      await fetchDetail(id).then((f) => setDetail(f ?? null))
      await refreshList()
    } catch (err) {
      // 通道 REJECT（网络/IPC/markSettled 失败窗口）：数据可能已部分落盘——绝不裸重试，
      // 重新同步三态：null=文件没了 / undefined=重读也败 / ProposalFile=差集定数
      const fresh = await fetchDetail(id)
      if (fresh === undefined) {
        showChannelError('采纳失败（且无法重读提案，建议关闭面板后重新打开）', err)
      } else if (fresh === null) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error('[ProposalReviewDialog] 采纳出错且提案文件已不存在:', msg)
        message.error(`采纳出错且提案文件已不存在（可能被他端消化/删除）：${msg}`, 8)
      } else {
        const nowApplied = new Set(fresh.appliedIndexes ?? [])
        const n = sent.filter((i) => nowApplied.has(i)).length
        setDetail(fresh)
        setChecked((prev) => {
          const next = new Set(prev)
          for (const i of sent) if (nowApplied.has(i)) next.delete(i)
          return next
        })
        const msg = err instanceof Error ? err.message : String(err)
        setNotice(`采纳状态未知，已重新同步：${n} 条实际已生效（通道报错：${msg}）`)
        if (n > 0) notifyEntitiesChanged()
      }
      await refreshList()
    } finally {
      setBusy(false)
    }
  }

  // —— 驳回勾选：删条目（全删空 = 整份提案删除）；索引重排 ⇒ 勾选清零 + 整份重读 ——
  const handleReject = async (): Promise<void> => {
    if (!projectPath || !detail || busy) return
    const id = detail.id
    const target = checkedList
    if (target.length === 0) return
    setBusy(true)
    setNotice(null)
    try {
      await rejectProposalChanges(projectPath, id, target)
      message.success(`已驳回 ${target.length} 条`)
      setChecked(new Set())
      setRefused([])
      // reject 可能整份删文件/重排索引/重算 status——徽章与图谱一律重拉，条目索引作废
      notifyEntitiesChanged()
      const list = await refreshList()
      if (list.some((p) => p.id === id)) {
        const fresh = await fetchDetail(id)
        setDetail(fresh ?? null)
      } else {
        setDetail(null)
      }
    } catch (err) {
      showChannelError('驳回失败', err)
      // 文件状态未知（部分删？）：与 adopt 错误同理重读，绝不带着旧索引继续操作
      const fresh = await fetchDetail(id)
      setDetail(fresh ?? null)
      setChecked(new Set())
      setRefused([])
      await refreshList()
    } finally {
      setBusy(false)
    }
  }

  const renderChange = (c: ProposalChange, i: number): React.ReactNode => {
    const applied = appliedSet.has(i)
    const refuseReason = refused.find((r) => r.index === i)?.reason
    const warnFields = needsOverwriteConfirm(c) ? afterKeys(c.after) : []
    return (
      <div className={`proposal-review-change${applied ? ' proposal-review-change--applied' : ''}`}>
        <div className="proposal-review-change-check">
          {applied ? (
            <span className="proposal-review-applied">✓ 已采纳</span>
          ) : (
            <Checkbox
              checked={checked.has(i)}
              disabled={busy}
              onChange={() => toggleCheck(i)}
              aria-label={`勾选变更条目 ${i + 1}`}
            />
          )}
        </div>
        <div className="proposal-review-change-main">
          <div className="proposal-review-change-head">
            <Tag color={OP_COLOR[c.op]}>{OP_LABEL[c.op]}</Tag>
            <Tag>{ENTITY_LABEL[c.entity]}</Tag>
            {c.targetId ? (
              <Tooltip title={c.targetId}>
                <Tag>目标 {c.targetId.slice(0, 8)}</Tag>
              </Tooltip>
            ) : null}
            <Text className="proposal-review-meta">#{i + 1}</Text>
          </div>
          {/* after 按文件原样呈现（窄门差异说明见 afterKeys 上方注释；BOOK_FORMAT §7.5） */}
          <div className="proposal-review-after">{summarizeAfter(c)}</div>
          {needsOverwriteConfirm(c) ? (
            <div className="proposal-review-warn">
              将覆盖你手写的值：{warnFields.length > 0 ? warnFields.join('、') : '（载荷非对象）'}
              ——勾选本条即确认覆盖
            </div>
          ) : null}
          {refuseReason ? <div className="proposal-review-refused">{refuseReason}</div> : null}
          <blockquote className="proposal-review-quote">
            <div className="proposal-review-quote-source">出自本章原文</div>
            {c.source.quote}
          </blockquote>
        </div>
      </div>
    )
  }

  const renderNavRow = (row: NavRow): React.ReactNode => {
    if (row.kind === 'chapter') {
      return <div className="proposal-review-chapter">{row.title}</div>
    }
    const p = row.proposal
    const selected = p.id === selectedId
    return (
      <div
        className={`proposal-review-proposal${selected ? ' proposal-review-proposal--selected' : ''}`}
        onClick={() => setSelectedId(p.id)}
      >
        <div className="proposal-review-proposal-title">
          {dayjs(p.createdAt).format('MM-DD HH:mm')} 提案
          {p.status === 'partial' ? <Tag color="orange">部分采纳</Tag> : null}
        </div>
        <div className="proposal-review-meta">
          已采纳 {appliedInRangeCount(p)}/{p.changes.length} 条 · {p.aiModel}
        </div>
      </div>
    )
  }

  return (
    <Modal
      className="proposal-review-modal"
      title="AI 整理提案审阅"
      open={open}
      onCancel={onClose}
      width={860}
      footer={
        <div className="proposal-review-footer">
          <span className="proposal-review-meta">
            已勾选 {checkedList.length} 条
            {detail ? ` / 未消化 ${detail.changes.length - appliedCount} 条` : ''}
          </span>
          <span className="proposal-review-actions">
            <Button onClick={onClose} disabled={busy}>
              关闭
            </Button>
            <Button danger onClick={() => void handleReject()} disabled={busy || checkedList.length === 0}>
              驳回勾选
            </Button>
            <Tooltip title="标橙条目需勾选才视为确认覆盖（未勾选=不写回，条目保留在提案里）">
              <Button type="primary" onClick={() => void handleAdopt()} loading={busy} disabled={busy || checkedList.length === 0}>
                采纳勾选
              </Button>
            </Tooltip>
          </span>
        </div>
      }
    >
      {/* origin 机制诚实文案（T3 顾虑 1：应用内手动编辑不撤销 aiTouched 旗标——不过度承诺，M4c 改进） */}
      <div className="proposal-review-note">
        AI 只会改动它此前写过的字段；你手写的字段被改动时条目会标橙并要求确认。
        你在应用内手动编辑不会撤销这一标记（M4c 计划改进）。
      </div>
      <div className="proposal-review">
        <div className="proposal-review-nav">
          {loadingList && proposals.length === 0 ? (
            <Spin style={{ display: 'block', margin: 'var(--space-5) auto' }} />
          ) : proposals.length === 0 ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无待审阅的提案" />
          ) : (
            <List size="small" split={false} dataSource={navRows} renderItem={renderNavRow} />
          )}
        </div>
        <div className="proposal-review-detail">
          {notice ? <div className="proposal-review-notice">{notice}</div> : null}
          {loadingDetail ? (
            <Spin style={{ display: 'block', margin: 'var(--space-5) auto' }} />
          ) : detail ? (
            <List
              size="small"
              split={false}
              dataSource={detail.changes.map((c, i) => ({ c, i }))}
              renderItem={({ c, i }) => renderChange(c, i)}
            />
          ) : (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="选择左侧提案开始审阅" />
          )}
        </div>
      </div>
    </Modal>
  )
}

export default ProposalReviewDialog
