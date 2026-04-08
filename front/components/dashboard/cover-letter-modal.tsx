"use client"

import { useState, useEffect } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Spinner } from '@/components/ui/spinner'
import type { Vacancy } from '@/lib/types'
import { Sparkles, Copy, Check, RefreshCw, Download } from 'lucide-react'
import { toast } from 'sonner'
import { ApiError, postCoverLetter } from '@/lib/api'

interface CoverLetterModalProps {
  vacancy: Vacancy | null
  onClose: () => void
  onSaved?: (vacancyId: string, text: string) => void
}

export function CoverLetterModal({ vacancy, onClose, onSaved }: CoverLetterModalProps) {
  const [isGenerating, setIsGenerating] = useState(false)
  const [coverLetter, setCoverLetter] = useState('')
  const [isCopied, setIsCopied] = useState(false)

  useEffect(() => {
    if (!vacancy) return
    setCoverLetter(vacancy.coverLetter ?? '')
    setIsGenerating(false)
    setIsCopied(false)
  }, [vacancy])

  const generateCoverLetter = async () => {
    if (!vacancy) return
    setIsGenerating(true)
    try {
      const res = await postCoverLetter(vacancy.id)
      setCoverLetter(res.coverLetter)
      onSaved?.(vacancy.id, res.coverLetter)
      toast.success('Сопроводительное сгенерировано')
    } catch (e) {
      if (e instanceof ApiError && e.status === 429) {
        const d = e.body as { detail?: { retryAfterSeconds?: number } | string }
        const det = d?.detail
        const w =
          typeof det === 'object' && det && 'retryAfterSeconds' in det
            ? Number(det.retryAfterSeconds)
            : 60
        toast.message('Лимит LLM', { description: `Повторите через ${w} с` })
      } else {
        toast.error('Не удалось сгенерировать письмо')
      }
    } finally {
      setIsGenerating(false)
    }
  }

  const handleCopy = async () => {
    await navigator.clipboard.writeText(coverLetter)
    setIsCopied(true)
    setTimeout(() => setIsCopied(false), 2000)
  }

  const handleClose = () => {
    setCoverLetter('')
    setIsGenerating(false)
    onClose()
  }

  if (!vacancy) return null

  return (
    <Dialog open={!!vacancy} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-primary" />
            Генерация сопроводительного письма
          </DialogTitle>
          <DialogDescription>
            Для вакансии: {vacancy.title} в {vacancy.company}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {!coverLetter && !isGenerating && (
            <div className="text-center py-8">
              <Sparkles className="w-12 h-12 text-primary mx-auto mb-4" />
              <h3 className="text-lg font-semibold mb-2">AI сгенерирует персонализированное письмо</h3>
              <p className="text-muted-foreground mb-6">
                На основе вашего резюме и требований вакансии будет создано уникальное сопроводительное письмо
              </p>
              <Button onClick={() => void generateCoverLetter()} className="gap-2">
                <Sparkles className="w-4 h-4" />
                Сгенерировать письмо
              </Button>
            </div>
          )}

          {isGenerating && (
            <div className="text-center py-8">
              <Spinner className="w-8 h-8 mx-auto mb-4" />
              <p className="text-muted-foreground">AI генерирует сопроводительное письмо...</p>
              <p className="text-sm text-muted-foreground mt-2">Это может занять несколько секунд</p>
            </div>
          )}

          {coverLetter && (
            <>
              <Textarea
                value={coverLetter}
                onChange={(e) => setCoverLetter(e.target.value)}
                className="min-h-[400px] font-mono text-sm leading-relaxed"
              />

              <div className="flex items-center gap-2">
                <Button onClick={handleCopy} variant="outline" className="gap-2">
                  {isCopied ? (
                    <>
                      <Check className="w-4 h-4" />
                      Скопировано
                    </>
                  ) : (
                    <>
                      <Copy className="w-4 h-4" />
                      Копировать
                    </>
                  )}
                </Button>
                <Button variant="outline" className="gap-2" onClick={() => void generateCoverLetter()}>
                  <RefreshCw className="w-4 h-4" />
                  Перегенерировать
                </Button>
                <Button variant="outline" className="gap-2 ml-auto">
                  <Download className="w-4 h-4" />
                  Скачать
                </Button>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
