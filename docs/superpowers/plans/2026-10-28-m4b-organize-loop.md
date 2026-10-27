# M4b：AI 整理闭环 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 兑现核心分工「基础人设人写、演化数据 AI 记、人确认」：写完一章点"整理本章"→ AI 产出结构化提案落 `.ai/proposals/` → 差异确认面板逐项采纳/驳回 → 采纳才经 bookStore 落盘（origin 标注 + 溯源引用），顺手建立实体-章节索引（M4c 跳章节与 M6 审阅的地基）。

**Architecture:** 提案即文件（崩溃不丢、第三方 AI 可读写）；变更应用一律走 M2 repository（守卫/缓存/监听全复用）；prompt 构造与提案 schema 全纯函数可单测；整理调用复用 M4a 流式通道（feature='organize'）。M4a 终审结转项（空闲超时等）作为 Task 0 先行。

**Tech Stack:** 既有栈，零新增依赖。

**Spec:** `docs/superpowers/specs/2026-10-28-m4-ai-loop-design.md`（G6/G7 + §4 提案即文件/origin 保护/结构化输出策略）；M4a 终审报告建议 1-6 为 Task 0 输入（结转清单见本计划 Task 0）。

## Global Constraints

- 零新增运行时依赖；typecheck 0（入 build）/ lint 0 error（1 既有 warning）/ vitest 全绿 / build ok；每任务一提交带 Co-Authored-By。
- 提案/摘要/索引全部在 `<book>/.ai/` 下；正式数据文件只经 bookStore repository 写。
- **origin 铁律**：`origin:'human'` 字段 AI 提案不得静默覆盖——update 变更携带 `overwritesHuman:true` 时差异面板默认不勾选且需显式确认；采纳引擎在 apply 时二次校验（面板状态过期→拒用该条并提示）。
- 提案 schema 校验失败 → 整份拒落（不落半套），带 `[provider] ` 前缀错误走 kind 协议。
- `.ai/` 路径定名（对表 M4a 终审 Minor 分歧）：**`.ai/index.json`（单文件，spec G7 原文为准）**；BOOK_FORMAT 若写 `index/` 由 Task 6 修正对齐。
- 渲染层不碰 fs；新通道组 `proposal:*` 走单一门面；错误一律 `[kind] ` 前缀 + parseKindTaggedError 消费。
- 现状基线：main=M4a 后，vitest 449。

## Review Focus

1. **整理全链路离线可证**：假 fetch 注入固定整理响应 JSON → chat→解析→提案落盘→采纳→repository 状态变化，e2e 测试必须存在且判别（Task 6）。
2. **origin 保护两面夹击**：面板默认态（overwritesHuman 不勾选）+ 引擎 apply 再校验（过期勾选→拒用）；测试各钉（Task 3/5）。
3. **提案文件对抗输入**：手改坏/半截 YAML、changes 空数组、op 未知枚举、targetId 悬挂——readProposal 全部拒用或整条跳过并 warn，绝不崩 UI（Task 1/3）。
4. **长整理生成不被腰斩**：Task 0 空闲超时落地后，>30s 假流式 fixture 不 abort（Task 0 测试）。
5. **pending 徽章与数据一致**：采纳/驳回/删提案后徽章计数与盘上 pending 数实时一致（Task 4/5 冒烟项）。

---

### Task 0: M4a 终审结转收口（超时语义 + 单源常量 + 占位符 + 刷新）

**Files:**
- Modify: `electron/main/ai/providers/http.ts`（linkSignal 空闲重置）、`providers/types.ts`（ProviderChatOptions 加 idleMs 语义注释）
- Modify: `src/common/ai-types.ts`（AiChatRequest 加 `timeoutMs?: number`；导出 `AI_FEATURES: readonly AiFeature[]`）
- Modify: `electron/main/ai/chatService.ts`（透传 timeoutMs；VALID_FEATURES 改用 AI_FEATURES；默认超时 120_000 空闲语义）
- Modify: `electron/main/ai/usage.ts`、`src/renderer/components/Settings/AiSettingsSection.tsx`、`StatsPanel.tsx`（FEATURES 数组改引 AI_FEATURES）
- Modify: `AiSettingsSection.tsx`（baseUrl 占位符随协议切换：openai→`https://api.openai.com/v1`，anthropic→`https://api.anthropic.com`）
- Modify: `src/renderer/hooks/useAI.ts`（onDone 回调后 fire-and-forget 通知 StatsPanel 刷新：复用 entityEvents 同款 emitter 加 `notifyUsageChanged()` 调用，一行级）
- Modify: `README.md`（"实时汇总"措辞对齐实际刷新时机）
- Test: http/chatService/useAI 相关既有用例更新 + 新增空闲重置判别用例

**Interfaces:** `linkSignal` 语义变更：`timeoutMs` 含义从"总时长"改为"空闲上限"（每次 onChunk 与每次 body read 重置计时器；连接建立前不重置）；`DEFAULT_IDLE_MS = 45_000`（chat），testConnection 保持 30_000 总时长不变（其内部走同一 linkSignal 但无 chunk 流，语义自然退化为总时长——注释说明）。`AI_FEATURES = ['organize','completion','review'] as const`。

- [ ] Step 1: 失败测试：假 fetch 返回每 10ms 一个 chunk、持续 5s 的流 + idleMs=100 → 不 abort 完成；同流静默 200ms → abort 'timeout'。
- [ ] Step 2: 实现 → PASS；AI_FEATURES 单源替换（typecheck 兜底 Record 映射，数组消费点全改引用）。
- [ ] Step 3: 占位符切换 + usage-changed 刷新 + README 措辞。
- [ ] Step 4: 全门 + Commit `fix(ai): idle-reset timeouts, single-source features list, protocol-aware placeholders`。

### Task 1: 提案 schema 与校验（纯函数）

**Files:**
- Create: `src/common/proposal.ts` + `proposal.test.ts`

**Interfaces:**
```ts
export type ProposalEntity = 'character'|'world'|'plotline'|'choice'|'foreshadow'|'summary'|'index'
export type ProposalOp = 'create'|'update'|'delete'
export interface ProposalChange { op: ProposalOp; entity: ProposalEntity; targetId?: string; after?: unknown; source: { chapterId: string; quote: string }; overwritesHuman?: boolean }
export interface ProposalFile { id: string; chapterId: string; createdAt: string; aiModel: string; status: 'pending'|'partial'|'settled'; changes: ProposalChange[] }
export function validateProposal(v: unknown): string[]           // 文件级：必填/枚举/changes 非空数组
export function validateChange(v: unknown): string[]             // 条目级：op×entity 合法组合表；create 必有 after；update 必有 targetId+after；delete 必有 targetId；source.quote 非空
export function proposalPath(bookDir: string, id: string): string // `.ai/proposals/${id}.yaml` — 纯字符串拼接
export function newProposalId(chapterId: string, ts: number): string // `prop-${chapterId.slice(0,8)}-${ts36}`
```
- op×entity 组合表钉死：create 允许 character/world/plotline/choice/foreshadow/summary；update 允许 character/world/plotline/choice/foreshadow/summary/index；delete 允许 plotline/choice/foreshadow（角色/设定/章不级联删——AI 无权删人写法，钉 spec 分工）。
- Test: 合法样例、changes 空、未知 op、delete character 拒绝、quote 空拒绝、round-trip（js-yaml dump→load→validate 过）。

- [ ] Steps: TDD → 实现 → 全门 → Commit `feat(proposal): proposal schema and validators`。

### Task 2: 整理 prompt 构造（纯函数）

**Files:**
- Create: `electron/main/ai/organize/prompt.ts` + `prompt.test.ts`（或放 src/common——裁定：src/common/organizePrompt.ts，纯且可被测试直 import）

**Interfaces:**
- `buildOrganizePrompt(args: { assembled: AssembledContext; chapterTitle: string; pendingForeshadows: ForeshadowEntry[] }): AiMessage[]`——在 assembled.messages 的 system 骨架后追加输出规约段：提案 JSON schema（changes 数组、允许 op×entity 组合、quote ≤120 字必须原文逐字、origin:'human' 字段变更必须 overwritesHuman:true、禁止 delete character/world）、`pendingForeshadows` 清单（要求核销判断）、"只输出 JSON"指令。
- `budgetToMaxTokens(budgetTokens: number): number`（= budget 的补量到模型上限的映射，夹 [1024, 16384]）。
- Test: 输出含 schema 关键 token（`"op"`、组合表、overwritesHuman 规则原文）；红线——prompt 全文不含任何非当前章 SENTINEL（复用 T5 fixture 思路）；messages 结构 system+user 各一。

- [ ] Steps: TDD → 实现 → 全门 → Commit `feat(organize): organize-prompt builder with proposal contract`。

### Task 3: 提案仓库（主进程 bookStore/proposals + 采纳引擎）

**Files:**
- Create: `electron/main/bookStore/proposals.ts` + `proposals.test.ts`
- Create: `electron/main/bookStore/adopt.ts` + `adopt.test.ts`
- Modify: `electron/main/ipc/modules/proposal.ts`（新）+ `handlers.ts` 注册 + `src/common/ipc.ts`/preload/useIPC（`proposal:getAll/get/adopt/reject/discard` 通道；`AiFeature` 已有）

**Interfaces:**
- proposals.ts：`listProposals(p): ProposalFile[]`（坏文件 skip+warn）；`getProposal(p,id)`；`writeProposal(p, file)`（validateProposal 前置 + 原子写）；`deleteProposal(p,id): boolean`；`markSettled(p,id,status)`。
- adopt.ts：`adoptChanges(p, proposalId, changeIndexes: number[]): {applied: number[]; refused: {index,reason}[]}`——逐条：重读当前正式数据 → **origin 二次校验**（update 命中 origin:'human' 字段且非 overwritesHuman:true → refused；overwritesHuman 条目要求 UI 已确认标志，由通道参数 `confirmedOverwrite:number[]` 携带）→ 经对应 repository 落盘（create 走 seed+update 组合；summary/index 落 `.ai/summaries/chapters/<chapterId>.yaml` 与 `.ai/index.json`）→ 提案剩余条目 status 更新（全清 settled，部分 partial，无剩 pending→settled）。
- 通道：`proposal:adopt {projectPath, proposalId, changeIndexes, confirmedOverwrite}` → 结果对象（refused 原因含 kind 前缀风格中文）。
- Test（tmp 书目录 + 真 repository）：create character 提案采纳 → listCharacters 出现；update 人写 personality 无 overwritesHuman → refused；带 overwritesHuman+confirmed → 落盘且 origin 变 'ai'；summary/index 落盘形状；坏提案文件 skip；delete character op 在 validateChange 已拒（引擎层双保险）。

- [ ] Steps: TDD → 实现 → 接线 → 全门 → Commit `feat(proposals): proposal store and origin-guarded adopt engine`。

### Task 4: "整理本章"触发链（按钮→chat→提案落盘→徽章）

**Files:**
- Modify: `src/renderer/components/Editor/EditorToolbar.tsx`（整理按钮 + pending 徽章）
- Create: `src/renderer/pages/Workspace/hooks/useOrganize.ts`
- Modify: `src/renderer/pages/Workspace/index.tsx`（装配）；`electron/main/ipc/modules/proposal.ts`（加 `proposal:organizeContext {projectPath, chapterId}` 一次性返回 {assembled inputs 原料：summaries/index/cards/pendingForeshadows}——或复用既有 getAll* 通道在渲染层组装。**裁定：渲染层组装**，复用既有通道，零新读通道）

**Interfaces:**
- 新只读通道（本任务补，渲染层组装上下文的原料缺口）：`book:readAiData {projectPath}: Promise<{ chapterSummaries: Record<string,string>; volumeSummaries: Record<string,string>; entityIndex: Record<string,string[]> }>`——主进程读 `.ai/summaries/**` 与 `.ai/index.json`（缺文件=空对象；坏文件 warn+skip），纯读零校验。preload/useIPC 同步接线（`useAiData()` 或直接 getAiData 函数）。
- `useOrganize(deps)` → `{organize(chapterId), organizing:boolean, pendingCount:number, refreshPending()}`：组 ContextInputs（getAllChapters/Characters/Settings + getAiData + proposal:getAll）→ assembleAiContext（渲染层 import src/common 纯函数）→ buildOrganizePrompt → useAI.chat(feature 'organize', timeoutMs 空闲 120s 由 T0 支持) → onDone 全文 → extractJsonLoose（**裁定：从 electron/main/ai/providers 移到 src/common/jsonLoose.ts**，主/渲染共用，providers 改 import）→ validateProposal → `proposal:save {projectPath, file}`（新通道：主进程再校验+落盘——双校验姿态）→ 徽章+1 + notifyEntitiesChanged。错误路径：kind 路由中文 toast；organizing 中按钮 loading 禁用。
- Test: jsonLoose 迁移后 providers 测试全绿；readAiData 主进程 tmp 测试（缺/坏/正常三态）；useOrganize 无 jsdom——静态走查 + CDP 冒烟（Task 6）覆盖。

- [ ] Steps: jsonLoose 迁移 → hook → 按钮/徽章 → 全门 → Commit `feat(organize): organize-this-chapter pipeline with proposal badge`。

### Task 5: 差异确认面板

**Files:**
- Create: `src/renderer/components/Dialogs/ProposalReviewDialog.tsx` + 样式（token 化）
- Modify: `Workspace/index.tsx`（打开入口：徽章点击）、`proposal:*` 消费

**Interfaces:** 列表渲染 changes：每条 op/entity 徽标 + after 摘要（截 120 字）+ quote 引用块 + 勾选框；overwritesHuman 条目默认不勾 + 橙字警示「将覆盖你手写的值」；按钮 采纳勾选 / 驳回勾选（=proposal:reject 删条目或整件）/ 关闭（保留 pending）。空勾选时采纳按钮禁用。确认后 pendingCount 刷新 + notifyEntitiesChanged（图表面板联动）。
- Test: 纯展示——typecheck/lint + CDP 冒烟（Task 6 步骤内）。

- [ ] Steps: 实现 → 接线 → 全门 → Commit `feat(proposals): diff review dialog with origin warnings`。

### Task 6: 端到端离线链路 + 文档 + 收尾

**Files:**
- Create: `electron/main/bookStore/e2e-organize.test.ts`（假 fetch 全链）
- Modify: `docs/BOOK_FORMAT.md`（.ai/proposals/、.ai/summaries/、.ai/index.json 正式化——**index 路径统一为 index.json**，修 M4a 遗留分歧；提案 YAML 示例；origin 语义）
- Modify: `README.md`、`docs/DEVELOPMENT.md`（M4b 行 + 真实测试数）
- Create: `docs/superpowers/plans/2026-10-28-m4b-closeout.md`

**CDP 冒烟（强制，证据进报告）**：dev 起应用 → 打开演示书 → 未配置 key 时"整理本章"置灰+提示 →（用 setSettings 配假 baseUrl）→ 点击整理 → 网络错误中文 toast（kind 路由）→ 手工写一个合法 pending 提案 yaml 进 `.ai/proposals/` → 重载书 → 徽章=1 → 打开差异面板 → 勾 1 条采纳 → 徽章=0、角色面板出现新角色、图刷新（entityEvents）→ 面板对 overwritesHuman 条目默认不勾+橙警。全程 console 无未捕获错误。
**e2e 测试**：vi.mock http.fetch 返回整理响应（含 3 变更：create character / update summary / foreshadow plant）→ 走 useOrganize 等价主进程链（chatService+proposal:save）→ adopt → 断言 characters/foreshadow/summaries/index 四路落盘正确。

- [ ] Steps: e2e → 文档 → CDP 冒烟 → 全门 → Commit `feat(m4b): end-to-end organize pipeline tests, docs and closeout`。

---

## M4b 完成定义（DoD）

- 整理链全通：按钮→AI（假 fetch 可复演）→提案落盘→面板→采纳→四路数据正确；origin 铁律两面夹击有测试。
- 提案文件对抗输入（坏/半截/未知枚举）不崩不污染。
- 空闲超时落地：>30s 慢流不 abort（Task 0 测试）；长整理生成可用。
- `.ai/` 三件套（proposals/summaries/index.json）进 BOOK_FORMAT 正式规范，路径分歧清零。
- 徽章/面板/图三方联动（entityEvents 复用）。
- 全门绿；CDP 冒烟证据在案；真 key 整理一次 = 发起人晨间冒烟项（清单写 closeout）。
- **不做**（M4c）：点击跳章节 UI、剧情线/选项/伏笔录入面板、图谱 3-5 视图、章节审阅。
