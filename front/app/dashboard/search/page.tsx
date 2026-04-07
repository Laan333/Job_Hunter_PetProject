"use client"

import { useState, useEffect } from 'react'
import { toast } from 'sonner'
import { Header } from '@/components/dashboard/header'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { ApiError, createSearch, deleteSearch, fetchSearches, patchSearch, postSearchSync } from '@/lib/api'
import type { SearchQuery } from '@/lib/types'
import { 
  Search, 
  Plus, 
  Play, 
  Pause, 
  Trash2, 
  Edit, 
  Clock, 
  MapPin,
  Briefcase,
  RefreshCw
} from 'lucide-react'
import { cn } from '@/lib/utils'

export default function SearchQueriesPage() {
  const [queries, setQueries] = useState<SearchQuery[]>([])
  const [syncingId, setSyncingId] = useState<string | null>(null)
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false)
  const [newQuery, setNewQuery] = useState({
    keyword: '',
    location: '',
    experience: '',
    employment: '',
    interval: 60
  })

  useEffect(() => {
    void (async () => {
      try {
        setQueries(await fetchSearches())
      } catch {
        toast.error('Не удалось загрузить поисковые запросы')
      }
    })()
  }, [])

  const handleToggleActive = async (id: string) => {
    const q = queries.find((x) => x.id === id)
    if (!q) return
    try {
      const updated = await patchSearch(id, { isActive: !q.isActive })
      setQueries((prev) => prev.map((x) => (x.id === id ? updated : x)))
    } catch {
      toast.error('Не удалось обновить запрос')
    }
  }

  const handleDelete = async (id: string) => {
    try {
      await deleteSearch(id)
      setQueries((prev) => prev.filter((q) => q.id !== id))
    } catch {
      toast.error('Не удалось удалить запрос')
    }
  }

  const handleRunSyncNow = async (id: string) => {
    setSyncingId(id)
    try {
      const res = await postSearchSync(id)
      setQueries((prev) => prev.map((q) => (q.id === id ? res.search : q)))
      if (res.error) {
        toast.error(`Синк: ${res.error}`)
        return
      }
      if (res.inserted > 0) {
        toast.success(`Добавлено новых вакансий: ${res.inserted}`)
      } else {
        toast.success('Готово: новых вакансий не найдено (возможно, уже были в базе)')
      }
    } catch (e) {
      if (e instanceof ApiError) {
        const detail =
          e.body && typeof e.body === 'object' && e.body !== null && 'detail' in e.body
            ? String((e.body as { detail?: unknown }).detail)
            : e.message
        toast.error(detail || `Ошибка ${e.status}`)
      } else {
        toast.error('Не удалось запустить синхронизацию')
      }
    } finally {
      setSyncingId(null)
    }
  }

  const handleAddQuery = async () => {
    if (!newQuery.keyword.trim()) {
      toast.error('Укажите ключевые слова')
      return
    }
    try {
      const created = await createSearch({
        keyword: newQuery.keyword.trim(),
        location: newQuery.location || undefined,
        experience: newQuery.experience || undefined,
        employment: newQuery.employment || undefined,
        interval: newQuery.interval,
        isActive: true,
      })
      setQueries((prev) => [created, ...prev])
      setIsAddDialogOpen(false)
      setNewQuery({
        keyword: '',
        location: '',
        experience: '',
        employment: '',
        interval: 60,
      })
    } catch {
      toast.error('Не удалось создать запрос')
    }
  }

  const formatTime = (minutes: number) => {
    if (minutes < 60) return `${minutes} мин`
    return `${Math.floor(minutes / 60)} ч`
  }

  const experienceOptions = [
    { value: '', label: 'Любой опыт' },
    { value: 'noExperience', label: 'Без опыта' },
    { value: 'between1And3', label: '1-3 года' },
    { value: 'between3And6', label: '3-6 лет' },
    { value: 'moreThan6', label: 'Более 6 лет' },
  ]

  const employmentOptions = [
    { value: '', label: 'Любая занятость' },
    { value: 'full', label: 'Полная занятость' },
    { value: 'part', label: 'Частичная занятость' },
    { value: 'project', label: 'Проектная работа' },
    { value: 'probation', label: 'Стажировка' },
  ]

  const intervalOptions = [
    { value: 30, label: 'Каждые 30 минут' },
    { value: 60, label: 'Каждый час' },
    { value: 120, label: 'Каждые 2 часа' },
    { value: 360, label: 'Каждые 6 часов' },
    { value: 720, label: 'Каждые 12 часов' },
    { value: 1440, label: 'Раз в день' },
  ]

  return (
    <div className="flex flex-col h-full">
      <Header 
        title="Поисковые запросы" 
        subtitle="Настройка автоматического поиска вакансий"
      />
      
      <div className="flex-1 p-6 space-y-6 overflow-auto">
        {/* Add Query Button */}
        <div className="flex justify-between items-center">
          <div>
            <p className="text-muted-foreground">
              Активных запросов: {queries.filter(q => q.isActive).length} из {queries.length}
            </p>
          </div>
          <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
            <DialogTrigger asChild>
              <Button className="gap-2">
                <Plus className="w-4 h-4" />
                Добавить запрос
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>Новый поисковый запрос</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="keyword">Ключевые слова *</Label>
                  <Input
                    id="keyword"
                    placeholder="Frontend Developer React"
                    value={newQuery.keyword}
                    onChange={(e) => setNewQuery(prev => ({ ...prev, keyword: e.target.value }))}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="location">Город</Label>
                  <Input
                    id="location"
                    placeholder="Москва"
                    value={newQuery.location}
                    onChange={(e) => setNewQuery(prev => ({ ...prev, location: e.target.value }))}
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Опыт работы</Label>
                    <Select 
                      value={newQuery.experience}
                      onValueChange={(value) => setNewQuery(prev => ({ ...prev, experience: value }))}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Выберите" />
                      </SelectTrigger>
                      <SelectContent>
                        {experienceOptions.map(opt => (
                          <SelectItem key={opt.value} value={opt.value || 'any'}>
                            {opt.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label>Занятость</Label>
                    <Select 
                      value={newQuery.employment}
                      onValueChange={(value) => setNewQuery(prev => ({ ...prev, employment: value }))}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Выберите" />
                      </SelectTrigger>
                      <SelectContent>
                        {employmentOptions.map(opt => (
                          <SelectItem key={opt.value} value={opt.value || 'any'}>
                            {opt.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Интервал обновления</Label>
                  <Select 
                    value={newQuery.interval.toString()}
                    onValueChange={(value) => setNewQuery(prev => ({ ...prev, interval: parseInt(value) }))}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {intervalOptions.map(opt => (
                        <SelectItem key={opt.value} value={opt.value.toString()}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="text-xs text-muted-foreground">
                  Источник вакансий по умолчанию: <code className="text-foreground">hh</code> (поле{' '}
                  <code className="text-foreground">vacancySource</code> в API).
                </div>

                <Button 
                  onClick={handleAddQuery} 
                  className="w-full"
                  disabled={!newQuery.keyword.trim()}
                >
                  Создать запрос
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        {/* Queries List */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {queries.map((query) => (
            <Card 
              key={query.id} 
              className={cn(
                "border-border/50 transition-colors",
                query.isActive ? "bg-card" : "bg-muted/30"
              )}
            >
              <CardContent className="p-5">
                <div className="flex items-start justify-between gap-4 mb-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-2">
                      <Search className="w-5 h-5 text-primary" />
                      <h3 className="font-semibold text-lg truncate">{query.keyword}</h3>
                    </div>
                    <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                      {query.location && (
                        <span className="flex items-center gap-1">
                          <MapPin className="w-4 h-4" />
                          {query.location}
                        </span>
                      )}
                      {query.experience && (
                        <span className="flex items-center gap-1">
                          <Briefcase className="w-4 h-4" />
                          {query.experience}
                        </span>
                      )}
                      <span className="flex items-center gap-1">
                        <Clock className="w-4 h-4" />
                        каждые {formatTime(query.interval)}
                      </span>
                    </div>
                  </div>
                  <Switch
                    checked={query.isActive}
                    onCheckedChange={() => handleToggleActive(query.id)}
                  />
                </div>

                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary" className="text-sm">
                      {query.vacanciesFound} вакансий найдено
                    </Badge>
                    <Badge variant="outline" className="text-xs">
                      {query.vacancySource ?? 'hh'}
                    </Badge>
                  </div>
                </div>

                {query.lastRun && (
                  <div className="text-xs text-muted-foreground mb-4">
                    Последний запуск: {new Date(query.lastRun).toLocaleString('ru-RU')}
                  </div>
                )}

                <div className="flex items-center gap-2 pt-4 border-t border-border">
                  <Button 
                    variant="outline" 
                    size="sm" 
                    className="flex-1 gap-2"
                    disabled={syncingId === query.id}
                    onClick={() => void handleRunSyncNow(query.id)}
                  >
                    <RefreshCw className={cn('w-4 h-4', syncingId === query.id && 'animate-spin')} />
                    {syncingId === query.id ? 'Синхронизация…' : 'Запустить сейчас'}
                  </Button>
                  <Button variant="ghost" size="icon" className="h-8 w-8">
                    <Edit className="w-4 h-4" />
                  </Button>
                  <Button 
                    variant="ghost" 
                    size="icon" 
                    className="h-8 w-8 text-destructive hover:text-destructive"
                    onClick={() => handleDelete(query.id)}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {queries.length === 0 && (
          <div className="text-center py-12">
            <Search className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-semibold mb-2">Нет поисковых запросов</h3>
            <p className="text-muted-foreground mb-4">
              Создайте первый запрос для автоматического поиска вакансий
            </p>
            <Button onClick={() => setIsAddDialogOpen(true)}>
              <Plus className="w-4 h-4 mr-2" />
              Создать запрос
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
