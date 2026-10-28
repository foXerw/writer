// useGraphData 台账读容错（Task 4 评审整改 R1，抽成纯函数供无 jsdom 单测，镜像 chapterRefresh.ts 先例）。
// 六路拉取中只有 foreshadow.get 会抛穿：损坏/非法 foreshadow.yaml 在仓库侧 readLedger
// （narrative.ts：YAML parse 抛穿 + validateForeshadowLedger 非空即 FORESHADOW_INVALID 抛穿）
// reject；其余五路读侧皆容错（characters.ts/world.ts listCharacters/listWorldEntries 与
//  narrative.ts listPlotlines/listChoices 坏档 warn+跳过、aiData.ts readAiData 坏档按空读，
//  通道层从不 reject）。不隔离这一路抛穿，Promise.all 整体 reject → 五张图首屏全白、刷新冻结。
// 降级只影响跳章菜单里伏笔条目的引用（entityRefs 按 ledger.entries 迭代，空数组自然无伏笔项），
// 五张图的 build*Graph 均不吃台账 → 视图照常。
import type { ForeshadowLedger } from '@/common/schema'

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
