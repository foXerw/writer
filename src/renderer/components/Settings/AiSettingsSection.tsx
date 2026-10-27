// AI 服务设置区块（M4a Task 2）：协议/Base URL/密钥/默认模型/按功能覆盖 + 保存/测试连接。
// 渲染层只接触 AiSettingsView（掩码视图）——密钥输入框永不回填明文，
// 留空即「不修改」（主进程空串保留语义）；测试连接在 provider 就绪前是诚实占位报错。
import React, { useCallback, useEffect, useState } from 'react'
import { Button, Collapse, Divider, Form, Input, Select, Space, Typography, message } from 'antd'
import { RobotOutlined } from '@ant-design/icons'
import type { AiProtocol, AiSettingsView } from '@/common/ai-types'
import { useAISettings } from '../../hooks/useIPC'

const { Text } = Typography

interface AiFormValues {
  protocol: AiProtocol
  baseUrl?: string
  apiKey?: string
  defaultModel?: string
  organizeModel?: string
  completionModel?: string
  reviewModel?: string
}

const PROTOCOL_OPTIONS: { value: AiProtocol; label: string }[] = [
  { value: 'openai', label: 'OpenAI 兼容' },
  { value: 'anthropic', label: 'Anthropic' }
]

const AiSettingsSection: React.FC = () => {
  const [form] = Form.useForm<AiFormValues>()
  const { getAISettings, setAISettings, testAIConnection } = useAISettings()
  const [view, setView] = useState<AiSettingsView | null>(null)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)

  useEffect(() => {
    let cancelled = false
    getAISettings()
      .then((v) => {
        if (cancelled) return
        setView(v)
        form.setFieldsValue({
          protocol: v.protocol,
          baseUrl: v.baseUrl,
          defaultModel: v.defaultModel,
          organizeModel: v.models.organize ?? '',
          completionModel: v.models.completion ?? '',
          reviewModel: v.models.review ?? ''
        })
      })
      .catch(() => {
        if (!cancelled) message.error('读取 AI 设置失败')
      })
    return () => {
      cancelled = true
    }
  }, [getAISettings, form])

  const handleSave = useCallback(async () => {
    const values = await form.validateFields().catch(() => null)
    if (!values) return
    setSaving(true)
    try {
      const next = await setAISettings({
        protocol: values.protocol,
        baseUrl: values.baseUrl ?? '',
        // 空串 = 保留旧密钥（主进程合并语义）
        apiKey: values.apiKey ?? '',
        defaultModel: values.defaultModel ?? '',
        models: {
          organize: values.organizeModel ?? '',
          completion: values.completionModel ?? '',
          review: values.reviewModel ?? ''
        }
      })
      setView(next)
      form.setFieldValue('apiKey', undefined)
      message.success('AI 设置已保存')
    } catch (err) {
      message.error(`保存失败：${err instanceof Error ? err.message : String(err)}`, 8)
    } finally {
      setSaving(false)
    }
  }, [form, setAISettings])

  const handleTest = useCallback(async () => {
    setTesting(true)
    try {
      await testAIConnection()
      message.success('连接正常')
    } catch (err) {
      // Task 2 阶段必然走到这里：AI_PROVIDER_NOT_READY 占位，如实回显、不粉饰
      message.error(err instanceof Error ? err.message : String(err), 8)
    } finally {
      setTesting(false)
    }
  }, [testAIConnection])

  const keyPlaceholder = view?.hasKey
    ? `${view.maskedKey}（已设置，留空则不修改）`
    : '尚未设置，请输入 API 密钥'

  return (
    <div className="ai-settings" style={{ padding: '16px' }}>
      <Space direction="vertical" style={{ width: '100%' }} size="middle">
        <Space>
          <RobotOutlined style={{ color: 'var(--color-text-secondary)' }} />
          <Text style={{ color: 'var(--color-text)', fontWeight: 500 }}>AI 服务</Text>
        </Space>

        <Form form={form} layout="vertical" requiredMark={false}>
          <Form.Item
            label={<Text style={{ color: 'var(--color-text-secondary)' }}>协议</Text>}
            name="protocol"
            initialValue="openai"
          >
            <Select options={PROTOCOL_OPTIONS} style={{ width: 200 }} />
          </Form.Item>

          <Form.Item
            label={<Text style={{ color: 'var(--color-text-secondary)' }}>Base URL</Text>}
            name="baseUrl"
          >
            <Input placeholder="例如 https://api.openai.com/v1" />
          </Form.Item>

          <Form.Item
            label={<Text style={{ color: 'var(--color-text-secondary)' }}>API 密钥</Text>}
            name="apiKey"
            extra={
              <Text style={{ color: 'var(--color-text-secondary)', fontSize: 12 }}>
                {view?.hasKey
                  ? `当前已设置：${view.maskedKey}，留空则不修改`
                  : '尚未设置 API 密钥'}
              </Text>
            }
          >
            <Input.Password placeholder={keyPlaceholder} autoComplete="off" />
          </Form.Item>

          <Form.Item
            label={<Text style={{ color: 'var(--color-text-secondary)' }}>默认模型</Text>}
            name="defaultModel"
          >
            <Input placeholder="例如 gpt-4o-mini / claude-sonnet-4-5" />
          </Form.Item>

          <Collapse
            style={{ background: 'var(--color-bg-base)', borderColor: 'var(--color-border)' }}
            items={[
              {
                key: 'advanced',
                label: '高级（按功能覆盖模型）',
                children: (
                  <>
                    <Form.Item
                      label={<Text style={{ color: 'var(--color-text-secondary)' }}>大纲整理</Text>}
                      name="organizeModel"
                    >
                      <Input placeholder="留空 = 使用默认模型" />
                    </Form.Item>
                    <Form.Item
                      label={<Text style={{ color: 'var(--color-text-secondary)' }}>续写</Text>}
                      name="completionModel"
                    >
                      <Input placeholder="留空 = 使用默认模型" />
                    </Form.Item>
                    <Form.Item
                      label={<Text style={{ color: 'var(--color-text-secondary)' }}>审校</Text>}
                      name="reviewModel"
                    >
                      <Input placeholder="留空 = 使用默认模型" />
                    </Form.Item>
                  </>
                )
              }
            ]}
          />

          <Space style={{ marginTop: 16 }}>
            <Button type="primary" onClick={handleSave} loading={saving}>
              保存
            </Button>
            <Button onClick={handleTest} loading={testing}>
              测试连接
            </Button>
          </Space>
        </Form>
      </Space>
      <Divider style={{ borderColor: 'var(--color-border)', margin: '16px 0 0' }} />
    </div>
  )
}

export default AiSettingsSection
