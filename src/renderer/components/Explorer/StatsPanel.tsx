import React, { useEffect, useMemo, useState } from 'react'
import { Card, Statistic, Progress, Row, Col, Typography, Space, Divider } from 'antd'
import {
  FileTextOutlined,
  ClockCircleOutlined,
  FireOutlined,
  TrophyOutlined,
  RiseOutlined,
  CalendarOutlined,
  RobotOutlined
} from '@ant-design/icons'
import type { AiFeature, AiUsageSummary } from '@/common/ai-types'
import { useAIUsage } from '../../hooks/useIPC'
import { subscribeEntitiesChanged } from '../../services/entityEvents'

const { Text } = Typography

interface HistoryDay {
  date: string   // 'YYYY-MM-DD'
  words: number
  minutes: number
}

// AI 功能中文标签（与 AiFeature 枚举逐一对应；顺序即展示顺序）
const AI_FEATURE_LABELS: Record<AiFeature, string> = {
  organize: '整理',
  completion: '补全',
  review: '审阅'
}
const AI_FEATURE_ORDER: readonly AiFeature[] = ['organize', 'completion', 'review']

interface StatsPanelProps {
  todayWordCount?: number
  totalWordCount?: number
  writingDuration?: number   // 今日分钟
  streak?: number
  dailyGoal?: number
  history?: HistoryDay[]     // 近 N 天（oldest→newest）；默认 []
  /** 书目录绝对路径（M4a Task 4）：给定才显示「AI 用量」区块（账本按书记账） */
  projectPath?: string
}

/** 一行计数文本：`2 次 · 提示 120 / 补全 45 tokens`（缓存仅在 >0 时追加）；feature 名由行左侧标签给出 */
function formatUsageLine(c: { calls: number; prompt: number; completion: number; cached: number }): string {
  const base = `${c.calls} 次 · 提示 ${c.prompt.toLocaleString()} / 补全 ${c.completion.toLocaleString()} tokens`
  return c.cached > 0 ? `${base} · 缓存 ${c.cached.toLocaleString()}` : base
}

const StatsPanel: React.FC<StatsPanelProps> = ({
  todayWordCount = 0,
  totalWordCount = 0,
  writingDuration = 0,
  streak = 0,
  dailyGoal = 2000,
  history = [],
  projectPath
}) => {
  // AI 用量账本（M4a Task 4）：mount/换书即拉 + entityEvents 刷新（沿用面板既有刷新面）；
  // 读失败静默保持 null——统计区块永远不值得把错误打到写作界面上。
  const { getAIUsage } = useAIUsage()
  const [aiUsage, setAiUsage] = useState<AiUsageSummary | null>(null)
  useEffect(() => {
    if (!projectPath) {
      setAiUsage(null)
      return
    }
    let alive = true
    const refresh = (): void => {
      getAIUsage(projectPath)
        .then((u) => {
          if (alive) setAiUsage(u)
        })
        .catch(() => {
          /* 静默 */
        })
    }
    refresh()
    const unsubscribe = subscribeEntitiesChanged(refresh)
    return () => {
      alive = false
      unsubscribe()
    }
  }, [projectPath, getAIUsage])
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
        borderBottom: '1px solid var(--color-border)',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center'
      }}>
        <Space>
          <RiseOutlined />
          <Text style={{ fontWeight: 500 }}>写作统计</Text>
        </Space>
        <Text style={{ color: progress >= 100 ? '#52c41a' : 'var(--color-primary)', fontSize: 12 }}>
          {progress >= 100 ? '目标达成' : `${progress}%`}
        </Text>
      </div>

      {/* 今日目标进度 */}
      <div style={{ padding: '16px', borderBottom: '1px solid var(--color-border)' }}>
        <Progress
          percent={progress}
          showInfo={false}
          strokeColor={progress >= 100 ? '#52c41a' : 'var(--color-primary)'}
          trailColor="var(--color-border)"
          size="small"
        />
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
          <Text style={{ color: 'var(--color-text-tertiary)', fontSize: 11 }}>{todayWordCount.toLocaleString()} 字</Text>
          <Text style={{ color: 'var(--color-text-tertiary)', fontSize: 11 }}>目标: {dailyGoal.toLocaleString()} 字</Text>
        </div>
      </div>

      {/* 核心统计 */}
      <div style={{ flex: 1, overflow: 'auto', padding: '16px 0' }}>
        <Row gutter={[16, 16]} style={{ padding: '0 16px' }}>
          <Col span={12}>
            <Card size="small" style={{ background: 'var(--color-bg-base)', borderColor: 'var(--color-border)' }}>
              <Statistic
                title={<Text style={{ color: 'var(--color-text-secondary)', fontSize: 11 }}>今日字数</Text>}
                value={todayWordCount}
                valueStyle={{ color: 'var(--color-primary)', fontSize: 20 }}
                prefix={<FileTextOutlined />}
                suffix="字"
              />
            </Card>
          </Col>
          <Col span={12}>
            <Card size="small" style={{ background: 'var(--color-bg-base)', borderColor: 'var(--color-border)' }}>
              <Statistic
                title={<Text style={{ color: 'var(--color-text-secondary)', fontSize: 11 }}>总字数</Text>}
                value={totalWordCount}
                valueStyle={{ color: '#52c41a', fontSize: 20 }}
                prefix={<TrophyOutlined />}
                suffix="字"
              />
            </Card>
          </Col>
          <Col span={12}>
            <Card size="small" style={{ background: 'var(--color-bg-base)', borderColor: 'var(--color-border)' }}>
              <Statistic
                title={<Text style={{ color: 'var(--color-text-secondary)', fontSize: 11 }}>今日时长</Text>}
                value={writingDuration}
                valueStyle={{ color: '#fa8c16', fontSize: 20 }}
                prefix={<ClockCircleOutlined />}
                suffix="分钟"
              />
            </Card>
          </Col>
          <Col span={12}>
            <Card size="small" style={{ background: 'var(--color-bg-base)', borderColor: 'var(--color-border)' }}>
              <Statistic
                title={<Text style={{ color: 'var(--color-text-secondary)', fontSize: 11 }}>连续写作</Text>}
                value={streak}
                valueStyle={{ color: 'var(--color-danger)', fontSize: 20 }}
                prefix={<FireOutlined />}
                suffix="天"
              />
            </Card>
          </Col>
        </Row>

        <Divider style={{ borderColor: 'var(--color-border)', margin: '16px 0' }} />

        {/* 本周数据 */}
        <div style={{ padding: '0 16px' }}>
          <Text style={{ color: 'var(--color-text-secondary)', fontSize: 12 }}>本周数据</Text>
          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            marginTop: 8, padding: '8px 12px', background: 'var(--color-bg-base)', borderRadius: 4
          }}>
            <Space><CalendarOutlined style={{ color: 'var(--color-text-tertiary)' }} /><Text style={{ color: 'var(--color-text)' }}>周总字数</Text></Space>
            <Text style={{ color: 'var(--color-primary)', fontWeight: 500 }}>{weeklyTotal.toLocaleString()} 字</Text>
          </div>
          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            marginTop: 8, padding: '8px 12px', background: 'var(--color-bg-base)', borderRadius: 4
          }}>
            <Space><RiseOutlined style={{ color: 'var(--color-text-tertiary)' }} /><Text style={{ color: 'var(--color-text)' }}>日均字数</Text></Space>
            <Text style={{ color: '#52c41a', fontWeight: 500 }}>{averageDaily.toLocaleString()} 字</Text>
          </div>
        </div>

        <Divider style={{ borderColor: 'var(--color-border)', margin: '16px 0' }} />

        {/* 近 N 天柱状趋势（纯 div/CSS） */}
        <div style={{ padding: '0 16px' }}>
          {maxWords === 0 ? (
            <Text style={{ display: 'block', color: 'var(--color-text-tertiary)', fontSize: 12, marginTop: 12, textAlign: 'center' }}>
              暂无写作记录
            </Text>
          ) : (
            <>
              <Text style={{ color: 'var(--color-text-secondary)', fontSize: 12 }}>最近 {history.length} 天</Text>
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
                          background: d.words > 0 ? 'var(--color-primary)' : 'var(--color-border)',
                          borderRadius: 2
                        }}
                      />
                      <Text style={{ color: 'var(--color-text-tertiary)', fontSize: 9, marginTop: 2 }}>
                        {d.date.slice(5)}
                      </Text>
                    </div>
                  )
                })}
              </div>
            </>
          )}
        </div>

        {/* AI 用量（M4a Task 4：<book>/.ai/usage.jsonl 账本聚合；仅在传入 projectPath 时出现） */}
        {projectPath && (
          <>
            <Divider style={{ borderColor: 'var(--color-border)', margin: '16px 0' }} />
            <div style={{ padding: '0 16px' }}>
              <Space><RobotOutlined style={{ color: 'var(--color-text-tertiary)' }} /><Text style={{ color: 'var(--color-text-secondary)', fontSize: 12 }}>AI 用量</Text></Space>
              {!aiUsage || aiUsage.total.calls === 0 ? (
                <div style={{ marginTop: 8, padding: '8px 12px', background: 'var(--color-bg-base)', borderRadius: 4 }}>
                  <Text style={{ color: 'var(--color-text-tertiary)', fontSize: 12 }}>
                    {aiUsage ? '暂无 AI 用量' : '读取中…'}
                  </Text>
                </div>
              ) : (
                <>
                  <div style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    marginTop: 8, padding: '8px 12px', background: 'var(--color-bg-base)', borderRadius: 4
                  }}>
                    <Text style={{ color: 'var(--color-text-tertiary)', fontSize: 11 }}>总计</Text>
                    <Text style={{ color: 'var(--color-primary)', fontSize: 11 }}>
                      {formatUsageLine(aiUsage.total)}
                    </Text>
                  </div>
                  {AI_FEATURE_ORDER.filter((f) => aiUsage.byFeature[f].calls > 0).map((f) => (
                    <div key={f} style={{
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      marginTop: 8, padding: '8px 12px', background: 'var(--color-bg-base)', borderRadius: 4
                    }}>
                      <Text style={{ color: 'var(--color-text-tertiary)', fontSize: 11 }}>{AI_FEATURE_LABELS[f]}</Text>
                      <Text style={{ color: 'var(--color-text)', fontSize: 11 }}>
                        {formatUsageLine(aiUsage.byFeature[f])}
                      </Text>
                    </div>
                  ))}
                </>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

export default StatsPanel
