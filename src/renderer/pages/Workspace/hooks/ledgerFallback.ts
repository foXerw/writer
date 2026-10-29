// useGraphData 台账读容错（Task 4 评审整改 R1，抽成纯函数供无 jsdom 单测，镜像 chapterRefresh.ts 先例）。
// 六路拉取中只有 foreshadow.get 会抛穿：损坏/非法 foreshadow.yaml 在仓库侧 readLedger
// （narrative.ts：YAML parse 抛穿 + validateForeshadowLedger 非空即 FORESHADOW_INVALID 抛穿）
// reject；其余五路读侧皆容错（characters.ts/world.ts listCharacters/listWorldEntries 与
//  narrative.ts listPlotlines/listChoices 坏档 warn+跳过、aiData.ts readAiData 坏档按空读，
//  通道层从不 reject）。不隔离这一路抛穿，Promise.all 整体 reject → 五张图首屏全白、刷新冻结。
// 降级只影响跳章菜单里伏笔条目的引用（entityRefs 按 ledger.entries 迭代，空数组自然无伏笔项），
// 五张图的 build*Graph 均不吃台账 → 视图照常。
//
// 台账坏值的两副面孔（Task 7 收口裁定，刻意不对称）：
// - 图谱侧 = 只读展示 → withLedgerFallback 静默降级空台账（warn 留痕），视图照常；
// - 整理侧 = 花用户 token 的写路径 → withLedgerLoudError 必须 fail-loud：空台账降级会让
//   AI 上下文的伏笔部分无声蒸发、照常产出「看起来正常」的提案，比报错更欺骗。
import type { ForeshadowLedger } from '@/common/schema'
import { narrativeErrorText } from '../../../services/narrativeErrors'

/** 台账降级值：与「盘上无台账」同形（readLedger 缺档即返回此形状），只读消费。 */
export const EMPTY_LEDGER: ForeshadowLedger = { entries: [] }

/**
 * 执行台账读取：成功原样透传；抛穿（坏 YAML/校验失败）→ console.warn 留痕（镜像仓库侧
 * 「跳过损坏…」warn 纪律）+ 返回 EMPTY_LEDGER，绝不向上抛——抛穿隔离只限这一路。
 */
export async function withLedgerFallback(
  load: () => Promise<ForeshadowLedger>
): Promise<ForeshadowLedger> {
  try {
    return await load()
  } catch (error) {
    console.warn('[useGraphData] 伏笔台账读取失败，按空台账降级（仅伏笔跳章引用缺席）：', error)
    return EMPTY_LEDGER
  }
}

/**
 * 整理侧台账读取（useOrganize 六路 Promise.all 用）：抛穿绝不吞——原 error console.error
 * 留痕后重抛，但消息换成 narrativeErrorText 归一的中文可读文案（坏台账 → 「伏笔台账数据
 * 已损坏，应用未做任何修改：…」）。此前该 error 直落 useOrganize 外层 catch，英文
 * `FORESHADOW_INVALID: <path>: …` 原样进「整理失败：」toast——fail-loud 的姿态本任务维持，
 * 只把文案面收口进中文词表单源（narrativeErrors.ts）。
 */
export async function withLedgerLoudError(
  load: () => Promise<ForeshadowLedger>
): Promise<ForeshadowLedger> {
  try {
    return await load()
  } catch (error) {
    console.error('[useOrganize] 伏笔台账读取失败，整理中止（不降级为空台账）：', error)
    throw new Error(narrativeErrorText(error instanceof Error ? error.message : String(error)), { cause: error })
  }
}
