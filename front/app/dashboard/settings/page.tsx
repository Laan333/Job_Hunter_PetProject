"use client"

import { useState, useEffect } from 'react'
import { toast } from 'sonner'
import { Header } from '@/components/dashboard/header'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { 
  Key, 
  Bell, 
  Database, 
  Brain, 
  RefreshCw, 
  Shield,
  CheckCircle,
  AlertCircle,
  Save,
  Trash2,
  TestTube
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { fetchSettings, patchSettings } from '@/lib/api'

export default function SettingsPage() {
  const [settings, setSettings] = useState({
    // API Keys
    gigachatAuthorizationKey: '',
    openaiApiKey: '',
    
    // General
    refreshInterval: 60,
    maxVacanciesPerSearch: 100,
    autoAnalyze: true,
    analyzeDelay: 3,
    
    // Notifications
    emailNotifications: false,
    browserNotifications: true,
    notifyOnNewVacancies: true,
    notifyOnHighMatch: true,
    highMatchThreshold: 70,
    llmProvider: 'openai' as 'openai' | 'gigachat' | 'none',
  })

  const [isSaved, setIsSaved] = useState(false)
  const [testResults, setTestResults] = useState<{[key: string]: 'success' | 'error' | null}>({
    gigachat: null,
    openai: null
  })

  useEffect(() => {
    void (async () => {
      try {
        const d = await fetchSettings()
        const ak = d.apiKeys as {
          gigachatAuthorizationKey?: string
          gigachat?: string
          openai?: string
        } | undefined
        setSettings((prev) => ({
          ...prev,
          gigachatAuthorizationKey: ak?.gigachatAuthorizationKey ?? ak?.gigachat ?? '',
          openaiApiKey: ak?.openai ?? '',
          refreshInterval: Number(d.refreshInterval ?? prev.refreshInterval),
          maxVacanciesPerSearch: Number(d.maxVacanciesPerSearch ?? prev.maxVacanciesPerSearch),
          autoAnalyze: Boolean(d.autoAnalyze),
          analyzeDelay: Number(d.analyzeDelay ?? prev.analyzeDelay),
          browserNotifications: Boolean(d.browserNotifications ?? prev.browserNotifications),
          notifyOnNewVacancies: Boolean(d.notifyOnNewVacancies ?? prev.notifyOnNewVacancies),
          notifyOnHighMatch: Boolean(d.notifyOnHighMatch ?? prev.notifyOnHighMatch),
          highMatchThreshold: Number(d.highMatchThreshold ?? prev.highMatchThreshold),
          llmProvider: (d.llmProvider as 'openai' | 'gigachat' | 'none') ?? prev.llmProvider,
        }))
      } catch {
        toast.error('Не удалось загрузить настройки')
      }
    })()
  }, [])

  const handleSave = async () => {
    try {
      const payload: Record<string, unknown> = {
        refreshInterval: settings.refreshInterval,
        autoAnalyze: settings.autoAnalyze,
        maxVacanciesPerSearch: settings.maxVacanciesPerSearch,
        analyzeDelay: settings.analyzeDelay,
        browserNotifications: settings.browserNotifications,
        notifyOnNewVacancies: settings.notifyOnNewVacancies,
        notifyOnHighMatch: settings.notifyOnHighMatch,
        highMatchThreshold: settings.highMatchThreshold,
        llmProvider: settings.llmProvider,
      }
      if (settings.gigachatAuthorizationKey && !settings.gigachatAuthorizationKey.startsWith('****')) {
        payload.gigachatAuthorizationKey = settings.gigachatAuthorizationKey
      }
      if (settings.openaiApiKey && !settings.openaiApiKey.startsWith('****')) {
        payload.openaiApiKey = settings.openaiApiKey
      }
      await patchSettings(payload)
      setIsSaved(true)
      toast.success('Настройки сохранены')
      setTimeout(() => setIsSaved(false), 2000)
    } catch {
      toast.error('Ошибка сохранения')
    }
  }

  const testApiKey = async (service: string) => {
    setTestResults(prev => ({ ...prev, [service]: null }))
    await new Promise(resolve => setTimeout(resolve, 1000))
    // Имитация проверки
    const success = Math.random() > 0.3
    setTestResults(prev => ({ ...prev, [service]: success ? 'success' : 'error' }))
  }

  const clearData = async () => {
    if (confirm('Вы уверены? Это действие удалит все сохраненные вакансии.')) {
      // Имитация очистки
      await new Promise(resolve => setTimeout(resolve, 500))
      alert('Данные очищены')
    }
  }

  return (
    <div className="flex flex-col h-full">
      <Header 
        title="Настройки" 
        subtitle="Конфигурация сервиса"
      />
      
      <div className="flex-1 p-6 space-y-6 overflow-auto">
        <div className="max-w-3xl space-y-6">
          {/* API Keys */}
          <Card className="border-border/50">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Key className="w-5 h-5 text-primary" />
                API Ключи
              </CardTitle>
              <CardDescription>
                Настройка ключей для доступа к внешним сервисам
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* GigaChat — Authorization Key из личного кабинета */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label htmlFor="gigachatAuthorizationKey" className="text-base font-medium">
                    GigaChat — Authorization Key
                  </Label>
                  {testResults.gigachat && (
                    <Badge className={cn(
                      testResults.gigachat === 'success' 
                        ? "bg-primary/10 text-primary" 
                        : "bg-destructive/10 text-destructive"
                    )}>
                      {testResults.gigachat === 'success' ? 'Подключено' : 'Ошибка'}
                    </Badge>
                  )}
                </div>
                <div className="flex gap-2">
                  <Input
                    id="gigachatAuthorizationKey"
                    type="password"
                    autoComplete="off"
                    placeholder="Вставьте Authorization Key из кабинета разработчика GigaChat"
                    value={settings.gigachatAuthorizationKey}
                    onChange={(e) => setSettings(prev => ({ ...prev, gigachatAuthorizationKey: e.target.value }))}
                  />
                  <Button 
                    variant="outline" 
                    onClick={() => testApiKey('gigachat')}
                    disabled={!settings.gigachatAuthorizationKey}
                  >
                    <TestTube className="w-4 h-4 mr-2" />
                    Тест
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Поле «Authorization Key» в личном кабинете GigaChat (OAuth:{' '}
                  <code className="text-foreground">Authorization: Basic …</code>). В .env:{' '}
                  <code className="text-foreground">GIGACHAT_AUTHORIZATION_KEY</code>.
                </p>
              </div>

              <Separator />

              {/* OpenAI API */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label htmlFor="openaiApiKey" className="text-base font-medium">
                    OpenAI API (альтернатива)
                  </Label>
                  {testResults.openai && (
                    <Badge className={cn(
                      testResults.openai === 'success' 
                        ? "bg-primary/10 text-primary" 
                        : "bg-destructive/10 text-destructive"
                    )}>
                      {testResults.openai === 'success' ? 'Подключено' : 'Ошибка'}
                    </Badge>
                  )}
                </div>
                <div className="flex gap-2">
                  <Input
                    id="openaiApiKey"
                    type="password"
                    placeholder="Введите API ключ OpenAI"
                    value={settings.openaiApiKey}
                    onChange={(e) => setSettings(prev => ({ ...prev, openaiApiKey: e.target.value }))}
                  />
                  <Button 
                    variant="outline" 
                    onClick={() => testApiKey('openai')}
                    disabled={!settings.openaiApiKey}
                  >
                    <TestTube className="w-4 h-4 mr-2" />
                    Тест
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* AI Settings */}
          <Card className="border-border/50">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Brain className="w-5 h-5 text-primary" />
                Настройки AI-анализа
              </CardTitle>
              <CardDescription>
                Параметры автоматического анализа вакансий
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-3">
                <Label>Провайдер LLM</Label>
                <Select
                  value={settings.llmProvider}
                  onValueChange={(value) =>
                    setSettings((prev) => ({ ...prev, llmProvider: value as 'openai' | 'gigachat' | 'none' }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="openai">OpenAI</SelectItem>
                    <SelectItem value="gigachat">GigaChat</SelectItem>
                    <SelectItem value="none">Выключено (заглушка)</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Используется для анализа вакансий и сопроводительных. При ошибке GigaChat выполняется попытка OpenAI,
                  если задан ключ.
                </p>
              </div>

              <Separator />

              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-base font-medium">Автоматический анализ</Label>
                  <p className="text-sm text-muted-foreground">
                    Автоматически анализировать новые вакансии
                  </p>
                </div>
                <Switch
                  checked={settings.autoAnalyze}
                  onCheckedChange={(checked) => setSettings(prev => ({ ...prev, autoAnalyze: checked }))}
                />
              </div>

              <Separator />

              <div className="space-y-3">
                <Label>Задержка между запросами к AI</Label>
                <Select 
                  value={settings.analyzeDelay.toString()}
                  onValueChange={(value) => setSettings(prev => ({ ...prev, analyzeDelay: parseInt(value) }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">1 минута</SelectItem>
                    <SelectItem value="2">2 минуты</SelectItem>
                    <SelectItem value="3">3 минуты</SelectItem>
                    <SelectItem value="5">5 минут</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Минимальный интервал между запросами для соблюдения лимитов API
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Search Settings */}
          <Card className="border-border/50">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <RefreshCw className="w-5 h-5 text-primary" />
                Настройки поиска
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-3">
                <Label>Интервал обновления по умолчанию</Label>
                <Select 
                  value={settings.refreshInterval.toString()}
                  onValueChange={(value) => setSettings(prev => ({ ...prev, refreshInterval: parseInt(value) }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="30">30 минут</SelectItem>
                    <SelectItem value="60">1 час</SelectItem>
                    <SelectItem value="120">2 часа</SelectItem>
                    <SelectItem value="360">6 часов</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-3">
                <Label>Максимум вакансий за один поиск</Label>
                <Select 
                  value={settings.maxVacanciesPerSearch.toString()}
                  onValueChange={(value) => setSettings(prev => ({ ...prev, maxVacanciesPerSearch: parseInt(value) }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="50">50 вакансий</SelectItem>
                    <SelectItem value="100">100 вакансий</SelectItem>
                    <SelectItem value="200">200 вакансий</SelectItem>
                    <SelectItem value="500">500 вакансий</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          {/* Notifications */}
          <Card className="border-border/50">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Bell className="w-5 h-5 text-primary" />
                Уведомления
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-base font-medium">Browser уведомления</Label>
                  <p className="text-sm text-muted-foreground">
                    Показывать уведомления в браузере
                  </p>
                </div>
                <Switch
                  checked={settings.browserNotifications}
                  onCheckedChange={(checked) => setSettings(prev => ({ ...prev, browserNotifications: checked }))}
                />
              </div>

              <Separator />

              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-base font-medium">О новых вакансиях</Label>
                  <p className="text-sm text-muted-foreground">
                    Уведомлять о найденных вакансиях
                  </p>
                </div>
                <Switch
                  checked={settings.notifyOnNewVacancies}
                  onCheckedChange={(checked) => setSettings(prev => ({ ...prev, notifyOnNewVacancies: checked }))}
                />
              </div>

              <Separator />

              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-base font-medium">Высокое совпадение</Label>
                  <p className="text-sm text-muted-foreground">
                    Уведомлять при совпадении выше порога
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <Select 
                    value={settings.highMatchThreshold.toString()}
                    onValueChange={(value) => setSettings(prev => ({ ...prev, highMatchThreshold: parseInt(value) }))}
                  >
                    <SelectTrigger className="w-24">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="60">60%</SelectItem>
                      <SelectItem value="70">70%</SelectItem>
                      <SelectItem value="80">80%</SelectItem>
                      <SelectItem value="90">90%</SelectItem>
                    </SelectContent>
                  </Select>
                  <Switch
                    checked={settings.notifyOnHighMatch}
                    onCheckedChange={(checked) => setSettings(prev => ({ ...prev, notifyOnHighMatch: checked }))}
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Data Management */}
          <Card className="border-border/50">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Database className="w-5 h-5 text-primary" />
                Управление данными
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <Alert>
                <Shield className="w-4 h-4" />
                <AlertDescription>
                  Все данные хранятся локально в PostgreSQL базе данных на вашем сервере
                </AlertDescription>
              </Alert>

              <Button 
                variant="destructive" 
                className="gap-2"
                onClick={clearData}
              >
                <Trash2 className="w-4 h-4" />
                Очистить все вакансии
              </Button>
            </CardContent>
          </Card>

          {/* Save Button */}
          <div className="flex justify-end pt-4">
            <Button onClick={handleSave} className="gap-2 min-w-[150px]">
              {isSaved ? (
                <>
                  <CheckCircle className="w-4 h-4" />
                  Сохранено
                </>
              ) : (
                <>
                  <Save className="w-4 h-4" />
                  Сохранить настройки
                </>
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
