import type { ReactNode } from 'react'

export interface MenuItem {
  key: string
  label: string
  icon?: ReactNode
  category?: string
  shortcut?: string
  action?: () => void
}

export interface CommandCategory {
  id: string
  name: string
  items: MenuItem[]
}
