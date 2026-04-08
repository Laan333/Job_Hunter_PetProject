"use client"

import { SafeMarkdown } from '@/components/safe-markdown'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import type { Vacancy } from '@/lib/types'
import {
  Building2,
  MapPin,
  Clock,
  Briefcase,
  Calendar,
  ExternalLink,
  Star,
  Users,
  Eye,
  Brain,
  Sparkles,
  Send,
  Undo2,
} from 'lucide-react'
import { cn } from '@/lib/utils'

interface VacancyDetailModalProps {
  vacancy: Vacancy | null
  onClose: () => void
  onGenerateCoverLetter?: (vacancy: Vacancy) => void
  onToggleFavorite?: (vacancy: Vacancy) => void
  onToggleApplied?: (vacancy: Vacancy) => void
}

export function VacancyDetailModal({
  vacancy,
  onClose,
  onGenerateCoverLetter,
  onToggleFavorite,
  onToggleApplied,
}: VacancyDetailModalProps) {
  if (!vacancy) return null

  const formatSalary = (salary?: Vacancy['salary']) => {
    if (!salary) return 'Не указана'
    const { from, to, currency, gross } = salary
    const formatNum = (n: number) => n.toLocaleString('ru-RU')
    
    let str = ''
    if (from && to) str = `${formatNum(from)} - ${formatNum(to)} ${currency}`
    else if (from) str = `от ${formatNum(from)} ${currency}`
    else if (to) str = `до ${formatNum(to)} ${currency}`
    
    if (gross) str += ' (до вычета налогов)'
    return str
  }

  return (
    <Dialog open={!!vacancy} onOpenChange={() => onClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh]">
        <DialogHeader>
          <div className="flex items-start justify-between gap-4">
            <div>
              <DialogTitle className="text-2xl font-bold mb-2">{vacancy.title}</DialogTitle>
              <div className="flex items-center gap-2 text-lg text-muted-foreground">
                <Building2 className="w-5 h-5" />
                <span className="font-medium">{vacancy.company}</span>
              </div>
            </div>
            {vacancy.matchScore && (
              <Badge className={cn(
                "text-lg px-3 py-1",
                vacancy.matchScore >= 80 ? "bg-primary/10 text-primary" :
                vacancy.matchScore >= 60 ? "bg-chart-3/10 text-chart-3" :
                "bg-muted text-muted-foreground"
              )}>
                {vacancy.matchScore}% match
              </Badge>
            )}
          </div>
        </DialogHeader>

        <ScrollArea className="max-h-[60vh] pr-4">
          <div className="space-y-6">
            {/* Salary */}
            <div className="text-3xl font-bold text-foreground">
              {formatSalary(vacancy.salary)}
            </div>

            {/* Meta info */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="flex items-center gap-2 text-sm">
                <MapPin className="w-4 h-4 text-muted-foreground" />
                <span>{vacancy.location}</span>
              </div>
              {vacancy.experience && (
                <div className="flex items-center gap-2 text-sm">
                  <Clock className="w-4 h-4 text-muted-foreground" />
                  <span>{vacancy.experience}</span>
                </div>
              )}
              {vacancy.employment && (
                <div className="flex items-center gap-2 text-sm">
                  <Briefcase className="w-4 h-4 text-muted-foreground" />
                  <span>{vacancy.employment}</span>
                </div>
              )}
              <div className="flex items-center gap-2 text-sm">
                <Calendar className="w-4 h-4 text-muted-foreground" />
                <span>{new Date(vacancy.publishedAt).toLocaleDateString('ru-RU')}</span>
              </div>
            </div>

            {/* Stats */}
            <div className="flex items-center gap-6 py-4 border-y border-border">
              {vacancy.responses !== undefined && (
                <div className="flex items-center gap-2">
                  <Users className="w-5 h-5 text-muted-foreground" />
                  <div>
                    <div className="text-lg font-semibold">{vacancy.responses}</div>
                    <div className="text-xs text-muted-foreground">откликов</div>
                  </div>
                </div>
              )}
              {vacancy.views !== undefined && (
                <div className="flex items-center gap-2">
                  <Eye className="w-5 h-5 text-muted-foreground" />
                  <div>
                    <div className="text-lg font-semibold">{vacancy.views}</div>
                    <div className="text-xs text-muted-foreground">просмотров</div>
                  </div>
                </div>
              )}
              {vacancy.schedule && (
                <Badge variant="secondary" className="ml-auto">
                  {vacancy.schedule}
                </Badge>
              )}
            </div>

            {/* Skills */}
            <div>
              <h3 className="font-semibold mb-3">Требуемые навыки</h3>
              <div className="flex flex-wrap gap-2">
                {(vacancy.skills || []).map((skill, index) => (
                  <Badge key={index} variant="outline">
                    {skill}
                  </Badge>
                ))}
              </div>
            </div>

            {/* Description */}
            <div>
              <h3 className="font-semibold mb-3">Описание</h3>
              <SafeMarkdown className="text-muted-foreground text-sm leading-relaxed [&_p]:mb-2 [&_ul]:list-disc [&_ul]:pl-5 [&_strong]:text-foreground">
                {vacancy.description || '_Нет описания_'}
              </SafeMarkdown>
            </div>

            {/* Requirements */}
            {vacancy.requirements && (
              <div>
                <h3 className="font-semibold mb-3">Требования</h3>
                <SafeMarkdown className="text-muted-foreground text-sm leading-relaxed [&_p]:mb-2 [&_ul]:list-disc [&_ul]:pl-5">
                  {vacancy.requirements}
                </SafeMarkdown>
              </div>
            )}

            {/* Responsibilities */}
            {vacancy.responsibilities && (
              <div>
                <h3 className="font-semibold mb-3">Обязанности</h3>
                <SafeMarkdown className="text-muted-foreground text-sm leading-relaxed [&_p]:mb-2 [&_ul]:list-disc [&_ul]:pl-5">
                  {vacancy.responsibilities}
                </SafeMarkdown>
              </div>
            )}

            {/* AI Analysis */}
            {vacancy.aiAnalysis && (
              <div className="p-4 bg-primary/5 rounded-lg border border-primary/10">
                <div className="flex items-center gap-2 font-semibold text-primary mb-2">
                  <Brain className="w-5 h-5" />
                  AI-анализ совместимости
                </div>
                <p className="text-muted-foreground leading-relaxed">
                  {vacancy.aiAnalysis}
                </p>
              </div>
            )}
          </div>
        </ScrollArea>

        {/* Actions */}
        <div className="flex flex-wrap items-center gap-3 pt-4 border-t border-border">
          <Button
            className="flex-1 min-w-[200px] gap-2"
            disabled={!onGenerateCoverLetter}
            onClick={() => onGenerateCoverLetter?.(vacancy)}
          >
            <Sparkles className="w-4 h-4" />
            Сгенерировать сопроводительное
          </Button>
          <Button
            variant={vacancy.status === 'applied' ? 'secondary' : 'outline'}
            className="gap-2"
            disabled={!onToggleApplied}
            onClick={() => onToggleApplied?.(vacancy)}
          >
            {vacancy.status === 'applied' ? (
              <>
                <Undo2 className="w-4 h-4" />
                Снять отметку отклика
              </>
            ) : (
              <>
                <Send className="w-4 h-4" />
                Откликнулся
              </>
            )}
          </Button>
          <Button variant="outline" className="gap-2" asChild>
            <a href={vacancy.url} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="w-4 h-4" />
              Открыть на HH
            </a>
          </Button>
          <Button
            variant="ghost"
            size="icon"
            disabled={!onToggleFavorite}
            onClick={() => onToggleFavorite?.(vacancy)}
            title={vacancy.isFavorite ? 'Убрать из избранного' : 'В избранное'}
          >
            <Star
              className={cn(
                'w-5 h-5',
                vacancy.isFavorite && 'fill-current text-chart-5',
              )}
            />
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
