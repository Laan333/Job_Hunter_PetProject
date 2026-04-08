"use client"

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useSearchParams } from 'next/navigation'
import { toast } from 'sonner'
import { Header } from '@/components/dashboard/header'
import { VacancyCard } from '@/components/dashboard/vacancy-card'
import { VacancyDetailModal } from '@/components/dashboard/vacancy-detail-modal'
import { CoverLetterModal } from '@/components/dashboard/cover-letter-modal'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ApiError, deleteVacancy, fetchLlmStatus, fetchSearches, fetchVacancies, fetchVacancy, patchVacancy, postAnalyze, postClearVacancies } from '@/lib/api'
import type { SearchQuery, Vacancy } from '@/lib/types'
import { Search, Filter, SortAsc, Star, Brain, Grid3X3, List } from 'lucide-react'
import { cn } from '@/lib/utils'

export default function VacanciesPage() {
  const searchParams = useSearchParams()
  const [vacancies, setVacancies] = useState<Vacancy[]>([])
  const [searches, setSearches] = useState<SearchQuery[]>([])
  const [selectedSearchId, setSelectedSearchId] = useState<string>('all')
  const [searchTerm, setSearchTerm] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [sortBy, setSortBy] = useState<string>('date')
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid')
  const [selectedVacancy, setSelectedVacancy] = useState<Vacancy | null>(null)
  const [coverLetterVacancy, setCoverLetterVacancy] = useState<Vacancy | null>(null)
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [llmCooldownSeconds, setLlmCooldownSeconds] = useState(0)
  const loadMoreRef = useRef<HTMLDivElement | null>(null)
  const linkVacancyId = searchParams.get('vacancyId')
  const PAGE_SIZE = 40

  const selectedSearchKeyword = useMemo(() => {
    if (selectedSearchId === 'all') return ''
    return searches.find((s) => s.id === selectedSearchId)?.keyword ?? ''
  }, [searches, selectedSearchId])

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

  const loadVacancies = useCallback(async (nextPage = 1, append = false) => {
    if (append) setLoadingMore(true)
    else setLoading(true)
    try {
      const data = await fetchVacancies({
        page: nextPage,
        pageSize: PAGE_SIZE,
        favoriteOnly: showFavoritesOnly || undefined,
        status: statusFilter !== 'all' ? statusFilter : undefined,
        q: selectedSearchKeyword || undefined,
      })
      setTotal(data.total)
      setPage(data.page)
      setVacancies((prev) => (append ? [...prev, ...data.items] : data.items))
    } catch (e) {
      toast.error(e instanceof ApiError ? `Ошибка загрузки (${e.status})` : 'Не удалось загрузить вакансии')
    } finally {
      if (append) setLoadingMore(false)
      else setLoading(false)
    }
  }, [selectedSearchKeyword, showFavoritesOnly, statusFilter])

  useEffect(() => {
    void loadVacancies(1, false)
  }, [loadVacancies])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const items = await fetchSearches()
        if (!cancelled) setSearches(items)
      } catch {
        /* ignore optional filter data failure */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const node = loadMoreRef.current
    if (!node || loading || loadingMore || vacancies.length >= total) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && !loadingMore && vacancies.length < total) {
          void loadVacancies(page + 1, true)
        }
      },
      { rootMargin: '220px' },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [loadVacancies, loading, loadingMore, page, total, vacancies.length])

  useEffect(() => {
    if (!linkVacancyId) return
    let cancelled = false
    void (async () => {
      try {
        const full = await fetchVacancy(linkVacancyId)
        if (cancelled) return
        setSelectedVacancy(full)
        setVacancies((prev) => {
          const exists = prev.some((v) => v.id === full.id)
          return exists ? prev.map((v) => (v.id === full.id ? { ...v, ...full } : v)) : [full, ...prev]
        })
      } catch {
        if (!cancelled) toast.error('Не удалось открыть вакансию по ссылке')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [linkVacancyId])

  const filteredVacancies = vacancies
    .filter((v) => {
      if (searchTerm) {
        const search = searchTerm.toLowerCase()
        return (
          v.title.toLowerCase().includes(search) ||
          v.company.toLowerCase().includes(search) ||
          (v.skills || []).some((s) => s.toLowerCase().includes(search))
        )
      }
      return true
    })
    .sort((a, b) => {
      switch (sortBy) {
        case 'date':
          return new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()
        case 'salary':
          return (b.salary?.from || 0) - (a.salary?.from || 0)
        case 'match':
          return (b.matchScore || 0) - (a.matchScore || 0)
        default:
          return 0
      }
    })

  const handleToggleFavorite = async (vacancy: Vacancy) => {
    const next = !vacancy.isFavorite
    try {
      const updated = await patchVacancy(vacancy.id, { isFavorite: next })
      setVacancies((prev) => prev.map((v) => (v.id === vacancy.id ? updated : v)))
      if (selectedVacancy?.id === vacancy.id) setSelectedVacancy(updated)
    } catch {
      toast.error('Не удалось обновить избранное')
    }
  }

  const handleToggleApplied = async (vacancy: Vacancy) => {
    const nextStatus = vacancy.status === 'applied' ? 'viewed' : 'applied'
    try {
      const updated = await patchVacancy(vacancy.id, { status: nextStatus })
      setVacancies((prev) => prev.map((v) => (v.id === vacancy.id ? updated : v)))
      if (selectedVacancy?.id === vacancy.id) setSelectedVacancy(updated)
    } catch {
      toast.error('Не удалось обновить статус отклика')
    }
  }

  const handleAnalyze = async (vacancy: Vacancy) => {
    try {
      const res = await postAnalyze(vacancy.id)
      const a = res.analysis
      setVacancies((prev) =>
        prev.map((v) =>
          v.id === vacancy.id
            ? {
                ...v,
                isAnalyzed: true,
                matchScore: a.score,
                aiAnalysis: a.summaryNotification,
              }
            : v,
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
        toast.message(`Лимит LLM`, { description: `Повторите через ${w} с` })
        return
      }
      toast.error('Ошибка анализа')
    }
  }

  const handleCoverSaved = (vacancyId: string, text: string) => {
    setVacancies((prev) =>
      prev.map((v) => (v.id === vacancyId ? { ...v, coverLetter: text } : v)),
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
      setVacancies((prev) => prev.map((v) => (v.id === vacancy.id ? { ...v, ...full } : v)))
    } catch {
      // Keep fallback with list payload if detail fetch fails.
    }
  }

  const handleDeleteVacancy = async (vacancy: Vacancy) => {
    if (!confirm(`Удалить вакансию "${vacancy.title}"?`)) return
    try {
      await deleteVacancy(vacancy.id)
      setVacancies((prev) => prev.filter((v) => v.id !== vacancy.id))
      if (selectedVacancy?.id === vacancy.id) setSelectedVacancy(null)
      toast.success('Вакансия удалена')
    } catch {
      toast.error('Не удалось удалить вакансию')
    }
  }

  const handleDeleteAllVacancies = async () => {
    if (!confirm('Удалить ВСЕ вакансии из базы?')) return
    try {
      const res = await postClearVacancies()
      setVacancies([])
      setSelectedVacancy(null)
      toast.success(`Удалено вакансий: ${res.deleted}`)
    } catch {
      toast.error('Не удалось удалить вакансии')
    }
  }

  const statusOptions = [
    { value: 'all', label: 'Все статусы' },
    { value: 'new', label: 'Новые' },
    { value: 'viewed', label: 'Просмотренные' },
    { value: 'applied', label: 'С откликом' },
    { value: 'rejected', label: 'Отказы' },
    { value: 'interview', label: 'Интервью' },
  ]

  const sortOptions = [
    { value: 'date', label: 'По дате' },
    { value: 'salary', label: 'По зарплате' },
    { value: 'match', label: 'По совпадению' },
  ]

  return (
    <div className="flex flex-col h-full">
      <Header title="Вакансии" subtitle={`${filteredVacancies.length} из ${vacancies.length} вакансий`} />

      <div className="flex-1 p-6 space-y-6 overflow-auto">
        <div className="flex flex-wrap items-center gap-4">
          <div className="relative flex-1 min-w-[250px] max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
            <Input
              placeholder="Поиск по названию, компании, навыкам..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10"
            />
          </div>

          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[180px]">
              <Filter className="w-4 h-4 mr-2" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {statusOptions.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={selectedSearchId} onValueChange={setSelectedSearchId}>
            <SelectTrigger className="w-[240px]">
              <Search className="w-4 h-4 mr-2" />
              <SelectValue placeholder="Поисковый запрос" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все поисковые запросы</SelectItem>
              {searches.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.keyword}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={sortBy} onValueChange={setSortBy}>
            <SelectTrigger className="w-[160px]">
              <SortAsc className="w-4 h-4 mr-2" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {sortOptions.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Button
            variant={showFavoritesOnly ? 'default' : 'outline'}
            size="sm"
            onClick={() => setShowFavoritesOnly(!showFavoritesOnly)}
            className="gap-2"
          >
            <Star className={cn('w-4 h-4', showFavoritesOnly && 'fill-current')} />
            Избранное
          </Button>

          <Button variant="outline" size="sm" onClick={() => void loadVacancies(1, false)} disabled={loading}>
            Обновить
          </Button>
          <Button variant="destructive" size="sm" onClick={() => void handleDeleteAllVacancies()}>
            Удалить все
          </Button>

          <div className="flex items-center gap-1 ml-auto border rounded-lg p-1">
            <Button variant={viewMode === 'grid' ? 'secondary' : 'ghost'} size="icon" className="h-8 w-8" onClick={() => setViewMode('grid')}>
              <Grid3X3 className="w-4 h-4" />
            </Button>
            <Button variant={viewMode === 'list' ? 'secondary' : 'ghost'} size="icon" className="h-8 w-8" onClick={() => setViewMode('list')}>
              <List className="w-4 h-4" />
            </Button>
          </div>
        </div>

        <div className="flex items-center gap-4 flex-wrap">
          <Badge variant="secondary" className="gap-1">
            <div className="w-2 h-2 rounded-full bg-primary" />
            Новые: {filteredVacancies.filter((v) => v.status === 'new').length}
          </Badge>
          <Badge variant="secondary" className="gap-1">
            <Brain className="w-3 h-3" />
            Проанализировано: {filteredVacancies.filter((v) => v.isAnalyzed).length}
          </Badge>
          <Badge variant="secondary" className="gap-1">
            <Star className="w-3 h-3 fill-current text-chart-5" />
            В избранном: {filteredVacancies.filter((v) => v.isFavorite).length}
          </Badge>
        </div>

        <div
          className={cn('grid gap-4', viewMode === 'grid' ? 'grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3' : 'grid-cols-1')}
        >
          {filteredVacancies.map((vacancy) => (
            <VacancyCard
              key={vacancy.id}
              vacancy={vacancy}
              llmCooldownSeconds={llmCooldownSeconds}
              onViewDetails={(v) => void handleViewDetails(v)}
              onGenerateCoverLetter={setCoverLetterVacancy}
              onToggleFavorite={handleToggleFavorite}
              onToggleApplied={handleToggleApplied}
              onAnalyze={handleAnalyze}
              onDelete={(v) => void handleDeleteVacancy(v)}
            />
          ))}
        </div>

        <div ref={loadMoreRef} className="h-8" />
        {(loadingMore || vacancies.length < total) && (
          <div className="text-center text-sm text-muted-foreground pb-4">
            {loadingMore ? 'Загружаем еще вакансии...' : 'Прокрутите ниже для подгрузки'}
          </div>
        )}

        {!loading && filteredVacancies.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <Search className="w-12 h-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">Вакансии не найдены</h3>
            <p className="text-muted-foreground">Запустите синк в настройках или добавьте поисковые запросы</p>
          </div>
        )}
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
