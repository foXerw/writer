# 批次 3 设计：写作统计（Writing Stats）

> 日期: 2026-08-02
> 范围: 把空壳统计（mock 数据 + 死代码）做成真实的、按项目持久化的写作统计
> 依据: `docs/AUDIT.md`（阶段16 空壳）+ 2026-08-02 代码复核
> 关联: 4 批路线图第 3 批（批次1 稳定与打磨、批次2 导出 Markdown 已合并 main）

---

## 背景与现状（已复核）

`src/renderer/components/Explorer/StatsPanel.tsx` UI 完整但全是假数据：
- 硬编码 `mockHistoryData`（7 天假字数）；`averageDaily`/`weeklyTotal` 都从 mock 算。
- `useStatsStore` 被 import（`@/stores`，且是已知的 TS2307 路径错）但**组件内从未调用**——纯死引用。
- Workspace 只传 `todayWordCount={editorContent.length}`（当前章字符数，并非"今日"）与 `totalWordCount={各章 wordCount 之和}`；`writingDuration`/`streak` 默认 0。
- `stores/index.ts` 的 `useStatsStore`：`addWordCount`/`updateDuration` **全项目零调用**，时长/streak 永远 0；其 localStorage 持久化是全局桶（不分项目）。

`WritingStats` 类型（`common/ipc.ts`）= `{ dailyWordCount, totalWordCount, writingDuration, streak }`（本批不改该类型，统计用新模型）。

## 目标

真实、按项目持久化的写作统计：
- **今日字数** = 今日正向增量累计（gross，删除不减）。
- **写作时长** = 活跃计时（60s tick，近 60s 有按键才 +1 分钟）。
- **连续天数** = 由每日历史计算。
- **近 N 天趋势** = 纯 div/CSS 柱状（无图表库依赖）。
- 数据存 `<project>/.novelwriter/stats.json`，随项目走、多项目独立。

---

## 数据模型（`<project>/.novelwriter/stats.json`）

```jsonc
{
  "dailyHistory": {
    "2026-08-02": { "words": 1234, "minutes": 45 }
    // 'YYYY-MM-DD' -> { words, minutes }；保留最近 90 天
  },
  "lastActiveDate": "2026-08-02"
}
```

> 不存 `totalWords`/`totalMinutes`：今日字数/分钟取自 `dailyHistory[today]`；"总字数"卡片取各章 `wordCount` 之和；周/趋势/streak 都从 `dailyHistory` 派生。模型尽量小。

`streak`、今日值、趋势均由纯函数从 `dailyHistory` 计算（不单独持久化）。

---

## 架构与文件

| 文件 | 改动 | 类型 |
|------|------|------|
| `src/renderer/services/statsService.ts` | **新建**：`StatsData`/`DayStat` 类型 + 纯函数（见下） | 新建 |
| `electron/main/ipc/handlers.ts` | 新增 `stats:get` / `stats:save`（读写 stats.json，含建 `.novelwriter/` 目录） | 修改 |
| `src/renderer/services/ipcService.ts` | 新增 `getStats` / `saveStats` 封装 | 修改 |
| `src/renderer/pages/Workspace/index.tsx` | 挂载载入 stats；编辑累计字数；60s tick 累计时长；防抖写盘 + 离开兜底 | 修改 |
| `src/renderer/components/Explorer/StatsPanel.tsx` | 删 mock + 删未用 `useStatsStore` import（顺带修 TS2307）；接收真实 props + `history` 画 CSS 柱趋势 | 修改 |
| `src/renderer/stores/index.ts` | 移除死代码 `useStatsStore`（移除前 grep 确认无其它引用） | 修改 |

**无新依赖**。新增 1 个主进程 IPC 通道组（stats:get/save）。

---

## `statsService.ts`（纯函数，无 React/IPC）

> 类型 `DayStat` / `StatsData` 定义在 `src/common/ipc.ts`（见上），本文件 `import type` 引入。

```ts
import type { DayStat, StatsData } from '../../common/ipc'

export const STATS_HISTORY_LIMIT = 90
export const EMPTY_STATS: StatsData = { dailyHistory: {}, lastActiveDate: '' }

// 'YYYY-MM-DD'（date 注入以保持纯度；app 内用 new Date()）
export function todayKey(d: Date = new Date()): string

// 确保今日桶存在；跨日时旧日留历史，今日新桶从 0 开始
export function ensureToday(stats: StatsData, d?: Date): StatsData

// 正向增量计入今日 words + 更新 lastActiveDate；delta<=0 原样返回；含 ensureToday + trim
export function addWords(stats: StatsData, delta: number, d?: Date): StatsData

// 今日 minutes += minutes；含 ensureToday
export function addMinutes(stats: StatsData, minutes: number, d?: Date): StatsData

// 连续写作天数：从今日往回数 words>0 的连续日；容忍今日尚未写（则从昨日起算）
export function computeStreak(stats: StatsData, d?: Date): number

// 今日 words（0 若无）
export function todayWords(stats: StatsData, d?: Date): number
// 今日 minutes
export function todayMinutes(stats: StatsData, d?: Date): number

// 近 days 天历史（oldest→newest），缺失日补 0；返回 { date:'YYYY-MM-DD', words, minutes }[]
export function recentHistory(stats: StatsData, days: number, d?: Date): { date: string; words: number; minutes: number }[]

// 裁剪到 STATS_HISTORY_LIMIT 天（按日期键排序取最近）
export function trimHistory(stats: StatsData, d?: Date): StatsData
```

**关键实现要点**：
- `addWords(delta)`：`delta<=0` 直接返回；否则 `ensureToday` → 在 `dailyHistory[today].words += delta`、`lastActiveDate = today` → `trimHistory`。
- `computeStreak`：`cursor=today`；若 `dailyHistory[today].words` 为 0，`cursor` 退到昨日；然后 `while (dailyHistory[cursor].words > 0) { streak++; cursor-- }`。
- `recentHistory(days)`：从 `days-1` 天前到今日逐日取，缺失补 `{words:0,minutes:0}`；返回完整键（组件自行格式化为 `MM-DD`）。
- 所有函数纯：不修改入参，返回新 `StatsData`；`date` 默认 `new Date()` 但可注入。

---

## IPC（`handlers.ts`）

```ts
// 读取项目统计；不存在返回 null
ipcMain.handle('stats:get', async (_, projectPath: string): Promise<StatsData | null> => {
  const filePath = path.join(projectPath, '.novelwriter', 'stats.json')
  if (!fs.existsSync(filePath)) return null
  try { return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as StatsData }
  catch { return null }
})

// 写入项目统计（必要时创建 .novelwriter 目录）
ipcMain.handle('stats:save', async (_, params: { projectPath: string; stats: StatsData }): Promise<boolean> => {
  try {
    const dir = path.join(params.projectPath, '.novelwriter')
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'stats.json'), JSON.stringify(params.stats, null, 2), 'utf-8')
    return true
  } catch (e) { console.error('stats:save 失败:', e); return false }
})
```

> `StatsData` / `DayStat` 类型放 `src/common/ipc.ts`（共享契约，新增不改既有 `WritingStats`）。主进程 `handlers.ts` 已有 `import ... from '../../src/common/ipc'`，追加 `StatsData` 即可；`statsService.ts` 用 `import type { StatsData, DayStat } from '../../common/ipc'`（正确相对路径 → `src/common/ipc.ts`，避免 `@/` 别名 TS2307）。两侧都用相对路径解析，不引入 main↔renderer 实现耦合（仅共享类型）。

## `ipcService.ts`

```ts
export async function getStats(projectPath: string): Promise<StatsData | null> {
  return invoke<StatsData | null>('stats:get', projectPath)
}
export async function saveStats(projectPath: string, stats: StatsData): Promise<boolean> {
  return invoke<boolean>('stats:save', { projectPath, stats })
}
```

---

## Workspace 集成

**挂载载入**：在 `loadChapters`（或 projectPath 就绪的 effect）中 `const loaded = await getStats(projectPath); setStats(loaded ?? EMPTY_STATS)`，置 `statsLoadedRef=true`。

**今日字数（正向增量）**：
- 新增 `prevLenRef = useRef(0)`。
- `selectChapter(chapter)` 内（设置 editorContent 后）置 `prevLenRef.current = chapter.content.length`（切章不计增量）。
- `handleEditorChange(val)`：`const delta = val.length - prevLenRef.current; prevLenRef.current = val.length; if (delta > 0) setStats(s => addWords(s, delta));` 同时 `lastActivityRef.current = Date.now()`。

**写作时长（活跃计时）**：
- `lastActivityRef = useRef(0)`；`handleEditorChange` 时更新为 `Date.now()`。
- `useEffect`：`setInterval` 60s——若 `Date.now() - lastActivityRef.current < 60_000`，`setStats(s => addMinutes(s, 1))`。卸载清理。

**持久化（防抖 + 离开兜底）**：
- `statsRef` 镜像最新 stats（render body 赋值，同批次1 `currentChapterIdRef` 模式）。
- `useEffect([stats, projectPath])`：若 `statsLoadedRef` 且 projectPath，`setTimeout(()=>saveStats(projectPath, stats), 3000)`，return 清上一个 timer（防抖 3s）。初始载入那次 setStats 会触发一次写盘（写回相同数据，无害）。
- `handleBack` 与 `beforeunload`：`void saveStats(projectPath, statsRef.current)` 兜底（复用批次1 离开时机）。

**StatsPanel props 改为**：
```tsx
<StatsPanel
  todayWordCount={todayWords(stats)}
  totalWordCount={chapters.reduce((s, c) => s + c.wordCount, 0)}
  writingDuration={todayMinutes(stats)}      // 今日分钟
  streak={computeStreak(stats)}
  dailyGoal={config?.dailyGoal ?? 2000}
  history={recentHistory(stats, 14)}          // 近 14 天
/>
```

---

## StatsPanel 改造

- **删** `mockHistoryData`、`import { useStatsStore } from '@/stores'`（顺带消除该文件 TS2307）。
- props 增加 `history: { date: string; words: number; minutes: number }[]`；删未用的 `onViewStats`。
- "本周数据"：由 `history` 近 7 天求和/均值（替代 mock 的 `weeklyTotal`/`averageDaily`）。
- "最近 N 天"区：用纯 div/CSS 把 `history` 画成紧凑柱状（每柱高度按 `words / maxWords` 比例，柱下标 `MM-DD`），替代 mock `List`。maxWords=0 时空态。
- 卡片：今日字数 / 总字数（项目章节数和）/ 写作时长（今日分钟）/ 连续写作（streak）。

---

## 边界与取舍

- **空项目/无历史**：`EMPTY_STATS` → 卡片 0、趋势空态、streak 0。
- **跨日**：`ensureToday` 处理；今日新桶从 0；streak 容忍今日尚未写（从昨日起算）。
- **切章不计增量**：`prevLenRef` 在 `selectChapter` 重置为新章长度。
- **删除不减字数**：gross 口径（`delta>0` 才计）。
- **时长空闲暂停**：60s tick 内无按键则不 +1。
- **防抖写盘 + 离开兜底**：stats 丢失 ≤3s，可接受（非正文关键数据）。
- **90 天上限**：`trimHistory` 裁剪。
- **移除 `useStatsStore`**：grep 确认仅 StatsPanel 引用且未用，再从 `stores/index.ts` 移除。
- **`.novelwriter/` 目录**：项目当前用 `.novelwriter.json`（文件），无 `.novelwriter/` 目录；`stats:save` 用 `mkdirSync recursive` 按需创建，前向兼容。

## 范围外（明确不做）

- 图表库（recharts 等）——用纯 CSS 柱状。
- 专门的统计页/弹窗——统计仍在侧栏 stats tab。
- 全局（跨项目）统计聚合——本批按项目。
- 写作目标的历史达成分析、热力图等高级可视化。
- 修改 `common/ipc.ts` 的 `WritingStats` 类型（保留，新统计模型独立）。

---

## 测试与验证（无测试框架）

- `npx tsc --noEmit`：被改文件不引入新错误（基线约 60；StatsPanel 的 `@/stores` TS2307 应消失）。
- `npm run build`：通过。
- `npm run lint`：仓库级坏（缺 react-refresh 插件，既有）。
- 手动冒烟（`npm run dev`）：
  1. 打开项目，侧栏统计 tab：卡片初始 0、趋势空态。
  2. 写作一会：今日字数随输入增长；放置不写约 1 分钟后时长 +1（再放着不涨）。
  3. 切章再写：增量只算新输入，切章本身不跳字。
  4. 删除文字：今日字数不减。
  5. 关闭重开项目：今日字数/时长/趋势仍在（持久化生效）。
  6. 跨日：构造昨日数据或改系统时间→新日从 0、streak 正确、历史出现。
  7. 趋势显示真实近 14 天，柱高与字数成比例。
  8. 回归：写作/保存/切章/导出（批次1-2）不受影响。

## 涉及文件清单

新建 1（`statsService.ts`），修改 5（handlers.ts、ipcService.ts、Workspace、StatsPanel、stores/index.ts）。预计净增约 150–200 行。
