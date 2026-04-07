"use client"

import Link from 'next/link'
import { Bell, RefreshCw, Moon, Sun, Activity } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useState, useEffect } from 'react'
import { fetchNotifications, fetchProcessStatus, postSync, type ProcessStatusDto } from '@/lib/api'
import { toast } from 'sonner'

interface HeaderProps {
  title: string
  subtitle?: string
}

export function Header({ title, subtitle }: HeaderProps) {
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [isDark, setIsDark] = useState(false)
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date())
  const [unreadCount, setUnreadCount] = useState(0)
  const [processStatus, setProcessStatus] = useState<ProcessStatusDto>({ active: false })

  useEffect(() => {
    const saved = localStorage.getItem('theme')
    if (saved === 'dark' || (!saved && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
      setIsDark(true)
      document.documentElement.classList.add('dark')
    }
  }, [])

  const loadUnread = () => {
    void fetchNotifications(true, 1, 1)
      .then((r) => setUnreadCount(r.total))
      .catch(() => {})
  }

  useEffect(() => {
    loadUnread()
    const id = setInterval(loadUnread, 60000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    let cancelled = false
    const poll = async () => {
      try {
        const state = await fetchProcessStatus()
        if (!cancelled) setProcessStatus(state)
      } catch {
        /* ignore status polling failures */
      }
    }
    void poll()
    const id = setInterval(poll, processStatus.active ? 2000 : 5000)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [processStatus.active])

  const toggleTheme = () => {
    setIsDark(!isDark)
    if (isDark) {
      document.documentElement.classList.remove('dark')
      localStorage.setItem('theme', 'light')
    } else {
      document.documentElement.classList.add('dark')
      localStorage.setItem('theme', 'dark')
    }
  }

  const handleRefresh = async () => {
    setIsRefreshing(true)
    try {
      await postSync()
      setLastUpdate(new Date())
      loadUnread()
      toast.success('Синхронизация с hh.ru выполнена')
    } catch {
      toast.error('Не удалось запустить синк')
    } finally {
      setIsRefreshing(false)
    }
  }

  return (
    <header className="h-16 bg-card border-b border-border flex items-center justify-between px-6">
      <div>
        <h1 className="text-xl font-bold text-foreground">{title}</h1>
        {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
      </div>

      <div className="flex items-center gap-2">
        {processStatus.active && (
          <Link href="/dashboard/processes">
            <Badge variant="outline" className="gap-1.5 cursor-pointer">
              <Activity className="w-3.5 h-3.5 animate-pulse" />
              {processStatus.processType === 'sync' ? 'Парсинг' : 'AI-анализ'}
              {typeof processStatus.progress === 'number' ? ` ${processStatus.progress}%` : ''}
            </Badge>
          </Link>
        )}
        <span className="text-xs text-muted-foreground hidden sm:block">
          Обновлено: {lastUpdate.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
        </span>

        <Button
          variant="ghost"
          size="icon"
          onClick={() => void handleRefresh()}
          disabled={isRefreshing}
          className="text-muted-foreground hover:text-foreground"
          title="Синк с hh.ru"
        >
          <RefreshCw className={`w-5 h-5 ${isRefreshing ? 'animate-spin' : ''}`} />
        </Button>

        <Button variant="ghost" size="icon" onClick={toggleTheme} className="text-muted-foreground hover:text-foreground">
          {isDark ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="relative text-muted-foreground hover:text-foreground">
              <Bell className="w-5 h-5" />
              {unreadCount > 0 && (
                <Badge className="absolute -top-1 -right-1 h-5 min-w-5 flex items-center justify-center p-0 text-xs px-1">
                  {unreadCount > 99 ? '99+' : unreadCount}
                </Badge>
              )}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-80">
            <DropdownMenuLabel>Уведомления</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href="/dashboard/notifications" className="cursor-pointer">
                Открыть все уведомления
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem disabled className="text-xs text-muted-foreground">
              Непрочитанных: {unreadCount}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  )
}
