"use client"

import { useState } from 'react'
import { useAuth } from '@/lib/auth-context'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Spinner } from '@/components/ui/spinner'
import { KeyRound, Shield, Briefcase, BarChart3, FileText, Sparkles } from 'lucide-react'

export function LoginPage() {
  const [apiKey, setApiKey] = useState('')
  const [error, setError] = useState('')
  const { login, isLoading } = useAuth()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    
    if (!apiKey.trim()) {
      setError('Введите API ключ')
      return
    }

    const success = await login(apiKey)
    if (!success) {
      setError('Неверный API ключ. Обратитесь к администратору.')
    }
  }

  const features = [
    {
      icon: Briefcase,
      title: 'Агрегация вакансий',
      description: 'Автоматический сбор вакансий с HH.ru по вашим запросам'
    },
    {
      icon: BarChart3,
      title: 'Аналитика рынка',
      description: 'Статистика по зарплатам, навыкам и трендам'
    },
    {
      icon: FileText,
      title: 'Анализ совместимости',
      description: 'AI-оценка соответствия вакансии вашему резюме'
    },
    {
      icon: Sparkles,
      title: 'Генерация писем',
      description: 'Автоматическое создание сопроводительных писем'
    }
  ]

  return (
    <div className="min-h-screen bg-background flex">
      {/* Левая панель с информацией */}
      <div className="hidden lg:flex lg:w-1/2 bg-primary text-primary-foreground p-12 flex-col justify-between">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-lg bg-white/20 flex items-center justify-center">
              <Briefcase className="w-6 h-6 text-white" />
            </div>
            <span className="text-2xl font-bold">JobHunter Pro</span>
          </div>
          <p className="text-white/70 text-lg">
            Профессиональный инструмент для поиска работы
          </p>
        </div>

        <div className="space-y-8">
          <h2 className="text-3xl font-bold leading-tight text-balance">
            Автоматизируйте поиск работы с помощью AI
          </h2>
          
          <div className="grid grid-cols-1 gap-6">
            {features.map((feature, index) => (
              <div key={index} className="flex gap-4 items-start">
                <div className="w-12 h-12 rounded-lg bg-white/10 flex items-center justify-center flex-shrink-0">
                  <feature.icon className="w-6 h-6 text-white" />
                </div>
                <div>
                  <h3 className="font-semibold text-lg">{feature.title}</h3>
                  <p className="text-white/70">{feature.description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="text-white/50 text-sm">
          JobHunter Pro v1.0 | Источник: hh.ru (бесплатный API)
        </div>
      </div>

      {/* Правая панель с формой */}
      <div className="w-full lg:w-1/2 flex items-center justify-center p-8">
        <Card className="w-full max-w-md border-border/50 shadow-lg">
          <CardHeader className="space-y-1 pb-6">
            <div className="flex items-center gap-2 mb-4 lg:hidden">
              <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
                <Briefcase className="w-5 h-5 text-primary-foreground" />
              </div>
              <span className="text-xl font-bold">JobHunter Pro</span>
            </div>
            <CardTitle className="text-2xl font-bold">Вход в систему</CardTitle>
            <CardDescription>
              Введите API ключ для доступа к дашборду
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <div className="relative">
                  <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                  <Input
                    type="password"
                    placeholder="Введите API ключ"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    className="pl-10 h-12"
                    disabled={isLoading}
                  />
                </div>
              </div>

              {error && (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              <Button 
                type="submit" 
                className="w-full h-12 text-base font-medium"
                disabled={isLoading}
              >
                {isLoading ? (
                  <>
                    <Spinner className="mr-2" />
                    Проверка...
                  </>
                ) : (
                  <>
                    <Shield className="mr-2 w-5 h-5" />
                    Войти
                  </>
                )}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
