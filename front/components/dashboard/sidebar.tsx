"use client"

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import { useAuth } from '@/lib/auth-context'
import { Button } from '@/components/ui/button'
import {
  LayoutDashboard,
  Briefcase,
  FileText,
  BarChart3,
  Settings,
  Search,
  LogOut,
  ChevronLeft,
  ChevronRight,
  Bell,
  Trophy
} from 'lucide-react'
import { useState } from 'react'

const navigation = [
  { name: 'Дашборд', href: '/dashboard', icon: LayoutDashboard },
  { name: 'Вакансии', href: '/dashboard/vacancies', icon: Briefcase },
  { name: 'Поисковые запросы', href: '/dashboard/search', icon: Search },
  { name: 'Моё резюме', href: '/dashboard/resume', icon: FileText },
  { name: 'Аналитика', href: '/dashboard/analytics', icon: BarChart3 },
  { name: 'Матч-баллы', href: '/dashboard/match-scores', icon: Trophy },
  { name: 'Уведомления', href: '/dashboard/notifications', icon: Bell },
  { name: 'Настройки', href: '/dashboard/settings', icon: Settings },
]

export function Sidebar() {
  const pathname = usePathname()
  const { logout } = useAuth()
  const [collapsed, setCollapsed] = useState(false)

  return (
    <aside 
      className={cn(
        "flex flex-col bg-card text-foreground border-r border-border transition-all duration-300",
        collapsed ? "w-16" : "w-64"
      )}
    >
      {/* Logo */}
      <div className="h-16 flex items-center justify-between px-4 border-b border-border">
        {!collapsed && (
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
              <Briefcase className="w-5 h-5 text-primary-foreground" />
            </div>
            <span className="font-bold text-lg text-foreground">JobHunter</span>
          </div>
        )}
        {collapsed && (
          <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center mx-auto">
            <Briefcase className="w-5 h-5 text-primary-foreground" />
          </div>
        )}
        <Button 
          variant="ghost" 
          size="icon" 
          className={cn(
            "text-foreground hover:bg-muted",
            collapsed && "absolute -right-3 top-6 bg-card border border-border rounded-full w-6 h-6"
          )}
          onClick={() => setCollapsed(!collapsed)}
        >
          {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
        </Button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 py-4">
        <ul className="space-y-1 px-2">
          {navigation.map((item) => {
            const isActive = pathname === item.href || 
              (item.href !== '/dashboard' && pathname.startsWith(item.href))
            
            return (
              <li key={item.name}>
                <Link
                  href={item.href}
                  className={cn(
                    "flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors",
                    isActive 
                      ? "bg-primary text-primary-foreground" 
                      : "text-muted-foreground hover:text-foreground hover:bg-muted"
                  )}
                  title={collapsed ? item.name : undefined}
                >
                  <item.icon className="w-5 h-5 flex-shrink-0" />
                  {!collapsed && <span className="font-medium">{item.name}</span>}
                </Link>
              </li>
            )
          })}
        </ul>
      </nav>

      {/* Logout */}
      <div className="p-4 border-t border-border">
        <Button
          variant="ghost"
          className={cn(
            "text-muted-foreground hover:text-foreground hover:bg-muted",
            collapsed ? "w-full justify-center p-2" : "w-full justify-start"
          )}
          onClick={logout}
          title={collapsed ? "Выйти" : undefined}
        >
          <LogOut className="w-5 h-5" />
          {!collapsed && <span className="ml-3">Выйти</span>}
        </Button>
      </div>
    </aside>
  )
}
