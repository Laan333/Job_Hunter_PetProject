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
import {
  Sparkles,
  Copy,
  Check,
  RefreshCw,
  ArrowLeft,
  MessageCircleQuestion,
  FileText,
} from 'lucide-react'
import { toast } from 'sonner'
import { ApiError, postCoverLetter, postScreeningAnswers } from '@/lib/api'
import { cn } from '@/lib/utils'

type Step = "choose" | "letter" | "questions"

interface CoverLetterModalProps {
  vacancy: Vacancy | null
  onClose: () => void
  onSaved?: (vacancyId: string, text: string) => void
}

function retryAfterFromApiError(e: ApiError): number {
  const d = e.body as { detail?: { retryAfterSeconds?: number } | string }
  const det = d?.detail
  if (typeof det === "object" && det && "retryAfterSeconds" in det) {
    return Number(det.retryAfterSeconds)
  }
  return 60
}

function detailMessageFromApiError(e: ApiError): string {
  const d = e.body as { detail?: unknown }
  const det = d?.detail
  if (typeof det === "string") return det
  if (det && typeof det === "object" && "message" in det) {
    const m = (det as { message?: string }).message
    if (typeof m === "string") return m
  }
  return e.message || "Ошибка запроса"
}

export function CoverLetterModal({ vacancy, onClose, onSaved }: CoverLetterModalProps) {
  const [step, setStep] = useState<Step>("choose")
  const [isGenerating, setIsGenerating] = useState(false)
  const [coverLetter, setCoverLetter] = useState("")
  const [isCopied, setIsCopied] = useState(false)

  const [employerQuestions, setEmployerQuestions] = useState("")
  const [answers, setAnswers] = useState("")
  const [isGeneratingQA, setIsGeneratingQA] = useState(false)
  const [isCopiedAnswers, setIsCopiedAnswers] = useState(false)

  useEffect(() => {
    if (!vacancy) return
    setStep("choose")
    setEmployerQuestions("")
    setAnswers("")
    setCoverLetter(vacancy.coverLetter ?? "")
    setIsGenerating(false)
    setIsGeneratingQA(false)
    setIsCopied(false)
    setIsCopiedAnswers(false)
  }, [vacancy?.id])

  const handleClose = () => {
    setStep("choose")
    setEmployerQuestions("")
    setAnswers("")
    setCoverLetter("")
    setIsGenerating(false)
    setIsGeneratingQA(false)
    onClose()
  }

  const generateCoverLetter = async () => {
    if (!vacancy) return
    setIsGenerating(true)
    try {
      const res = await postCoverLetter(vacancy.id)
      setCoverLetter(res.coverLetter)
      onSaved?.(vacancy.id, res.coverLetter)
      toast.success("Сопроводительное сгенерировано")
    } catch (e) {
      if (e instanceof ApiError && e.status === 429) {
        toast.message("Пауза GigaChat", {
          description: `Подождите ${retryAfterFromApiError(e)} с. Письмо генерируется через GigaChat; лимит не связан с OpenAI.`,
        })
      } else {
        toast.error("Не удалось сгенерировать письмо")
      }
    } finally {
      setIsGenerating(false)
    }
  }

  const submitScreeningAnswers = async () => {
    if (!vacancy) return
    const q = employerQuestions.trim()
    if (q.length < 3) {
      toast.error("Введите вопросы (не менее 3 символов)")
      return
    }
    setIsGeneratingQA(true)
    try {
      const res = await postScreeningAnswers(vacancy.id, q)
      setAnswers(res.answers)
      toast.success("Ответы сгенерированы (GigaChat)")
    } catch (e) {
      if (e instanceof ApiError && e.status === 429) {
        toast.message("Пауза GigaChat", {
          description: `Подождите ${retryAfterFromApiError(e)} с. Это интервал между запросами к GigaChat, не к OpenAI.`,
        })
      } else if (e instanceof ApiError && e.status === 503) {
        toast.error(detailMessageFromApiError(e))
      } else if (e instanceof ApiError && e.status === 400) {
        toast.error(detailMessageFromApiError(e))
      } else {
        toast.error("Не удалось сгенерировать ответы")
      }
    } finally {
      setIsGeneratingQA(false)
    }
  }

  const handleCopyLetter = async () => {
    await navigator.clipboard.writeText(coverLetter)
    setIsCopied(true)
    setTimeout(() => setIsCopied(false), 2000)
  }

  const handleCopyAnswers = async () => {
    await navigator.clipboard.writeText(answers)
    setIsCopiedAnswers(true)
    setTimeout(() => setIsCopiedAnswers(false), 2000)
  }

  if (!vacancy) return null

  return (
    <Dialog open={!!vacancy} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-primary" />
            {step === "choose" && "Сопроводительное или ответы"}
            {step === "letter" && "Сопроводительное письмо"}
            {step === "questions" && "Ответы на вопросы работодателя"}
          </DialogTitle>
          <DialogDescription>
            {vacancy.title} · {vacancy.company}
          </DialogDescription>
        </DialogHeader>

        {step !== "choose" && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="w-fit -mt-2 gap-1 text-muted-foreground"
            onClick={() => {
              setStep("choose")
              setIsGenerating(false)
              setIsGeneratingQA(false)
            }}
          >
            <ArrowLeft className="w-4 h-4" />
            Назад к выбору
          </Button>
        )}

        {step === "choose" && (
          <div className="grid sm:grid-cols-2 gap-3 pt-2">
            <button
              type="button"
              onClick={() => setStep("letter")}
              className={cn(
                "flex flex-col items-start gap-2 rounded-lg border border-border p-4 text-left transition-colors",
                "hover:bg-muted/50 hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              )}
            >
              <FileText className="w-8 h-8 text-primary" />
              <span className="font-semibold">Сопроводительное письмо</span>
              <span className="text-sm text-muted-foreground">
                Классическое письмо по резюме и требованиям вакансии (как раньше).
              </span>
            </button>
            <button
              type="button"
              onClick={() => setStep("questions")}
              className={cn(
                "flex flex-col items-start gap-2 rounded-lg border border-border p-4 text-left transition-colors",
                "hover:bg-muted/50 hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              )}
            >
              <MessageCircleQuestion className="w-8 h-8 text-primary" />
              <span className="font-semibold">Ответить на вопросы</span>
              <span className="text-sm text-muted-foreground">
                Вставьте вопросы из формы отклика — GigaChat ответит на основе резюме и полного текста вакансии.
              </span>
            </button>
          </div>
        )}

        {step === "letter" && (
          <div className="space-y-4">
            {!coverLetter && !isGenerating && (
              <div className="text-center py-6">
                <Sparkles className="w-10 h-10 text-primary mx-auto mb-3" />
                <p className="text-muted-foreground mb-4">
                  На основе вашего резюме и требований вакансии будет создано сопроводительное письмо.
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
                <p className="text-muted-foreground">Генерация письма…</p>
              </div>
            )}

            {coverLetter && !isGenerating && (
              <>
                <Textarea
                  value={coverLetter}
                  onChange={(e) => setCoverLetter(e.target.value)}
                  className="min-h-[320px] font-mono text-sm leading-relaxed"
                />
                <div className="flex flex-wrap items-center gap-2">
                  <Button onClick={handleCopyLetter} variant="outline" className="gap-2">
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
                </div>
              </>
            )}
          </div>
        )}

        {step === "questions" && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Скопируйте вопросы из формы отклика на hh.ru (можно несколько, каждый с новой строки). Ответы
              формируются только через <strong>GigaChat</strong> с учётом вашего резюме и описания вакансии.
            </p>
            <Textarea
              value={employerQuestions}
              onChange={(e) => setEmployerQuestions(e.target.value)}
              placeholder="Например:&#10;Расскажите о вашем опыте с FastAPI&#10;Готовы ли к удалённой работе?&#10;Ожидания по зарплате"
              className="min-h-[140px] text-sm"
              disabled={isGeneratingQA}
            />
            <Button
              type="button"
              onClick={() => void submitScreeningAnswers()}
              disabled={isGeneratingQA || employerQuestions.trim().length < 3}
              className="gap-2"
            >
              {isGeneratingQA ? (
                <>
                  <Spinner className="w-4 h-4" />
                  Отправка в GigaChat…
                </>
              ) : (
                <>
                  <MessageCircleQuestion className="w-4 h-4" />
                  Отправить
                </>
              )}
            </Button>

            {answers && (
              <>
                <Textarea
                  value={answers}
                  onChange={(e) => setAnswers(e.target.value)}
                  className="min-h-[280px] text-sm leading-relaxed"
                />
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" className="gap-2" onClick={handleCopyAnswers}>
                    {isCopiedAnswers ? (
                      <>
                        <Check className="w-4 h-4" />
                        Скопировано
                      </>
                    ) : (
                      <>
                        <Copy className="w-4 h-4" />
                        Копировать ответы
                      </>
                    )}
                  </Button>
                  <Button
                    variant="outline"
                    className="gap-2"
                    onClick={() => void submitScreeningAnswers()}
                    disabled={isGeneratingQA || employerQuestions.trim().length < 3}
                  >
                    <RefreshCw className="w-4 h-4" />
                    Перегенерировать
                  </Button>
                </div>
              </>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
