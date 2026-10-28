# M4c-1：稳定变更标识（change-id）重构 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 用稳定 `cid` 取代位置索引作为提案变更的记账主键，一次消除 M4b 终审点名的三个耦合风险：position-based appliedIndexes 漂移、markSettled 整批失败窗内的重试双胞胎、跨窗口 reject 重排后的陈旧勾选。

**Architecture:** `ProposalChange.cid?: string`（校验宽容：缺省合法——旧文件/第三方文件不炸）；`buildProposalFromAi`（T4 纯函数）为每条变更盖章 `cid = randomUUID()`；adopt 引擎记账主键改为 `cid ?? 'idx:<n>'` 合成稳定键（`appliedCids: string[]` 与既有 `appliedIndexes` 并存过渡：markSettled 同时写两者，读侧优先 appliedCids）；reject 按 cid 摘除、不再需要位置重映射；面板勾选集从 index 改为 cid（legacy 无 cid 条目回退 `idx:<n>` 键并在引擎侧同样回退——两侧口径单源：`changeKey(change, index)` 导出自 proposal.ts）。

**Tech Stack:** 既有栈，零新依赖。

**Spec:** `docs/superpowers/specs/2026-10-28-m4-ai-loop-design.md` §4 提案即文件；m4b closeout 裁定「stable change-id 为 M4c 首项」。

## Global Constraints

- 旧提案文件（无 cid、只有 appliedIndexes）必须照常可读、可采纳、可驳回——向后兼容是硬门（BOOK_FORMAT 已对外发布，第三方可能手写提案）。
- `changeKey()` 是键计算唯一来源：引擎、面板、markSettled、reject 全部消费它，禁止第二处内联 `idx:` 字面量。
- 双写 `appliedCids`+`appliedIndexes` 期间，二者语义必须一致（appliedIndexes 仅在文件内 changes 未变时可信；markSettled 在同一原子写里更新两者）。
- 重试幂等性目标测试：模拟 markSettled 抛穿后重试同一批（同 cids）→ 引擎按 appliedCids 判"已采纳"拒重放（旧世界这里会双胞胎）。
- 门禁：typecheck 0 / lint 0 new / vitest 627 基线全绿+新增 / build；单提交带 Co-Authored-By。

## Review Focus

1. **legacy 文件全链路**：无 cid + 只有 appliedIndexes 的提案 → 面板渲染（回退键）、采纳（拒已应用）、驳回（重排后回退键变化 = 旧已应用条目可能因位置移动而"复活"？——必须证明：驳回触发的 changes 收缩会把 appliedIndexes 同步重映射（既有逻辑），且 markSettled 双写后 appliedCids 成为权威，回退键仅对从未双写过的新文件生效——把这条推理钉成测试）。
2. **重试双胞胎回归**：markSettled 失败模拟（只 mock 记账写、实体写真实）→ 重试 → create 不双胞胎（appliedCids 挡住）。这是本次重构的存在理由，必须有判别性测试。
3. **changeKey 单源**：grep 全仓 `idx:` 字面量只允许出现在 proposal.ts 定义处。
4. **面板状态纪律不回退**：T5 的 reject→清零重读、applied 灰化不可勾、越界夹取在 cid 化后语义等价或更强（越界夹取可退役——cid 不存在越界；若退役，跨窗 reject 后旧勾选 cid 已不在 changes → 引擎按未知键 REFUSED，证明该路径仍安全并钉测试）。
5. **BOOK_FORMAT 同步**：§7.2 字段表加 cid?/appliedCids?，示例 YAML 更新，legacy 双写口径写明（第三方照文档写文件仍被接受）。

---

### Task 1: cid 全链路（schema → 盖章 → 引擎 → 面板 → 文档）

**Files:**
- Modify: `src/common/proposal.ts`（ProposalChange.cid?、ProposalFile.appliedCids?、`export function changeKey(c: ProposalChange, index: number): string`、validateChange 宽容校验 cid 非空字符串、validateProposal 对 appliedCids 数组形状校验）+ test 扩展
- Modify: `src/common/organizeResult.ts`（盖章时注入 cid）+ test 断言
- Modify: `electron/main/bookStore/adopt.ts`（applied 判定/记账改 changeKey 域；markSettled 双写；reject 按 key 摘除 + appliedIndexes 同步收缩；已采纳守卫读 appliedCids∪重映射后的 appliedIndexes）+ test 扩展（含重试双胞胎判别）
- Modify: `src/renderer/components/Dialogs/ProposalReviewDialog.tsx`（checked 集合 index→key；applied 灰化用 key；越界夹取退役改未知键拒——保留 filter 防御亦可，报告说明选择）+ `src/renderer/pages/Workspace/index.tsx` 若涉
- Modify: `docs/BOOK_FORMAT.md` §7.2（字段表/示例/双写口径）
- Test: 上述各 test 文件

**关键设计（实现者可细化但语义不得偏离）：**
- `changeKey = c.cid ?? 'idx:' + index`。
- markSettled 签名扩展：接收本次批次的 key 集；写 `appliedCids = union(existing, batch)` 且 `appliedIndexes = 由 appliedCids 对当前 changes 重算的位置投影`（对无 cid 文件二者恒等，兼容旧读者）。
- 引擎"已采纳"守卫：`isApplied(change, i, file) = file.appliedCids?.includes(key) || (file.appliedCids === undefined && file.appliedIndexes?.includes(i))`——纯旧文件走位置投影（其语义在旧世界已正确），一旦任何批次写过 appliedCids 即永久转 cid 权威。
- DUPLICATE/TOO_LARGE/谓词单源（m4b 结转 d 项 `isUnsettled()`）**顺手做掉**：proposal.ts 导出 `isUnsettled(p) = p.status !== 'settled'`，三处拷贝改引用。

**Steps:**
- [ ] 1. 先写失败测试：(a) 重试双胞胎判别（markSettled mock 抛→实体已落盘→appliedCids 未写→重试→**当前实现会双胞胎**？不——旧实现 appliedIndexes 也未写，重试确实双胞胎；新实现同样未写 appliedCids……注意：判别测试的正确形态是 markSettled 成功后的二次采纳被拒（已有）+ **reject 重排后旧勾选 index 不再错杀/错放**（新测试：3 条 changes 采纳第 2 条→外部 reject 第 1 条→重排→按 cid 重试第 3 条→不误拒不误放；旧位置世界此测试语义会错位——用它做 RED 证据）；(b) legacy 文件（无 cid 仅 appliedIndexes）三操作全链路；(c) changeKey 单源 grep 门；(d) isUnsettled 三消费点。
- [ ] 2. RED 留证 → 实现 → GREEN；全量 627+新增 绿。
- [ ] 3. CDP 快验（可选加分）：seed 一个带 cid 的 pending 提案 → 面板采纳 → 盘上 appliedCids+appliedIndexes 双写正确。
- [ ] 4. BOOK_FORMAT 同步 + 全门 + Commit `refactor(proposal): stable change-id keys with legacy position fallback`。

---

## DoD

- 新提案全链路 cid 权威；旧文件位置投影兼容且推理入测试；markSettled 后重试/重排场景键稳定。
- changeKey/isUnsettled 单源；BOOK_FORMAT 与实现零漂移；627+新增全绿。
