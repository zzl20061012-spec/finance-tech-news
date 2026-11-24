export const categories = ['semiconductor', 'market', 'ai'] as const

export type Category = (typeof categories)[number]

export interface NewsItem {
  id: string
  title: string
  url: string
  source: string
  publishedAt: string | null
  summary?: string
  categories: Category[]
  keywords?: string[]
}

export interface SourceStatus {
  id: string
  name: string
  status: 'ok' | 'stale' | 'error'
  lastSuccessAt: string | null
}

export interface NewsSnapshot {
  updatedAt: string
  items: NewsItem[]
  sources: SourceStatus[]
}
