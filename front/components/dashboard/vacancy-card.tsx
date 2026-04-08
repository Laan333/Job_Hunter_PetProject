"use client"

import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  MapPin,
  Building2,
  Clock,
  ExternalLink,
  Star,
  Eye,
  Users,
  Sparkles,
  FileText,
  Brain,
  Trash2,
  Send,
  Undo2,
} from 'lucide-react'
import type { Vacancy } from '@/lib/types'
import { cn } from '@/lib/utils'

interface VacancyCardProps {
  vacancy: Vacancy
  /** Seconds until LLM slot is free (0 = ready). */
  llmCooldownSeconds?: number
  onAnalyze?: (vacancy: Vacancy) => void
  onGenerateCoverLetter?: (vacancy: Vacancy) => void
  onToggleFavorite?: (vacancy: Vacancy) => void
  onToggleApplied?: (vacancy: Vacancy) => void
  onViewDetails?: (vacancy: Vacancy) => void
  onDelete?: (vacancy: Vacancy) => void
}

export function VacancyCard({
  vacancy,
  llmCooldownSeconds = 0,
  onAnalyze,
  onGenerateCoverLetter,
  onToggleFavorite,
  onToggleApplied,
  onViewDetails,
  onDelete,
}: VacancyCardProps) {
  const formatSalary = (salary?: Vacancy['salary']) => {
    if (!salary) return 'Не указана'
    const { from, to, currency } = salary
    const formatNum = (n: number) => n.toLocaleString('ru-RU')
    
    if (from && to) return `${formatNum(from)} - ${formatNum(to)} ${currency}`
    if (from) return `от ${formatNum(from)} ${currency}`
    if (to) return `до ${formatNum(to)} ${currency}`
    return 'Не указана'
  }

  const statusColors = {
    new: 'bg-primary/10 text-primary',
    viewed: 'bg-muted text-muted-foreground',
    applied: 'bg-chart-2/10 text-chart-2',
    rejected: 'bg-destructive/10 text-destructive',
    interview: 'bg-chart-3/10 text-chart-3'
  }

  const statusLabels = {
    new: 'Новая',
    viewed: 'Просмотрено',
    applied: 'Отклик',
    rejected: 'Отказ',
    interview: 'Интервью'
  }

  const isApplied = vacancy.status === 'applied'

  return (
    <Card
      className={cn(
        'border-border/50 hover:border-primary/30 transition-colors',
        isApplied && 'opacity-75 bg-muted/30',
      )}
    >
      <CardContent className="p-5">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 mb-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              {isApplied && (
                <span className="shrink-0 text-chart-2" title="Вы откликнулись">
                  <Send className="w-4 h-4" aria-hidden />
                </span>
              )}
              <h3
                className="text-lg font-semibold text-foreground truncate cursor-pointer hover:text-primary transition-colors"
                onClick={() => onViewDetails?.(vacancy)}
              >
                {vacancy.title}
              </h3>
              {vacancy.matchScore && (
                <Badge className={cn(
                  "flex-shrink-0",
                  vacancy.matchScore >= 80 ? "bg-primary/10 text-primary" :
                  vacancy.matchScore >= 60 ? "bg-chart-3/10 text-chart-3" :
                  "bg-muted text-muted-foreground"
                )}>
                  {vacancy.matchScore}% match
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Building2 className="w-4 h-4" />
              <span className="font-medium">{vacancy.company}</span>
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            <Badge className={statusColors[vacancy.status]}>
              {statusLabels[vacancy.status]}
            </Badge>
            <Button
              variant="ghost"
              size="icon"
              className={cn(
                "h-8 w-8",
                vacancy.isFavorite ? "text-chart-5" : "text-muted-foreground"
              )}
              onClick={() => onToggleFavorite?.(vacancy)}
            >
              <Star className={cn("w-5 h-5", vacancy.isFavorite && "fill-current")} />
            </Button>
          </div>
        </div>

        {/* Salary */}
        <div className="text-xl font-bold text-foreground mb-4">
          {formatSalary(vacancy.salary)}
        </div>

        {/* Meta info */}
        <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground mb-4">
          <div className="flex items-center gap-1.5">
            <MapPin className="w-4 h-4" />
            <span>{vacancy.location}</span>
          </div>
          {vacancy.experience && (
            <div className="flex items-center gap-1.5">
              <Clock className="w-4 h-4" />
              <span>{vacancy.experience}</span>
            </div>
          )}
          {vacancy.schedule && (
            <Badge variant="secondary" className="font-normal">
              {vacancy.schedule}
            </Badge>
          )}
        </div>

        {/* Skills */}
        <div className="flex flex-wrap gap-2 mb-4">
          {(vacancy.skills || []).slice(0, 6).map((skill, index) => (
            <Badge key={index} variant="outline" className="text-xs">
              {skill}
            </Badge>
          ))}
          {(vacancy.skills || []).length > 6 && (
            <Badge variant="outline" className="text-xs">
              +{(vacancy.skills || []).length - 6}
            </Badge>
          )}
        </div>

        {/* Stats */}
        <div className="flex items-center gap-4 text-xs text-muted-foreground mb-4 pb-4 border-b border-border">
          {vacancy.responses !== undefined && (
            <div className="flex items-center gap-1">
              <Users className="w-3.5 h-3.5" />
              <span>{vacancy.responses} откликов</span>
            </div>
          )}
          {vacancy.views !== undefined && (
            <div className="flex items-center gap-1">
              <Eye className="w-3.5 h-3.5" />
              <span>{vacancy.views} просмотров</span>
            </div>
          )}
          <span className="ml-auto">
            {new Date(vacancy.publishedAt).toLocaleDateString('ru-RU', {
              day: 'numeric',
              month: 'short'
            })}
          </span>
        </div>

        {/* AI Analysis Preview */}
        {vacancy.aiAnalysis && (
          <div className="mb-4 p-3 bg-primary/5 rounded-lg border border-primary/10">
            <div className="flex items-center gap-2 text-sm font-medium text-primary mb-1">
              <Brain className="w-4 h-4" />
              AI-анализ
            </div>
            <p className="text-sm text-muted-foreground line-clamp-2">
              {vacancy.aiAnalysis}
            </p>
          </div>
        )}

        {/* Actions */}
        <div className="flex flex-wrap items-center gap-2">
          {!vacancy.isAnalyzed && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => onAnalyze?.(vacancy)}
              className="flex-1 min-w-[120px]"
              disabled={llmCooldownSeconds > 0}
              title={llmCooldownSeconds > 0 ? `Интервал LLM: подождите ${llmCooldownSeconds} с` : undefined}
            >
              <Brain className="w-4 h-4 mr-2" />
              {llmCooldownSeconds > 0 ? `Анализ ~${llmCooldownSeconds}с` : 'Анализировать'}
            </Button>
          )}
          <Button
            variant={isApplied ? 'secondary' : 'outline'}
            size="sm"
            className="gap-1"
            disabled={!onToggleApplied}
            onClick={() => onToggleApplied?.(vacancy)}
            title={isApplied ? 'Снять отметку отклика' : 'Отметить, что откликнулись'}
          >
            {isApplied ? <Undo2 className="w-4 h-4" /> : <Send className="w-4 h-4" />}
            {isApplied ? 'Снять метку' : 'Откликнулся'}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => onGenerateCoverLetter?.(vacancy)}
            className="flex-1 min-w-[120px]"
          >
            <Sparkles className="w-4 h-4 mr-2" />
            Сопроводительное
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => onViewDetails?.(vacancy)}
          >
            <FileText className="w-4 h-4 mr-2" />
            Подробнее
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            asChild
          >
            <a href={vacancy.url} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="w-4 h-4" />
            </a>
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-destructive hover:text-destructive"
            onClick={() => onDelete?.(vacancy)}
            title="Удалить вакансию"
          >
            <Trash2 className="w-4 h-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
