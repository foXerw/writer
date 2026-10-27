# M4a 收尾记录（AI 服务层）

日期：2026-10-28 ｜ 分支：feat/m4a-ai-service-layer（1a4e6b0..ddba04c 十提交 = T1–T5 含三轮复审整改，
T6 收口提交随本文档入库）
计划：`2026-10-28-m4a-ai-service-layer.md` ｜ DoD 见该文件末节（全部达成，人工真 key 冒烟留发起人）

## 交付面

- **T1 安全硬化**：dev 三免安全开关移除 + 导出隐藏窗收紧（联网代码前置条件），CDP 活体全绿。
- **T2 设置保险库**：`src/common/ai-types.ts`（双进程共享类型 + maskKey/isConfigured）；
  `electron/main/ai/settings.ts`（明文 apiKey 只在主进程 `userData/ai-settings.json`；坏文件回退默认
  绝不抛、日志绝不回显内容）；`ai:getSettings/setSettings/testConnection` 三通道（返回值永远掩码视图）；
  设置页「AI 服务」区块（留空=不修改）。
- **T3 双协议 provider**：`electron/main/ai/providers/`（openai 兼容 + anthropic），SSE 增量解析、
  超时/取消归因、401/403→auth；错误消息远端文本一律先脱敏后截断（redact-before-truncate）。
- **T4 流式对话通道 + 账本**：`chatService.ts`（requestId 隔离/busy 闸/幂等 cancel/终态 settled 守卫）、
  `ai:chunk/ai:done/ai:error` 定向事件、渲染层 `useAI`（handlerMap 分发 + `parseKindTaggedError`）；
  按书 `.ai/usage.jsonl` 账本 + `ai:getUsage` 聚合 + StatsPanel「AI 用量」区块。
- **T5 上下文装配器**：`src/common/ai-context.ts` 纯函数（分层优先级 + token 预算 + 尾部裁剪），
  红线测试钉死「正文优先、绝不静默丢关键层」。
- **T6 连接测试闭环 + 清除密钥**：`ai:testConnection` 真接 provider（openai `GET /models` 报首条模型、
  anthropic 1-token 最小调用）；错误跨 IPC 带 `[kind] ` 前缀、UI 用 `parseKindTaggedError` 分类中文归因
  （auth/network/timeout/not-configured/provider/cancelled/busy 全覆盖）；受理侧 feature 白名单
  （organize/completion/review 之外 `[provider]` 同步拒，先于账本）；`clearApiKey` 显式清除通道 +
  设置页「清除密钥」Popconfirm；StatsPanel 读取失败与「读取中」「暂无用量」三态分离；
  测试按钮无已存密钥时置灰、pending 期 loading。

## 本里程碑裁定（评审中定案；均可推翻）

1. **IPC-unwrap 协议**（T4 复审 Important）：`ipcMain.handle` 的 reject 到渲染层永远被裹
   `Error invoking remote method '…': Error: …`，裸锚定匹配 `[kind]` 在真实边界必失配。裁定：渲染层
   一律经导出函数 `parseKindTaggedError`（先剥包装、裁尾部 stack 行、再锚定解析），**绝不**对原始
   message 做子串匹配。主进程对应纪律：handler 边界 throw 前把 `AiCallError.kind` 重编进
   `[\`kind\`] ` 前缀（kind 属性本身跨不过序列化）。Task 6 的 testConnection 遵守同一协议。
2. **脱敏不变量**（T3 复审 FOLD）：任何远端字符串（401 响应体/流内 error 事件）进入错误 message 前
   先 `redactKey` 再截 300——反序时恰好横跨截断线的密钥只留前缀碎片，之后再也遮不掉。
3. **wordCount CJK 码点修正**（T5 复审 Important，**行为变化**）：旧字面量把第三段区间写误为
   `U+4E00–U+FAFF`（连片），谚文（U+AC00–D7AF）与彝文（U+A000–A4CF）被当汉字计数。修正后含
   韩文/彝文的字数统计与 AI token 估算**下降**（更准确口径）；受影响者为用户可见行为变化，特此记账。
4. **清除密钥走 `clearApiKey:true` 显式哨兵**（T2 复审裁定；T6 落地）：空串 apiKey 已是「不修改」
   语义、不能一字段两义；`=== true` 严格判定（falsy 不动语义），与非空 apiKey 同现时清除优先。
5. **只读画布等 M3 结转项 M4a 一律未动**：图谱写交互、Monaco viewState、实体卡定位仍按
   M3 closeout 清单留 M4 后续片（M4b/c），本片零触碰不稀释。

## M4b 结转/待办

- StatsPanel 在 `ai:done` 后即时刷用量（一行事件订阅，当前只靠 entityEvents/换书拉）。
- usage.jsonl 无界增长：个人尺度可接受，M4b+ 加轮转或按月分文件。
- **已在本片闭环**：settled 终态守卫（T4 修复轮）、代理对劈半修复（T5 修复轮
  `longestTailToFit` 码点感知）、StatsPanel 错误态（T6）、受理侧 feature 白名单（T6）、
  testConnection 真实现（T6）。
- M4b 主线：整理→提案（`.ai/proposals/` 已预留路径，见 BOOK_FORMAT §7）→差异确认 UI→采纳落盘；
  上下文装配器接进真实调用方；剧情线/选项/伏笔录入 UI（M3/M4 结转）。
- 人工真 key 冒烟（连接测试/一轮对话/清除密钥）：留发起人（本片以假 baseUrl 的 CDP 冒烟证明了
  错误分类端到端，成功路径靠 provider 假 fetch 测试钉死）。

## 门禁证据

- typecheck 0 错；lint 0 error（1 既有 warning：`src/renderer/index.tsx` react-refresh，M2 前遗留）；
  `npm run test` **449 用例全绿**（32 文件；M4a 基线 321 → 本片净增 128）；build 通过。
- CDP 真机冒烟（Task 6，设置页经真实 IPC 边界）：假配置（openai / `http://127.0.0.1:9/` / 假密钥）
  保存 → 掩码提示 `当前已设置：sk-…5678` → 「测试连接」toast
  **「网络不通或地址错误：网络请求失败：TypeError: fetch failed」**（network 分类中文文案，
  无 `Error invoking remote method` 裸串、无 `[network]` 残迹、无明文密钥泄漏）→
  「清除密钥」Popconfirm 确认 → 「API 密钥已清除」、掩码显示消失回「尚未设置 API 密钥」、
  清除链接消失、测试按钮回置灰。15/15 断言全过（脚本 `.superpowers/sdd/…/cdp-task6.mjs`，
  日志在 task-6-report.md）。
