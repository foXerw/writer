# M4b 收尾记录（整理闭环：整理本章 → 提案 → 差异确认 → 采纳）

日期：2026-10-28 ｜ 分支：feat/m4b-organize-loop（72d7b69..HEAD，T0–T6 含三轮复审整改）
计划：`2026-10-28-m4b-organize-loop.md` ｜ DoD 见该文件末节（代码侧全部达成；真 key 整理一次留发起人晨间冒烟）
基线：main = M4a 后 449 测试 → M4b 收口 **627 测试全绿**（41 文件；本片净增 178）。

## 交付面

- **T0 空闲超时语义收口**：`linkSignal` 的 `timeoutMs` 改「连续无流增量的静默时长」（默认 45s），
  慢流长整理不再被总时长误杀；`sanitizeIdleMs` 只认正有限数；feature 白名单单源 `AI_FEATURES`；
  设置页协议感知占位文案。
- **T1 提案 schema**：`src/common/proposal.ts`（ProposalFile/ProposalChange 类型 + 手写校验守卫 +
  `ALLOWED_OPS` op×entity 组合表单一权威——delete 仅限 plotline/choice/foreshadow「AI 无权删人写实体」；
  `proposalPath/newProposalId` 纯函数；`appliedIndexes` 可选字段）。
- **T2 organize 提示词**：`src/common/organizePrompt.ts`（输出规约从组合表渲染、永不漂移；
  chapterId 由系统盖章 AI 不复述；user 消息逐字节透传红线；`budgetToMaxTokens` 线性夹取）。
- **T3 存储 + 采纳引擎**：`bookStore/proposals.ts`（stem 即 id 权威 / list 容错 / `BAD_PROPOSAL_ID`
  路径门 / `markSettled` 唯一记账口）+ `bookStore/adopt.ts`（origin 守卫 + allowlist 逐键拷贝 +
  逐条 try/catch 批次纪律）+ `proposal:*` 五通道（`ipc/modules/proposal.ts`）。
- **T4 触发链**：`useOrganize`（整理本章 → 装配 → 流式 → 宽容解析 → 盖章 → `proposal:save`）+
  `book:readAiData` 只读快照通道 + `src/common/organizeResult.ts` 纯函数 + `jsonLoose` 宽容提取 +
  图谱入口徽章（pendingCount）+ `aiErrorText` kind 文案单源。
- **T5 差异审阅面板**：`ProposalReviewDialog`（逐条 op/entity 徽标 + after 摘要 + 出处引用块 +
  overwritesHuman 橙警默认不勾 + 勾选→`confirmedOverwrite` 映射 + 采纳错误重读差分再重试 +
  applied 灰化防重放 + 徽章回落）。
- **T6 端到端证明 + 抛光 + 文档**：`bookStore/e2e-organize.test.ts`（假 `http.fetch` 全链：真 chatService ×
  真 provider 解析 × 真通道 × 真引擎，3 变更采纳四路落盘 + `PROPOSAL_DUPLICATE` 现场触发）；
  `readAiData` 扩 `meta:{name,synopsis}` 并接进大纲层（P1）；`proposal:save` 同章去重引擎闸门（P2）；
  多条目盖章测试（P3）；规约示例旗标改占位 false + 紧邻说明（P4）；BOOK_FORMAT §7 三件套正式化
  （summaries 键权威 / proposals 通道政策含 DUPLICATE / §7.5 T5 面板交互）（P5）；README +
  DEVELOPMENT M4b 行（P6）；本文（P7）；T0 结转小项（sanitizeIdleMs 0 值钉、closed 分支
  noteActivity 单测、feature 标签单源 `AI_FEATURE_LABELS` 收口「大纲整理/续写/审校」漂移）。

## M4b 期间裁定（评审定案；均可推翻，推翻前勿在别处另立口径）

1. **origin 机制 = `aiTouched?: string[]`（计划缺陷裁定）**：M2 schema 无 origin 字段，plan 的
   「origin:human」短语落空。裁定：人写 = 字段非空（string trim 非空/数组非空/number≠0/boolean true）
   且字段名不在该实体 `aiTouched`；AI 采纳成功时逐键记名。判定式已写进 BOOK_FORMAT §7.5。
2. **裁定 A：create×character/world 播种 `aiTouched` = 所写非空字段清单**——AI 产字段不得伪装人写，
   否则后续整理改自己建的卡也要旗标+确认（摩擦收口）。空值字段不入账（人后续填写天然是人写）。
3. **裁定 B：人手编辑 UI 不清 `aiTouched`**（人改过的 AI 字段仍算 AI 领地）——M4b 接受的欠保护，
   面板文案已如实声明；M4c 若用户可感再收口。
4. **I2 未知字段 = 整条拒（控制器改判）**：character/world/plotline/choice 的 update 命中 allowlist 外
   且非保留回显集的键 → `REFUSED: 未知字段 <key>`——静默丢弃会让 appliedIndexes 说谎。
   保留键回显（id/createdAt/updatedAt/aiTouched/status）照旧静默容忍。
5. **窄门欠账（接受，不修）**：foreshadow/summary/index 的 update 引擎按固定键集消费，未知兄弟键
   静默丢——与裁定 4 口径不一致，M4b 接受（T5 面板注释如实标注），结转 M4c 统一。
6. **盖章序（裁定 1）**：`buildProposalFromAi` 先把整理章 id 盖进每条 `source.chapterId`（覆写 AI
   幻觉值）**再**跑 `validateProposal`——反序则每条栽在 UUID 形状检查。出处唯一权威 = 触发章。
7. **空 changes 语义（裁定 2）**：AI 未发现可记录变更 → `empty` 分支：不落盘、不算错误、
   `message.info` 复位徽章（合法业务态，不生成「零条目提案文件」垃圾）。
8. **徽章点击 `e.preventDefault()`（T5 修复轮 I1）**：rc-segmented 的 label 默认动作会切视图，
   `stopPropagation` 拦不住原生行为——点徽章数字只开面板、视图保持写作；`preventDefault` +
   `stopPropagation` 双拦（机制已写进源码注释防再犯）。
9. **`PROPOSAL_DUPLICATE` 引擎闸门（T6 P2）**：`proposal:save` 落盘前扫存量——同章已有
   pending/partial 提案即拒（UI 按钮禁用只是防呆，双窗口各自在途的权威防线在通道层）；
   settled 存量不拦（消化完的章可再整理）。第三方直写 `.ai/proposals/` 不受闸门约束（交换区本意）。
10. **单空闲窗、TTFB 独立上限不做（T0）**：连接阶段一次性 45s + 流阶段逐活动续窗共用同一计时器；
    若要对「首字节前」另设更严上限需加阶段位——过度设计，缓议结转。
11. **`readAiData` 键权威（裁定 4 + P1）**：摘要映射以文件内 `chapterId/volumeId` 为键，
    缺失/非字符串兜底文件名 stem；index.json 顶层坏 → warn+{}、坏值键跳过；`meta:{name,synopsis}`
    为 book.json 投影（缺档静默、坏档 warn），useOrganize 把 synopsis 接进 `ContextInputs.outlineNotes`
    ——大纲层不再恒空。零校验零缓存零副作用的纯读纪律不变。
12. **update×index 的 `targetId` 为占位**（校验器要求 update 必携）：index 是全书单一派生总目录，
    值不参与语义，引擎忽略；entityId/chapterId 双 UUID + 存在性硬门（章存在性为引擎从严）。
13. **未配置 key 时整理入口 = 点击时校验 + toast，而非禁用置灰（终审裁定）**：spec §6 字面要求
    「未配置则禁用置灰」，实际实现为入口可点、点击时校验 `isConfigured`（view 侧等价式）并以
    中文 toast 指引去设置页。理由：状态更新鲜（置灰快照易与设置页实时改动脱节）、一次点击即得
    指引、不做 error-bombing（其余不可整理情形本就同走点击校验路径）。偏离 spec §6 在此记录并
    由控制器接受；M4c 若要求严格合规，把 `isConfigured` 折进 `organizeDisabled`（双门并单谓词）即可。

## M4c / M5 结转

- **窄门未知键一致性**（裁定 5）：引擎统一整条拒，或面板显式标注「该键不会被应用」——二选一收口。
- **settled 历史查看 UI**：消化后的提案文件仍在 `.ai/proposals/`（status=settled），面板/徽章目前
  只呈现未消化提案；「整理历史」浏览视图未建。
- **在途整理取消 UI**：`ai:cancel` 通道与 chatService 幂等 cancel 都在，`useOrganize` 未接渲染层
  取消按钮（180s 空闲窗内用户只能等）。
- **aiModel capture-at-send-time**：`resolveModelLabel(view)` 在解析完成后复算——设置中途被改会
  把「后一个模型名」盖到「前一个请求」的提案上。口径未定，M4c 决定（发时快照 vs 现算）。
  「2026-10-30 勘误：M4c-2 微批 #3 五跳取证判为幻影——view 为发前一次性 IPC 克隆快照，飞行中改设置不可见；详见 m4c2-closeout 继续结转 aiModel 条。」
- **多条目盖章测试**：✅ 已在 T6 P3 闭环（organizeResult 多 change 混合盖章 + 整份过校验）。
- **T0 结转小项**：✅ 已在 T6 sweep 闭环（sanitizeIdleMs 0 值 / closed 分支 noteActivity / 标签单源）。
- **M3 结转不动**：点击跳章节 UI、Monaco 光标/滚动恢复、实体卡面板定位——均未被 M4b 触碰，
  原样留在 M4c 清单。
- **M4c 本体**：剧情线/选项/伏笔录入面板、图谱 3-5 视图（`index.json` 消费侧跳章节联动）；
  **M5** ghost text 实时补全（`feature:'completion'` 白名单已就位）；**M6** 章节审阅（`review` 同上）。
- usage.jsonl 无界增长轮转（M4a 结转，未动）。
- **STABLE change-id 重构（M4c 第一优先）**：change 条目改用稳定 id 而非数组下标做采纳记账——
  一次消除三个耦合风险：位置式 `appliedIndexes` 在条目驳回删除后的漂移、`markSettled` 总失败时的
  重试双胞胎、跨窗口驳回重排导致索引错位。
- **prop-id 同毫秒碰撞（已论证无害，记录在案）**：`newProposalId` = 章前缀 + ts 的 36 进制，同毫秒
  双生成会同 id——DUPLICATE 闸门已挡住通道侧重复落盘、跨章 id 前缀天然不同、sync 处理器单线程无
  交错窗口；不作缺陷修，留档备查。
- **静态 `message.*` 遗留**：`ChapterTree` / `VolumeManager` / `AiSettingsSection` 仍用静态
  `message.*`（同 T6 冒烟②根因）——M4c 统一改 `App.useApp()`。
- **unsettled 谓词单源**：「未消化」判定（`status !== 'settled'`）散落在按钮禁用 / DUPLICATE 闸门 /
  徽章计数 / 导航分组等处——收口为 `src/common/proposal.ts` 导出的 `isUnsettled()` 单一权威。
- **离线 e2e 补一条 `overwritesHuman`**：`e2e-organize.test.ts` 脚本响应加一条 `overwritesHuman: true`
  的变更（走勾选→`confirmedOverwrite`→覆盖落盘全路）——把冒烟里 CDP-only 的覆盖人写路径变成 CI 回归。
- **面板文案范围修正**：「AI 只会改动它此前写过的字段」只对角色/设定（有 `aiTouched` 的实体）成立；
  伏笔/摘要/索引没有 `aiTouched`，该说法对它们构成 overclaim——改措辞限定适用范围。
- **`PROPOSAL_*` 错误码中文映射**：`PROPOSAL_DUPLICATE`/`PROPOSAL_INVALID`/`PROPOSAL_TOO_LARGE`/
  `BAD_PROPOSAL_ID` 等通道错误码目前原样入 toast——同 `aiErrorText` 口径建 kind→中文单源。
- **逐字引文正文内软校验（可辩论）**：`source.quote` 目前只校验非空/长度，不核「逐字来自正文」——
  可在 save 时对正文做包含性软校验（warn 不拦，防 AI 复述幻觉出处）；是否值得做留 M4c 辩论。

## 门禁证据

- `npm run typecheck` 0 错；`npx eslint .` 0 error（1 既有 warning：`src/renderer/index.tsx`
  react-refresh，M2 前遗留）；`npm run test` **627/627 全绿**（41 文件；基线 620 → +7：
  aiData +2（P1）/ proposal 通道 +1（P2）/ organizeResult +1（P3）/ organizePrompt +1（P4）/
  e2e 全链 +1 / providers closed 分支 +1（T0 结转；chatService 0 值钉并入既有用例）；
  另 M4b 全程 449→627 净增 178）；`npm run build` 通过。
- `e2e-organize.test.ts`：假 fetch 全链（Review Focus 1）——SSE 分片重组逐字节还原、
  模型解析取 `models.organize`、提案落盘、`PROPOSAL_DUPLICATE` 现场触发、3 条采纳四路落盘
  （角色 aiTouched 播种/摘要/index.json 合并/settled 记账）、readAiData 复读闭环回流。
- CDP 真机冒烟（Task 6 强制项）：dev 起 app + 演示书 `D:/tmp/测试/测试`，21 断言全绿
  （徽章=1 → 点数字面板开且视图保持写作[I1 回归面] → 2 条目橙警默认不勾 → 勾选采纳 →
  盘上角色/人写字段覆盖记名/提案 settled → 角色面板原地刷新 → 图谱节点出现 → console 零错误）。
  冒烟揪出并当场修复三处真机缺陷（静态审查全数漏网）：
  ① `ProposalReviewDialog` 的 `loadingDetail` 无闭合路径——详情区永转圈、变更条目永不渲染；
  ② 面板/useOrganize 用静态 `message.*` 触发 antd dev 告警（console.error）——改 `App.useApp()`；
  ③ `CharacterPanel`/`SettingPanel` 不订 `entityEvents`——采纳落的新实体不重开书面板不出现
  （主进程自写被 watcher 源头抑制，与 M3 FI-1 同因；补订阅）。
  逐步骤证据见 [`.superpowers/sdd/2026-10-28-m4b-organize-loop/task-6-report.md`](../../.superpowers/sdd/2026-10-28-m4b-organize-loop/task-6-report.md)。

## 人工冒烟义务（发起人）

1. **真 key 整理一次**（晨间冒烟项）：设置页配真实 provider → 打开有正文的章 → 「整理本章」→
   等待生成（长生成合法，空闲 180s 才判死）→ 徽章出现 → 面板逐条勾选 → 采纳 → 角色/设定面板与
   图谱出现新数据。成功路径离线侧已由 e2e + providers 测试钉死，本项验真网关兼容性。
2. 冒烟若遇失败：按 kind 中文归因 toast（aiErrorText 单源）截图回报；提案文件可在
   `.ai/proposals/` 手工取证（YAML，人可读）。
