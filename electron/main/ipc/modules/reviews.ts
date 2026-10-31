// review:* IPC 层（M6 T1）：4 通道薄委托到 bookStore/reviews，本文件零文件系统直操
// （对齐 proposal/chapter/character 纪律）。参数一律对象形状 {projectPath, …}（新通道组新契约）。
//
// 错误语义与 PROPOSAL_* 同款（平文前缀，渲染层原样展示——审阅面板按 spec 在对话框内呈现）：
// - REVIEW_INVALID / REVIEW_MISSING / REVIEW_NOT_OPEN / BAD_REVIEW_CHAPTER_ID 见 bookStore/reviews.ts 头注；
// - REVIEW_CHAPTER_MISSING: <id>  saveRun 盖章：被审章不是现存章（幻觉/已删章 id 拒落账本，
//   proposal:save 同款闸门——通道层职责，存储层不重复）。
// - REVIEW_TOO_MANY: <n> > 200    saveRun 单 run 意见数帽（通道级政策，PROPOSAL_TOO_LARGE/
//   MAX_PROPOSAL_CHANGES 先例同款——病理输出门口拦；存储层不设限，存量账本可读可迁移）。
// 双保险姿态：saveRun 逐条 validateReviewOpinion 在存储层（写侧唯一咽喉），渲染层 T5 落盘前
// 自会先跑一次（同 useOrganize 先例）——谁都不能单独失守。
import { ipcMain } from 'electron'
import type { ReviewOpinion } from '../../../../src/common/reviewTypes'
import {
  dismissReview,
  listAllReviews,
  loadReviews,
  markReviewConverted,
  saveRun
} from '../../bookStore/reviews'
import { listChapters } from '../../bookStore/chapters'

/** 单 run 意见数上限（通道级 saveRun 政策，对齐 MAX_PROPOSAL_CHANGES=200 先例；T1 评审发现③）。 */
const MAX_REVIEW_OPINIONS = 200

export function registerReviewHandlers(): void {
  // chapterId 省略 = 全书聚合（徽标计数/跨章面板）；给出 = 单章账本点读
  ipcMain.handle(
    'review:get',
    (_e, params: { projectPath: string; chapterId?: string }): ReviewOpinion[] =>
      params.chapterId === undefined
        ? listAllReviews(params.projectPath)
        : loadReviews(params.projectPath, params.chapterId)
  )

  ipcMain.handle(
    'review:saveRun',
    (_e, params: { projectPath: string; chapterId: string; opinions: ReviewOpinion[]; model: string }): ReviewOpinion[] => {
      // 数帽先于一切盘操作（纯长度检查，病理输出门口拦）
      if (Array.isArray(params.opinions) && params.opinions.length > MAX_REVIEW_OPINIONS) {
        throw new Error(`REVIEW_TOO_MANY: ${params.opinions.length} > ${MAX_REVIEW_OPINIONS}`)
      }
      if (!listChapters(params.projectPath).some((c) => c.id === params.chapterId)) {
        throw new Error(`REVIEW_CHAPTER_MISSING: ${params.chapterId}`)
      }
      return saveRun(params.projectPath, params.chapterId, params.opinions, params.model)
    }
  )

  ipcMain.handle(
    'review:dismiss',
    (_e, params: { projectPath: string; chapterId: string; opinionId: string }): ReviewOpinion[] =>
      dismissReview(params.projectPath, params.chapterId, params.opinionId)
  )

  ipcMain.handle(
    'review:markConverted',
    (
      _e,
      params: { projectPath: string; chapterId: string; opinionId: string; proposalId: string }
    ): ReviewOpinion[] =>
      markReviewConverted(params.projectPath, params.chapterId, params.opinionId, params.proposalId)
  )
}
