// M6 审阅意见仓库（T1）：`.ai/reviews/<chapterId>.json` = ReviewOpinion[] 单文件 JSON 数组
// （真 JSON 字节、缩进 2 人可读——派生数据与 index.json 同待遇，watcher 对 .ai/ 本就忽略）。
// 主进程代码：相对导入 + node: 前缀（memory「@ 别名路径陷阱」同款纪律，镜像 proposals.ts）。
//
// 信任姿态（宽严分界，同 proposal 先例）：
// - 宽容读：loadReviews 缺文件 → []；坏 JSON 字节/顶层非数组 → console.warn（绝对路径）+ []；
//   数组内坏条目逐条 validateReviewOpinion warn+skip——一本坏账不该瘫痪审阅面板（listProposals 口径）；
// - 严格写自家产物：saveRun 对入参逐条 validateReviewOpinion + chapterId 归属核对，
//   任一条坏 → REVIEW_INVALID 抛穿且**发生在任何落盘之前**（部分写零污染——测试钉死）；
//   落盘走 writeTextFileAtomic（tmp+rename），合并矩阵全在内存算完再一次写。
//
// 合并矩阵（spec Q4/G4，重审按章替换的单一权威）：
// - 旧 dismissed/converted 原样保留（converted 携 proposalId 转化指针）；
// - 旧 open 与新意见同抑制键 → 被新替换（旧条目出局，新条目 open/stale 照输入）；
// - 旧 open 未重现 → 保留且 stale=true（「上次未重现」是标记非删除——徽标仍计、可驳回）；
//   已 stale 者再未重现 → 仍 stale（幂等不叠加）；已 stale 者重现 → 被新替换（恢复新鲜）；
// - 新意见命中旧 dismissed 抑制键 → 丢弃（同章防复读，spec Q6：键含 chapterId，跨章不抑制）。
//
// 状态迁移唯一写入口：dismissReview（open→dismissed，重复 dismiss 幂等）、
// markReviewConverted（非 stale 的 open→converted+proposalId，指针唯一——重复转化拒）。
// stale 只在 saveRun 合并里产生；两者互斥路径由状态守卫钉死。
//
// 错误语义（平文前缀，PROPOSAL_* 同款，渲染层原样展示）：
// - REVIEW_INVALID: <id>: …            自家产物校验失败 / proposalId 空
// - REVIEW_MISSING: <id>                dismiss/markConverted 目标意见不存在
// - REVIEW_NOT_OPEN: <id>               状态迁移守卫（converted/stale/dismissed 不可再迁移）
// - BAD_REVIEW_CHAPTER_ID: <id>         chapterId 非 UUID——join 重定向封死（账本文件名即 chapterId）
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import type { ReviewOpinion } from '../../../src/common/reviewTypes'
import { suppressionKey, validateReviewOpinion } from '../../../src/common/reviewTypes'
import { UUID_PATTERN } from '../../../src/common/schema'
import { reviewFile, reviewsDir } from './paths'
import { writeTextFileAtomic } from './docStore'

const JSON_EXT = '.json'

/** chapterId 路径安全门：账本文件名 = `<chapterId>.json`，UUID 形状是唯一放行条件（封死 `../`）。 */
function assertReviewChapterId(chapterId: unknown): void {
  if (typeof chapterId !== 'string' || !UUID_PATTERN.test(chapterId)) {
    throw new Error(`BAD_REVIEW_CHAPTER_ID: ${String(chapterId)}`)
  }
}

/** 单档宽容解析（loadReviews/listAllReviews 共用）：坏字节/非数组 → warn+[]；坏条目 warn+skip。 */
function parseReviewFile(abs: string): ReviewOpinion[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(abs, 'utf8'))
  } catch (err) {
    console.warn(`跳过损坏审阅账本: ${abs}: ${err instanceof Error ? err.message : String(err)}`)
    return []
  }
  if (!Array.isArray(parsed)) {
    console.warn(`跳过顶层非数组的审阅账本: ${abs}`)
    return []
  }
  const out: ReviewOpinion[] = []
  for (const item of parsed) {
    const errors = validateReviewOpinion(item)
    if (errors.length > 0) {
      console.warn(`跳过审阅账本内非法意见: ${abs}: ${errors.join('; ')}`)
      continue
    }
    out.push(item as ReviewOpinion)
  }
  return out
}

/** 该章全部意见（文件缺失/损坏 → []，永不整体抛穿）。 */
export function loadReviews(projectPath: string, chapterId: string): ReviewOpinion[] {
  assertReviewChapterId(chapterId)
  const abs = reviewFile(projectPath, chapterId)
  if (!existsSync(abs)) return []
  return parseReviewFile(abs)
}

/** 全书意见聚合（徽标计数/跨章面板数据源）：目录缺失 → []；按文件名升序稳定迭代、逐档容错。 */
export function listAllReviews(projectPath: string): ReviewOpinion[] {
  const dir = reviewsDir(projectPath)
  if (!existsSync(dir)) return []
  const out: ReviewOpinion[] = []
  for (const name of readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(JSON_EXT))
    .map((e) => e.name)
    .sort()) {
    out.push(...parseReviewFile(join(dir, name)))
  }
  return out
}

/** 全量落盘（缩进 2 + 尾换行，人可读；原子写 + 自写登记走 docStore 唯一咽喉）。 */
function writeReviews(projectPath: string, chapterId: string, opinions: ReviewOpinion[]): void {
  writeTextFileAtomic(reviewFile(projectPath, chapterId), JSON.stringify(opinions, null, 2) + '\n')
}

/**
 * 重审合并（按章替换的唯一实现；返回合并后全集）。
 * - model 参数是 run 的模型单一权威：盖在所有**新入**意见上（T5 漏盖/串槽也拧得回来）；
 *   旧存量（dismissed/converted/stale）不动——它们的 model 是各自 run 的历史真相。
 * - 入参逐条严格校验（含 chapterId 归属核对）且**先于任何盘操作**——部分写零污染。
 * - 新意见的 status/stale 照输入（常态 open/false；首跑可携 converted——合并矩阵按状态分流处理）。
 */
export function saveRun(
  projectPath: string,
  chapterId: string,
  opinions: ReviewOpinion[],
  model: string
): ReviewOpinion[] {
  assertReviewChapterId(chapterId)
  if (!Array.isArray(opinions)) {
    throw new Error(`REVIEW_INVALID: ${chapterId}: opinions must be an array`)
  }
  const incoming: ReviewOpinion[] = []
  for (const o of opinions) {
    const errors = validateReviewOpinion(o)
    if (errors.length > 0) {
      const id = typeof o === 'object' && o !== null ? String(o.id) : '?'
      throw new Error(`REVIEW_INVALID: ${id}: ${errors.join('; ')}`)
    }
    if (o.chapterId !== chapterId) {
      // 幻影/串章意见拒落——账本文件名即 chapterId，入错档等于跨章污染
      throw new Error(`REVIEW_INVALID: ${o.id}: chapterId "${o.chapterId}" does not match target "${chapterId}"`)
    }
    incoming.push({ ...o, model })
  }

  const old = loadReviews(projectPath, chapterId)
  const dismissedKeys = new Set(
    old.filter((o) => o.status === 'dismissed').map((o) => suppressionKey(o))
  )
  const newKeys = new Set(incoming.map((o) => suppressionKey(o)))

  const kept = old.map((o) => {
    if (o.status !== 'open') return o // dismissed/converted 原样保留（converted 携转化指针）
    // open：与新 run 同抑制键 → 被替换（出局）；未重现 → stale=true（重跑幂等）
    return newKeys.has(suppressionKey(o)) ? null : { ...o, stale: true }
  })
  const additions = incoming.filter((o) => !dismissedKeys.has(suppressionKey(o)))

  const merged: ReviewOpinion[] = [...kept.filter((o): o is ReviewOpinion => o !== null), ...additions]
  writeReviews(projectPath, chapterId, merged)
  return merged
}

/** 驳回（唯一写入口）：open → dismissed；重复驳回幂等；converted 不可驳回。返回更新后全集。 */
export function dismissReview(
  projectPath: string,
  chapterId: string,
  opinionId: string
): ReviewOpinion[] {
  const opinions = loadReviews(projectPath, chapterId)
  const target = opinions.find((o) => o.id === opinionId)
  if (!target) throw new Error(`REVIEW_MISSING: ${opinionId}`)
  if (target.status === 'converted') throw new Error(`REVIEW_NOT_OPEN: ${opinionId}`)
  if (target.status === 'dismissed') return opinions // 幂等（双击/竞态），不重写字节
  const merged = opinions.map((o) => (o.id === opinionId ? { ...o, status: 'dismissed' as const } : o))
  writeReviews(projectPath, chapterId, merged)
  return merged
}

/** 转化盖章（唯一写入口）：非 stale 的 open → converted + proposalId（指针唯一，不可二次转化）。 */
export function markReviewConverted(
  projectPath: string,
  chapterId: string,
  opinionId: string,
  proposalId: string
): ReviewOpinion[] {
  if (typeof proposalId !== 'string' || proposalId.trim() === '') {
    throw new Error(`REVIEW_INVALID: proposalId must be a non-empty string`)
  }
  const opinions = loadReviews(projectPath, chapterId)
  const target = opinions.find((o) => o.id === opinionId)
  if (!target) throw new Error(`REVIEW_MISSING: ${opinionId}`)
  // spec Q4：仅（非 stale 的）open 可转化——stale/dismissed/converted 一律拒（防双指针/防幽灵转化）
  if (target.status !== 'open' || target.stale) throw new Error(`REVIEW_NOT_OPEN: ${opinionId}`)
  const merged = opinions.map((o) =>
    o.id === opinionId
      ? { ...o, status: 'converted' as const, proposalId: proposalId.trim() }
      : o
  )
  writeReviews(projectPath, chapterId, merged)
  return merged
}
