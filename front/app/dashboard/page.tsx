"use client"

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Header } from '@/components/dashboard/header'
import { StatsCards } from '@/components/dashboard/stats-cards'
import { RecentVacancies } from '@/components/dashboard/recent-vacancies'
import { SearchQueriesCard } from '@/components/dashboard/search-queries-card'
import { AnalyticsCharts } from '@/components/dashboard/analytics-charts'
import { VacancyDetailModal } from '@/components/dashboard/vacancy-detail-modal'
import { CoverLetterModal } from '@/components/dashboard/cover-letter-modal'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  ApiError,
  deleteVacancy,
  fetchAnalytics,
  fetchLlmStatus,
  fetchSearches,
  fetchVacancies,
  fetchVacancy,
  patchVacancy,
  postAnalyze,
} from '@/lib/api'
import type { Analytics, SearchQuery, Vacancy } from '@/lib/types'

const emptyAnalytics: Analytics = {
  totalVacancies: 0,
  newToday: 0,
  analyzed: 0,
  applied: 0,
  favorites: 0,
  avgSalary: 0,
  topSkills: [],
  vacanciesByDate: [],
  vacanciesBySource: [],
  vacanciesByExperience: [],
}

export default function DashboardPage() {
  const [analytics, setAnalytics] = useState<Analytics>(emptyAnalytics)
  const [vacancies, setVacancies] = useState<Vacancy[]>([])
  const [queries, setQueries] = useState<SearchQuery[]>([])
  const [selectedSearchId, setSelectedSearchId] = useState<string>('all')
  const [selectedVacancy, setSelectedVacancy] = useState<Vacancy | null>(null)
  const [coverLetterVacancy, setCoverLetterVacancy] = useState<Vacancy | null>(null)
  const [llmCooldownSeconds, setLlmCooldownSeconds] = useState(0)

  useEffect(() => {
    let cancelled = false
    const poll = async () => {
      try {
        const s = await fetchLlmStatus()
        if (cancelled) return
        setLlmCooldownSeconds(s.llmCallAllowed ? 0 : s.retryAfterSeconds)
      } catch {
        /* offline / auth */
      }
    }
    void poll()
    const id = setInterval(poll, 2000)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [])

  useEffect(() => {
    const load = async () => {
      try {
        const [a, s] = await Promise.all([fetchAnalytics(), fetchSearches()])
        const selectedKeyword =
          selectedSearchId === 'all' ? undefined : s.find((q) => q.id === selectedSearchId)?.keyword
        const v = await fetchVacancies({ pageSize: 8, q: selectedKeyword })
        setAnalytics(a)
        setVacancies(v.items)
        setQueries(s)
      } catch (e) {
        if (e instanceof ApiError) {
          toast.error(`Дашборд: ошибка ${e.status}`)
        }
      }
    }
    void load()
  }, [selectedSearchId])

  const handleToggleFavorite = async (vacancy: Vacancy) => {
    const next = !vacancy.isFavorite
    try {
      const updated = await patchVacancy(vacancy.id, { isFavorite: next })
      setVacancies((prev) => prev.map((x) => (x.id === vacancy.id ? updated : x)))
      if (selectedVacancy?.id === vacancy.id) setSelectedVacancy(updated)
    } catch {
      toast.error('Не удалось обновить избранное')
    }
  }

  const handleToggleApplied = async (vacancy: Vacancy) => {
    const nextStatus = vacancy.status === 'applied' ? 'viewed' : 'applied'
    try {
      const updated = await patchVacancy(vacancy.id, { status: nextStatus })
      setVacancies((prev) => prev.map((x) => (x.id === vacancy.id ? updated : x)))
      if (selectedVacancy?.id === vacancy.id) setSelectedVacancy(updated)
    } catch {
      toast.error('Не удалось обновить статус отклика')
    }
  }

  const handleCoverSaved = (vacancyId: string, text: string) => {
    setVacancies((prev) =>
      prev.map((x) => (x.id === vacancyId ? { ...x, coverLetter: text } : x)),
    )
    setSelectedVacancy((prev) =>
      prev?.id === vacancyId ? { ...prev, coverLetter: text } : prev,
    )
  }

  const handleViewDetails = async (vacancy: Vacancy) => {
    setSelectedVacancy(vacancy)
    try {
      const full = await fetchVacancy(vacancy.id)
      setSelectedVacancy(full)
      setVacancies((prev) => prev.map((x) => (x.id === vacancy.id ? { ...x, ...full } : x)))
    } catch {
      /* keep list payload */
    }
  }

  const handleAnalyze = async (vacancy: Vacancy) => {
    try {
      const res = await postAnalyze(vacancy.id)
      const a = res.analysis
      setVacancies((prev) =>
        prev.map((x) =>
          x.id === vacancy.id
            ? {
                ...x,
                isAnalyzed: true,
                matchScore: a.score,
                aiAnalysis: a.summaryNotification,
              }
            : x,
        ),
      )
      toast.success(`Анализ готов: ${a.score}/100`)
    } catch (e) {
      if (e instanceof ApiError && e.status === 429) {
        const d = e.body as { detail?: { retryAfterSeconds?: number } | string }
        const det = d?.detail
        const w =
          typeof det === 'object' && det && 'retryAfterSeconds' in det
            ? Number(det.retryAfterSeconds)
            : 60
        setLlmCooldownSeconds(w)
        toast.message('Лимит LLM', { description: `Повторите через ${w} с` })
        return
      }
      toast.error('Ошибка анализа')
    }
  }

  const handleDeleteVacancy = async (vacancy: Vacancy) => {
    if (!confirm(`Удалить вакансию "${vacancy.title}"?`)) return
    try {
      await deleteVacancy(vacancy.id)
      setVacancies((prev) => prev.filter((x) => x.id !== vacancy.id))
      if (selectedVacancy?.id === vacancy.id) setSelectedVacancy(null)
      toast.success('Вакансия удалена')
    } catch {
      toast.error('Не удалось удалить вакансию')
    }
  }

  return (
    <div className="flex flex-col h-full">
      <Header title="Дашборд" subtitle="Обзор вакансий и аналитика" />

      <div className="flex-1 p-6 space-y-6 overflow-auto">
        <StatsCards analytics={analytics} />

        <AnalyticsCharts analytics={analytics} />

        <div className="flex items-center gap-3">
          <span className="text-sm text-muted-foreground">Фильтр вакансий:</span>
          <Select value={selectedSearchId} onValueChange={setSelectedSearchId}>
            <SelectTrigger className="w-[320px]">
              <SelectValue placeholder="Все поисковые запросы" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все поисковые запросы</SelectItem>
              {queries.map((q) => (
                <SelectItem key={q.id} value={q.id}>
                  {q.keyword}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
          <div className="xl:col-span-2">
            <RecentVacancies
              vacancies={vacancies}
              llmCooldownSeconds={llmCooldownSeconds}
              onViewDetails={(v) => void handleViewDetails(v)}
              onGenerateCoverLetter={setCoverLetterVacancy}
              onToggleFavorite={handleToggleFavorite}
              onToggleApplied={handleToggleApplied}
              onAnalyze={handleAnalyze}
              onDelete={(v) => void handleDeleteVacancy(v)}
            />
          </div>
          <div>
            <SearchQueriesCard queries={queries.slice(0, 5)} />
          </div>
        </div>
      </div>

      <VacancyDetailModal
        vacancy={selectedVacancy}
        onClose={() => setSelectedVacancy(null)}
        onGenerateCoverLetter={setCoverLetterVacancy}
        onToggleFavorite={handleToggleFavorite}
        onToggleApplied={handleToggleApplied}
      />
      <CoverLetterModal
        vacancy={coverLetterVacancy}
        onClose={() => setCoverLetterVacancy(null)}
        onSaved={handleCoverSaved}
      />
    </div>
  )
}
