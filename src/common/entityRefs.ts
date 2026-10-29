// 实体→章节引用并集（M4c-2 Task 2：章节跳转的纯函数底座，主/渲染共用）。
// 图上节点点击后要弹「跳哪一章」菜单（Task 4），菜单数据 = 每个实体出现在哪些章。
// 引用有两个来源，取并集：
// - index：AI 维护的 .ai/index.json（实体 id → 章节 id 清单，M4b 整理管道产出；
//   键域外的 id——比如实体已删除后的残留记账——一律忽略，不让幽灵实体复活）；
// - 显式字段：角色 arc[].chapterIds / 剧情线 stages[].chapterIds / 选项 chapterId /
//   伏笔 plantedChapterId + resolvedChapterId（未回收为 null，天然不进并集）。
// 词条（WorldEntryV2）在 v2 schema 没有任何章节字段（世界设定按条目组织、不绑章），
// 故其显式来源恒为空——这是 schema 现状而非省略，若未来词条增绑章字段需在此补。
// 三条清洗纪律：去重；剔除不在 orderedChapterIds 的悬挂引用（章节已被删除）；
// 输出数组按 orderedChapterIds 位置排序（书序），与引用在入参中的出现次序无关。
// 键域 = 所有实体 id（角色/词条/剧情线/选项/伏笔条目），无可用引用的实体值为 []，
// 调用方按 `refs[id]?.length` 分流「有引用→弹菜单 / 无→回退 M3 切面板」。

import type {
  CharacterV2,
  ChoiceNodeV2,
  ForeshadowEntry,
  ForeshadowLedger,
  PlotlineV2,
  WorldEntryV2
} from './schema'

export interface EntityChapterRefsArgs {
  /** .ai/index.json 的 实体 id → 章节 id 清单（可能缺失键）。 */
  index: Record<string, string[]>
  characters: CharacterV2[]
  world: WorldEntryV2[]
  plotlines: PlotlineV2[]
  choices: ChoiceNodeV2[]
  ledger: ForeshadowLedger
  /** 当前书序（章节 id 按落盘顺序排列）；既是过滤悬挂的白名单，也是排序基准。 */
  orderedChapterIds: string[]
}

/** 伏笔条目的显式章节引用：埋设章必有，回收章可为 null。 */
function foreshadowChapterRefs(entry: ForeshadowEntry): string[] {
  return entry.resolvedChapterId === null
    ? [entry.plantedChapterId]
    : [entry.plantedChapterId, entry.resolvedChapterId]
}

/**
 * 汇总所有实体的章节引用并集。纯函数：不改动任何入参（含其内层数组），
 * 同输入必得同输出（键按 角色→词条→剧情线→选项→伏笔 的入参序插入，值按书序）。
 */
export function buildEntityChapterRefs(args: EntityChapterRefsArgs): Record<string, string[]> {
  // 悬挂判定与排序共用一张 章节 id → 书序位置 表；重复 id 以首个位置为准。
  const position = new Map<string, number>()
  args.orderedChapterIds.forEach((chapterId, i) => {
    if (!position.has(chapterId)) position.set(chapterId, i)
  })

  const refs: Record<string, string[]> = {}
  /** index ∪ 显式引用 → 去重 → 剔除悬挂 → 按书序排序，写入一个实体键。 */
  const emit = (entityId: string, explicit: string[]): void => {
    const indexPart = args.index[entityId] ?? []
    // Map 键去重、值携书序位次：悬挂引用（get 出 undefined）在这一关出局后，位次即「必然存在」
    // ——结转微批 #2 删掉了排序回调里的死 `?? 0` 兜底（原 deduped 只收 position.has 为真的 id，
    // 兜底分支不可达），杜绝「看起来会越界」的误导性防御。
    const deduped = new Map<string, number>()
    for (const chapterId of [...indexPart, ...explicit]) {
      const pos = position.get(chapterId)
      if (pos !== undefined) deduped.set(chapterId, pos)
    }
    refs[entityId] = [...deduped].sort((a, b) => a[1] - b[1]).map(([chapterId]) => chapterId)
  }

  for (const character of args.characters) {
    emit(character.id, character.arc.flatMap(stage => stage.chapterIds))
  }
  // 词条无显式章节字段（见文件头 schema 现状说明），只吃 index。
  for (const entry of args.world) {
    emit(entry.id, [])
  }
  for (const plotline of args.plotlines) {
    emit(plotline.id, plotline.stages.flatMap(stage => stage.chapterIds))
  }
  for (const choice of args.choices) {
    emit(choice.id, [choice.chapterId])
  }
  for (const entry of args.ledger.entries) {
    emit(entry.id, foreshadowChapterRefs(entry))
  }

  return refs
}
