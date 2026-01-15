import React, { useState, useEffect, useMemo } from 'react'
import { Card, Statistic, Progress, Row, Col, Typography, Space, List, Tag, Divider } from 'antd'
import {
  FileTextOutlined,
  ClockCircleOutlined,
  FireOutlined,
  TrophyOutlined,
  RiseOutlined,
  CalendarOutlined
} from '@ant-design/icons'
import { useStatsStore } from '@/stores'

const { Text, Title } = Typography

interface StatsPanelProps {
  todayWordCount?: number
  totalWordCount?: number
  writingDuration?: number
  streak?: number
  dailyGoal?: number
  onViewStats?: () => void
}

// 模拟历史数据
const mockHistoryData = [
  { date: '01-15', count: 2500 },
  { date: '01-14', count: 3200 },
  { date: '01-13', count: 1800 },
  { date: '01-12', count: 4100 },
  { date: '01-11', count: 2800 },
  { date: '01-10', count: 3500 },
  { date: '01-09', count: 2200 }
]

const StatsPanel: React.FC<StatsPanelProps> = ({
  todayWordCount = 0,
  totalWordCount = 0,
  writingDuration = 0,
  streak = 0,
  dailyGoal = 2000,
  onViewStats
}) => {
  // 计算进度
  const progress = useMemo(() => {
    return Math.min(Math.round((todayWordCount / dailyGoal) * 100), 100)
  }, [todayWordCount, dailyGoal])

  // 计算平均日字数
  const averageDaily = useMemo(() => {
    if (mockHistoryData.length === 0) return 0
    const total = mockHistoryData.reduce((sum, item) => sum + item.count, 0)
    return Math.round(total / mockHistoryData.length)
  }, [])

  // 本周总字数
  const weeklyTotal = useMemo(() => {
    return mockHistoryData.reduce((sum, item) => sum + item.count, 0)
  }, [])

  // 获取当前时间
  const currentTime = new Date()
  const hour = currentTime.getHours()

  // 根据时间显示问候语
  const greeting = useMemo(() => {
    if (hour < 6) return '深夜写作，注意休息'
    if (hour < 12) return '早上好，创作顺利'
    if (hour < 14) return '午后好，继续加油'
    if (hour < 18) return '下午好，效率满满'
    return '晚上好，静心写作'
  }, [hour])

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
        <Tag color={progress >= 100 ? 'green' : 'blue'}>
          {progress >= 100 ? '目标达成' : `${progress}%`}
        </Tag>
      </div>

      {/* 问候语 */}
      <div style={{ padding: '16px', borderBottom: '1px solid #333' }}>
        <Text style={{ color: '#888', fontSize: 12 }}>{greeting}</Text>
        <Progress
          percent={progress}
          showInfo={false}
          strokeColor={progress >= 100 ? '#52c41a' : '#1890ff'}
          trailColor="#333"
          size="small"
          style={{ marginTop: 8 }}
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
                value={Math.round(writingDuration / 60)}
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

        {/* 周统计 */}
        <div style={{ padding: '0 16px' }}>
          <Text style={{ color: '#888', fontSize: 12 }}>本周数据</Text>
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginTop: 8,
            padding: '8px 12px',
            background: '#1e1e1e',
            borderRadius: 4
          }}>
            <Space>
              <CalendarOutlined style={{ color: '#666' }} />
              <Text style={{ color: '#d4d4d4' }}>周总字数</Text>
            </Space>
            <Text style={{ color: '#1890ff', fontWeight: 500 }}>
              {weeklyTotal.toLocaleString()} 字
            </Text>
          </div>
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginTop: 8,
            padding: '8px 12px',
            background: '#1e1e1e',
            borderRadius: 4
          }}>
            <Space>
              <RiseOutlined style={{ color: '#666' }} />
              <Text style={{ color: '#d4d4d4' }}>日均字数</Text>
            </Space>
            <Text style={{ color: '#52c41a', fontWeight: 500 }}>
              {averageDaily.toLocaleString()} 字
            </Text>
          </div>
        </div>

        <Divider style={{ borderColor: '#333', margin: '16px 0' }} />

        {/* 历史记录 */}
        <div style={{ padding: '0 16px' }}>
          <Text style={{ color: '#888', fontSize: 12 }}>最近7天</Text>
          <List
            size="small"
            dataSource={mockHistoryData}
            renderItem={(item, index) => (
              <List.Item style={{ borderColor: '#333' }}>
                <Space style={{ width: '100%', justifyContent: 'space-between' }}>
                  <Text style={{ color: '#666', fontSize: 12 }}>{item.date}</Text>
                  <Progress
                    percent={Math.min((item.count / dailyGoal) * 100, 100)}
                    size="small"
                    style={{ width: 120 }}
                    strokeColor={index === 0 ? '#1890ff' : '#52c41a'}
                    trailColor="#333"
                  />
                  <Text style={{ color: '#d4d4d4', fontSize: 12 }}>
                    {item.count.toLocaleString()} 字
                  </Text>
                </Space>
              </List.Item>
            )}
          />
        </div>
      </div>
    </div>
  )
}

export default StatsPanel
