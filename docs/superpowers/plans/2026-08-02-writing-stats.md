# 批次 3 实现计划：写作统计（Writing Stats）

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`).

**Goal:** 把空壳统计做成真实的、按项目持久化的写作统计（今日字数=正向增量、时长=活跃计时、streak 由历史算、无依赖 CSS 柱趋势）。

**Architecture:** 新建 `statsService.ts`（纯函数）+ `common/ipc.ts` 加 `StatsData`/`DayStat` 类型；新增 `stats:get`/`stats:save` IPC 读写 `<project>/.novelwriter/stats.json`；Workspace 挂载载入、编辑累计字数、60s tick 累计时长、防抖写盘+离开兜底；StatsPanel 用真实 props + CSS 趋势；移除死代码 `useStatsStore`。

**Tech Stack:** Electron + React 18 + TS + antd 5。无测试框架；无新依赖。

## Global Constraints

- **无单元测试框架**：每任务验证 = `npx tsc --noEmit`（被改文件不引入新错误，基线约 60）+ `npm run build` + 手动冒烟。子代理无法驱动 Electron GUI；手动冒烟由人完成。
- **不引入新依赖**；不改 `common/ipc.ts` 既有 `WritingStats`（仅**新增** `StatsData`/`DayStat`）。
- **分支**：`feat/writing-stats`（已创建，spec 提交于 `0be6827`）。
- 提交规范：Conventional Commits，中文，末尾 `Co-Authored-By: Claude <noreply@anthropic.com>`。

## 文件结构

| 文件 | 责任 | 任务 |
|------|------|------|
| `src/common/ipc.ts` | 新增 `DayStat`/`StatsData` 类型（共享契约） | Task 1 |
| `src/renderer/services/statsService.ts` | **新建**：纯函数（今日字数/时长/streak/趋势/裁剪） | Task 1 |
| `electron/main/ipc/handlers.ts` | 新增 `stats:get`/`stats:save` | Task 2 |
| `src/renderer/services/ipcService.ts` | 新增 `getStats`/`saveStats` | Task 2 |
| `src/renderer/components/Explorer/StatsPanel.tsx` | 删 mock + 删 useStatsStore import；真实 props + CSS 柱趋势 | Task 3 |
| `src/renderer/pages/Workspace/index.tsx` | 载入/累计/计时/持久化；传真实 props | Task 4 |
| `src/renderer/stores/index.ts` | 移除死代码 `useStatsStore` | Task 5 |
| `docs/AUDIT.md` / `README.md` / `docs/DEVELOPMENT.md` | 阶段16 状态 | Task 6 |

---

## Task 1: 共享类型 + statsService 纯函数

**Files:**
- Modify: `src/common/ipc.ts`（`WritingStats` 之后，约 102 行后追加）
- Create: `src/renderer/services/statsService.ts`

**Interfaces:**
- Produces: `DayStat`、`StatsData`（common）；`EMPTY_STATS`、`STATS_HISTORY_LIMIT`、`STATS_DURATION_TICK_MS`、`STATS_IDLE_THRESHOLD_MS`、`todayKey`、`ensureToday`、`addWords`、`addMinutes`、`computeStreak`、`todayWords`、`todayMinutes`、`recentHistory`、`trimHistory`（statsService）

- [ ] **Step 1: common/ipc.ts 追加类型**

在 `WritingStats` 接口之后（约 102 行 `}` 之后）追加：

```ts
// 写作统计（按项目持久化模型）
export interface DayStat {
  words: number
  minutes: number
}
export interface StatsData {
  dailyHistory: Record<string, DayStat>  // 'YYYY-MM-DD' -> DayStat
  lastActiveDate: string                 // 'YYYY-MM-DD'
}
```

- [ ] **Step 2: 新建 statsService.ts**

创建 `src/renderer/services/statsService.ts`：

```ts
import type { DayStat, StatsData } from '../../common/ipc'

export const STATS_HISTORY_LIMIT = 90
export const STATS_DURATION_TICK_MS = 60_000   // 活跃计时 tick
export const STATS_IDLE_THRESHOLD_MS = 60_000  // 近 60s 有按键算活跃
export const EMPTY_STATS: StatsData = { dailyHistory: {}, lastActiveDate: '' }

export function todayKey(d: Date = new Date()): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function ensureToday(stats: StatsData, d: Date = new Date()): StatsData {
  const key = todayKey(d)
  if (stats.dailyHistory[key]) return stats
  return { ...stats, dailyHistory: { ...stats.dailyHistory, [key]: { words: 0, minutes: 0 } } }
}

export function addWords(stats: StatsData, delta: number, d: Date = new Date()): StatsData {
  if (delta <= 0) return stats
  const key = todayKey(d)
  const withToday = ensureToday(stats, d)
  const day: DayStat = withToday.dailyHistory[key] ?? { words: 0, minutes: 0 }
  const next: StatsData = {
    ...withToday,
    dailyHistory: { ...withToday.dailyHistory, [key]: { ...day, words: day.words + delta } },
    lastActiveDate: key
  }
  return trimHistory(next, d)
}

export function addMinutes(stats: StatsData, minutes: number, d: Date = new Date()): StatsData {
  if (minutes <= 0) return stats
  const key = todayKey(d)
  const withToday = ensureToday(stats, d)
  const day: DayStat = withToday.dailyHistory[key] ?? { words: 0, minutes: 0 }
  return {
    ...withToday,
    dailyHistory: { ...withToday.dailyHistory, [key]: { ...day, minutes: day.minutes + minutes } },
    lastActiveDate: withToday.lastActiveDate || key
  }
}

export function computeStreak(stats: StatsData, d: Date = new Date()): number {
  let streak = 0
  const cursor = new Date(d)
  // 今日尚未写则从昨日起算（streak at risk 但仍展示）
  if ((stats.dailyHistory[todayKey(cursor)]?.words ?? 0) === 0) {
    cursor.setDate(cursor.getDate() - 1)
  }
  while ((stats.dailyHistory[todayKey(cursor)]?.words ?? 0) > 0) {
    streak++
    cursor.setDate(cursor.getDate() - 1)
  }
  return streak
}

export function todayWords(stats: StatsData, d: Date = new Date()): number {
  return stats.dailyHistory[todayKey(d)]?.words ?? 0
}

export function todayMinutes(stats: StatsData, d: Date = new Date()): number {
  return stats.dailyHistory[todayKey(d)]?.minutes ?? 0
}

export function recentHistory(
  stats: StatsData,
  days: number,
  d: Date = new Date()
): { date: string; words: number; minutes: number }[] {
  const out: { date: string; words: number; minutes: number }[] = []
  for (let i = days - 1; i >= 0; i--) {
    const dd = new Date(d)
    dd.setDate(dd.getDate() - i)
    const key = todayKey(dd)
    const day: DayStat = stats.dailyHistory[key] ?? { words: 0, minutes: 0 }
    out.push({ date: key, words: day.words, minutes: day.minutes })
  }
  return out
}

export function trimHistory(stats: StatsData, _d: Date = new Date()): StatsData {
  const keys = Object.keys(stats.dailyHistory).sort() // ISO 日期字典序=时间序
  if (keys.length <= STATS_HISTORY_LIMIT) return stats
  const keep = new Set(keys.slice(keys.length - STATS_HISTORY_LIMIT))
  const dailyHistory: Record<string, DayStat> = {}
  for (const k of Object.keys(stats.dailyHistory)) {
    if (keep.has(k)) dailyHistory[k] = stats.dailyHistory[k]
  }
  return { ...stats, dailyHistory }
}
```

- [ ] **Step 3: 类型检查**

Run: `npx tsc --noEmit 2>&1 | grep -E "common/ipc|statsService"`
Expected: 无输出（新代码零错误；既有别处引用 common/ipc 不受影响，仅新增导出）。

- [ ] **Step 4: 构建**

Run: `npm run build` → 通过。

- [ ] **Step 5: 提交**

```bash
git add src/common/ipc.ts src/renderer/services/statsService.ts
git commit -m "$(cat <<'EOF'
feat(stats): 新增 StatsData 类型与 statsService 纯函数

common/ipc.ts 加 DayStat/StatsData（不改既有 WritingStats）；
statsService 提供今日字数/时长/streak/趋势/裁剪等纯函数，date 可注入。

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: stats IPC 与 ipcService

**Files:**
- Modify: `electron/main/ipc/handlers.ts`（文件末尾或设定区追加）
- Modify: `src/renderer/services/ipcService.ts`（章节相关之后追加）

- [ ] **Step 1: handlers.ts 新增 stats:get / stats:save**

在 `handlers.ts` 顶部既有 import 行 `import { Chapter, ProjectType, Character, Setting } from '../../src/common/ipc'` 扩展为追加 `StatsData`：

```ts
import { Chapter, ProjectType, Character, Setting, StatsData } from '../../src/common/ipc'
```

在文件末尾（最后一个 `ipcmMain.handle` 之后）追加：

```ts
// ==================== 写作统计相关 ====================
ipcMain.handle('stats:get', async (_, projectPath: string): Promise<StatsData | null> => {
  const filePath = path.join(projectPath, '.novelwriter', 'stats.json')
  if (!fs.existsSync(filePath)) return null
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as StatsData
  } catch (e) {
    console.error('stats:get 解析失败:', e)
    return null
  }
})

ipcMain.handle('stats:save', async (_, params: { projectPath: string; stats: StatsData }): Promise<boolean> => {
  try {
    const dir = path.join(params.projectPath, '.novelwriter')
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'stats.json'), JSON.stringify(params.stats, null, 2), 'utf-8')
    return true
  } catch (e) {
    console.error('stats:save 失败:', e)
    return false
  }
})
```

- [ ] **Step 2: ipcService.ts 新增 getStats / saveStats**

在 `ipcService.ts` 顶部既有 `import type { Chapter, ProjectData, RecentProject, FileFilter } from '../common/ipc'` 扩展为追加 `StatsData`：

```ts
import type { Chapter, ProjectData, RecentProject, FileFilter, StatsData } from '../common/ipc'
```

> 注：ipcService.ts 在 `src/renderer/services/`，`../common/ipc` 是既有（pre-existing TS2307，vite 容忍）。保持与文件既有写法一致即可（本批不修这个既有路径问题）。

在「章节相关」区之后追加：

```ts
// ==================== 写作统计相关 ====================

export async function getStats(projectPath: string): Promise<StatsData | null> {
  return invoke<StatsData | null>('stats:get', projectPath)
}

export async function saveStats(projectPath: string, stats: StatsData): Promise<boolean> {
  return invoke<boolean>('stats:save', { projectPath, stats })
}
```

- [ ] **Step 3: 类型检查**

Run: `npx tsc --noEmit 2>&1 | grep -E "handlers|ipcService"`
Expected: 无新错误（handlers 的 `../../src/common/ipc` 路径正确解析；既有 TS2307 在 ipcService 的 `../common/ipc` 不变）。

- [ ] **Step 4: 构建**

Run: `npm run build` → 通过。

- [ ] **Step 5: 提交**

```bash
git add electron/main/ipc/handlers.ts src/renderer/services/ipcService.ts
git commit -m "$(cat <<'EOF'
feat(stats): 新增 stats:get/save IPC 与 ipcService 封装

按项目读写 <project>/.novelwriter/stats.json（按需建目录）；
ipcService 暴露 getStats/saveStats。

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: StatsPanel 重写（真实 props + CSS 趋势）

**Files:**
- Modify: `src/renderer/components/Explorer/StatsPanel.tsx`

> 设计为**可独立编译**：新增 `history` 等 prop 设为可选（默认 []），这样即使 Workspace（Task 4）尚未传真实值，组件也能编译渲染空态。

- [ ] **Step 1: 重写整个 StatsPanel.tsx**

整文件替换为：

```tsx
import React, { useMemo } from 'react'
import { Card, Statistic, Progress, Row, Col, Typography, Space, Divider } from 'antd'
import {
  FileTextOutlined,
  ClockCircleOutlined,
  FireOutlined,
  TrophyOutlined,
  RiseOutlined,
  CalendarOutlined
} from '@ant-design/icons'

const { Text } = Typography

interface HistoryDay {
  date: string   // 'YYYY-MM-DD'
  words: number
  minutes: number
}

interface StatsPanelProps {
  todayWordCount?: number
  totalWordCount?: number
  writingDuration?: number   // 今日分钟
  streak?: number
  dailyGoal?: number
  history?: HistoryDay[]     // 近 N 天（oldest→newest）；默认 []
}

const StatsPanel: React.FC<StatsPanelProps> = ({
  todayWordCount = 0,
  totalWordCount = 0,
  writingDuration = 0,
  streak = 0,
  dailyGoal = 2000,
  history = []
}) => {
  const progress = useMemo(
    () => Math.min(Math.round((todayWordCount / dailyGoal) * 100), 100),
    [todayWordCount, dailyGoal]
  )

  // 近 7 天用于"本周数据"
  const last7 = useMemo(() => history.slice(-7), [history])
  const weeklyTotal = useMemo(() => last7.reduce((s, d) => s + d.words, 0), [last7])
  const averageDaily = useMemo(
    () => (last7.length > 0 ? Math.round(weeklyTotal / last7.length) : 0),
    [last7, weeklyTotal]
  )

  // 趋势柱最大值（用于比例）
  const maxWords = useMemo(
    () => history.reduce((m, d) => Math.max(m, d.words), 0),
    [history]
  )

  return (
    <div className="stats-panel" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* 头部 */}
      <div style={{
        padding: '12px 16px',
        borderBottom: '1px solid #333',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center'
      }}>
        <Space>
          <RiseOutlined />
          <Text style={{ fontWeight: 500 }}>写作统计</Text>
        </Space>
        <Text style={{ color: progress >= 100 ? '#52c41a' : '#1890ff', fontSize: 12 }}>
          {progress >= 100 ? '目标达成' : `${progress}%`}
        </Text>
      </div>

      {/* 今日目标进度 */}
      <div style={{ padding: '16px', borderBottom: '1px solid #333' }}>
        <Progress
          percent={progress}
          showInfo={false}
          strokeColor={progress >= 100 ? '#52c41a' : '#1890ff'}
          trailColor="#333"
          size="small"
        />
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
          <Text style={{ color: '#666', fontSize: 11 }}>{todayWordCount.toLocaleString()} 字</Text>
          <Text style={{ color: '#666', fontSize: 11 }}>目标: {dailyGoal.toLocaleString()} 字</Text>
        </div>
      </div>

      {/* 核心统计 */}
      <div style={{ flex: 1, overflow: 'auto', padding: '16px 0' }}>
        <Row gutter={[16, 16]} style={{ padding: '0 16px' }}>
          <Col span={12}>
            <Card size="small" style={{ background: '#1e1e1e', borderColor: '#333' }}>
              <Statistic
                title={<Text style={{ color: '#888', fontSize: 11 }}>今日字数</Text>}
                value={todayWordCount}
                valueStyle={{ color: '#1890ff', fontSize: 20 }}
                prefix={<FileTextOutlined />}
                suffix="字"
              />
            </Card>
          </Col>
          <Col span={12}>
            <Card size="small" style={{ background: '#1e1e1e', borderColor: '#333' }}>
              <Statistic
                title={<Text style={{ color: '#888', fontSize: 11 }}>总字数</Text>}
                value={totalWordCount}
                valueStyle={{ color: '#52c41a', fontSize: 20 }}
                prefix={<TrophyOutlined />}
                suffix="字"
              />
            </Card>
          </Col>
          <Col span={12}>
            <Card size="small" style={{ background: '#1e1e1e', borderColor: '#333' }}>
              <Statistic
                title={<Text style={{ color: '#888', fontSize: 11 }}>写作时长</Text>}
                value={writingDuration}
                valueStyle={{ color: '#fa8c16', fontSize: 20 }}
                prefix={<ClockCircleOutlined />}
                suffix="分钟"
              />
            </Card>
          </Col>
          <Col span={12}>
            <Card size="small" style={{ background: '#1e1e1e', borderColor: '#333' }}>
              <Statistic
                title={<Text style={{ color: '#888', fontSize: 11 }}>连续写作</Text>}
                value={streak}
                valueStyle={{ color: '#f5222d', fontSize: 20 }}
                prefix={<FireOutlined />}
                suffix="天"
              />
            </Card>
          </Col>
        </Row>

        <Divider style={{ borderColor: '#333', margin: '16px 0' }} />

        {/* 本周数据 */}
        <div style={{ padding: '0 16px' }}>
          <Text style={{ color: '#888', fontSize: 12 }}>本周数据</Text>
          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            marginTop: 8, padding: '8px 12px', background: '#1e1e1e', borderRadius: 4
          }}>
            <Space><CalendarOutlined style={{ color: '#666' }} /><Text style={{ color: '#d4d4d4' }}>周总字数</Text></Space>
            <Text style={{ color: '#1890ff', fontWeight: 500 }}>{weeklyTotal.toLocaleString()} 字</Text>
          </div>
          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            marginTop: 8, padding: '8px 12px', background: '#1e1e1e', borderRadius: 4
          }}>
            <Space><RiseOutlined style={{ color: '#666' }} /><Text style={{ color: '#d4d4d4' }}>日均字数</Text></Space>
            <Text style={{ color: '#52c41a', fontWeight: 500 }}>{averageDaily.toLocaleString()} 字</Text>
          </div>
        </div>

        <Divider style={{ borderColor: '#333', margin: '16px 0' }} />

        {/* 近 N 天柱状趋势（纯 div/CSS） */}
        <div style={{ padding: '0 16px' }}>
          <Text style={{ color: '#888', fontSize: 12 }}>最近 {history.length} 天</Text>
          {maxWords === 0 ? (
            <Text style={{ display: 'block', color: '#555', fontSize: 12, marginTop: 12, textAlign: 'center' }}>
              暂无写作记录
            </Text>
          ) : (
            <div style={{
              display: 'flex', alignItems: 'flex-end', gap: 2,
              marginTop: 12, height: 80
            }}>
              {history.map((d, i) => {
                const h = maxWords > 0 ? Math.max((d.words / maxWords) * 100, d.words > 0 ? 6 : 2) : 0
                return (
                  <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                    <div
                      title={`${d.date}: ${d.words} 字`}
                      style={{
                        width: '100%',
                        height: `${h}%`,
                        minHeight: 2,
                        background: d.words > 0 ? '#1890ff' : '#333',
                        borderRadius: 2
                      }}
                    />
                    <Text style={{ color: '#555', fontSize: 9, marginTop: 2 }}>
                      {d.date.slice(5)}
                    </Text>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default StatsPanel
```

> 删除了：`mockHistoryData`、`useStatsStore` import（消除该文件 `@/stores` TS2307）、未用的 `Title`/`onViewStats`/`List`/`Tag` 等。`writingDuration` 现直接是分钟（不再 `/60`，由调用方传分钟）。

- [ ] **Step 2: 类型检查**

Run: `npx tsc --noEmit 2>&1 | grep "StatsPanel"`
Expected: 无输出（`@/stores` TS2307 应已消失；无新错误）。

- [ ] **Step 3: 构建**

Run: `npm run build` → 通过。

- [ ] **Step 4: 提交**

```bash
git add src/renderer/components/Explorer/StatsPanel.tsx
git commit -m "$(cat <<'EOF'
refactor(stats): StatsPanel 改真实 props + CSS 柱趋势，删 mock 与死 import

删 mockHistoryData 与未用的 useStatsStore import（消除 @/stores TS2307）；
接收 todayWordCount/totalWordCount/writingDuration(分钟)/streak/history；
近 N 天用纯 div/CSS 柱状趋势；history 可选默认 [] 可独立编译。

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

> 手动冒烟推迟到 Task 4 接线后（此时 StatsPanel 仍由 Workspace 传旧值，渲染空态/旧值，Task 4 后才见真实数据）。

---

## Task 4: Workspace 集成（载入/累计/计时/持久化）

**Files:**
- Modify: `src/renderer/pages/Workspace/index.tsx`

**Interfaces:**
- Consumes: `getStats`/`saveStats`（Task 2）、`EMPTY_STATS`/`addWords`/`addMinutes`/`todayWords`/`todayMinutes`/`computeStreak`/`recentHistory`/`STATS_DURATION_TICK_MS`/`STATS_IDLE_THRESHOLD_MS`（Task 1）、`StatsData`（common）、既有 `selectChapter`/`handleEditorChange`/`handleBack`/`beforeunload`/`projectPath`/`chapters`/`config`
- Produces: 组件内 `stats` 状态 + 计时/累计/持久化副作用

- [ ] **Step 1: 补 import**

在 `Workspace/index.tsx` 顶部 import 区新增：
```tsx
import type { StatsData } from '@/common/ipc'
import {
  getStats, saveStats
} from '../../services/ipcService'
import {
  EMPTY_STATS, addWords, addMinutes, todayWords, todayMinutes,
  computeStreak, recentHistory, STATS_DURATION_TICK_MS, STATS_IDLE_THRESHOLD_MS
} from '../../services/statsService'
```

> `getStats`/`saveStats` 加入既有 ipcService import 行（该行已有 `startAutoSave, stopAutoSave, saveFileDialog, writeFile`）。

- [ ] **Step 2: 新增 stats 状态与 refs**

在组件内状态区新增：
```tsx
  const [stats, setStats] = useState<StatsData>(EMPTY_STATS)
  const statsRef = useRef(stats)
  statsRef.current = stats
  const statsLoadedRef = useRef(false)
  const prevLenRef = useRef(0)           // 当前章上一刻长度，用于增量
  const lastActivityRef = useRef(0)      // 最近一次按键时间戳
```

并在 `projectPath` 定义处（约 `const projectPath = state?.project?.path || state?.projectPath` 之后）加镜像 ref（供 `beforeunload` 的 `[]`-deps effect 避免陈旧闭包）：
```tsx
  const projectPathRef = useRef(projectPath)
  projectPathRef.current = projectPath
```

- [ ] **Step 3: 挂载载入 stats**

在 `loadChapters` 内（`getAllChapters` 之后、或 projectPath 就绪的 effect 内）追加载入：
```tsx
    // 载入项目写作统计
    try {
      const loaded = await getStats(projectPath)
      setStats(loaded ?? EMPTY_STATS)
    } catch (e) {
      console.error('载入统计失败:', e)
      setStats(EMPTY_STATS)
    }
    statsLoadedRef.current = true
```
（放在 `loadChapters` 函数体里 `getAllChapters` 调用之后即可。）

- [ ] **Step 4: selectChapter 重置 prevLen**

在 `selectChapter(chapter)` 内，设置 `editorContent` 之后追加：
```tsx
    prevLenRef.current = chapter.content.length   // 切章不计增量
```

- [ ] **Step 5: handleEditorChange 累计字数 + 记录活跃**

在 `handleEditorChange(val)` 内，现有 `setEditorContent(val); isDirtyRef.current = true` 之后追加：
```tsx
    const delta = val.length - prevLenRef.current
    prevLenRef.current = val.length
    if (delta > 0) {
      setStats(s => addWords(s, delta))
    }
    lastActivityRef.current = Date.now()
```

- [ ] **Step 6: 60s 活跃计时 effect**

新增 effect（与其他 effect 并列）：
```tsx
  // 写作时长：每 60s，若近 IDLE 阈值内有按键则今日 +1 分钟
  useEffect(() => {
    if (!projectPath) return
    const timer = setInterval(() => {
      if (Date.now() - lastActivityRef.current < STATS_IDLE_THRESHOLD_MS) {
        setStats(s => addMinutes(s, 1))
      }
    }, STATS_DURATION_TICK_MS)
    return () => clearInterval(timer)
  }, [projectPath])
```

- [ ] **Step 7: 防抖写盘 effect**

新增 effect：
```tsx
  // 统计持久化：变化后防抖 3s 写盘
  useEffect(() => {
    if (!projectPath || !statsLoadedRef.current) return
    const t = setTimeout(() => { void saveStats(projectPath, stats) }, 3000)
    return () => clearTimeout(t)
  }, [stats, projectPath])
```

- [ ] **Step 8: 离开兜底**

在 `handleBack`（已有 `flushIfDirty()`）内追加（handleBack 每次渲染重建，闭包新鲜，用 `projectPath` 即可）：
```tsx
    if (projectPath) void saveStats(projectPath, statsRef.current)
```
在 `beforeunload` handler（批次1 已有 `flushIfDirtyRef.current()`，该 effect 为 `[]` deps）内追加——**必须用 `projectPathRef.current`**（直接用 `projectPath` 会捕获挂载时的陈旧值，可能为 undefined）：
```tsx
      if (projectPathRef.current) void saveStats(projectPathRef.current, statsRef.current)
```

- [ ] **Step 9: 传真实 props 给 StatsPanel**

将既有 `<StatsPanel todayWordCount={editorContent.length} totalWordCount={...} />`（在侧栏 stats tab 分支）替换为：
```tsx
                <StatsPanel
                  todayWordCount={todayWords(stats)}
                  totalWordCount={chapters.reduce((sum, c) => sum + c.wordCount, 0)}
                  writingDuration={todayMinutes(stats)}
                  streak={computeStreak(stats)}
                  dailyGoal={config?.dailyGoal ?? 2000}
                  history={recentHistory(stats, 14)}
                />
```

- [ ] **Step 10: 类型检查**

Run: `npx tsc --noEmit 2>&1 | grep "pages/Workspace"`
Expected: 无新错误（既有 TS6133 React/Title/loading/handleDeleteChapter 保留）。`Date.now()` 在 app 代码可用。

- [ ] **Step 11: 构建**

Run: `npm run build` → 通过。

- [ ] **Step 12: 手动冒烟（核心）**

Run: `npm run dev`，打开项目：
1. 统计 tab：卡片初始 0、趋势空态（暂无记录）。
2. 写作一会：今日字数随输入增长；约 1 分钟后时长 +1；放置不写→时长不涨。
3. 切章再写：增量只算新输入，切章不跳字。
4. 删除文字：今日字数不减。
5. 返回首页再进：今日/时长/趋势仍在（持久化）。
6. 趋势柱随每日字数成比例，标 MM-DD。
7. 回归：保存/切章/导出不受影响。

- [ ] **Step 13: 提交**

```bash
git add src/renderer/pages/Workspace/index.tsx
git commit -m "$(cat <<'EOF'
feat(stats): Workspace 集成统计载入/累计/计时/持久化

挂载载入 stats；编辑正向增量累计今日字数；60s tick 活跃计时；
防抖 3s 写盘 + 返回/关窗兜底；StatsPanel 传真实今日/总/时长/streak/趋势。

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: 移除死代码 useStatsStore

**Files:**
- Modify: `src/renderer/stores/index.ts`

> 前置：Task 3 已删除 StatsPanel 对 `useStatsStore` 的唯一引用。先 grep 确认全项目无其它引用，再移除。

- [ ] **Step 1: 确认无引用**

Run: `grep -rn "useStatsStore" src/`
Expected: 仅可能命中 `stores/index.ts` 的定义本身（无其它消费方）。若仍有消费方，**停止**并报告（NEEDS_CONTEXT）。

- [ ] **Step 2: 移除 useStatsStore**

在 `src/renderer/stores/index.ts` 删除整段 `StatsState` interface + `useStatsStore = create<StatsState>()(...)`（约 151-194 行，从 `// 写作统计状态` 注释到其闭合 `)`）。保留 `useTabStore`/`useProjectStore`/`useEditorStore`。

- [ ] **Step 3: 类型检查**

Run: `npx tsc --noEmit 2>&1 | grep "stores/index"`
Expected: 无输出。总错误数应较前**减少**（移除了若干 TS6133：addWordCount/updateDuration 等）。

- [ ] **Step 4: 构建**

Run: `npm run build` → 通过。

- [ ] **Step 5: 提交**

```bash
git add src/renderer/stores/index.ts
git commit -m "$(cat <<'EOF'
refactor(stats): 移除死代码 useStatsStore

addWordCount/updateDuration 全项目零调用；统计改用按项目 stats.json
（Task 1-4）。移除该 store 及其 localStorage 持久化。

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: 文档状态更新（阶段16）

**Files:**
- Modify: `docs/AUDIT.md`、`README.md`、`docs/DEVELOPMENT.md`

- [ ] **Step 1: AUDIT.md 追加批次3 复审段**

在「## 2026-08-02 复审：批次 2 导出（Markdown）」段之后插入：

```markdown
## 2026-08-02 复审：批次 3 写作统计

分支 `feat/writing-stats`，详见 `docs/superpowers/plans/2026-08-02-writing-stats.md`。已修复：

- **写作统计（阶段16 空壳）**：StatsPanel 删 mock + 删死 `useStatsStore`；新增 `statsService` 纯函数 + `stats:get/save` IPC，按项目持久化 `<project>/.novelwriter/stats.json`。今日字数=正向增量(gross)、写作时长=活跃计时(60s tick)、连续天数由每日历史计算；近 14 天纯 CSS 柱趋势。Workspace 挂载载入、编辑累计、60s 计时、防抖写盘+离开兜底。移除 `stores/index.ts` 死代码 `useStatsStore`（顺带消除 StatsPanel 的 `@/stores` TS2307）。

仍待做：阶段 15（快捷键自定义）；导出 Word/PDF/ePub（阶段17 剩余）。
```

- [ ] **Step 2: README.md 更新阶段16 行 + 真实进度**

- 阶段16 行状态改为 `✅ 已实现（按项目 stats.json：今日字数/活跃时长/streak/CSS 趋势）`。
- 「真实进度」链路追加「+ 写作统计」，仍待做列表移除「阶段16」、保留「15 快捷键自定义 / 17 剩余 Word·PDF·ePub」。

- [ ] **Step 3: DEVELOPMENT.md 更新阶段16 行**

阶段16 行 → `✅ 已实现`（其余行不动；8/10-14 历史漂移既有，不在本批）。

- [ ] **Step 4: 提交**

```bash
git add docs/AUDIT.md README.md docs/DEVELOPMENT.md
git commit -m "$(cat <<'EOF'
docs: 更新进度（批次3 写作统计完成）

阶段16 标完成；AUDIT 追加批次3 复审段；真实进度链路加写作统计。

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## 收尾验证（全部 Task 完成后）

- `npx tsc --noEmit`：总错误数应**下降**（移除 useStatsStore + StatsPanel 的 @/stores）；被改文件无新错误。
- `npm run build`：通过。
- 完整手动冒烟（合并各 Task 冒烟步骤）。
- `git log --oneline feat/writing-stats ^main`：确认提交（spec + 6 task）。

## 后续

本批完成后进入**批次 4：快捷键自定义（阶段15）**（最后一批）。合并 `feat/writing-stats` 到 main 由用户决定（finishing-a-development-branch）。
