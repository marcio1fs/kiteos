'use client'

import { useState, useRef, useEffect } from 'react'
import { useAuthStore, apiFetch } from '@/lib/store'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Bot,
  Send,
  Loader2,
  Wrench,
  Lightbulb,
  MessageCircle,
  DollarSign,
  AlertTriangle,
  User,
  Sparkles,
} from 'lucide-react'

// ==================== TYPES ====================
interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  type?: string
  timestamp: Date
  confirmationWarning?: string | null
}

const QUICK_ACTIONS = [
  {
    id: 'diagnostico',
    label: 'Diagnóstico de Veículo',
    description: 'Ajuda com identificação de problemas',
    icon: Wrench,
    type: 'DIAGNOSTICO',
    prompt: 'Preciso de ajuda com o diagnóstico de um veículo. Quais são os pontos mais comuns que devo verificar?',
  },
  {
    id: 'sugestao',
    label: 'Sugerir Serviços',
    description: 'Sugestões de serviços adicionais',
    icon: Lightbulb,
    type: 'SUGESTAO_SERVICO',
    prompt: 'Quais serviços adicionais posso oferecer aos clientes com base nas OS em andamento?',
  },
  {
    id: 'explicacao',
    label: 'Explicar ao Cliente',
    description: 'Explicar problema em termos simples',
    icon: MessageCircle,
    type: 'EXPLICACAO_CLIENTE',
    prompt: 'Me ajude a explicar um problema técnico ao cliente de forma simples e compreensível.',
  },
  {
    id: 'financeiro',
    label: 'Auxílio Financeiro',
    description: 'Otimização financeira',
    icon: DollarSign,
    type: 'AUXILIO_FINANCEIRO',
    prompt: 'Como posso otimizar o fluxo de caixa e o controle financeiro da oficina?',
  },
]

// ==================== MAIN COMPONENT ====================
export function AIAssistantModule() {
  const { office, user } = useAuthStore()
  const officeId = office?.id

  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [typing, setTyping] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Auto-scroll to bottom
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages, typing])

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // ---- Send Message ----
  const sendMessage = async (content: string, type: string = 'GERAL') => {
    if (!content.trim() || !officeId || sending) return

    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: content.trim(),
      type,
      timestamp: new Date(),
    }

    setMessages(prev => [...prev, userMsg])
    setInput('')
    setSending(true)
    setTyping(true)

    try {
      const res = await apiFetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          officeId,
          userId: user?.id,
          message: content.trim(),
          type,
        }),
      })

      setTyping(false)

      if (res.success && res.data?.response) {
        const aiMsg: ChatMessage = {
          id: `ai-${Date.now()}`,
          role: 'assistant',
          content: res.data.response,
          type: res.data.type,
          timestamp: new Date(res.data.createdAt || new Date()),
          confirmationWarning: res.data.confirmationWarning,
        }
        setMessages(prev => [...prev, aiMsg])
      } else {
        const aiMsg: ChatMessage = {
          id: `ai-${Date.now()}`,
          role: 'assistant',
          content: 'Desculpe, não consegui processar sua solicitação. Tente novamente em alguns instantes.',
          timestamp: new Date(),
        }
        setMessages(prev => [...prev, aiMsg])
      }
    } catch {
      setTyping(false)
      const aiMsg: ChatMessage = {
        id: `ai-${Date.now()}`,
        role: 'assistant',
        content: 'Erro de conexão. Verifique sua internet e tente novamente.',
        timestamp: new Date(),
      }
      setMessages(prev => [...prev, aiMsg])
    } finally {
      setSending(false)
      inputRef.current?.focus()
    }
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    sendMessage(input)
  }

  const handleQuickAction = (action: typeof QUICK_ACTIONS[number]) => {
    sendMessage(action.prompt, action.type)
  }

  return (
    <div className="space-y-4">
      {/* Warning Banner */}
      <Alert className="border-amber-300 bg-amber-50 text-amber-900">
        <AlertTriangle className="h-4 w-4" />
        <AlertDescription className="text-sm font-medium">
          A IA é assistente e <strong>NUNCA</strong> executa ações sem confirmação humana. Sempre revise antes de aplicar sugestões.
        </AlertDescription>
      </Alert>

      {/* Main Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        {/* Chat Area */}
        <div className="lg:col-span-3">
          <Card className="flex flex-col h-[600px]">
            {/* Chat Header */}
            <CardHeader className="pb-3 border-b shrink-0">
              <CardTitle className="flex items-center gap-2 text-lg">
                <div className="w-8 h-8 rounded-lg bg-emerald-600 flex items-center justify-center">
                  <Bot className="w-4 h-4 text-white" />
                </div>
                Assistente KiteOS
                <Badge variant="secondary" className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100 text-xs">
                  <Sparkles className="w-3 h-3 mr-1" /> IA
                </Badge>
              </CardTitle>
            </CardHeader>

            {/* Messages */}
            <CardContent className="flex-1 overflow-hidden p-0">
              <div ref={scrollRef} className="h-full overflow-y-auto p-4 space-y-4">
                {messages.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full text-center py-12">
                    <div className="w-16 h-16 rounded-2xl bg-emerald-100 flex items-center justify-center mb-4">
                      <Bot className="w-8 h-8 text-emerald-600" />
                    </div>
                    <h3 className="text-lg font-semibold text-zinc-800 mb-1">Olá! Sou o assistente KiteOS</h3>
                    <p className="text-sm text-zinc-500 max-w-md">
                      Posso ajudar com diagnósticos de veículos, sugestões de serviço,
                      explicações para clientes e questões financeiras.
                    </p>
                    <p className="text-xs text-zinc-400 mt-2">
                      Use as ações rápidas ao lado ou digite sua pergunta abaixo.
                    </p>
                  </div>
                ) : (
                  messages.map((msg) => (
                    <div
                      key={msg.id}
                      className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                    >
                      <div className={`flex gap-2 max-w-[85%] ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
                        {/* Avatar */}
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
                          msg.role === 'user'
                            ? 'bg-emerald-600'
                            : 'bg-zinc-200'
                        }`}>
                          {msg.role === 'user' ? (
                            <User className="w-4 h-4 text-white" />
                          ) : (
                            <Bot className="w-4 h-4 text-zinc-600" />
                          )}
                        </div>

                        {/* Message Bubble */}
                        <div className={`rounded-2xl px-4 py-2.5 ${
                          msg.role === 'user'
                            ? 'bg-emerald-600 text-white'
                            : 'bg-zinc-100 text-zinc-800'
                        }`}>
                          <p className="text-sm whitespace-pre-wrap leading-relaxed">{msg.content}</p>
                          {msg.confirmationWarning && (
                            <div className={`mt-2 p-2 rounded-lg text-xs ${
                              msg.role === 'user'
                                ? 'bg-emerald-700 text-emerald-100'
                                : 'bg-amber-100 text-amber-800 border border-amber-200'
                            }`}>
                              <AlertTriangle className="w-3 h-3 inline mr-1" />
                              {msg.confirmationWarning}
                            </div>
                          )}
                          <p className={`text-[10px] mt-1 ${
                            msg.role === 'user' ? 'text-emerald-200' : 'text-zinc-400'
                          }`}>
                            {msg.timestamp.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                          </p>
                        </div>
                      </div>
                    </div>
                  ))
                )}

                {/* Typing Indicator */}
                {typing && (
                  <div className="flex justify-start">
                    <div className="flex gap-2">
                      <div className="w-8 h-8 rounded-full bg-zinc-200 flex items-center justify-center shrink-0">
                        <Bot className="w-4 h-4 text-zinc-600" />
                      </div>
                      <div className="rounded-2xl px-4 py-3 bg-zinc-100">
                        <div className="flex items-center gap-1">
                          <div className="w-2 h-2 rounded-full bg-zinc-400 animate-bounce" style={{ animationDelay: '0ms' }} />
                          <div className="w-2 h-2 rounded-full bg-zinc-400 animate-bounce" style={{ animationDelay: '150ms' }} />
                          <div className="w-2 h-2 rounded-full bg-zinc-400 animate-bounce" style={{ animationDelay: '300ms' }} />
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </CardContent>

            {/* Input Area */}
            <div className="border-t p-3 shrink-0">
              <form onSubmit={handleSubmit} className="flex gap-2">
                <Input
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="Pergunte ao assistente KiteOS..."
                  disabled={sending}
                  className="flex-1"
                />
                <Button
                  type="submit"
                  disabled={sending || !input.trim()}
                  className="bg-emerald-600 hover:bg-emerald-700 shrink-0"
                >
                  {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                </Button>
              </form>
            </div>
          </Card>
        </div>

        {/* Quick Actions Panel */}
        <div className="lg:col-span-1">
          <Card className="h-[600px] flex flex-col">
            <CardHeader className="pb-3 border-b shrink-0">
              <CardTitle className="text-sm font-semibold text-zinc-700 flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-emerald-600" />
                Ações Rápidas
              </CardTitle>
            </CardHeader>
            <CardContent className="flex-1 overflow-y-auto p-3 space-y-2">
              {QUICK_ACTIONS.map((action) => {
                const Icon = action.icon
                return (
                  <button
                    key={action.id}
                    onClick={() => handleQuickAction(action)}
                    disabled={sending}
                    className="w-full text-left p-3 rounded-xl border border-zinc-200 hover:border-emerald-300 hover:bg-emerald-50 transition-all group disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <div className="flex items-start gap-3">
                      <div className="w-9 h-9 rounded-lg bg-zinc-100 group-hover:bg-emerald-100 flex items-center justify-center shrink-0 transition-colors">
                        <Icon className="w-4 h-4 text-zinc-600 group-hover:text-emerald-600 transition-colors" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-zinc-800 group-hover:text-emerald-700 transition-colors">
                          {action.label}
                        </p>
                        <p className="text-xs text-zinc-500 truncate">{action.description}</p>
                      </div>
                    </div>
                  </button>
                )
              })}

              {/* Chat History Summary */}
              {messages.length > 0 && (
                <div className="pt-4 mt-4 border-t">
                  <p className="text-xs font-semibold text-zinc-500 mb-2">Histórico da Conversa</p>
                  <div className="space-y-1 max-h-48 overflow-y-auto">
                    {messages.map((msg) => (
                      <div key={msg.id} className="flex items-start gap-2 text-xs">
                        <span className={`shrink-0 ${msg.role === 'user' ? 'text-emerald-600' : 'text-zinc-400'}`}>
                          {msg.role === 'user' ? '👤' : '🤖'}
                        </span>
                        <p className="text-zinc-600 truncate">{msg.content}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Clear Chat */}
              {messages.length > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setMessages([])}
                  className="w-full text-xs text-zinc-500 hover:text-red-500 mt-2"
                >
                  Limpar conversa
                </Button>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
