'use client'

import { useState } from 'react'
import { useAuthStore } from '@/lib/store'
import { maskCNPJ, validateCNPJ } from '@/lib/validators'
import { Wrench, Eye, EyeOff, Loader2 } from 'lucide-react'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Separator } from '@/components/ui/separator'

export function LoginModule() {
  const { login, register } = useAuthStore()

  // Login state
  const [loginEmail, setLoginEmail] = useState('')
  const [loginPassword, setLoginPassword] = useState('')
  const [loginLoading, setLoginLoading] = useState(false)
  const [loginError, setLoginError] = useState('')

  // Register state
  const [regName, setRegName] = useState('')
  const [regEmail, setRegEmail] = useState('')
  const [regPassword, setRegPassword] = useState('')
  const [regOfficeName, setRegOfficeName] = useState('')
  const [regCnpj, setRegCnpj] = useState('')
  const [regOfficeEmail, setRegOfficeEmail] = useState('')
  const [regLoading, setRegLoading] = useState(false)
  const [regError, setRegError] = useState('')

  // Show/hide password
  const [showPassword, setShowPassword] = useState(false)

  // Active tab
  const [activeTab, setActiveTab] = useState('login')

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoginError('')
    if (!loginEmail || !loginPassword) {
      setLoginError('Preencha todos os campos')
      return
    }
    setLoginLoading(true)
    try {
      const success = await login(loginEmail, loginPassword)
      if (!success) {
        setLoginError('Email ou senha incorretos')
      }
    } catch {
      setLoginError('Erro ao fazer login. Tente novamente.')
    } finally {
      setLoginLoading(false)
    }
  }

  const handleCnpjChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setRegCnpj(maskCNPJ(e.target.value))
  }

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault()
    setRegError('')
    if (!regName || !regEmail || !regPassword || !regOfficeName || !regCnpj || !regOfficeEmail) {
      setRegError('Preencha todos os campos obrigatórios')
      return
    }
    if (regPassword.length < 8) {
      setRegError('A senha deve ter pelo menos 8 caracteres')
      return
    }
    if (!/[A-Z]/.test(regPassword) || !/[a-z]/.test(regPassword) || !/[0-9]/.test(regPassword) || !/[!@#$%^&*()_+\-=[\]{}|;:\'",.<>?/`~]/.test(regPassword)) {
      setRegError('A senha deve conter ao menos uma maiúscula, minúscula, número e caractere especial (ex: Senha@123)')
      return
    }
    // Validate CNPJ
    const cnpjError = validateCNPJ(regCnpj)
    if (cnpjError) {
      setRegError(cnpjError)
      return
    }
    setRegLoading(true)
    try {
      const res = await register({
        name: regName,
        email: regEmail,
        password: regPassword,
        officeName: regOfficeName,
        cnpj: regCnpj,
        officeEmail: regOfficeEmail,
      })
      if (!res.success) {
        setRegError(res.error || 'Erro ao criar conta. Verifique os dados e tente novamente.')
      }
    } catch {
      setRegError('Erro ao criar conta. Tente novamente.')
    } finally {
      setRegLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-zinc-50 via-white to-emerald-50/30 p-4">
      {/* Background decorative elements */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-80 h-80 bg-emerald-100/40 rounded-full blur-3xl" />
        <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-emerald-100/30 rounded-full blur-3xl" />
      </div>

      <div className="w-full max-w-md relative z-10">
        {/* Branding */}
        <div className="flex flex-col items-center mb-8">
          <div className="flex items-center justify-center w-14 h-14 rounded-2xl bg-emerald-600 shadow-lg shadow-emerald-600/25 mb-4">
            <Wrench className="w-7 h-7 text-white" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900">
            KiteOS
          </h1>
          <p className="text-sm text-zinc-500 mt-1">
            Sistema de Gestão para Oficinas
          </p>
        </div>

        {/* Card */}
        <Card className="border-zinc-200/80 shadow-xl shadow-zinc-200/50">
          <CardHeader className="pb-0 pt-6 px-6">
            <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
              <TabsList className="w-full bg-zinc-100 h-10">
                <TabsTrigger
                  value="login"
                  className="flex-1 data-[state=active]:bg-white data-[state=active]:shadow-sm data-[state=active]:text-emerald-700 font-medium"
                >
                  Entrar
                </TabsTrigger>
                <TabsTrigger
                  value="register"
                  className="flex-1 data-[state=active]:bg-white data-[state=active]:shadow-sm data-[state=active]:text-emerald-700 font-medium"
                >
                  Registrar
                </TabsTrigger>
              </TabsList>

              {/* Login Tab */}
              <TabsContent value="login" className="mt-6">
                <form onSubmit={handleLogin} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="login-email" className="text-zinc-700">
                      Email
                    </Label>
                    <Input
                      id="login-email"
                      type="email"
                      placeholder="seu@email.com"
                      value={loginEmail}
                      onChange={(e) => setLoginEmail(e.target.value)}
                      className="h-10 border-zinc-200 focus-visible:border-emerald-500 focus-visible:ring-emerald-500/20"
                      disabled={loginLoading}
                      autoComplete="email"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="login-password" className="text-zinc-700">
                      Senha
                    </Label>
                    <div className="relative">
                      <Input
                        id="login-password"
                        type={showPassword ? 'text' : 'password'}
                        placeholder="••••••••"
                        value={loginPassword}
                        onChange={(e) => setLoginPassword(e.target.value)}
                        className="h-10 pr-10 border-zinc-200 focus-visible:border-emerald-500 focus-visible:ring-emerald-500/20"
                        disabled={loginLoading}
                        autoComplete="current-password"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600 transition-colors"
                        tabIndex={-1}
                      >
                        {showPassword ? (
                          <EyeOff className="w-4 h-4" />
                        ) : (
                          <Eye className="w-4 h-4" />
                        )}
                      </button>
                    </div>
                  </div>

                  {loginError && (
                    <div className="flex items-center gap-2 p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">
                      <div className="w-1.5 h-1.5 rounded-full bg-red-500 shrink-0" />
                      {loginError}
                    </div>
                  )}

                  <Button
                    type="submit"
                    className="w-full h-10 bg-emerald-600 hover:bg-emerald-700 text-white font-medium shadow-sm"
                    disabled={loginLoading}
                  >
                    {loginLoading ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Entrando...
                      </>
                    ) : (
                      'Entrar'
                    )}
                  </Button>
                </form>
              </TabsContent>

              {/* Register Tab */}
              <TabsContent value="register" className="mt-6">
                <form onSubmit={handleRegister} className="space-y-4">
                  {/* User Info */}
                  <div className="space-y-1.5">
                    <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">
                      Dados do Usuário
                    </p>
                    <Separator className="bg-zinc-100" />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="reg-name" className="text-zinc-700">
                      Nome completo
                    </Label>
                    <Input
                      id="reg-name"
                      type="text"
                      placeholder="João da Silva"
                      value={regName}
                      onChange={(e) => setRegName(e.target.value)}
                      className="h-10 border-zinc-200 focus-visible:border-emerald-500 focus-visible:ring-emerald-500/20"
                      disabled={regLoading}
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-2">
                      <Label htmlFor="reg-email" className="text-zinc-700">
                        Email
                      </Label>
                      <Input
                        id="reg-email"
                        type="email"
                        placeholder="seu@email.com"
                        value={regEmail}
                        onChange={(e) => setRegEmail(e.target.value)}
                        className="h-10 border-zinc-200 focus-visible:border-emerald-500 focus-visible:ring-emerald-500/20"
                        disabled={regLoading}
                        autoComplete="email"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="reg-password" className="text-zinc-700">
                        Senha
                      </Label>
                      <Input
                        id="reg-password"
                        type="password"
                        placeholder="Mín. 8 chars (ex: Senha@123)"
                        value={regPassword}
                        onChange={(e) => setRegPassword(e.target.value)}
                        className="h-10 border-zinc-200 focus-visible:border-emerald-500 focus-visible:ring-emerald-500/20"
                        disabled={regLoading}
                        autoComplete="new-password"
                      />
                      <p className="text-[11px] text-zinc-400">
                        Requer maiúscula, minúscula, número e símbolo (ex: !@#$).
                      </p>
                    </div>
                  </div>

                  {/* Office Info */}
                  <div className="space-y-1.5 pt-2">
                    <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">
                      Dados da Oficina
                    </p>
                    <Separator className="bg-zinc-100" />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="reg-office-name" className="text-zinc-700">
                      Nome da oficina
                    </Label>
                    <Input
                      id="reg-office-name"
                      type="text"
                      placeholder="Auto Mecânica Exemplo"
                      value={regOfficeName}
                      onChange={(e) => setRegOfficeName(e.target.value)}
                      className="h-10 border-zinc-200 focus-visible:border-emerald-500 focus-visible:ring-emerald-500/20"
                      disabled={regLoading}
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-2">
                      <Label htmlFor="reg-cnpj" className="text-zinc-700">
                        CNPJ
                      </Label>
                      <Input
                        id="reg-cnpj"
                        type="text"
                        placeholder="00.000.000/0000-00"
                        value={regCnpj}
                        onChange={handleCnpjChange}
                        className="h-10 border-zinc-200 focus-visible:border-emerald-500 focus-visible:ring-emerald-500/20"
                        disabled={regLoading}
                        maxLength={18}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="reg-office-email" className="text-zinc-700">
                        Email da oficina
                      </Label>
                      <Input
                        id="reg-office-email"
                        type="email"
                        placeholder="contato@oficina.com"
                        value={regOfficeEmail}
                        onChange={(e) => setRegOfficeEmail(e.target.value)}
                        className="h-10 border-zinc-200 focus-visible:border-emerald-500 focus-visible:ring-emerald-500/20"
                        disabled={regLoading}
                      />
                    </div>
                  </div>

                  {regError && (
                    <div className="flex items-center gap-2 p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">
                      <div className="w-1.5 h-1.5 rounded-full bg-red-500 shrink-0" />
                      {regError}
                    </div>
                  )}

                  <Button
                    type="submit"
                    className="w-full h-10 bg-emerald-600 hover:bg-emerald-700 text-white font-medium shadow-sm"
                    disabled={regLoading}
                  >
                    {regLoading ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Criando conta...
                      </>
                    ) : (
                      'Criar Conta'
                    )}
                  </Button>
                </form>
              </TabsContent>
            </Tabs>
          </CardHeader>
          <CardContent className="pt-4 pb-6 px-6">
            <p className="text-center text-xs text-zinc-400">
              Ao continuar, você concorda com os{' '}
              <span className="text-emerald-600 cursor-pointer hover:underline">
                Termos de Uso
              </span>{' '}
              e{' '}
              <span className="text-emerald-600 cursor-pointer hover:underline">
                Política de Privacidade
              </span>
            </p>
          </CardContent>
        </Card>

        {/* Footer */}
        <p className="text-center text-xs text-zinc-400 mt-6">
          KiteOS &copy; {new Date().getFullYear()} — Todos os direitos reservados
        </p>
      </div>
    </div>
  )
}
