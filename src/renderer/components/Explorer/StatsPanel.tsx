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
                title={<Text style={{ color: '#888', fontSize: 11 }}>今日时长</Text>}
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
          {maxWords === 0 ? (
            <Text style={{ display: 'block', color: '#555', fontSize: 12, marginTop: 12, textAlign: 'center' }}>
              暂无写作记录
            </Text>
          ) : (
            <>
              <Text style={{ color: '#888', fontSize: 12 }}>最近 {history.length} 天</Text>
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
            </>
          )}
        </div>
      </div>
    </div>
  )
}

export default StatsPanel
