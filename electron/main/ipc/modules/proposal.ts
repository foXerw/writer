// proposal:* IPC 层（M4b T3）：5 通道薄委托到 bookStore/proposals + bookStore/adopt，
// 本文件零文件系统直操（对齐 chapter/character/narrative 纪律）。参数一律对象形状
// {projectPath, …}（控制器裁定，与 getAll 系旧通道的裸 string 参数刻意不同——新通道组新纪律）。
//
// 错误语义（裁定：不复用 AI 路径的 [kind] 词表——proposal 通道错误是 PROPOSAL_*: 前缀的
// 平文消息，CHAPTER_MISSING 先例同款，渲染层原样展示）：
// - PROPOSAL_INVALID: <id|abs>: …   文件级校验失败（save 双保险 / 点读坏档抛穿）
// - PROPOSAL_TOO_LARGE: <n> > 200   save 条目数上限（通道级策略——validateProposal 不关心数量，
//                                   病理输出/手滑巨型文件在门口拦；存储层/引擎不设限，存量文件可读可采纳）
// - PROPOSAL_CHAPTER_MISSING: <id>  save 盖章：提案出处章不是现存章（幻觉/过期章 id 拒落）
// - PROPOSAL_MISSING: <id>          adopt/reject 目标提案不存在
// - BAD_PROPOSAL_ID: <id>           id 路径安全门（join 重定向封死）
// 逐条拒绝不是通道错误：adopt 的 REFUSED: 条目在结果对象 refused[] 里按 index 返回。
import { ipcMain } from 'electron'
import type { ProposalAdoptResult, ProposalFile } from '../../../../src/common/proposal'
import { validateProposal } from '../../../../src/common/proposal'
import { getProposal, listProposals, writeProposal } from '../../bookStore/proposals'
import { adoptChanges, rejectChanges } from '../../bookStore/adopt'
import { listChapters } from '../../bookStore/chapters'

/** 单份提案条目数上限（通道级 save 政策，评审折入；T5 面板对超大提案也没有可用性）。 */
const MAX_PROPOSAL_CHANGES = 200

export function registerProposalHandlers(): void {
  ipcMain.handle('proposal:getAll', (_e, params: { projectPath: string }): ProposalFile[] =>
    listProposals(params.projectPath)
  )

  ipcMain.handle(
    'proposal:get',
    (_e, params: { projectPath: string; id: string }): ProposalFile | null =>
      getProposal(params.projectPath, params.id)
  )

  // 双保险：渲染层（T4 useOrganize）落盘前已跑过一次 validateProposal——主进程再验一次，
  // 谁都不能单独失守；盖章 = 出处章必须是现存章（AI 幻觉 chapterId / 章已被删的过期提案拒落）。
  ipcMain.handle(
    'proposal:save',
    (_e, params: { projectPath: string; file: ProposalFile }): ProposalFile => {
      const { projectPath, file } = params
      const errors = validateProposal(file)
      if (errors.length > 0) {
        const id = typeof file === 'object' && file !== null ? String(file.id) : '?'
        throw new Error(`PROPOSAL_INVALID: ${id}: ${errors.join('; ')}`)
      }
      if (file.changes.length > MAX_PROPOSAL_CHANGES) {
        throw new Error(`PROPOSAL_TOO_LARGE: ${file.changes.length} > ${MAX_PROPOSAL_CHANGES}`)
      }
      if (!listChapters(projectPath).some((c) => c.id === file.chapterId)) {
        throw new Error(`PROPOSAL_CHAPTER_MISSING: ${file.chapterId}`)
      }
      return writeProposal(projectPath, file) // 存储层第三道 validateProposal（writeProposal 前置）
    }
  )

  ipcMain.handle(
    'proposal:adopt',
    (
      _e,
      params: {
        projectPath: string
        proposalId: string
        changeIndexes: number[]
        confirmedOverwrite?: number[]
      }
    ): ProposalAdoptResult =>
      adoptChanges(
        params.projectPath,
        params.proposalId,
        params.changeIndexes,
        params.confirmedOverwrite ?? [] // 缺省 = 无任何覆盖确认（overwritesHuman 条目一律拒——从严）
      )
  )

  ipcMain.handle(
    'proposal:reject',
    (
      _e,
      params: { projectPath: string; proposalId: string; changeIndexes: number[] }
    ): void => rejectChanges(params.projectPath, params.proposalId, params.changeIndexes)
  )
}
