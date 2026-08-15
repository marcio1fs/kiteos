'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { useAuthStore, apiFetch } from '@/lib/store'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Building2, Mail, Phone, MapPin, Save, Loader2, Shield, Users, Upload, Trash2, ImageIcon, CreditCard, CheckCircle, XCircle, AlertTriangle, ExternalLink, MessageCircle, Wifi, WifiOff } from 'lucide-react'

interface MpConfig {
  mpEnabled: boolean
  mpSandbox: boolean
  mpAccessToken: string
  mpPublicKey: string
  mpUserId: string
  mpValid: boolean
}

interface WaConfig {
  waEnabled: boolean
  waApiUrl: string
  waApiToken: string
  waInstance: string
  waPhone: string
  waValid: boolean
}

export function OfficeProfileModule() {
  const { user, office } = useAuthStore()
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [uploading, setUploading] = useState(false)
  /**
   * Resolve logo URL for display.
   * Uses /api/uploads/ path since Next.js standalone doesn't serve dynamically added public files.
   */
  const resolveLogoUrl = (logo: string | null | undefined): string | null => {
    if (!logo) return null
    if (logo.startsWith('http') || logo.startsWith('data:')) return logo
    return logo.replace(/^\/uploads\//, '/api/uploads/')
  }

  const [logoPreview, setLogoPreview] = useState<string | null>(resolveLogoUrl(office?.logo))
  const [uploadError, setUploadError] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [form, setForm] = useState({
    name: office?.name || '',
    email: office?.email || '',
    phone: office?.phone || '',
    address: office?.address || '',
    city: office?.city || '',
    state: office?.state || '',
    zipCode: office?.zipCode || '',
  })

  // Mercado Pago config state
  const [mpConfig, setMpConfig] = useState<MpConfig>({
    mpEnabled: false,
    mpSandbox: true,
    mpAccessToken: '',
    mpPublicKey: '',
    mpUserId: '',
    mpValid: false,
  })
  const [mpLoading, setMpLoading] = useState(true)
  const [mpSaving, setMpSaving] = useState(false)
  const [mpValidating, setMpValidating] = useState(false)
  const [mpMessage, setMpMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  // WhatsApp config state
  const [waConfig, setWaConfig] = useState<WaConfig>({
    waEnabled: false,
    waApiUrl: '',
    waApiToken: '',
    waInstance: '',
    waPhone: '',
    waValid: false,
  })
  const [waLoading, setWaLoading] = useState(true)
  const [waSaving, setWaSaving] = useState(false)
  const [waTesting, setWaTesting] = useState(false)
  const [waMessage, setWaMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const fetchMpConfig = useCallback(async () => {
    if (!office) return
    setMpLoading(true)
    try {
      const res = await apiFetch(`/api/mercadopago/config?officeId=${office.id}`)
      if (res.success && res.data) {
        setMpConfig({
          mpEnabled: res.data.enabled || false,
          mpSandbox: res.data.sandbox ?? true,
          mpAccessToken: '', // Never returned from API for security
          mpPublicKey: res.data.publicKey || '',
          mpUserId: res.data.userId || '',
          mpValid: !!(res.data.userId && res.data.enabled),
        })
      }
    } catch {
      // Silently handle
    } finally {
      setMpLoading(false)
    }
  }, [office])

  useEffect(() => {
    fetchMpConfig()
  }, [fetchMpConfig])

  const fetchWaConfig = useCallback(async () => {
    if (!office) return
    setWaLoading(true)
    try {
      const res = await apiFetch(`/api/whatsapp/config?officeId=${office.id}`)
      if (res.success && res.data) {
        setWaConfig({
          waEnabled: res.data.enabled || false,
          waApiUrl: res.data.apiUrl || '',
          waApiToken: '', // Never returned from API for security
          waInstance: res.data.instance || '',
          waPhone: res.data.phone || '',
          waValid: !!(res.data.apiUrl && res.data.instance && res.data.enabled),
        })
      }
    } catch {
      // Silently handle
    } finally {
      setWaLoading(false)
    }
  }, [office])

  useEffect(() => {
    fetchWaConfig()
  }, [fetchWaConfig])

  const handleSave = async () => {
    if (!office) return
    setSaving(true)
    setSaved(false)
    try {
      const data = await apiFetch(`/api/offices/${office.id}`, {
        method: 'PUT',
        body: JSON.stringify(form),
      })
      if (data.success) {
        // Update store and localStorage with new office data
        const updatedOffice = { ...office, ...form }
        localStorage.setItem('kiteos_office', JSON.stringify(updatedOffice))
        useAuthStore.setState({ office: updatedOffice })
      }
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } catch {
      // Silently handle
    } finally {
      setSaving(false)
    }
  }

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !office) return

    setUploadError('')

    // Validate file type
    const validTypes = ['image/png', 'image/jpeg', 'image/webp']
    if (!validTypes.includes(file.type)) {
      setUploadError('Tipo inválido. Use PNG, JPG ou WEBP.')
      return
    }

    // Validate file size (2MB)
    if (file.size > 2 * 1024 * 1024) {
      setUploadError('Arquivo muito grande. Máximo 2MB.')
      return
    }

    // Show preview
    const reader = new FileReader()
    reader.onload = (ev) => {
      setLogoPreview(ev.target?.result as string)
    }
    reader.readAsDataURL(file)

    // Upload
    setUploading(true)
    try {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('officeId', office.id)

      const token = localStorage.getItem('kiteos_token')
      const res = await fetch('/api/upload/logo', {
        method: 'POST',
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: formData,
      })
      const contentType = res.headers.get('content-type') || ''
      const data = contentType.includes('application/json') ? await res.json() : { success: false, error: `Erro no upload (${res.status})` }

      if (data.success) {
        setLogoPreview(resolveLogoUrl(data.data.logo))
        setUploadError('')
        // Update office in localStorage and store so logo appears on receipts
        const currentOffice = JSON.parse(localStorage.getItem('kiteos_office') || '{}')
        const updatedOffice = { ...currentOffice, logo: data.data.logo }
        localStorage.setItem('kiteos_office', JSON.stringify(updatedOffice))
        // Update zustand store
        useAuthStore.setState({ office: updatedOffice })
      } else {
        setUploadError(data.error || 'Erro ao fazer upload')
        setLogoPreview(resolveLogoUrl(office.logo))
      }
    } catch {
      setUploadError('Erro ao fazer upload do logo')
      setLogoPreview(resolveLogoUrl(office.logo))
    } finally {
      setUploading(false)
    }
  }

  const handleRemoveLogo = async () => {
    if (!office) return
    setUploading(true)
    setUploadError('')
    try {
      const data = await apiFetch(`/api/upload/logo?officeId=${office.id}`, {
        method: 'DELETE',
      })
      if (data.success) {
        setLogoPreview(null)
        // Update office in localStorage and store
        const currentOffice = JSON.parse(localStorage.getItem('kiteos_office') || '{}')
        const updatedOffice = { ...currentOffice, logo: null }
        localStorage.setItem('kiteos_office', JSON.stringify(updatedOffice))
        useAuthStore.setState({ office: updatedOffice })
      } else {
        setUploadError(data.error || 'Erro ao remover logo')
      }
    } catch {
      setUploadError('Erro ao remover logo')
    } finally {
      setUploading(false)
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    }
  }

  const handleMpSave = async () => {
    if (!office) return
    setMpSaving(true)
    setMpMessage(null)
    try {
      const payload: Record<string, unknown> = {
        officeId: office.id,
        mpEnabled: mpConfig.mpEnabled,
        mpSandbox: mpConfig.mpSandbox,
      }

      // Only send access token if user typed a new one
      if (mpConfig.mpAccessToken) {
        payload.mpAccessToken = mpConfig.mpAccessToken
      }
      if (mpConfig.mpPublicKey) {
        payload.mpPublicKey = mpConfig.mpPublicKey
      }

      const res = await apiFetch(`/api/mercadopago/config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (res.success) {
        setMpMessage({ type: 'success', text: res.data?.message || 'Configurações do Mercado Pago salvas com sucesso!' })
        setMpConfig(prev => ({
          ...prev,
          mpValid: true,
          mpUserId: res.data?.userId || prev.mpUserId,
          mpAccessToken: '', // Clear after save for security
        }))
      } else {
        setMpMessage({ type: 'error', text: res.error || 'Erro ao salvar configurações' })
      }
    } catch {
      setMpMessage({ type: 'error', text: 'Erro de conexão ao salvar' })
    } finally {
      setMpSaving(false)
      setTimeout(() => setMpMessage(null), 5000)
    }
  }

  const handleMpValidate = async () => {
    if (!mpConfig.mpAccessToken) {
      setMpMessage({ type: 'error', text: 'Insira o Access Token para validar' })
      return
    }
    setMpValidating(true)
    setMpMessage(null)
    try {
      // Try to get user info from MP API to validate the token
      const mpResponse = await fetch('https://api.mercadopago.com/users/me', {
        headers: { Authorization: `Bearer ${mpConfig.mpAccessToken}` },
      })

      if (mpResponse.ok) {
        const userData = await mpResponse.json()
        setMpConfig(prev => ({
          ...prev,
          mpUserId: String(userData.id),
          mpValid: true,
          mpEnabled: true,
        }))
        setMpMessage({ type: 'success', text: `Token válido! Conta: ${userData.nickname || userData.email || userData.id}` })
      } else {
        setMpConfig(prev => ({ ...prev, mpValid: false }))
        setMpMessage({ type: 'error', text: 'Token inválido ou expirado. Verifique o Access Token.' })
      }
    } catch {
      setMpConfig(prev => ({ ...prev, mpValid: false }))
      setMpMessage({ type: 'error', text: 'Erro ao validar token. Verifique sua conexão.' })
    } finally {
      setMpValidating(false)
    }
  }

  const handleWaSave = async () => {
    if (!office) return
    setWaSaving(true)
    setWaMessage(null)
    try {
      const payload: Record<string, unknown> = {
        officeId: office.id,
        waEnabled: waConfig.waEnabled,
      }

      // Only send fields that user filled
      if (waConfig.waApiUrl) payload.waApiUrl = waConfig.waApiUrl
      if (waConfig.waApiToken) payload.waApiToken = waConfig.waApiToken
      if (waConfig.waInstance) payload.waInstance = waConfig.waInstance
      if (waConfig.waPhone) payload.waPhone = waConfig.waPhone

      const res = await apiFetch(`/api/whatsapp/config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (res.success) {
        setWaMessage({ type: 'success', text: res.data?.message || 'Configurações do WhatsApp salvas com sucesso!' })
        setWaConfig(prev => ({
          ...prev,
          waValid: res.data?.validated || !!(prev.waApiUrl && prev.waInstance),
          waApiToken: '', // Clear after save for security
        }))
      } else {
        setWaMessage({ type: 'error', text: res.error || 'Erro ao salvar configurações' })
      }
    } catch {
      setWaMessage({ type: 'error', text: 'Erro de conexão ao salvar' })
    } finally {
      setWaSaving(false)
      setTimeout(() => setWaMessage(null), 5000)
    }
  }

  const handleWaTest = async () => {
    if (!office) return
    setWaTesting(true)
    setWaMessage(null)
    try {
      const payload: Record<string, unknown> = {
        officeId: office.id,
        testOnly: true,
      }

      // Send current form values for testing
      if (waConfig.waApiUrl) payload.waApiUrl = waConfig.waApiUrl
      if (waConfig.waApiToken) payload.waApiToken = waConfig.waApiToken
      if (waConfig.waInstance) payload.waInstance = waConfig.waInstance
      if (waConfig.waPhone) payload.waPhone = waConfig.waPhone

      const res = await apiFetch(`/api/whatsapp/config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (res.success && res.data?.validated) {
        setWaMessage({ type: 'success', text: res.data?.message || 'Conexão testada com sucesso!' })
        setWaConfig(prev => ({ ...prev, waValid: true }))
      } else {
        setWaMessage({ type: 'error', text: res.data?.message || res.error || 'Falha na conexão com WhatsApp API' })
        setWaConfig(prev => ({ ...prev, waValid: false }))
      }
    } catch {
      setWaMessage({ type: 'error', text: 'Erro de conexão ao testar' })
    } finally {
      setWaTesting(false)
      setTimeout(() => setWaMessage(null), 8000)
    }
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6 p-4 md:p-0">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-zinc-900">Perfil da Oficina</h1>
        <p className="text-zinc-500 text-sm mt-1">Gerencie as informações da sua oficina</p>
      </div>

      {/* Logo Upload Card */}
      <Card className="border-zinc-200/60">
        <CardHeader>
          <CardTitle className="text-base">Logo da Oficina</CardTitle>
          <CardDescription>
            A logo será exibida nos recibos e ordens de serviço impressas. Formatos: PNG, JPG ou WEBP. Máximo 2MB.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col sm:flex-row items-start gap-6">
            {/* Logo Preview */}
            <div className="flex flex-col items-center gap-3">
              <div className="w-32 h-32 rounded-xl border-2 border-dashed border-zinc-300 flex items-center justify-center bg-zinc-50 overflow-hidden">
                {logoPreview ? (
                  <img
                    src={logoPreview}
                    alt="Logo da oficina"
                    className="w-full h-full object-contain p-2"
                  />
                ) : (
                  <div className="flex flex-col items-center gap-2 text-zinc-400">
                    <ImageIcon className="w-8 h-8" />
                    <span className="text-xs">Sem logo</span>
                  </div>
                )}
              </div>
              {logoPreview && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleRemoveLogo}
                  className="text-red-500 hover:text-red-700 hover:bg-red-50 gap-1 text-xs"
                >
                  <Trash2 className="w-3 h-3" /> Remover
                </Button>
              )}
            </div>

            {/* Upload Controls */}
            <div className="flex-1 space-y-4">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={handleLogoUpload}
                className="hidden"
                id="logo-upload"
              />
              <Button
                variant="outline"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="border-emerald-200 text-emerald-700 hover:bg-emerald-50 gap-2"
              >
                {uploading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Enviando...
                  </>
                ) : (
                  <>
                    <Upload className="w-4 h-4" />
                    {logoPreview ? 'Trocar Logo' : 'Enviar Logo'}
                  </>
                )}
              </Button>

              {uploadError && (
                <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">
                  {uploadError}
                </div>
              )}

              <div className="text-xs text-zinc-500 space-y-1">
                <p>A logo será usada automaticamente em:</p>
                <ul className="list-disc list-inside ml-2 space-y-0.5">
                  <li>Recibos de pagamento</li>
                  <li>Ordens de serviço impressas</li>
                  <li>Extratos de encerramento</li>
                </ul>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Office Info Card */}
      <Card className="border-zinc-200/60">
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-emerald-50 flex items-center justify-center shrink-0">
              {logoPreview ? (
                <img src={logoPreview} alt="Logo" className="w-8 h-8 object-contain" />
              ) : (
                <Building2 className="w-6 h-6 text-emerald-600" />
              )}
            </div>
            <div>
              <CardTitle className="text-lg">{office?.name}</CardTitle>
              <CardDescription>
                CNPJ: {office?.cnpj?.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5')}
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="flex items-center gap-2 text-sm">
              <Mail className="w-4 h-4 text-zinc-400" />
              <span className="text-zinc-600">{office?.email}</span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <Phone className="w-4 h-4 text-zinc-400" />
              <span className="text-zinc-600">{office?.phone || 'Não informado'}</span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <MapPin className="w-4 h-4 text-zinc-400" />
              <span className="text-zinc-600">
                {[office?.address, office?.city, office?.state].filter(Boolean).join(', ') || 'Não informado'}
              </span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <Shield className="w-4 h-4 text-zinc-400" />
              <Badge variant="secondary" className="bg-emerald-100 text-emerald-700 text-xs">
                {user?.role === 'OWNER' ? 'Proprietário' : user?.role === 'ADMIN' ? 'Administrador' : 'Funcionário'}
              </Badge>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Edit Form */}
      <Card className="border-zinc-200/60">
        <CardHeader>
          <CardTitle className="text-base">Editar Informações</CardTitle>
          <CardDescription>Atualize os dados cadastrais da oficina</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Nome da Oficina</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="border-zinc-200"
              />
            </div>
            <div className="space-y-2">
              <Label>Email</Label>
              <Input
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                className="border-zinc-200"
              />
            </div>
            <div className="space-y-2">
              <Label>Telefone</Label>
              <Input
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                placeholder="(77) 99999-0000"
                className="border-zinc-200"
              />
            </div>
            <div className="space-y-2">
              <Label>CEP</Label>
              <Input
                value={form.zipCode}
                onChange={(e) => setForm({ ...form, zipCode: e.target.value })}
                placeholder="00000-000"
                className="border-zinc-200"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Endereço</Label>
            <Input
              value={form.address}
              onChange={(e) => setForm({ ...form, address: e.target.value })}
              placeholder="Rua, número, complemento"
              className="border-zinc-200"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Cidade</Label>
              <Input
                value={form.city}
                onChange={(e) => setForm({ ...form, city: e.target.value })}
                placeholder="Itapetinga"
                className="border-zinc-200"
              />
            </div>
            <div className="space-y-2">
              <Label>Estado</Label>
              <Input
                value={form.state}
                onChange={(e) => setForm({ ...form, state: e.target.value })}
                placeholder="BA"
                maxLength={2}
                className="border-zinc-200"
              />
            </div>
          </div>

          <div className="flex justify-end pt-2">
            <Button
              onClick={handleSave}
              disabled={saving}
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              {saving ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Salvando...
                </>
              ) : saved ? (
                'Salvo com sucesso!'
              ) : (
                <>
                  <Save className="w-4 h-4" />
                  Salvar Alterações
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Mercado Pago Configuration Card - Restricted to ADMIN */}
      {user?.role === 'ADMIN' && (
        <Card className="border-zinc-200/60">
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center">
                <CreditCard className="w-5 h-5 text-blue-600" />
              </div>
              <div className="flex-1">
                <CardTitle className="text-base">Mercado Pago</CardTitle>
                <CardDescription>
                  Configure para receber pagamentos de assinaturas e vendas PDV
                </CardDescription>
              </div>
              {mpConfig.mpValid ? (
                <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100">
                  <CheckCircle className="w-3 h-3 mr-1" /> Conectado
                </Badge>
              ) : mpConfig.mpAccessToken ? (
                <Badge className="bg-yellow-100 text-yellow-700 hover:bg-yellow-100">
                  <AlertTriangle className="w-3 h-3 mr-1" /> Não validado
                </Badge>
              ) : (
                <Badge className="bg-zinc-100 text-zinc-500 hover:bg-zinc-100">
                  <XCircle className="w-3 h-3 mr-1" /> Desconectado
                </Badge>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {mpMessage && (
              <div className={`p-3 rounded-lg text-sm flex items-center gap-2 ${
                mpMessage.type === 'success'
                  ? 'bg-emerald-50 border border-emerald-200 text-emerald-700'
                  : 'bg-red-50 border border-red-200 text-red-700'
              }`}>
                {mpMessage.type === 'success' ? <CheckCircle className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
                {mpMessage.text}
              </div>
            )}

            {/* Enable/Disable Toggle */}
            <div className="flex items-center justify-between p-3 rounded-lg bg-zinc-50">
              <div>
                <p className="text-sm font-medium text-zinc-800">Ativar Mercado Pago</p>
                <p className="text-xs text-zinc-500">Habilita pagamentos online para assinaturas e PDV</p>
              </div>
              <Switch
                checked={mpConfig.mpEnabled}
                onCheckedChange={(checked) => setMpConfig({ ...mpConfig, mpEnabled: checked })}
              />
            </div>

            {/* Sandbox Mode Toggle */}
            <div className="flex items-center justify-between p-3 rounded-lg bg-zinc-50">
              <div>
                <p className="text-sm font-medium text-zinc-800">Modo Sandbox (Teste)</p>
                <p className="text-xs text-zinc-500">Use para testar sem cobranças reais</p>
              </div>
              <Switch
                checked={mpConfig.mpSandbox}
                onCheckedChange={(checked) => setMpConfig({ ...mpConfig, mpSandbox: checked })}
              />
            </div>

            {/* Access Token */}
            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                Access Token
                {mpConfig.mpAccessToken && (
                  <Badge variant="outline" className={`text-xs ${mpConfig.mpAccessToken.startsWith('TEST-') ? 'border-yellow-300 text-yellow-700' : mpConfig.mpAccessToken.startsWith('APP_USR-') ? 'border-emerald-300 text-emerald-700' : 'border-zinc-300'}`}>
                    {mpConfig.mpAccessToken.startsWith('TEST-') ? 'Sandbox' : mpConfig.mpAccessToken.startsWith('APP_USR-') ? 'Produção' : 'Custom'}
                  </Badge>
                )}
              </Label>
              <Input
                type="password"
                value={mpConfig.mpAccessToken}
                onChange={(e) => setMpConfig({ ...mpConfig, mpAccessToken: e.target.value, mpValid: false })}
                placeholder="TEST-xxxx ou APP_USR-xxxx"
                className="border-zinc-200 font-mono text-sm"
              />
              <p className="text-xs text-zinc-500">
                Obtenha em: Mercado Pago → Seu Negócio → Configurações → Credenciais
              </p>
            </div>

            {/* Public Key */}
            <div className="space-y-2">
              <Label>Public Key (opcional)</Label>
              <Input
                type="password"
                value={mpConfig.mpPublicKey}
                onChange={(e) => setMpConfig({ ...mpConfig, mpPublicKey: e.target.value })}
                placeholder="APP_USR-xxxx ou TEST-xxxx"
                className="border-zinc-200 font-mono text-sm"
              />
            </div>

            {/* User ID (read-only, set by validation) */}
            {mpConfig.mpUserId && (
              <div className="space-y-2">
                <Label>ID da Conta MP</Label>
                <Input
                  value={mpConfig.mpUserId}
                  readOnly
                  className="border-zinc-200 bg-zinc-50 text-zinc-600"
                />
              </div>
            )}

            {/* Actions */}
            <div className="flex flex-col sm:flex-row gap-3 pt-2">
              <Button
                variant="outline"
                onClick={handleMpValidate}
                disabled={mpValidating || !mpConfig.mpAccessToken}
                className="border-blue-200 text-blue-700 hover:bg-blue-50"
              >
                {mpValidating ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Validando...
                  </>
                ) : (
                  <>
                    <Shield className="w-4 h-4" />
                    Validar Token
                  </>
                )}
              </Button>
              <Button
                onClick={handleMpSave}
                disabled={mpSaving}
                className="bg-emerald-600 hover:bg-emerald-700 text-white"
              >
                {mpSaving ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Salvando...
                  </>
                ) : (
                  <>
                    <Save className="w-4 h-4" />
                    Salvar Configurações
                  </>
                )}
              </Button>
            </div>

            {/* Help Link */}
            <div className="p-3 rounded-lg bg-blue-50 text-xs text-blue-700 flex items-start gap-2">
              <ExternalLink className="w-4 h-4 mt-0.5 shrink-0" />
              <div>
                <p className="font-semibold mb-1">Como obter as credenciais:</p>
                <ol className="list-decimal list-inside space-y-0.5">
                  <li>Acesse <a href="https://www.mercadopago.com.br/settings/account/credentials" target="_blank" rel="noopener noreferrer" className="underline">mercadopago.com.br/settings/account/credentials</a></li>
                  <li>Para testes, use as credenciais de Sandbox (começam com TEST-)</li>
                  <li>Para produção, use as credenciais de Produção (começam com APP_USR-)</li>
                  <li>Copie o Access Token e cole acima</li>
                </ol>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* WhatsApp Configuration Card */}
      <Card className="border-zinc-200/60">
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-green-50 flex items-center justify-center">
              <MessageCircle className="w-5 h-5 text-green-600" />
            </div>
            <div className="flex-1">
              <CardTitle className="text-base">WhatsApp API</CardTitle>
              <CardDescription>
                Configure para enviar orçamentos e recibos via WhatsApp
              </CardDescription>
            </div>
            {waConfig.waValid ? (
              <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100">
                <CheckCircle className="w-3 h-3 mr-1" /> Conectado
              </Badge>
            ) : waConfig.waApiUrl ? (
              <Badge className="bg-yellow-100 text-yellow-700 hover:bg-yellow-100">
                <AlertTriangle className="w-3 h-3 mr-1" /> Não validado
              </Badge>
            ) : (
              <Badge className="bg-zinc-100 text-zinc-500 hover:bg-zinc-100">
                <XCircle className="w-3 h-3 mr-1" /> Desconectado
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {waMessage && (
            <div className={`p-3 rounded-lg text-sm flex items-center gap-2 ${
              waMessage.type === 'success'
                ? 'bg-emerald-50 border border-emerald-200 text-emerald-700'
                : 'bg-red-50 border border-red-200 text-red-700'
            }`}>
              {waMessage.type === 'success' ? <CheckCircle className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
              {waMessage.text}
            </div>
          )}

          {waLoading && (
            <div className="flex items-center gap-2 text-sm text-zinc-500">
              <Loader2 className="w-4 h-4 animate-spin" /> Carregando configuração...
            </div>
          )}

          {!waLoading && (
            <>
              {/* Enable/Disable Toggle */}
              <div className="flex items-center justify-between p-3 rounded-lg bg-zinc-50">
                <div>
                  <p className="text-sm font-medium text-zinc-800">Ativar WhatsApp</p>
                  <p className="text-xs text-zinc-500">Habilita envio de orçamentos e recibos via WhatsApp</p>
                </div>
                <Switch
                  checked={waConfig.waEnabled}
                  onCheckedChange={(checked) => setWaConfig({ ...waConfig, waEnabled: checked })}
                />
              </div>

              {/* API URL */}
              <div className="space-y-2">
                <Label>URL da API</Label>
                <Input
                  value={waConfig.waApiUrl}
                  onChange={(e) => setWaConfig({ ...waConfig, waApiUrl: e.target.value, waValid: false })}
                  placeholder="Ex: https://api.z-api.io"
                  className="border-zinc-200 font-mono text-sm"
                />
                <p className="text-xs text-zinc-500">
                  Apenas a URL base (domínio). NÃO cole a URL completa do endpoint aqui.
                  Ex correto: <code className="bg-zinc-100 px-1 rounded">https://api.z-api.io</code>
                </p>
              </div>

              {/* Instance */}
              <div className="space-y-2">
                <Label>Instância (ID)</Label>
                <Input
                  value={waConfig.waInstance}
                  onChange={(e) => setWaConfig({ ...waConfig, waInstance: e.target.value, waValid: false })}
                  placeholder="Ex: 3F44E27AFF71310118AC627A26780FE3"
                  className="border-zinc-200 font-mono text-sm"
                />
                <p className="text-xs text-zinc-500">
                  Z-API: ID da instância (hash alfanumérico) | Evolution API: nome da instância
                </p>
              </div>

              {/* API Token */}
              <div className="space-y-2">
                <Label className="flex items-center gap-2">
                  Token da API
                </Label>
                <Input
                  type="password"
                  value={waConfig.waApiToken}
                  onChange={(e) => setWaConfig({ ...waConfig, waApiToken: e.target.value, waValid: false })}
                  placeholder="Ex: 9ED9CEF0A6A6A81CF6718857"
                  className="border-zinc-200 font-mono text-sm"
                />
                <p className="text-xs text-zinc-500">
                  Z-API: Token da instância | Evolution API: API Key global
                </p>
              </div>

              {/* Phone Number */}
              <div className="space-y-2">
                <Label>Número do WhatsApp (Remetente)</Label>
                <Input
                  value={waConfig.waPhone}
                  onChange={(e) => setWaConfig({ ...waConfig, waPhone: e.target.value })}
                  placeholder="5577999999999"
                  className="border-zinc-200 font-mono text-sm"
                />
                <p className="text-xs text-zinc-500">
                  Número do WhatsApp conectado à API (com código do país, sem +)
                </p>
              </div>

              {/* Actions */}
              <div className="flex flex-col sm:flex-row gap-3 pt-2">
                <Button
                  onClick={handleWaSave}
                  disabled={waSaving}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white"
                >
                  {waSaving ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Salvando...
                    </>
                  ) : (
                    <>
                      <Save className="w-4 h-4" />
                      Salvar Configurações
                    </>
                  )}
                </Button>
                <Button
                  onClick={handleWaTest}
                  disabled={waTesting || (!waConfig.waApiUrl && !waConfig.waInstance)}
                  variant="outline"
                  className="gap-2 border-green-300 text-green-700 hover:bg-green-50"
                >
                  {waTesting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Testando...
                    </>
                  ) : waConfig.waValid ? (
                    <>
                      <Wifi className="w-4 h-4" />
                      Testar Conexão
                    </>
                  ) : (
                    <>
                      <WifiOff className="w-4 h-4" />
                      Testar Conexão
                    </>
                  )}
                </Button>
              </div>

              {/* Help Link */}
              <div className="p-3 rounded-lg bg-green-50 text-xs text-green-700 flex items-start gap-2">
                <MessageCircle className="w-4 h-4 mt-0.5 shrink-0" />
                <div>
                  <p className="font-semibold mb-1">Como configurar (Z-API):</p>
                  <ol className="list-decimal list-inside space-y-0.5">
                    <li>Crie uma conta em <a href="https://z-api.io" target="_blank" rel="noopener noreferrer" className="underline">z-api.io</a></li>
                    <li>Crie uma instância e escaneie o QR Code com seu WhatsApp</li>
                    <li>No painel Z-API, copie a <strong>URL base</strong> (ex: https://api.z-api.io)</li>
                    <li>Copie o <strong>ID da Instância</strong> e o <strong>Token</strong></li>
                    <li>Cole cada um no campo correspondente acima e clique em <strong>Testar Conexão</strong></li>
                  </ol>
                  <p className="mt-2 font-semibold">Atenção - Campos separados!</p>
                  <ul className="list-disc list-inside space-y-0.5">
                    <li><strong>URL da API</strong>: apenas o domínio (ex: <code className="bg-green-100 px-1 rounded">https://api.z-api.io</code>)</li>
                    <li><strong>Instância</strong>: o ID/hash (ex: <code className="bg-green-100 px-1 rounded">3F44E27AFF...</code>)</li>
                    <li><strong>Token</strong>: a chave de autenticação (ex: <code className="bg-green-100 px-1 rounded">9ED9CEF0A6...</code>)</li>
                  </ul>
                  <p className="mt-2 font-semibold">Serviços compatíveis:</p>
                  <ul className="list-disc list-inside space-y-0.5">
                    <li><strong>Z-API</strong> (z-api.io) - Mais popular no Brasil</li>
                    <li><strong>Evolution API</strong> - Open source, self-hosted</li>
                  </ul>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Users Section */}
      <Card className="border-zinc-200/60">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base">Usuários</CardTitle>
              <CardDescription>Equipe da oficina</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            <div className="flex items-center gap-3 p-3 rounded-lg bg-zinc-50">
              <div className="w-10 h-10 rounded-full bg-emerald-100 flex items-center justify-center">
                <Users className="w-5 h-5 text-emerald-600" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium text-zinc-800">{user?.name}</p>
                <p className="text-xs text-zinc-500">{user?.email}</p>
              </div>
              <Badge variant="secondary" className="bg-emerald-100 text-emerald-700 text-xs">
                {user?.role === 'OWNER' ? 'Proprietário' : user?.role === 'ADMIN' ? 'Admin' : 'Funcionário'}
              </Badge>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
