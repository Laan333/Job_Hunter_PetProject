"use client"

import { useEffect, useMemo, useState } from 'react'
import { Header } from '@/components/dashboard/header'
import { VacancyDetailModal } from '@/components/dashboard/vacancy-detail-modal'
import { CoverLetterModal } from '@/components/dashboard/cover-letter-modal'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ApiError, fetchVacancies, fetchVacancy, patchVacancy } from '@/lib/api'
import type { Vacancy } from '@/lib/types'
import { Search, ExternalLink, Send, Sparkles, Undo2 } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

export default function MatchScoresPage() {
  const [vacancies, setVacancies] = useState<Vacancy[]>([])
  const [query, setQuery] = useState('')
  const [minScore, setMinScore] = useState<string>('60')
  const [sourceFilter, setSourceFilter] = useState<string>('all')
  const [fitPreset, setFitPreset] = useState<'all' | 'stretch' | 'high'>('all')
  const [relevantOnly, setRelevantOnly] = useState<boolean>(true)
  const [selectedVacancy, setSelectedVacancy] = useState<Vacancy | null>(null)
  const [coverLetterVacancy, setCoverLetterVacancy] = useState<Vacancy | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      setLoading(true)
      try {
        const first = await fetchVacancies({ page: 1, pageSize: 200 })
        if (cancelled) return
        setVacancies(first.items)
      } catch (e) {
        const msg = e instanceof ApiError ? `Ошибка загрузки (${e.status})` : 'Не удалось загрузить вакансии'
        toast.error(msg)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const min = Math.max(Number(minScore), relevantOnly ? 60 : 0)
    const base = vacancies.filter((v) => (v.matchScore ?? -1) >= min)
    const bySource = sourceFilter === 'all' ? base : base.filter((v) => (v.source || 'other') === sourceFilter)
    const byFit =
      fitPreset === 'all'
        ? bySource
        : bySource.filter((v) => {
            const score = v.matchScore ?? -1
            if (fitPreset === 'stretch') return score >= 70 && score <= 84
            return score >= 85
          })
    if (!q) return byFit
    return byFit.filter(
      (v) =>
        v.title.toLowerCase().includes(q) ||
        v.company.toLowerCase().includes(q) ||
        (v.skills || []).some((s) => s.toLowerCase().includes(q)),
    )
  }, [vacancies, query, minScore, sourceFilter, fitPreset, relevantOnly])

  const sorted = useMemo(
    () => [...filtered].sort((a, b) => (b.matchScore || 0) - (a.matchScore || 0)),
    [filtered],
  )

  const sourceOptions = useMemo(() => {
    const set = new Set<string>()
    vacancies.forEach((v) => set.add(v.source || 'other'))
    return ['all', ...Array.from(set)]
  }, [vacancies])

  const handleOpenDetails = async (vacancy: Vacancy) => {
    setSelectedVacancy(vacancy)
    try {
      const full = await fetchVacancy(vacancy.id)
      setSelectedVacancy(full)
      setVacancies((prev) => prev.map((x) => (x.id === full.id ? { ...x, ...full } : x)))
    } catch {
      // keep list payload as fallback
    }
  }

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

  const scoreBadge = (score: number | null | undefined): { label: string; className: string } => {
    const s = score ?? 0
    if (s >= 85) return { label: 'High-fit', className: 'bg-primary/10 text-primary' }
    if (s >= 70) return { label: 'Good', className: 'bg-chart-3/10 text-chart-3' }
    if (s >= 60) return { label: 'Stretch', className: 'bg-chart-4/10 text-chart-4' }
    return { label: 'Low', className: 'bg-muted text-muted-foreground' }
  }

  return (
    <div className="flex flex-col h-full">
      <Header
        title="Матч-баллы вакансий"
        subtitle={`Всего с анализом: ${sorted.length} из ${vacancies.length}`}
      />
      <div className="flex-1 p-6 space-y-4 overflow-auto">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative max-w-xl flex-1 min-w-[260px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-9"
              placeholder="Фильтр по названию, компании, навыкам..."
            />
          </div>
          <Select value={minScore} onValueChange={setMinScore}>
            <SelectTrigger className="w-[150px]">
              <SelectValue placeholder="Мин. балл" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="60">От 60</SelectItem>
              <SelectItem value="70">От 70</SelectItem>
              <SelectItem value="80">От 80</SelectItem>
              <SelectItem value="90">От 90</SelectItem>
              <SelectItem value="0">Любой балл</SelectItem>
            </SelectContent>
          </Select>
          <Select value={sourceFilter} onValueChange={setSourceFilter}>
            <SelectTrigger className="w-[140px]">
              <SelectValue placeholder="Источник" />
            </SelectTrigger>
            <SelectContent>
              {sourceOptions.map((s) => (
                <SelectItem key={s} value={s}>
                  {s === 'all' ? 'Все источники' : s.toUpperCase()}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant={fitPreset === 'all' ? 'default' : 'outline'}
              onClick={() => setFitPreset('all')}
            >
              Все
            </Button>
            <Button
              size="sm"
              variant={fitPreset === 'stretch' ? 'default' : 'outline'}
              onClick={() => setFitPreset('stretch')}
            >
              На вырост (70-84)
            </Button>
            <Button
              size="sm"
              variant={fitPreset === 'high' ? 'default' : 'outline'}
              onClick={() => setFitPreset('high')}
            >
              High-fit (85+)
            </Button>
          </div>
          <div className="flex items-center gap-2 ml-auto">
            <span className="text-sm text-muted-foreground">Только релевантные (&gt;=60)</span>
            <Switch checked={relevantOnly} onCheckedChange={setRelevantOnly} />
          </div>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          {sorted.map((v) => {
            const applied = v.status === 'applied'
            return (
              <Card
                key={v.id}
                className={cn('border-border/50', applied && 'opacity-75 bg-muted/30')}
              >
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center justify-between gap-3">
                    <span className="truncate flex items-center gap-2 min-w-0">
                      {applied && (
                        <span className="shrink-0 text-chart-2" title="Вы откликнулись">
                          <Send className="w-4 h-4" aria-hidden />
                        </span>
                      )}
                      <span className="truncate">{v.title}</span>
                    </span>
                    <div className="flex flex-wrap items-center justify-end gap-2 shrink-0">
                      <Badge>{v.matchScore}/100</Badge>
                      <Badge variant="secondary" className={scoreBadge(v.matchScore).className}>
                        {scoreBadge(v.matchScore).label}
                      </Badge>
                      {applied && (
                        <Badge variant="secondary" className="bg-chart-2/10 text-chart-2">
                          Отклик
                        </Badge>
                      )}
                    </div>
                  </CardTitle>
                  <p className="text-sm text-muted-foreground">{v.company}</p>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex flex-wrap gap-2">
                    {(v.skills || []).slice(0, 6).map((s) => (
                      <Badge key={s} variant="outline" className="text-xs">
                        {s}
                      </Badge>
                    ))}
                  </div>
                  {v.aiAnalysis && <p className="text-sm text-muted-foreground">{v.aiAnalysis}</p>}
                  <div className="flex flex-wrap items-center gap-2">
                    <Button size="sm" variant="outline" onClick={() => void handleOpenDetails(v)}>
                      Подробнее
                    </Button>
                    <Button
                      size="sm"
                      variant={applied ? 'secondary' : 'outline'}
                      className="gap-1"
                      onClick={() => void handleToggleApplied(v)}
                    >
                      {applied ? <Undo2 className="w-3.5 h-3.5" /> : <Send className="w-3.5 h-3.5" />}
                      {applied ? 'Снять метку' : 'Откликнулся'}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1"
                      onClick={() => setCoverLetterVacancy(v)}
                    >
                      <Sparkles className="w-3.5 h-3.5" />
                      Письмо
                    </Button>
                    <Button size="sm" variant="ghost" asChild>
                      <a href={v.url} target="_blank" rel="noopener noreferrer" className="gap-1 inline-flex items-center">
                        HH
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>

        {!loading && sorted.length === 0 && (
          <div className="text-sm text-muted-foreground">Нет проанализированных вакансий с баллами.</div>
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
