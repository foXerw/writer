# M4：AI 维护闭环 设计文档（AI 代拟，待发起人复核）

日期：2026-10-28 ｜ 状态：发起人授权 AI 代定设计并开发（2026-10-27"你来设定后进行开发"、2026-10-28"继续后面的开发"）；⚑ 选择均可推翻
上游规格：`2026-10-25-perfect-novel-repositioning-design.md` §7.3（维护闭环）、§7.4（分层上下文）、§8（M4 行）
依赖：M2 数据基石（bookStore/refs/提案目录预留）、M3 图谱（entityEvents 刷新腿、索引解锁点击跳章节）

## 1. 意图

兑现核心分工：**基础人设人写，演化数据 AI 记、人确认**。写完一章点"整理本章"，AI 读完产出结构化差异提案；作者逐项采纳/驳回；采纳才落盘，且每条 AI 数据带"出自第几章+原文引用"可溯源。同时建成 AI 服务层（双协议 BYOK + token 分账 + 分层上下文），为 M5 补全/M6 审阅铺路。

M4 体量大，拆三个子里程碑按序交付：
- **M4a AI 服务层**（本计划先行）：provider 抽象、密钥配置、流式通道、token 账本、分层上下文装配、联网前安全硬化。可全离线开发（假 provider 测试）。
- **M4b 整理闭环**：整理本章→提案→差异确认 UI→带溯源落盘→实体-章节索引。live 联调需发起人填 key。
- **M4c 录入与图点亮**：剧情线/选项/伏笔录入面板 + 图谱第三~五种视图 + 索引驱动的"点击跳章节"。

## 2. 目标

- G1 双协议 provider：`openai`（兼容 /chat/completions，覆盖 DeepSeek/通义/OpenRouter/Ollama）与 `anthropic`（原生 messages API）；设置页 Base URL + Key + 模型名，按功能（整理/补全/审阅）留独立模型槽（M1 裁定），MVP 界面只暴露一套默认+可选覆盖。
- G2 密钥安全姿态：key 存 userData 明文配置（发起人裁定，随大流）；**AI 调用一律在主进程发起**，渲染进程只传请求意图，key 永不进渲染进程/不出网络请求日志。
- G3 流式响应：主进程→渲染进程按 requestId 分块推送，监听器精确移除（不重蹈 M1 前 removeAllListeners 覆辙）。
- G4 token 分账：每请求记 `{feature, model, promptTokens, completionTokens, cachedTokens?}` 入 `<book>/.ai/usage.jsonl`（JSONL 追加，纯文件、人可读）；统计面板显示"按功能累计/按模型累计"。
- G5 分层上下文装配器（纯函数、可单测）：全书大纲线 + 当前卷梗概 + 最近 N 章摘要 + 当前章正文 + 涉事实体卡（经实体-章节索引精确捞取），任何请求不"全量读全书"（spec §7.4 红线）；输出带 token 预算上限与截断策略（远端摘要优先保留、近端正文保底）。
- G6 整理闭环（M4b）：手动"整理本章"→ AI 产出提案（JSON，schema 校验）→ 落 `.ai/proposals/<id>.yaml` → 图谱/工具栏"待确认 N"徽章 → 差异确认面板逐项 采纳/驳回/修改后采纳 → 采纳才写正式文件；每条提案带 `source: {chapterId, quote}`；AI 写入的字段带 `origin:'ai'`（人写默认 `'human'`，AI 提案**永不覆盖 origin:'human' 的字段**——"AI 不许动作者法典"裁定）。
- G7 实体-章节索引：`.ai/index.json`（实体 id → 出场章节 id 集 + 伏笔埋点/回收位置），整理闭环顺手维护；解锁 M3 遗留"点击跳章节"与伏笔未回收对账视图。
- G8 联网前安全硬化（前置门槛）：移除 dev 的 disable-web-security/allow-running-insecure-content/allow-file-access-from-files 三开关；导出隐藏窗显式安全 webPreferences。

## 3. 非目标

- ❌ 自动/静默整理（每章保存就调 AI）——MVP 手动触发（spec §7.3 防打扰裁定）；自动化留 M5+ 讨论。
- ❌ 内置模型代理/额度/计费——纯 BYOK。
- ❌ 实时补全（M5）与章节审阅（M6）的 UI——M4 只把服务层与上下文器铺到能支持它们。
- ❌ 提案冲突的三方合并（AI 提案 vs 人已改）——差异确认 UI 逐项人工裁决即可，不做自动合并。
- ❌ 多 provider 路由/故障转移/重试编排——单 active provider，失败就报错给用户（简单>聪明）。
- ❌ 向量检索/embedding——索引用精确匹配（名字/别名扫描），写作场景实体量小，AI 整理本身承担消歧。

## 4. 关键设计选择（⚑ 均可推翻）

- ⚑ **AI 全部在主进程**：provider 客户端、密钥、流式转发、账本落盘都在 electron/main/ai/*。渲染进程经门面 `ai:chat(requestId, intent)` + `ai:chunk/done/error` 事件通信。理由：密钥隔离、无 CORS、文件账本顺手；M1 体检已定此方向。
- ⚑ **提案即文件**（`.ai/proposals/*.yaml`），非数据库非内存态：崩溃不丢、第三方 AI（Claude Code）能直接读写、驳回=删文件。提案 schema：`{id, chapterId, createdAt, status:'pending', changes:[{op:'create'|'update'|'delete', entity:'character'|'world'|'plotline'|'choice'|'foreshadow'|'index'|'summary', targetId?, before?, after, source:{quote}}]}`；changes 逐条可独立采纳/驳回（一条提案=一章整理的所有变更，拆条裁决）。
- ⚑ **origin 保护规则**：update 类变更若目标字段现值 `origin:'human'`，差异面板标黄"将覆盖你手写的值"并默认不勾选——人仍有权覆盖，但 AI 绝不"静默改人写内容"（spec 反目标"填表/黑箱"的机制化）。
- ⚑ **token 估算**：不引 tokenizer 库，用启发式（CJK 字符≈1 token、拉丁≈4 字符/token）做预算裁剪；**真实用量以 provider 响应的 usage 字段为准**记账（估算只用于请求前裁剪，误差可接受）。
- ⚑ **结构化输出策略**：不赌各家 JSON mode 差异——统一在 prompt 里要求"只输出 JSON"，主进程做防御性解析（剥 ```json 围栏、截取首尾花括号、schema 校验失败→带错误重试一次→仍败则报错给用户，绝不落半套提案）。
- ⚑ **账本 JSONL 而非聚合文件**：追加写无读-改-写竞态、崩溃安全、第三方友好；UI 聚合展示时现算（单书几千行无压力）。
- ⚑ **模型默认建议值**：整理=claude-opus-5-5/同档（质量优先，发起人"最高质量"裁定），补全槽留快模型位（M5 用）；配置界面给推荐注释但不锁定。

## 5. 架构与文件划分（M4a 为主）

```
electron/main/ai/
  settings.ts        # userData/ai-settings.json 读写（含 key），缺文件=未配置
  provider.ts        # ProviderAdapter 接口 + openai.ts/anthropic.ts 两实现（fetch，SSE 流解析）
  chatService.ts     # ipcMain 入口：ai:chat→按 requestId 流式转发 chunk/done/error；记账落 usage.jsonl
  usage.ts           # 账本 append + 聚合查询
  context/
    assembler.ts     # G5 分层上下文装配（纯函数，输入 book 数据+预算，输出 messages[]）
    estimate.ts      # token 启发式估算（纯函数）
src/common/
  ai-types.ts        # 门面类型：AiChatRequest/AiChunk/AiUsageRecord/AiSettings（主/渲染共用）
src/renderer/
  pages/Settings/AiSettingsSection.tsx   # 协议/BaseURL/Key/模型 + 连接测试按钮
  components/Explorer/StatsPanel 增 token 分账区块
```

M4b/M4c 文件（提案仓库/差异确认面板/录入面板/图视图扩展）在各自计划中展开。

## 6. 约束

- 渲染进程零接触 key 与网络；门面新增 `ai:*` 通道组（唯一允许的新通道面）；preload 仍单一 `window.novelWriter`。
- 未配置 key 时：所有 AI 入口禁用置灰 + "先在设置配置 AI"引导，不弹错误轰炸。
- 提案/账本/摘要全部落在 `<book>/.ai/`（M2 BOOK_FORMAT 已预留该目录为 AI 区，正式文件区零污染）。
- 先做 G8 安全硬化再接任何网络代码（顺序硬约束）。
- 全部门禁沿用：typecheck 0 / lint 0 error / vitest / build；测试用**假 provider**（固定 fixture），不依赖网络与真实 key。
- 中文文案；每任务提交带 Co-Authored-By。

## 7. 验收（M4a DoD）

- 设置页可配 协议/BaseURL/Key/模型，保存后主进程生效（连接测试按钮分别打两协议的 models/minimal 端点，成功/失败有明确回显）。
- 假 provider 下：ai:chat 流式回传按 requestId 隔离、done/error 后监听器无泄漏；usage.jsonl 追加记录、统计面板聚合正确。
- 上下文装配器单测：给定 fixture 书（3 卷 30 章 20 角色），预算内产出 messages 含大纲线+当前卷梗概+近 3 章摘要+当前章+涉事实体卡，且**不含**任何非涉实体的整卡、绝不整书塞入；超预算时按优先级降级（先砍远章摘要、再砍非关键实体卡、正文保底）。
- dev 三开关移除后应用功能无回归（导出/加载本地资源正常）；导出隐藏窗安全参数生效。
- 无 key 时所有 AI 入口禁用；配置错误 key 时报错可读（区分 401/网络/超时）。
- 人工冒烟（发起人）：填真实 key→连接测试通过→（M4b 后）整理一章看账本。

## 8. M4b/M4c 验收（各自计划展开，此处从略）

M4b：整理一章→提案落盘→差异面板逐条采纳/驳回→正式文件更新且 origin 保护生效→重开应用 pending 提案仍在→索引正确。
M4c：三种录入面板 CRUD→图五视图点亮（数据成熟者先行）→点节点跳章节（索引驱动）。
