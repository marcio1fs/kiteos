'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useAuthStore, apiFetch } from '@/lib/store'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Separator } from '@/components/ui/separator'
import {
  Search,
  Globe,
  Download,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Loader2,
  Shield,
  Upload,
  FileKey2,
  Clock,
  Info,
  RefreshCw,
  Trash2,
  Key,
  Server,
  ExternalLink,
  Zap,
} from 'lucide-react'

// ==================== TYPES ====================
interface SefazConsultaRecord {
  id: string
  chave: string
  ambiente: string
  protocolo: string | null
  status: string
  fornecedorCnpj: string | null
  xmlArmazenado: boolean
  codigoStatus: string | null
  motivoStatus: string | null
  tempoResposta: number | null
  tentativas: number
  erroAmigavel: string | null
  invoiceId: string | null
  createdAt: string
}

interface CertificadoInfo {
  id: string
  nomeArquivo: string
  validade: string | null
  ativo: boolean
  ambiente: string
  uf: string
  cnpjCpf: string | null
  razaoSocial: string | null
  isExpired: boolean
}

const STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  AUTORIZADA: { label: 'Autorizada', className: 'bg-emerald-100 text-emerald-800 hover:bg-emerald-100' },
  CANCELADA: { label: 'Cancelada', className: 'bg-red-100 text-red-800 hover:bg-red-100' },
  DENEGADA: { label: 'Denegada', className: 'bg-red-100 text-red-800 hover:bg-red-100' },
  INUTILIZADA: { label: 'Inutilizada', className: 'bg-zinc-100 text-zinc-800 hover:bg-zinc-100' },
  NAO_ENCONTRADA: { label: 'Não Encontrada', className: 'bg-amber-100 text-amber-800 hover:bg-amber-100' },
  ERRO: { label: 'Erro', className: 'bg-red-100 text-red-800 hover:bg-red-100' },
}

function formatDate(dateStr: string | null) {
  if (!dateStr) return '—'
  return new Date(dateStr).toLocaleDateString('pt-BR')
}

function formatDateTime(dateStr: string | null) {
  if (!dateStr) return '—'
  return new Date(dateStr).toLocaleString('pt-BR')
}

function maskChave(value: string) {
  return value.replace(/\D/g, '').slice(0, 44)
}

// ==================== MAIN COMPONENT ====================
export function SefazModule() {
  const { office, user } = useAuthStore()
  const officeId = office?.id

  // State
  const [activeTab, setActiveTab] = useState('consultar')
  const [alerts, setAlerts] = useState<Array<{ type: 'error' | 'warning' | 'info'; message: string }>>([])

  // Consulta state
  const [chaveConsulta, setChaveConsulta] = useState('')
  const [consultando, setConsultando] = useState(false)
  const [consultaResult, setConsultaResult] = useState<{
    status: string
    xmlDisponivel: boolean
    protocolo: string | null
    chave: string
    cStat: string
    xMotivo: string
    tempoResposta: number
  } | null>(null)

  // Importar state
  const [chaveImportar, setChaveImportar] = useState('')
  const [importando, setImportando] = useState(false)
  const [importarResult, setImportarResult] = useState<{
    nfeId: string
    fornecedor: string
    valorTotal: number
    chave: string
    numero: string
  } | null>(null)

  // Historico state
  const [consultas, setConsultas] = useState<SefazConsultaRecord[]>([])
  const [historicoLoading, setHistoricoLoading] = useState(false)
  const [statusFilter, setStatusFilter] = useState('ALL')

  // Certificado state
  const [certificado, setCertificado] = useState<CertificadoInfo | null>(null)
  const [certLoading, setCertLoading] = useState(false)
  const [certDialogOpen, setCertDialogOpen] = useState(false)
  const [certUploading, setCertUploading] = useState(false)
  const [certForm, setCertForm] = useState({
    senha: '',
    ambiente: 'HOMOLOGACAO',
    uf: 'BA',
  })
  const certFileRef = useRef<HTMLInputElement>(null)

  // Status SEFAZ state
  const [sefazStatus, setSefazStatus] = useState<{
    online: boolean | null
    xMotivo: string | null
    tMed: string | null
  } | null>(null)
  const [checkingStatus, setCheckingStatus] = useState(false)

  // Auto-dismiss alerts
  useEffect(() => {
    if (alerts.length === 0) return
    const timer = setTimeout(() => setAlerts(prev => prev.slice(1)), 6000)
    return () => clearTimeout(timer)
  }, [alerts])

  // ---- Fetch Certificate ----
  const fetchCertificado = useCallback(async () => {
    if (!officeId) return
    setCertLoading(true)
    try {
      const res = await apiFetch(`/api/sefaz/certificado?officeId=${officeId}`)
      if (res.success && res.data) {
        setCertificado(res.data)
      } else {
        setCertificado(null)
      }
    } catch {
      setCertificado(null)
    } finally {
      setCertLoading(false)
    }
  }, [officeId])

  // ---- Fetch Historico ----
  const fetchHistorico = useCallback(async () => {
    if (!officeId) return
    setHistoricoLoading(true)
    try {
      const params = new URLSearchParams({ officeId, limit: '50' })
      if (statusFilter !== 'ALL') params.set('status', statusFilter)
      const res = await apiFetch(`/api/sefaz/consultas?${params.toString()}`)
      if (res.success) {
        setConsultas(res.data || [])
      }
    } catch {
      setAlerts(prev => [...prev, { type: 'error', message: 'Erro ao carregar histórico' }])
    } finally {
      setHistoricoLoading(false)
    }
  }, [officeId, statusFilter])

  useEffect(() => {
    fetchCertificado()
  }, [fetchCertificado])

  useEffect(() => {
    if (activeTab === 'historico') fetchHistorico()
  }, [activeTab, fetchHistorico])

  // ---- Consultar SEFAZ ----
  const handleConsultar = async () => {
    if (!officeId || !chaveConsulta) return
    setConsultando(true)
    setConsultaResult(null)
    try {
      const res = await apiFetch('/api/sefaz/consultar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chave: chaveConsulta, officeId, userId: user?.id }),
      })
      if (res.success) {
        setConsultaResult(res.data)
        if (res.data.status === 'AUTORIZADA') {
          setAlerts(prev => [...prev, { type: 'info', message: 'NF-e autorizada! XML disponível para importação.' }])
        } else if (res.data.status === 'CANCELADA' || res.data.status === 'DENEGADA') {
          setAlerts(prev => [...prev, { type: 'error', message: `NF-e ${res.data.status.toLowerCase()}. Importação bloqueada.` }])
        } else {
          setAlerts(prev => [...prev, { type: 'warning', message: `Status: ${res.data.xMotivo || res.data.status}` }])
        }
      } else {
        setAlerts(prev => [...prev, { type: 'error', message: res.error || 'Erro ao consultar SEFAZ' }])
      }
    } catch {
      setAlerts(prev => [...prev, { type: 'error', message: 'Erro de conexão ao consultar SEFAZ' }])
    } finally {
      setConsultando(false)
    }
  }

  // ---- Importar da SEFAZ ----
  const handleImportar = async () => {
    if (!officeId || !chaveImportar) return
    setImportando(true)
    setImportarResult(null)
    try {
      const res = await apiFetch('/api/sefaz/importar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chave: chaveImportar, officeId, userId: user?.id }),
      })
      if (res.success) {
        setImportarResult(res.data)
        setAlerts(prev => [...prev, { type: 'info', message: `NF-e importada com sucesso! Fornecedor: ${res.data.fornecedor}` }])
      } else {
        const msg = res.errors?.join(', ') || res.error || 'Erro ao importar NF-e da SEFAZ'
        setAlerts(prev => [...prev, { type: 'error', message: msg }])
      }
    } catch {
      setAlerts(prev => [...prev, { type: 'error', message: 'Erro de conexão ao importar NF-e' }])
    } finally {
      setImportando(false)
    }
  }

  // ---- Upload Certificado ----
  const handleCertUpload = async () => {
    if (!officeId) return
    const file = certFileRef.current?.files?.[0]
    if (!file) {
      setAlerts(prev => [...prev, { type: 'error', message: 'Selecione o arquivo .pfx do certificado' }])
      return
    }
    if (!certForm.senha) {
      setAlerts(prev => [...prev, { type: 'error', message: 'Informe a senha do certificado' }])
      return
    }

    setCertUploading(true)
    try {
      const formData = new FormData()
      formData.append('arquivo', file)
      formData.append('senha', certForm.senha)
      formData.append('ambiente', certForm.ambiente)
      formData.append('uf', certForm.uf)
      formData.append('officeId', officeId)

      const token = localStorage.getItem('kiteos_token')
      const res = await fetch('/api/sefaz/certificado', {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: formData,
      })
      const contentType = res.headers.get('content-type') || ''
      const data = contentType.includes('application/json') ? await res.json() : { success: false, errors: [`Erro no servidor (${res.status})`] }

      if (data.success) {
        setCertDialogOpen(false)
        setAlerts(prev => [...prev, { type: 'info', message: 'Certificado digital configurado com sucesso!' }])
        fetchCertificado()
      } else {
        setAlerts(prev => [...prev, { type: 'error', message: data.errors?.join(', ') || 'Erro ao configurar certificado' }])
      }
    } catch {
      setAlerts(prev => [...prev, { type: 'error', message: 'Erro de conexão ao enviar certificado' }])
    } finally {
      setCertUploading(false)
    }
  }

  // ---- Delete Certificado ----
  const handleDeleteCert = async () => {
    if (!officeId || !certificado) return
    try {
      const res = await apiFetch('/api/sefaz/certificado', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ officeId, certificadoId: certificado.id }),
      })
      if (res.success) {
        setCertificado(null)
        setAlerts(prev => [...prev, { type: 'info', message: 'Certificado removido' }])
      }
    } catch {
      setAlerts(prev => [...prev, { type: 'error', message: 'Erro ao remover certificado' }])
    }
  }

  // ---- Check SEFAZ Status ----
  const handleCheckStatus = async () => {
    if (!officeId || !certificado) return
    setCheckingStatus(true)
    setSefazStatus(null)
    try {
      const res = await apiFetch(`/api/sefaz/status?officeId=${officeId}`, { method: 'POST' })
      if (res.success) {
        setSefazStatus({
          online: res.data?.cStat === '107',
          xMotivo: res.data?.xMotivo,
          tMed: res.data?.tMed,
        })
      } else {
        setSefazStatus({ online: false, xMotivo: 'Erro ao verificar status', tMed: null })
      }
    } catch {
      setSefazStatus({ online: false, xMotivo: 'Erro de conexão', tMed: null })
    } finally {
      setCheckingStatus(false)
    }
  }

  const hasCert = !!certificado && certificado.ativo && !certificado.isExpired

  // ==================== RENDER ====================
  return (
    <div className="space-y-6">
      {/* Floating Alerts */}
      <div className="fixed top-4 right-4 z-50 space-y-2 max-w-sm">
        {alerts.map((alert, i) => (
          <Alert key={i} variant={alert.type === 'error' ? 'destructive' : 'default'} className={
            alert.type === 'warning' ? 'border-orange-300 bg-orange-50 text-orange-800' :
            alert.type === 'info' ? 'border-emerald-300 bg-emerald-50 text-emerald-800' :
            undefined
          }>
            {alert.type === 'error' && <XCircle className="h-4 w-4" />}
            {alert.type === 'warning' && <AlertTriangle className="h-4 w-4" />}
            {alert.type === 'info' && <CheckCircle2 className="h-4 w-4" />}
            <AlertDescription className="text-sm">{alert.message}</AlertDescription>
          </Alert>
        ))}
      </div>

      {/* Certificate Status Banner */}
      {!hasCert && (
        <Alert className="border-amber-300 bg-amber-50">
          <Shield className="h-4 w-4 text-amber-600" />
          <AlertDescription className="text-amber-800 text-sm">
            <strong>Certificado digital não configurado.</strong> Para consultar e importar NF-e diretamente da SEFAZ, configure um certificado A1 (.pfx) na aba &quot;Certificado&quot;.
          </AlertDescription>
        </Alert>
      )}

      {/* Main Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="consultar" className="gap-2">
            <Search className="w-4 h-4" /> Consultar
          </TabsTrigger>
          <TabsTrigger value="importar" className="gap-2">
            <Download className="w-4 h-4" /> Importar
          </TabsTrigger>
          <TabsTrigger value="historico" className="gap-2">
            <Clock className="w-4 h-4" /> Histórico
          </TabsTrigger>
          <TabsTrigger value="certificado" className="gap-2">
            <Key className="w-4 h-4" /> Certificado
          </TabsTrigger>
        </TabsList>

        {/* ===== TAB: Consultar SEFAZ ===== */}
        <TabsContent value="consultar" className="space-y-6 mt-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Globe className="w-5 h-5 text-emerald-600" />
                Consultar NF-e na SEFAZ
              </CardTitle>
              <CardDescription>
                Informe a chave de acesso de 44 dígitos para verificar o status da NF-e diretamente na SEFAZ
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-col sm:flex-row gap-3">
                <div className="flex-1 space-y-2">
                  <Label htmlFor="chave-consulta">Chave de Acesso NF-e</Label>
                  <Input
                    id="chave-consulta"
                    placeholder="Informe os 44 dígitos da chave de acesso"
                    value={chaveConsulta}
                    onChange={(e) => setChaveConsulta(maskChave(e.target.value))}
                    maxLength={44}
                    className="font-mono text-sm"
                    disabled={consultando}
                  />
                  <p className="text-xs text-zinc-500">
                    {chaveConsulta.length}/44 dígitos
                    {chaveConsulta.length === 44 && <span className="text-emerald-600 ml-1">✓ Completa</span>}
                  </p>
                </div>
                <div className="flex items-end">
                  <Button
                    onClick={handleConsultar}
                    disabled={consultando || chaveConsulta.length !== 44 || !hasCert}
                    className="bg-emerald-600 hover:bg-emerald-700 min-w-[140px]"
                  >
                    {consultando ? (
                      <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Consultando...</>
                    ) : (
                      <><Search className="w-4 h-4 mr-2" /> Consultar</>
                    )}
                  </Button>
                </div>
              </div>

              {/* Result */}
              {consultaResult && (
                <Card className={`border-2 ${consultaResult.status === 'AUTORIZADA' ? 'border-emerald-300 bg-emerald-50' : 'border-red-200 bg-red-50'}`}>
                  <CardContent className="pt-4 space-y-3">
                    <div className="flex items-center gap-2">
                      {consultaResult.status === 'AUTORIZADA' ? (
                        <CheckCircle2 className="w-6 h-6 text-emerald-600" />
                      ) : (
                        <XCircle className="w-6 h-6 text-red-600" />
                      )}
                      <div>
                        <p className="font-semibold text-lg">
                          {consultaResult.status === 'AUTORIZADA' ? 'NF-e Autorizada' : `NF-e ${consultaResult.status}`}
                        </p>
                        <p className="text-sm text-zinc-600">{consultaResult.xMotivo}</p>
                      </div>
                    </div>
                    <Separator />
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                      <div>
                        <p className="text-zinc-500">Protocolo</p>
                        <p className="font-mono font-medium">{consultaResult.protocolo || '—'}</p>
                      </div>
                      <div>
                        <p className="text-zinc-500">Código Status</p>
                        <p className="font-medium">{consultaResult.cStat}</p>
                      </div>
                      <div>
                        <p className="text-zinc-500">XML Disponível</p>
                        <p className="font-medium">{consultaResult.xmlDisponivel ? 'Sim' : 'Não'}</p>
                      </div>
                      <div>
                        <p className="text-zinc-500">Tempo Resposta</p>
                        <p className="font-medium">{consultaResult.tempoResposta}ms</p>
                      </div>
                    </div>
                    {consultaResult.status === 'AUTORIZADA' && (
                      <div className="flex gap-2 pt-2">
                        <Button
                          onClick={() => { setChaveImportar(consultaResult.chave); setActiveTab('importar') }}
                          className="bg-emerald-600 hover:bg-emerald-700"
                        >
                          <Download className="w-4 h-4 mr-2" /> Importar esta NF-e
                        </Button>
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}

              {/* Info Box */}
              {!consultaResult && !consultando && (
                <div className="bg-zinc-50 rounded-lg p-4 space-y-2">
                  <div className="flex items-center gap-2 text-zinc-600">
                    <Info className="w-4 h-4" />
                    <p className="font-medium text-sm">Como funciona a consulta SEFAZ</p>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm text-zinc-500">
                    <div className="flex items-start gap-2">
                      <span className="bg-emerald-100 text-emerald-700 rounded-full w-6 h-6 flex items-center justify-center text-xs font-bold shrink-0">1</span>
                      <p>Informe a chave de acesso de 44 dígitos da NF-e</p>
                    </div>
                    <div className="flex items-start gap-2">
                      <span className="bg-emerald-100 text-emerald-700 rounded-full w-6 h-6 flex items-center justify-center text-xs font-bold shrink-0">2</span>
                      <p>O sistema consulta a SEFAZ para verificar o status da NF-e</p>
                    </div>
                    <div className="flex items-start gap-2">
                      <span className="bg-emerald-100 text-emerald-700 rounded-full w-6 h-6 flex items-center justify-center text-xs font-bold shrink-0">3</span>
                      <p>Se autorizada, o XML fica disponível para importação automática</p>
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ===== TAB: Importar da SEFAZ ===== */}
        <TabsContent value="importar" className="space-y-6 mt-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Download className="w-5 h-5 text-emerald-600" />
                Importar NF-e da SEFAZ
              </CardTitle>
              <CardDescription>
                Consulta e importa automaticamente o XML autorizado diretamente da SEFAZ
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-col sm:flex-row gap-3">
                <div className="flex-1 space-y-2">
                  <Label htmlFor="chave-importar">Chave de Acesso NF-e</Label>
                  <Input
                    id="chave-importar"
                    placeholder="Informe os 44 dígitos da chave de acesso"
                    value={chaveImportar}
                    onChange={(e) => setChaveImportar(maskChave(e.target.value))}
                    maxLength={44}
                    className="font-mono text-sm"
                    disabled={importando}
                  />
                  <p className="text-xs text-zinc-500">
                    {chaveImportar.length}/44 dígitos
                    {chaveImportar.length === 44 && <span className="text-emerald-600 ml-1">✓ Completa</span>}
                  </p>
                </div>
                <div className="flex items-end">
                  <Button
                    onClick={handleImportar}
                    disabled={importando || chaveImportar.length !== 44 || !hasCert}
                    className="bg-emerald-600 hover:bg-emerald-700 min-w-[140px]"
                  >
                    {importando ? (
                      <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Importando...</>
                    ) : (
                      <><Download className="w-4 h-4 mr-2" /> Importar</>
                    )}
                  </Button>
                </div>
              </div>

              {/* Import Result */}
              {importarResult && (
                <Card className="border-2 border-emerald-300 bg-emerald-50">
                  <CardContent className="pt-4 space-y-3">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="w-6 h-6 text-emerald-600" />
                      <p className="font-semibold text-lg">NF-e Importada com Sucesso!</p>
                    </div>
                    <Separator />
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                      <div>
                        <p className="text-zinc-500">Número</p>
                        <p className="font-medium">{importarResult.numero}</p>
                      </div>
                      <div>
                        <p className="text-zinc-500">Fornecedor</p>
                        <p className="font-medium">{importarResult.fornecedor}</p>
                      </div>
                      <div>
                        <p className="text-zinc-500">Valor Total</p>
                        <p className="font-medium">{importarResult.valorTotal.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</p>
                      </div>
                      <div>
                        <p className="text-zinc-500">ID</p>
                        <p className="font-mono text-xs">{importarResult.nfeId}</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Flow Info */}
              {!importarResult && !importando && (
                <div className="bg-zinc-50 rounded-lg p-4 space-y-3">
                  <div className="flex items-center gap-2 text-zinc-600">
                    <Zap className="w-4 h-4" />
                    <p className="font-medium text-sm">Fluxo de Importação Automática</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-sm text-zinc-500">
                    <span className="bg-emerald-100 text-emerald-700 px-2 py-1 rounded">Consultar SEFAZ</span>
                    <span>→</span>
                    <span className="bg-emerald-100 text-emerald-700 px-2 py-1 rounded">Validar Autorização</span>
                    <span>→</span>
                    <span className="bg-emerald-100 text-emerald-700 px-2 py-1 rounded">Download XML</span>
                    <span>→</span>
                    <span className="bg-emerald-100 text-emerald-700 px-2 py-1 rounded">Pré-lançamento</span>
                    <span>→</span>
                    <span className="bg-amber-100 text-amber-700 px-2 py-1 rounded">Conferência</span>
                    <span>→</span>
                    <span className="bg-blue-100 text-blue-700 px-2 py-1 rounded">Estoque + Financeiro</span>
                  </div>
                  <div className="text-xs text-zinc-400 space-y-1">
                    <p>• NF-e canceladas, denegadas ou inutilizadas são bloqueadas automaticamente</p>
                    <p>• O estoque NÃO é atualizado automaticamente — é necessária conferência física</p>
                    <p>• Após conferência aprovada, o estoque e título a pagar são gerados</p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ===== TAB: Histórico ===== */}
        <TabsContent value="historico" className="space-y-6 mt-6">
          <Card>
            <CardHeader>
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Clock className="w-5 h-5 text-emerald-600" />
                  Histórico de Consultas SEFAZ
                </CardTitle>
                <Button variant="outline" size="sm" onClick={fetchHistorico} className="gap-1">
                  <RefreshCw className="w-3.5 h-3.5" /> Atualizar
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Filter */}
              <div className="flex gap-3">
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="w-full sm:w-48">
                    <SelectValue placeholder="Filtrar status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">Todos os Status</SelectItem>
                    <SelectItem value="AUTORIZADA">Autorizada</SelectItem>
                    <SelectItem value="CANCELADA">Cancelada</SelectItem>
                    <SelectItem value="DENEGADA">Denegada</SelectItem>
                    <SelectItem value="INUTILIZADA">Inutilizada</SelectItem>
                    <SelectItem value="NAO_ENCONTRADA">Não Encontrada</SelectItem>
                    <SelectItem value="ERRO">Erro</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Table */}
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Chave</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Protocolo</TableHead>
                      <TableHead>Ambiente</TableHead>
                      <TableHead>Tempo</TableHead>
                      <TableHead>Data</TableHead>
                      <TableHead>Importada</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {historicoLoading ? (
                      <TableRow>
                        <TableCell colSpan={7} className="text-center py-8 text-zinc-500">
                          <Loader2 className="w-5 h-5 animate-spin mx-auto mb-2" />
                          Carregando histórico...
                        </TableCell>
                      </TableRow>
                    ) : consultas.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={7} className="text-center py-8 text-zinc-500">
                          Nenhuma consulta registrada
                        </TableCell>
                      </TableRow>
                    ) : (
                      consultas.map((c) => {
                        const statusConf = STATUS_CONFIG[c.status] || STATUS_CONFIG.ERRO
                        return (
                          <TableRow key={c.id}>
                            <TableCell className="font-mono text-xs max-w-[120px] truncate" title={c.chave}>
                              {c.chave.substring(0, 20)}...
                            </TableCell>
                            <TableCell>
                              <Badge variant="secondary" className={statusConf.className}>
                                {statusConf.label}
                              </Badge>
                            </TableCell>
                            <TableCell className="font-mono text-xs">{c.protocolo || '—'}</TableCell>
                            <TableCell>
                              <Badge variant="outline" className={c.ambiente === 'PRODUCAO' ? 'text-emerald-700' : 'text-amber-700'}>
                                {c.ambiente === 'PRODUCAO' ? 'Produção' : 'Homologação'}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-sm">{c.tempoResposta ? `${c.tempoResposta}ms` : '—'}</TableCell>
                            <TableCell className="text-sm">{formatDateTime(c.createdAt)}</TableCell>
                            <TableCell>
                              {c.invoiceId ? (
                                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                              ) : (
                                <XCircle className="w-4 h-4 text-zinc-300" />
                              )}
                            </TableCell>
                          </TableRow>
                        )
                      })
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ===== TAB: Certificado ===== */}
        <TabsContent value="certificado" className="space-y-6 mt-6">
          {/* Current Certificate */}
          <Card>
            <CardHeader>
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <CardTitle className="flex items-center gap-2 text-lg">
                  <FileKey2 className="w-5 h-5 text-emerald-600" />
                  Certificado Digital
                </CardTitle>
                <div className="flex gap-2">
                  {certificado && (
                    <Button variant="destructive" size="sm" onClick={handleDeleteCert} className="gap-1">
                      <Trash2 className="w-3.5 h-3.5" /> Remover
                    </Button>
                  )}
                  <Button onClick={() => setCertDialogOpen(true)} className="bg-emerald-600 hover:bg-emerald-700 gap-1">
                    <Upload className="w-4 h-4" /> Configurar Certificado
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {certLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-6 h-6 animate-spin text-emerald-600" />
                  <span className="ml-2 text-zinc-500">Carregando...</span>
                </div>
              ) : certificado ? (
                <div className="space-y-4">
                  <div className={`p-4 rounded-lg border-2 ${certificado.isExpired ? 'border-red-300 bg-red-50' : 'border-emerald-300 bg-emerald-50'}`}>
                    <div className="flex items-center gap-2 mb-2">
                      {certificado.isExpired ? (
                        <XCircle className="w-5 h-5 text-red-600" />
                      ) : (
                        <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                      )}
                      <p className={`font-medium ${certificado.isExpired ? 'text-red-800' : 'text-emerald-800'}`}>
                        {certificado.isExpired ? 'Certificado Expirado' : 'Certificado Ativo'}
                      </p>
                    </div>
                    <p className="text-sm text-zinc-600">
                      {certificado.isExpired
                        ? 'O certificado digital expirou. Configure um novo certificado para continuar usando a integração SEFAZ.'
                        : 'O certificado digital está ativo e pronto para uso na integração com SEFAZ.'}
                    </p>
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
                    <div>
                      <p className="text-zinc-500">Arquivo</p>
                      <p className="font-medium">{certificado.nomeArquivo}</p>
                    </div>
                    <div>
                      <p className="text-zinc-500">CNPJ/CPF</p>
                      <p className="font-mono">{certificado.cnpjCpf || '—'}</p>
                    </div>
                    <div>
                      <p className="text-zinc-500">Razão Social</p>
                      <p className="font-medium">{certificado.razaoSocial || '—'}</p>
                    </div>
                    <div>
                      <p className="text-zinc-500">Validade</p>
                      <p className="font-medium">{formatDate(certificado.validade)}</p>
                    </div>
                    <div>
                      <p className="text-zinc-500">Ambiente</p>
                      <Badge variant="outline" className={certificado.ambiente === 'PRODUCAO' ? 'text-emerald-700' : 'text-amber-700'}>
                        {certificado.ambiente === 'PRODUCAO' ? 'Produção' : 'Homologação'}
                      </Badge>
                    </div>
                    <div>
                      <p className="text-zinc-500">UF</p>
                      <p className="font-medium">{certificado.uf}</p>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-12">
                  <FileKey2 className="w-12 h-12 text-zinc-300 mb-3" />
                  <p className="text-zinc-500 font-medium">Nenhum certificado configurado</p>
                  <p className="text-sm text-zinc-400">Configure um certificado A1 (.pfx) para usar a integração SEFAZ</p>
                  <Button onClick={() => setCertDialogOpen(true)} className="bg-emerald-600 hover:bg-emerald-700 mt-4 gap-2">
                    <Upload className="w-4 h-4" /> Configurar Certificado
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          {/* SEFAZ Status Check */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Server className="w-5 h-5 text-emerald-600" />
                Status do Serviço SEFAZ
              </CardTitle>
              <CardDescription>
                Verifique se o webservice da SEFAZ está operacional
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-4">
                <Button
                  onClick={handleCheckStatus}
                  disabled={checkingStatus || !hasCert}
                  variant="outline"
                  className="gap-2"
                >
                  {checkingStatus ? (
                    <><Loader2 className="w-4 h-4 animate-spin" /> Verificando...</>
                  ) : (
                    <><ExternalLink className="w-4 h-4" /> Verificar Status</>
                  )}
                </Button>

                {sefazStatus && (
                  <div className={`flex items-center gap-2 px-4 py-2 rounded-lg ${
                    sefazStatus.online ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-800'
                  }`}>
                    {sefazStatus.online ? (
                      <CheckCircle2 className="w-5 h-5" />
                    ) : (
                      <XCircle className="w-5 h-5" />
                    )}
                    <div>
                      <p className="font-medium">{sefazStatus.online ? 'SEFAZ Online' : 'SEFAZ Offline'}</p>
                      <p className="text-xs">{sefazStatus.xMotivo}</p>
                    </div>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Certificate Guide */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Info className="w-5 h-5 text-zinc-500" />
                Guia de Configuração
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-sm text-zinc-600">
              <div className="space-y-3">
                <div className="flex items-start gap-3">
                  <span className="bg-emerald-100 text-emerald-700 rounded-full w-6 h-6 flex items-center justify-center text-xs font-bold shrink-0">1</span>
                  <div>
                    <p className="font-medium text-zinc-800">Obtenha o Certificado A1</p>
                    <p>Adquira um certificado digital A1 (.pfx) de uma Autoridade Certificadora credenciada pela ICP-Brasil. O certificado deve ser do tipo e-CNPJ ou e-CPF.</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <span className="bg-emerald-100 text-emerald-700 rounded-full w-6 h-6 flex items-center justify-center text-xs font-bold shrink-0">2</span>
                  <div>
                    <p className="font-medium text-zinc-800">Selecione o Arquivo e Senha</p>
                    <p>Clique em &quot;Configurar Certificado&quot; e selecione o arquivo .pfx. Informe a senha que foi definida no momento da emissão do certificado.</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <span className="bg-emerald-100 text-emerald-700 rounded-full w-6 h-6 flex items-center justify-center text-xs font-bold shrink-0">3</span>
                  <div>
                    <p className="font-medium text-zinc-800">Escolha o Ambiente</p>
                    <p><strong>Homologação:</strong> Para testes. Use chaves de NF-e de homologação.<br/>
                    <strong>Produção:</strong> Para operações reais. Use chaves de NF-e reais.</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <span className="bg-emerald-100 text-emerald-700 rounded-full w-6 h-6 flex items-center justify-center text-xs font-bold shrink-0">4</span>
                  <div>
                    <p className="font-medium text-zinc-800">Selecione a UF</p>
                    <p>Informe o estado (UF) do emitente do certificado. A UF determina qual webservice da SEFAZ será utilizado para as consultas.</p>
                  </div>
                </div>
              </div>
              <Separator />
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                <p className="font-medium text-amber-800">⚠️ Segurança</p>
                <p className="text-amber-700 mt-1">A senha do certificado é armazenada criptografada (AES-256-GCM) e nunca é exposta em logs ou respostas da API. O arquivo PFX também é criptografado antes do armazenamento.</p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Certificate Upload Dialog */}
      <Dialog open={certDialogOpen} onOpenChange={setCertDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileKey2 className="w-5 h-5 text-emerald-600" />
              Configurar Certificado Digital
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Arquivo PFX (*.pfx)</Label>
              <input
                ref={certFileRef}
                type="file"
                accept=".pfx"
                className="block w-full text-sm text-zinc-500 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-medium file:bg-emerald-50 file:text-emerald-700 hover:file:bg-emerald-100"
              />
              <p className="text-xs text-zinc-500">Selecione o arquivo .pfx do certificado A1</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="cert-senha">Senha do Certificado</Label>
              <Input
                id="cert-senha"
                type="password"
                placeholder="Senha do certificado"
                value={certForm.senha}
                onChange={(e) => setCertForm(prev => ({ ...prev, senha: e.target.value }))}
              />
              <p className="text-xs text-zinc-500">A senha é armazenada de forma criptografada</p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Ambiente</Label>
                <Select value={certForm.ambiente} onValueChange={(v) => setCertForm(prev => ({ ...prev, ambiente: v }))}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="HOMOLOGACAO">Homologação</SelectItem>
                    <SelectItem value="PRODUCAO">Produção</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>UF</Label>
                <Select value={certForm.uf} onValueChange={(v) => setCertForm(prev => ({ ...prev, uf: v }))}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MG','MS','MT','PA','PB','PE','PI','PR','RJ','RN','RO','RR','RS','SC','SE','SP','TO'].map(uf => (
                      <SelectItem key={uf} value={uf}>{uf}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCertDialogOpen(false)} disabled={certUploading}>
              Cancelar
            </Button>
            <Button onClick={handleCertUpload} disabled={certUploading} className="bg-emerald-600 hover:bg-emerald-700">
              {certUploading ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Enviando...</>
              ) : (
                <><Upload className="w-4 h-4 mr-2" /> Salvar</>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
