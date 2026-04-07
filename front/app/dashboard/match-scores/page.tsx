"use client"

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Header } from '@/components/dashboard/header'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ApiError, fetchVacancies } from '@/lib/api'
import type { Vacancy } from '@/lib/types'
import { Search, ExternalLink } from 'lucide-react'
import { toast } from 'sonner'

export default function MatchScoresPage() {
  const [vacancies, setVacancies] = useState<Vacancy[]>([])
  const [query, setQuery] = useState('')
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
    const base = vacancies.filter((v) => v.matchScore != null)
    if (!q) return base
    return base.filter(
      (v) =>
        v.title.toLowerCase().includes(q) ||
        v.company.toLowerCase().includes(q) ||
        (v.skills || []).some((s) => s.toLowerCase().includes(q)),
    )
  }, [vacancies, query])

  const sorted = useMemo(
    () => [...filtered].sort((a, b) => (b.matchScore || 0) - (a.matchScore || 0)),
    [filtered],
  )

  return (
    <div className="flex flex-col h-full">
      <Header
        title="Матч-баллы вакансий"
        subtitle={`Всего с анализом: ${sorted.length} из ${vacancies.length}`}
      />
      <div className="flex-1 p-6 space-y-4 overflow-auto">
        <div className="relative max-w-xl">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-9"
            placeholder="Фильтр по названию, компании, навыкам..."
          />
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          {sorted.map((v) => (
            <Card key={v.id} className="border-border/50">
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center justify-between gap-3">
                  <span className="truncate">{v.title}</span>
                  <Badge>{v.matchScore}/100</Badge>
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
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="outline" asChild>
                    <Link href="/dashboard/vacancies">К вакансии в CRM</Link>
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
          ))}
        </div>

        {!loading && sorted.length === 0 && (
          <div className="text-sm text-muted-foreground">Нет проанализированных вакансий с баллами.</div>
        )}
      </div>
    </div>
  )
}
