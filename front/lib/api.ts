/**
 * Browser client for FastAPI (`/api/v1` via nginx or NEXT_PUBLIC_API_BASE).
 */

import type { Analytics, AppNotification, Resume, SearchQuery, Vacancy } from '@/lib/types'

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? '/api/v1'

export function getStoredApiKey(): string | null {
  if (typeof window === 'undefined') return null
  return localStorage.getItem('jh_api_key')
}

export class ApiError extends Error {
  status: number
  body: unknown

  constructor(status: number, message: string, body?: unknown) {
    super(message)
    this.status = status
    this.body = body
  }
}

async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const key = getStoredApiKey()
  const headers = new Headers(init.headers)
  if (key) headers.set('X-API-Key', key)
  if (!headers.has('Content-Type') && init.body && typeof init.body === 'string') {
    headers.set('Content-Type', 'application/json')
  }
  const url = path.startsWith('http') ? path : `${API_BASE}${path.startsWith('/') ? '' : '/'}${path}`
  return fetch(url, { ...init, headers })
}

async function parseJson<T>(r: Response): Promise<T> {
  const text = await r.text()
  if (!r.ok) {
    let body: unknown = text
    try {
      body = text ? JSON.parse(text) : null
    } catch {
      /* keep text */
    }
    throw new ApiError(r.status, r.statusText, body)
  }
  return text ? (JSON.parse(text) as T) : (null as T)
}

export async function apiMe(): Promise<{ ok: boolean }> {
  const r = await apiFetch('/me')
  return parseJson(r)
}

export type VacanciesListResponse = {
  items: Vacancy[]
  total: number
  page: number
  pageSize: number
}

export async function fetchVacancies(params?: {
  page?: number
  pageSize?: number
  favoriteOnly?: boolean
  status?: string
}): Promise<VacanciesListResponse> {
  const sp = new URLSearchParams()
  if (params?.page) sp.set('page', String(params.page))
  if (params?.pageSize) sp.set('pageSize', String(params.pageSize))
  if (params?.favoriteOnly) sp.set('favoriteOnly', 'true')
  if (params?.status) sp.set('status', params.status)
  const q = sp.toString()
  const r = await apiFetch(`/vacancies/${q ? `?${q}` : ''}`)
  return parseJson(r)
}

export async function patchVacancy(
  id: string,
  body: Partial<{ status: string; isFavorite: boolean; isAnalyzed: boolean }>,
): Promise<Vacancy> {
  const r = await apiFetch(`/vacancies/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  })
  return parseJson(r)
}

export async function postCoverLetter(vacancyId: string, resumeId?: string): Promise<{ coverLetter: string }> {
  const r = await apiFetch(`/vacancies/${vacancyId}/cover-letter`, {
    method: 'POST',
    body: JSON.stringify(resumeId ? { resumeId } : {}),
  })
  return parseJson(r)
}

export async function postAnalyze(vacancyId: string): Promise<{
  analysis: {
    id: string
    score: number
    summaryNotification: string
    categories: string[]
  }
}> {
  const r = await apiFetch(`/vacancies/${vacancyId}/analyze`, { method: 'POST' })
  return parseJson(r)
}

export async function fetchSearches(): Promise<SearchQuery[]> {
  const r = await apiFetch('/searches')
  return parseJson(r)
}

export async function createSearch(body: Record<string, unknown>): Promise<SearchQuery> {
  const r = await apiFetch('/searches', { method: 'POST', body: JSON.stringify(body) })
  return parseJson(r)
}

export async function patchSearch(id: string, body: Record<string, unknown>): Promise<SearchQuery> {
  const r = await apiFetch(`/searches/${id}`, { method: 'PATCH', body: JSON.stringify(body) })
  return parseJson(r)
}

export async function deleteSearch(id: string): Promise<void> {
  const r = await apiFetch(`/searches/${id}`, { method: 'DELETE' })
  if (!r.ok) await parseJson(r)
}

export type SettingsDto = Record<string, unknown>

export async function fetchSettings(): Promise<SettingsDto> {
  const r = await apiFetch('/settings')
  return parseJson(r)
}

export async function patchSettings(body: Record<string, unknown>): Promise<SettingsDto> {
  const r = await apiFetch('/settings', { method: 'PATCH', body: JSON.stringify(body) })
  return parseJson(r)
}

export type LlmStatusDto = {
  provider: string
  llmCallAllowed: boolean
  retryAfterSeconds: number
  openaiConfigured: boolean
  gigachatConfigured: boolean
  llmMinIntervalSeconds: number
}

export async function fetchLlmStatus(): Promise<LlmStatusDto> {
  const r = await apiFetch('/llm/status')
  return parseJson(r)
}

export async function fetchResumes(): Promise<Resume[]> {
  const r = await apiFetch('/resumes')
  return parseJson(r)
}

export async function postResume(body: Record<string, unknown>): Promise<Resume> {
  const r = await apiFetch('/resumes', { method: 'POST', body: JSON.stringify(body) })
  return parseJson(r)
}

export async function fetchResume(): Promise<Resume | null> {
  const r = await apiFetch('/resume')
  if (r.status === 404) return null
  return parseJson(r)
}

export async function putResume(body: Record<string, unknown>): Promise<Resume> {
  const r = await apiFetch('/resume', { method: 'PUT', body: JSON.stringify(body) })
  return parseJson(r)
}

export async function fetchAnalytics(): Promise<Analytics> {
  const r = await apiFetch('/analytics')
  return parseJson(r)
}

export async function postSync(): Promise<{ runId: string; status: string; error?: string | null }> {
  const r = await apiFetch('/sync', { method: 'POST' })
  return parseJson(r)
}

export type NotificationsListResponse = {
  items: AppNotification[]
  total: number
  page: number
  pageSize: number
}

export async function fetchNotifications(
  unreadOnly?: boolean,
  page = 1,
  pageSize = 50,
): Promise<NotificationsListResponse> {
  const sp = new URLSearchParams()
  sp.set('page', String(page))
  sp.set('pageSize', String(pageSize))
  if (unreadOnly) sp.set('unreadOnly', 'true')
  const r = await apiFetch(`/notifications?${sp.toString()}`)
  return parseJson(r)
}

export async function markNotificationRead(id: string): Promise<AppNotification> {
  const r = await apiFetch(`/notifications/${id}/read`, { method: 'PATCH' })
  return parseJson(r)
}

export async function markAllNotificationsRead(): Promise<{ updated: number }> {
  const r = await apiFetch('/notifications/mark-all-read', { method: 'POST' })
  return parseJson(r)
}
