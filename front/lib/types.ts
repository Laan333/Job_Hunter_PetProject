// Типы для вакансий
export interface Vacancy {
  id: string
  externalId: string
  source: string
  title: string
  company: string
  companyLogo?: string
  salary?: {
    from?: number
    to?: number
    currency: string
    gross?: boolean
  }
  experience?: string
  employment?: string
  schedule?: string
  location: string
  description: string
  requirements?: string
  responsibilities?: string
  skills: string[]
  url: string
  publishedAt: string
  createdAt: string
  responses?: number
  views?: number
  isAnalyzed: boolean
  matchScore?: number
  aiAnalysis?: string
  coverLetter?: string
  isFavorite: boolean
  status: 'new' | 'viewed' | 'applied' | 'rejected' | 'interview'
}

// Типы для резюме
export interface Resume {
  id: string
  title: string
  fullName: string
  position: string
  experience: string
  skills: string[]
  education: string
  about: string
  contacts: {
    email?: string
    phone?: string
    telegram?: string
  }
  rawText: string
  createdAt: string
  updatedAt: string
  isActive: boolean
}

// Типы для поисковых запросов
export interface SearchQuery {
  id: string
  keyword: string
  location?: string
  areaId?: number
  experience?: string
  employment?: string
  salary?: {
    from?: number
    to?: number
  }
  schedule?: string
  isActive: boolean
  interval: number // в минутах
  lastRun?: string
  nextRun?: string
  createdAt: string
  vacanciesFound: number
  /** Saved search vacancy source id (`hh`, `stub`, …). */
  vacancySource?: string
}

// Типы для настроек
export interface Settings {
  apiKeys: {
    /** Маска Authorization Key (GigaChat, личный кабинет Сбера). */
    gigachatAuthorizationKey?: string
    /** @deprecated то же значение, что gigachatAuthorizationKey */
    gigachat?: string
    openai?: string
  }
  refreshInterval: number
  autoAnalyze: boolean
  maxVacanciesPerSearch: number
  notifications: {
    email: boolean
    browser: boolean
  }
  /** Extended fields from API (optional for backward compatibility). */
  analyzeDelay?: number
  browserNotifications?: boolean
  notifyOnNewVacancies?: boolean
  notifyOnHighMatch?: boolean
  highMatchThreshold?: number
  telegramEnabled?: boolean
  matchAnalysisIntervalMinutes?: number
  llmMinIntervalSeconds?: number
  llmProvider?: 'openai' | 'gigachat' | 'none'
  vacancySources?: string[]
  hhDailySyncTime?: string
  hhDailySyncTimezone?: string
  vacancyMaxAgeDays?: number
}

export interface AppNotification {
  id: string
  vacancyId: string
  analysisId: string | null
  summary: string
  score: number | null
  categories: string[]
  readAt: string | null
  createdAt: string
}

// Типы для аналитики
export interface Analytics {
  totalVacancies: number
  newToday: number
  analyzed: number
  applied: number
  avgSalary: number
  topSkills: { skill: string; count: number }[]
  vacanciesByDate: { date: string; count: number }[]
  vacanciesBySource: { source: string; count: number }[]
  vacanciesByExperience: { experience: string; count: number }[]
}

// Типы для пользователя
export interface User {
  isAuthenticated: boolean
  apiKey?: string
}
