"use client"

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { Header } from '@/components/dashboard/header'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { SafeMarkdown } from '@/components/safe-markdown'
import { fetchNotifications, markAllNotificationsRead, markNotificationRead } from '@/lib/api'
import type { AppNotification } from '@/lib/types'
import { Bell, Check, CheckCheck, ExternalLink } from 'lucide-react'

export default function NotificationsPage() {
  const [items, setItems] = useState<AppNotification[]>([])
  const [filter, setFilter] = useState<'all' | 'unread'>('all')
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetchNotifications(filter === 'unread', 1, 100)
      setItems(res.items)
    } catch (e) {
      toast.error('Не удалось загрузить уведомления')
    } finally {
      setLoading(false)
    }
  }, [filter])

  useEffect(() => {
    void load()
  }, [load])

  const onRead = async (n: AppNotification) => {
    if (n.readAt) return
    try {
      if (filter === 'unread') {
        await markNotificationRead(n.id)
        await load()
      } else {
        const updated = await markNotificationRead(n.id)
        setItems((prev) => prev.map((x) => (x.id === n.id ? updated : x)))
      }
    } catch {
      toast.error('Ошибка')
    }
  }

  const onReadAll = async () => {
    try {
      await markAllNotificationsRead()
      await load()
      toast.success('Все отмечены прочитанными')
    } catch {
      toast.error('Ошибка')
    }
  }

  return (
    <div className="flex flex-col h-full">
      <Header title="Уведомления" subtitle="Матчинг и высокий score" />

      <div className="flex-1 p-6 space-y-4 overflow-auto">
        <div className="flex flex-wrap gap-2 items-center">
          <Button variant={filter === 'all' ? 'default' : 'outline'} size="sm" onClick={() => setFilter('all')}>
            Все
          </Button>
          <Button variant={filter === 'unread' ? 'default' : 'outline'} size="sm" onClick={() => setFilter('unread')}>
            Непрочитанные
          </Button>
          <Button variant="outline" size="sm" className="ml-auto gap-2" onClick={() => void onReadAll()}>
            <CheckCheck className="w-4 h-4" />
            Прочитать все
          </Button>
          <Button variant="ghost" size="sm" onClick={() => void load()} disabled={loading}>
            Обновить
          </Button>
        </div>

        {items.length === 0 && !loading && (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              <Bell className="w-10 h-10 mx-auto mb-2 opacity-50" />
              Пока нет уведомлений. Включите плановый матчинг и порог в настройках.
            </CardContent>
          </Card>
        )}

        <div className="space-y-3">
          {items.map((n) => (
            <Card key={n.id} className={n.readAt ? 'opacity-70' : 'border-primary/30'}>
              <CardContent className="p-4 space-y-2">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    {n.score != null && <Badge variant="secondary">{n.score}/100</Badge>}
                    {n.categories?.slice(0, 4).map((c) => (
                      <Badge key={c} variant="outline" className="text-xs">
                        {c}
                      </Badge>
                    ))}
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {new Date(n.createdAt).toLocaleString('ru-RU')}
                  </span>
                </div>
                <SafeMarkdown className="text-sm [&_p]:mb-1">{n.summary}</SafeMarkdown>
                <div className="flex gap-2 pt-2">
                  <Button variant="outline" size="sm" className="gap-1" asChild>
                    <Link href={`/dashboard/vacancies?vacancyId=${n.vacancyId}`}>
                      <ExternalLink className="w-3 h-3" />
                      К вакансии
                    </Link>
                  </Button>
                  {!n.readAt && (
                    <Button size="sm" variant="secondary" className="gap-1" onClick={() => void onRead(n)}>
                      <Check className="w-3 h-3" />
                      Прочитано
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  )
}
