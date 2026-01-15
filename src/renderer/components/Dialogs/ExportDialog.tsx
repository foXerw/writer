import React, { useState } from 'react'
import {
  Modal,
  Radio,
  Select,
  InputNumber,
  Space,
  Typography,
  Button,
  Progress,
  message,
  Divider
} from 'antd'
import {
  FileMarkdownOutlined,
  FileWordOutlined,
  FilePdfOutlined,
  BookOutlined,
  DownloadOutlined
} from '@ant-design/icons'
import type { Chapter } from '@/common/ipc'

const { Text, Title } = Typography

interface ExportDialogProps {
  open: boolean
  onClose: () => void
  chapters: Chapter[]
  projectName: string
  onExport: (options: ExportOptions) => Promise<void>
}

export interface ExportOptions {
  format: 'markdown' | 'word' | 'pdf' | 'epub'
  includeChapters: 'current' | 'all' | 'selected'
  selectedChapterIds?: string[]
  options?: {
    addFrontMatter?: boolean
    addToc?: boolean
    chapterAsFile?: boolean
  }
}

const ExportDialog: React.FC<ExportDialogProps> = ({
  open,
  onClose,
  chapters,
  projectName,
  onExport
}) => {
  const [format, setFormat] = useState<ExportOptions['format']>('markdown')
  const [includeChapters, setIncludeChapters] = useState<ExportOptions['includeChapters']>('all')
  const [selectedChapters, setSelectedChapters] = useState<string[]>([])
  const [addFrontMatter, setAddFrontMatter] = useState(true)
  const [addToc, setAddToc] = useState(true)
  const [exporting, setExporting] = useState(false)
  const [exportProgress, setExportProgress] = useState(0)
  const [messageApi, contextHolder] = message.useMessage()

  // 导出格式配置
  const formatOptions = [
    { value: 'markdown', label: 'Markdown', icon: <FileMarkdownOutlined />, desc: '纯文本格式，广泛支持' },
    { value: 'word', label: 'Word文档', icon: <FileWordOutlined />, desc: 'docx格式，可编辑' },
    { value: 'pdf', label: 'PDF文档', icon: <FilePdfOutlined />, desc: '便携式文档' },
    { value: 'epub', label: '电子书', icon: <BookOutlined />, desc: 'ePub格式，适合阅读器' }
  ]

  // 处理导出
  const handleExport = async () => {
    setExporting(true)
    setExportProgress(0)

    try {
      // 模拟导出进度
      const progressInterval = setInterval(() => {
        setExportProgress(prev => {
          if (prev >= 90) {
            clearInterval(progressInterval)
            return prev
          }
          return prev + 10
        })
      }, 200)

      await onExport({
        format,
        includeChapters,
        selectedChapterIds: selectedChapters,
        options: {
          addFrontMatter,
          addToc
        }
      })

      clearInterval(progressInterval)
      setExportProgress(100)
      messageApi.success('导出成功！')
      onClose()
    } catch (error) {
      messageApi.error('导出失败，请重试')
      console.error('Export error:', error)
    } finally {
      setExporting(false)
      setExportProgress(0)
    }
  }

  return (
    <>
      {contextHolder}
      <Modal
        title="导出项目"
        open={open}
        onCancel={onClose}
        footer={null}
        width={500}
      >
        <Space direction="vertical" style={{ width: '100%' }} size="large">
          {/* 导出格式 */}
          <div>
            <Text style={{ color: '#888', fontSize: 12 }}>导出格式</Text>
            <div style={{ marginTop: 8 }}>
              <Radio.Group
                value={format}
                onChange={(e) => setFormat(e.target.value)}
                buttonStyle="solid"
                style={{ width: '100%' }}
              >
                <Space direction="vertical" style={{ width: '100%' }}>
                  {formatOptions.map(opt => (
                    <Radio.Button
                      key={opt.value}
                      value={opt.value}
                      style={{
                        width: '100%',
                        height: 'auto',
                        padding: '12px 16px',
                        borderColor: format === opt.value ? '#1890ff' : '#333',
                        background: format === opt.value ? 'rgba(24, 144, 255, 0.1)' : 'transparent'
                      }}
                    >
                      <Space>
                        <span style={{ color: format === opt.value ? '#1890ff' : '#888' }}>
                          {opt.icon}
                        </span>
                        <div>
                          <Text style={{ color: format === opt.value ? '#1890ff' : '#d4d4d4' }}>
                            {opt.label}
                          </Text>
                          <br />
                          <Text style={{ color: '#666', fontSize: 11 }}>{opt.desc}</Text>
                        </div>
                      </Space>
                    </Radio.Button>
                  ))}
                </Space>
              </Radio.Group>
            </div>
          </div>

          <Divider style={{ borderColor: '#333' }} />

          {/* 导出范围 */}
          <div>
            <Text style={{ color: '#888', fontSize: 12 }}>导出范围</Text>
            <Radio.Group
              value={includeChapters}
              onChange={(e) => setIncludeChapters(e.target.value)}
              style={{ marginTop: 8 }}
            >
              <Space direction="vertical">
                <Radio value="current">当前章节</Radio>
                <Radio value="all">全部章节 ({chapters.length}篇)</Radio>
                <Radio value="selected">选择章节</Radio>
              </Space>
            </Radio.Group>

            {includeChapters === 'selected' && (
              <Select
                mode="multiple"
                placeholder="选择要导出的章节"
                value={selectedChapters}
                onChange={setSelectedChapters}
                style={{ width: '100%', marginTop: 8 }}
                options={chapters.map(c => ({
                  value: c.id,
                  label: c.title || '无标题'
                }))}
              />
            )}
          </div>

          <Divider style={{ borderColor: '#333' }} />

          {/* 导出选项 */}
          <div>
            <Text style={{ color: '#888', fontSize: 12 }}>导出选项</Text>
            <Space direction="vertical" style={{ width: '100%', marginTop: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input
                  type="checkbox"
                  checked={addFrontMatter}
                  onChange={(e) => setAddFrontMatter(e.target.checked)}
                />
                <Text style={{ color: '#d4d4d4' }}>添加YAML前言</Text>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input
                  type="checkbox"
                  checked={addToc}
                  onChange={(e) => setAddToc(e.target.checked)}
                />
                <Text style={{ color: '#d4d4d4' }}>生成目录</Text>
              </div>
            </Space>
          </div>

          {/* 导出进度 */}
          {exporting && (
            <div>
              <Text style={{ color: '#888', fontSize: 12 }}>导出中...</Text>
              <Progress
                percent={exportProgress}
                size="small"
                status="active"
                strokeColor="#1890ff"
                trailColor="#333"
              />
            </div>
          )}

          {/* 操作按钮 */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <Button onClick={onClose} disabled={exporting}>
              取消
            </Button>
            <Button
              type="primary"
              icon={<DownloadOutlined />}
              onClick={handleExport}
              loading={exporting}
              disabled={includeChapters === 'selected' && selectedChapters.length === 0}
            >
              导出
            </Button>
          </div>
        </Space>
      </Modal>
    </>
  )
}

export default ExportDialog
