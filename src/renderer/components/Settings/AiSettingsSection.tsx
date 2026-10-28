// AI 服务设置区块（M4a Task 2 设置 + Task 6 测试连接闭环）：
// 协议/Base URL/密钥/默认模型/按功能覆盖 + 保存/测试连接/清除密钥。
// 渲染层只接触 AiSettingsView（掩码视图）——密钥输入框永不回填明文，
// 留空即「不修改」（主进程空串保留语义）；清除走 patch.clearApiKey:true 显式路径。
// 测试连接错误分类（T4 契约）：必须经 parseKindTaggedError 解包 `[kind] ` 前缀再展示中文文案，
// 绝不裸匹配 message 文本——Electron 会把 handler reject 裹成 `Error invoking remote method …`。
import React, { useCallback, useEffect, useState } from 'react'
import { Button, Collapse, Divider, Form, Input, Popconfirm, Select, Space, Typography, message } from 'antd'
import { RobotOutlined } from '@ant-design/icons'
import type { AiProtocol, AiSettingsView } from '@/common/ai-types'
import { AI_FEATURE_LABELS } from '@/common/ai-types'
import { useAISettings } from '../../hooks/useIPC'
import { parseKindTaggedError } from '../../hooks/useAI'
import { aiErrorToast } from '../../services/aiErrorText'

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

/** Base URL 占位符随协议切换（M4b Task 0）：两协议的合法形状本就不同 */
const BASE_URL_PLACEHOLDER: Record<AiProtocol, string> = {
  openai: '例如 https://api.openai.com/v1',
  anthropic: '例如 https://api.anthropic.com'
}

const AiSettingsSection: React.FC = () => {
  const [form] = Form.useForm<AiFormValues>()
  const { getAISettings, setAISettings, testAIConnection } = useAISettings()
  const [view, setView] = useState<AiSettingsView | null>(null)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [clearing, setClearing] = useState(false)
  // 占位符跟随协议下拉的实时值（未落定前按初始值 openai 展示）
  const watchedProtocol = Form.useWatch('protocol', form)
  const baseUrlPlaceholder = BASE_URL_PLACEHOLDER[watchedProtocol ?? 'openai']

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
      const result = await testAIConnection()
      message.success(`连接成功（${result.sample}）`, 6)
    } catch (err) {
      // T4 契约：先解包 `[kind] ` 前缀（含 IPC 包装剥离），按 kind 归类中文文案；解不出即 provider
      // （文案表单一权威在 services/aiErrorText——organize 管线共用，不再本地复制）
      const { kind, message: detail } = parseKindTaggedError(String((err as Error)?.message ?? err))
      message.error(aiErrorToast(kind, detail), 8)
    } finally {
      setTesting(false)
    }
  }, [testAIConnection])

  const handleClearKey = useCallback(async () => {
    setClearing(true)
    try {
      const next = await setAISettings({ clearApiKey: true })
      setView(next)
      form.setFieldValue('apiKey', undefined)
      message.success('API 密钥已清除')
    } catch (err) {
      message.error(`清除密钥失败：${err instanceof Error ? err.message : String(err)}`, 8)
    } finally {
      setClearing(false)
    }
  }, [form, setAISettings])

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
            extra={
              <Text style={{ color: 'var(--color-text-tertiary)', fontSize: 12 }}>
                anthropic 填主机根，不要带 /v1
              </Text>
            }
          >
            <Input placeholder={baseUrlPlaceholder} />
          </Form.Item>

          <Form.Item
            label={<Text style={{ color: 'var(--color-text-secondary)' }}>API 密钥</Text>}
            name="apiKey"
            extra={
              <Space size="small">
                <Text style={{ color: 'var(--color-text-secondary)', fontSize: 12 }}>
                  {view?.hasKey
                    ? `当前已设置：${view.maskedKey}，留空则不修改`
                    : '尚未设置 API 密钥'}
                </Text>
                {view?.hasKey && (
                  <Popconfirm
                    title="清除 API 密钥"
                    description="清除后需重新填写才能使用 AI 功能，确定清除？"
                    okText="清除"
                    okButtonProps={{ danger: true }}
                    cancelText="取消"
                    onConfirm={handleClearKey}
                  >
                    <Button type="link" danger size="small" style={{ padding: 0 }} loading={clearing}>
                      清除密钥
                    </Button>
                  </Popconfirm>
                )}
              </Space>
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
                      label={<Text style={{ color: 'var(--color-text-secondary)' }}>{AI_FEATURE_LABELS.organize}（整理本章）</Text>}
                      name="organizeModel"
                    >
                      <Input placeholder="留空 = 使用默认模型" />
                    </Form.Item>
                    <Form.Item
                      label={<Text style={{ color: 'var(--color-text-secondary)' }}>{AI_FEATURE_LABELS.completion}</Text>}
                      name="completionModel"
                    >
                      <Input placeholder="留空 = 使用默认模型" />
                    </Form.Item>
                    <Form.Item
                      label={<Text style={{ color: 'var(--color-text-secondary)' }}>{AI_FEATURE_LABELS.review}</Text>}
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
            {/* 无已保存密钥时置灰：测试的是主进程已存配置，未保存的输入框内容不生效 */}
            <Button onClick={handleTest} loading={testing} disabled={view !== null && !view.hasKey}>
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
