'use client'

import React, { useEffect, useState, useCallback } from 'react'
import { apiFetch, useAuthStore } from '@/lib/store'
import {
  UserCheck,
  UserPlus,
  Users,
  Search,
  Loader2,
  Shield,
  DollarSign,
  TrendingUp,
  Key,
  Edit2,
  Trash2,
  CheckCircle2,
  XCircle,
  AlertCircle,
  RefreshCw,
  ShoppingBag,
  Percent,
  Receipt,
  Calendar
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { toast } from 'sonner'

export interface Employee {
  id: string
  name: string
  email: string
  role: 'OWNER' | 'ADMIN' | 'EMPLOYEE'
  commissionRate: number
  active: boolean
  createdAt: string
  updatedAt: string
  totalSalesCount: number
  totalSalesAmount: number
  commissionAmount: number
}

interface SellerSaleDetail {
  id: string
  number: string
  totalAmount: number
  discount: number
  paymentMethod: string
  createdAt: string
  client?: { name: string } | null
  commissionAmount: number
}

export function EmployeesModule() {
  const { office, user: currentUser } = useAuthStore()
  const [employees, setEmployees] = useState<Employee[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState<string>('all')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [periodFilter, setPeriodFilter] = useState<'all' | 'this_month' | 'last_month'>('this_month')

  // Modals state
  const [isAddOpen, setIsAddOpen] = useState(false)
  const [isEditOpen, setIsEditOpen] = useState(false)
  const [isResetPasswordOpen, setIsResetPasswordOpen] = useState(false)
  const [isCommissionModalOpen, setIsCommissionModalOpen] = useState(false)
  const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(null)
  const [sellerSalesDetails, setSellerSalesDetails] = useState<SellerSaleDetail[]>([])
  const [loadingSalesDetails, setLoadingSalesDetails] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  // Form states
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    password: '',
    role: 'EMPLOYEE' as 'EMPLOYEE' | 'ADMIN',
    commissionRate: 5.0
  })
  const [editData, setEditData] = useState({
    name: '',
    email: '',
    role: 'EMPLOYEE' as 'EMPLOYEE' | 'ADMIN',
    commissionRate: 0,
    active: true
  })
  const [newPassword, setNewPassword] = useState('')

  const getPeriodDates = (period: 'all' | 'this_month' | 'last_month') => {
    const now = new Date()
    if (period === 'this_month') {
      const start = new Date(now.getFullYear(), now.getMonth(), 1)
      const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59)
      return { startDate: start.toISOString(), endDate: end.toISOString() }
    } else if (period === 'last_month') {
      const start = new Date(now.getFullYear(), now.getMonth() - 1, 1)
      const end = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59)
      return { startDate: start.toISOString(), endDate: end.toISOString() }
    }
    return { startDate: '', endDate: '' }
  }

  const fetchEmployees = useCallback(async () => {
    if (!office?.id) return
    setLoading(true)
    try {
      let url = `/api/employees?officeId=${office.id}`
      if (search) url += `&search=${encodeURIComponent(search)}`
      if (roleFilter !== 'all') url += `&role=${roleFilter}`
      if (statusFilter !== 'all') url += `&active=${statusFilter === 'active'}`

      const { startDate, endDate } = getPeriodDates(periodFilter)
      if (startDate) url += `&startDate=${encodeURIComponent(startDate)}`
      if (endDate) url += `&endDate=${encodeURIComponent(endDate)}`

      const res = await apiFetch(url)
      if (res.success && Array.isArray(res.data)) {
        setEmployees(res.data)
      } else {
        toast.error(res.error || 'Erro ao carregar funcionários')
      }
    } catch {
      toast.error('Erro de conexão ao buscar funcionários')
    } finally {
      setLoading(false)
    }
  }, [office?.id, search, roleFilter, statusFilter, periodFilter])

  useEffect(() => {
    fetchEmployees()
  }, [fetchEmployees])

  const handleCreateEmployee = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!office?.id) return

    if (!formData.name.trim() || !formData.email.trim() || !formData.password) {
      toast.error('Preencha todos os campos obrigatórios')
      return
    }

    setSubmitting(true)
    try {
      const res = await apiFetch('/api/employees', {
        method: 'POST',
        body: JSON.stringify({
          officeId: office.id,
          name: formData.name.trim(),
          email: formData.email.trim(),
          password: formData.password,
          role: formData.role,
          commissionRate: Number(formData.commissionRate || 0)
        })
      })

      if (res.success) {
        toast.success('Funcionário / Vendedor cadastrado com sucesso!')
        setIsAddOpen(false)
        setFormData({ name: '', email: '', password: '', role: 'EMPLOYEE', commissionRate: 5.0 })
        fetchEmployees()
      } else {
        toast.error(res.error || 'Erro ao cadastrar funcionário')
      }
    } catch {
      toast.error('Erro ao enviar requisição')
    } finally {
      setSubmitting(false)
    }
  }

  const handleUpdateEmployee = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!office?.id || !selectedEmployee) return

    setSubmitting(true)
    try {
      const res = await apiFetch(`/api/employees/${selectedEmployee.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          officeId: office.id,
          name: editData.name.trim(),
          email: editData.email.trim(),
          role: editData.role,
          commissionRate: Number(editData.commissionRate || 0),
          active: editData.active
        })
      })

      if (res.success) {
        toast.success('Dados do funcionário atualizados!')
        setIsEditOpen(false)
        setSelectedEmployee(null)
        fetchEmployees()
      } else {
        toast.error(res.error || 'Erro ao atualizar funcionário')
      }
    } catch {
      toast.error('Erro ao atualizar dados')
    } finally {
      setSubmitting(false)
    }
  }

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!office?.id || !selectedEmployee) return

    if (!newPassword) {
      toast.error('Digite a nova senha')
      return
    }

    setSubmitting(true)
    try {
      const res = await apiFetch(`/api/employees/${selectedEmployee.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          officeId: office.id,
          password: newPassword
        })
      })

      if (res.success) {
        toast.success(`Senha de ${selectedEmployee.name} redefinida com sucesso!`)
        setIsResetPasswordOpen(false)
        setSelectedEmployee(null)
        setNewPassword('')
      } else {
        toast.error(res.error || 'Erro ao redefinir senha')
      }
    } catch {
      toast.error('Erro de comunicação com o servidor')
    } finally {
      setSubmitting(false)
    }
  }

  const handleDeleteEmployee = async (employee: Employee) => {
    if (!office?.id) return
    if (!confirm(`Tem certeza que deseja remover o funcionário "${employee.name}"?`)) return

    try {
      const res = await apiFetch(`/api/employees/${employee.id}?officeId=${office.id}`, {
        method: 'DELETE'
      })

      if (res.success) {
        toast.success('Funcionário removido com sucesso')
        fetchEmployees()
      } else {
        toast.error(res.error || 'Erro ao remover funcionário')
      }
    } catch {
      toast.error('Erro ao excluir funcionário')
    }
  }

  const openEditModal = (emp: Employee) => {
    setSelectedEmployee(emp)
    setEditData({
      name: emp.name,
      email: emp.email,
      role: emp.role === 'OWNER' ? 'ADMIN' : (emp.role as 'EMPLOYEE' | 'ADMIN'),
      commissionRate: emp.commissionRate || 0,
      active: emp.active
    })
    setIsEditOpen(true)
  }

  const openResetPasswordModal = (emp: Employee) => {
    setSelectedEmployee(emp)
    setNewPassword('')
    setIsResetPasswordOpen(true)
  }

  const openCommissionModal = async (emp: Employee) => {
    if (!office?.id) return
    setSelectedEmployee(emp)
    setIsCommissionModalOpen(true)
    setLoadingSalesDetails(true)
    try {
      const res = await apiFetch(`/api/employees/${emp.id}?officeId=${office.id}`)
      if (res.success && res.data?.sales) {
        setSellerSalesDetails(res.data.sales)
      } else {
        setSellerSalesDetails([])
      }
    } catch {
      toast.error('Erro ao buscar extrato de comissões')
    } finally {
      setLoadingSalesDetails(false)
    }
  }

  // Calculate statistics
  const totalEmployees = employees.length
  const activeEmployees = employees.filter((e) => e.active).length
  const totalSalesVolume = employees.reduce((acc, curr) => acc + (curr.totalSalesAmount || 0), 0)
  const totalCommissionsVolume = employees.reduce((acc, curr) => acc + (curr.commissionAmount || 0), 0)

  const formatCurrency = (val: number) => {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val)
  }

  const getRoleBadge = (role: string) => {
    switch (role) {
      case 'OWNER':
        return <Badge className="bg-amber-600 text-white font-medium">Proprietário</Badge>
      case 'ADMIN':
        return <Badge className="bg-indigo-600 text-white font-medium">Administrador</Badge>
      default:
        return <Badge className="bg-emerald-600 text-white font-medium">Vendedor / Funcionário</Badge>
    }
  }

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900 tracking-tight flex items-center gap-2">
            <UserCheck className="w-7 h-7 text-emerald-600" />
            Funcionários & Vendedores
          </h1>
          <p className="text-sm text-zinc-500 mt-1">
            Cadastre a equipe da oficina, configure porcentagem de comissão e controle o extrato de comissões a pagar.
          </p>
        </div>
        <Button
          onClick={() => setIsAddOpen(true)}
          className="bg-emerald-600 hover:bg-emerald-700 text-white shadow-md flex items-center gap-2"
        >
          <UserPlus className="w-4 h-4" />
          Novo Funcionário / Vendedor
        </Button>
      </div>

      {/* Metrics Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="bg-white border-zinc-200 shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">
              Total de Colaboradores
            </CardTitle>
            <Users className="w-4 h-4 text-zinc-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-zinc-900">{totalEmployees}</div>
            <p className="text-xs text-zinc-500 mt-1">Cadastrados na oficina</p>
          </CardContent>
        </Card>

        <Card className="bg-white border-zinc-200 shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">
              Vendedores Ativos
            </CardTitle>
            <CheckCircle2 className="w-4 h-4 text-emerald-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-emerald-600">{activeEmployees}</div>
            <p className="text-xs text-zinc-500 mt-1">Com acesso ativo ao sistema</p>
          </CardContent>
        </Card>

        <Card className="bg-white border-zinc-200 shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">
              Total em Vendas
            </CardTitle>
            <TrendingUp className="w-4 h-4 text-indigo-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-indigo-600">{formatCurrency(totalSalesVolume)}</div>
            <p className="text-xs text-zinc-500 mt-1">Volume de vendas no período</p>
          </CardContent>
        </Card>

        <Card className="bg-white border-zinc-200 shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">
              Comissão Total da Equipe
            </CardTitle>
            <DollarSign className="w-4 h-4 text-amber-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-amber-600">{formatCurrency(totalCommissionsVolume)}</div>
            <p className="text-xs text-zinc-500 mt-1">Comissões a pagar no período</p>
          </CardContent>
        </Card>
      </div>

      {/* Filter and Search Bar */}
      <Card className="bg-white border-zinc-200 shadow-sm">
        <CardContent className="p-4 flex flex-col md:flex-row items-center gap-3">
          <div className="relative flex-1 w-full">
            <Search className="w-4 h-4 absolute left-3 top-3 text-zinc-400" />
            <Input
              placeholder="Buscar funcionário por nome ou e-mail..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 bg-zinc-50 border-zinc-200"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
            {/* Period Filter */}
            <div className="flex items-center bg-zinc-100 p-1 rounded-lg border border-zinc-200 text-xs">
              <Button
                variant={periodFilter === 'this_month' ? 'secondary' : 'ghost'}
                size="sm"
                onClick={() => setPeriodFilter('this_month')}
                className="h-7 text-xs px-2.5"
              >
                Este Mês
              </Button>
              <Button
                variant={periodFilter === 'last_month' ? 'secondary' : 'ghost'}
                size="sm"
                onClick={() => setPeriodFilter('last_month')}
                className="h-7 text-xs px-2.5"
              >
                Mês Passado
              </Button>
              <Button
                variant={periodFilter === 'all' ? 'secondary' : 'ghost'}
                size="sm"
                onClick={() => setPeriodFilter('all')}
                className="h-7 text-xs px-2.5"
              >
                Geral
              </Button>
            </div>

            <Select value={roleFilter} onValueChange={setRoleFilter}>
              <SelectTrigger className="w-36 bg-zinc-50 border-zinc-200 text-xs">
                <SelectValue placeholder="Função" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas Funções</SelectItem>
                <SelectItem value="EMPLOYEE">Vendedor / Func.</SelectItem>
                <SelectItem value="ADMIN">Administrador</SelectItem>
                <SelectItem value="OWNER">Proprietário</SelectItem>
              </SelectContent>
            </Select>

            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-32 bg-zinc-50 border-zinc-200 text-xs">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos Status</SelectItem>
                <SelectItem value="active">Ativos</SelectItem>
                <SelectItem value="inactive">Inativos</SelectItem>
              </SelectContent>
            </Select>

            <Button
              variant="outline"
              size="icon"
              onClick={fetchEmployees}
              className="shrink-0"
              title="Atualizar lista"
            >
              <RefreshCw className="w-4 h-4 text-zinc-600" />
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Employees Table */}
      <Card className="bg-white border-zinc-200 shadow-sm overflow-hidden">
        <CardContent className="p-0">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-16 text-zinc-500">
              <Loader2 className="w-8 h-8 animate-spin text-emerald-600 mb-2" />
              <p className="text-sm">Carregando lista de funcionários e comissões...</p>
            </div>
          ) : employees.length === 0 ? (
            <div className="text-center py-16 px-4">
              <Users className="w-12 h-12 text-zinc-300 mx-auto mb-3" />
              <h3 className="text-base font-semibold text-zinc-800">Nenhum funcionário encontrado</h3>
              <p className="text-sm text-zinc-500 max-w-md mx-auto mt-1">
                {search || roleFilter !== 'all' || statusFilter !== 'all'
                  ? 'Nenhum colaborador corresponde aos filtros aplicados.'
                  : 'Cadastre os vendedores e colaboradores da sua oficina para que cada um tenha um usuário no sistema.'}
              </p>
              {!search && roleFilter === 'all' && (
                <Button
                  onClick={() => setIsAddOpen(true)}
                  className="mt-4 bg-emerald-600 hover:bg-emerald-700 text-white"
                >
                  <UserPlus className="w-4 h-4 mr-2" />
                  Cadastrar Primeiro Vendedor
                </Button>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm text-zinc-600">
                <thead className="bg-zinc-50 border-b border-zinc-200 text-xs font-semibold text-zinc-500 uppercase tracking-wider">
                  <tr>
                    <th className="py-3.5 px-4">Funcionário / Vendedor</th>
                    <th className="py-3.5 px-4">Função</th>
                    <th className="py-3.5 px-4 text-center">Taxa Comissão (%)</th>
                    <th className="py-3.5 px-4 text-center">Vendas Realizadas</th>
                    <th className="py-3.5 px-4 text-right">Total em Vendas</th>
                    <th className="py-3.5 px-4 text-right">Comissão Calculada</th>
                    <th className="py-3.5 px-4 text-center">Status</th>
                    <th className="py-3.5 px-4 text-right">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-200">
                  {employees.map((emp) => (
                    <tr key={emp.id} className="hover:bg-zinc-50/80 transition-colors">
                      <td className="py-4 px-4">
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center font-bold text-sm shrink-0">
                            {emp.name.charAt(0).toUpperCase()}
                          </div>
                          <div>
                            <div className="font-semibold text-zinc-900 flex items-center gap-1.5">
                              {emp.name}
                              {emp.id === currentUser?.id && (
                                <span className="text-[10px] bg-zinc-200 text-zinc-700 px-1.5 py-0.5 rounded font-normal">
                                  Você
                                </span>
                              )}
                            </div>
                            <div className="text-xs text-zinc-500">{emp.email}</div>
                          </div>
                        </div>
                      </td>

                      <td className="py-4 px-4">{getRoleBadge(emp.role)}</td>

                      <td className="py-4 px-4 text-center">
                        <Badge variant="outline" className="bg-amber-50 text-amber-800 border-amber-300 font-semibold gap-1">
                          <Percent className="w-3 h-3 text-amber-600" />
                          {emp.commissionRate || 0}%
                        </Badge>
                      </td>

                      <td className="py-4 px-4 text-center font-medium text-zinc-800">
                        <div className="inline-flex items-center gap-1 bg-zinc-100 px-2.5 py-1 rounded-full text-xs">
                          <ShoppingBag className="w-3.5 h-3.5 text-zinc-500" />
                          <span>{emp.totalSalesCount} vendas</span>
                        </div>
                      </td>

                      <td className="py-4 px-4 text-right font-semibold text-zinc-900">
                        {formatCurrency(emp.totalSalesAmount)}
                      </td>

                      <td className="py-4 px-4 text-right font-bold text-emerald-700">
                        {formatCurrency(emp.commissionAmount || 0)}
                      </td>

                      <td className="py-4 px-4 text-center">
                        {emp.active ? (
                          <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 rounded-full">
                            <CheckCircle2 className="w-3 h-3" />
                            Ativo
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-xs font-medium text-red-700 bg-red-50 border border-red-200 px-2.5 py-0.5 rounded-full">
                            <XCircle className="w-3 h-3" />
                            Inativo
                          </span>
                        )}
                      </td>

                      <td className="py-4 px-4 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => openCommissionModal(emp)}
                            title="Extrato de Comissões"
                            className="h-8 w-8 text-zinc-600 hover:text-emerald-600 hover:bg-emerald-50"
                          >
                            <Receipt className="w-4 h-4" />
                          </Button>

                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => openResetPasswordModal(emp)}
                            title="Redefinir Senha"
                            className="h-8 w-8 text-zinc-600 hover:text-amber-600"
                          >
                            <Key className="w-4 h-4" />
                          </Button>

                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => openEditModal(emp)}
                            title="Editar Funcionário"
                            className="h-8 w-8 text-zinc-600 hover:text-emerald-600"
                          >
                            <Edit2 className="w-4 h-4" />
                          </Button>

                          {emp.role !== 'OWNER' && emp.id !== currentUser?.id && (
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => handleDeleteEmployee(emp)}
                              title="Remover Funcionário"
                              className="h-8 w-8 text-zinc-600 hover:text-red-600"
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* MODAL: Novo Funcionário / Vendedor */}
      <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
        <DialogContent className="sm:max-w-md bg-white">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-zinc-900">
              <UserPlus className="w-5 h-5 text-emerald-600" />
              Novo Funcionário / Vendedor
            </DialogTitle>
            <DialogDescription>
              Cadastre o vendedor ou colaborador com a taxa de comissão sobre as vendas.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleCreateEmployee} className="space-y-4 py-2">
            <div className="space-y-1">
              <Label htmlFor="name">Nome Completo *</Label>
              <Input
                id="name"
                placeholder="Ex: João da Silva"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                required
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="email">E-mail de Acesso *</Label>
              <Input
                id="email"
                type="email"
                placeholder="vendedor@suaoficina.com.br"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                required
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="password">Senha Inicial *</Label>
              <Input
                id="password"
                type="password"
                placeholder="No mínimo 6 caracteres (com letras e números)"
                value={formData.password}
                onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                required
              />
              <p className="text-[11px] text-zinc-500">
                A senha deve conter ao menos 6 caracteres (contendo letras e números, ex: master369).
              </p>
            </div>

            <div className="space-y-1">
              <Label htmlFor="commissionRate">Porcentagem de Comissão (%) sobre Vendas</Label>
              <div className="relative">
                <Input
                  id="commissionRate"
                  type="number"
                  step="0.1"
                  min="0"
                  max="100"
                  placeholder="Ex: 5.0"
                  value={formData.commissionRate}
                  onChange={(e) => setFormData({ ...formData, commissionRate: parseFloat(e.target.value) || 0 })}
                  className="pr-8"
                />
                <Percent className="w-4 h-4 absolute right-2.5 top-2.5 text-zinc-400" />
              </div>
              <p className="text-[11px] text-zinc-500">Porcentagem aplicada sobre o valor bruto das vendas do vendedor.</p>
            </div>

            <div className="space-y-1">
              <Label htmlFor="role">Função / Nível de Acesso *</Label>
              <Select
                value={formData.role}
                onValueChange={(val: 'EMPLOYEE' | 'ADMIN') => setFormData({ ...formData, role: val })}
              >
                <SelectTrigger id="role" className="bg-white">
                  <SelectValue placeholder="Selecione a função" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="EMPLOYEE">Vendedor / Funcionário (Acesso a vendas e OS)</SelectItem>
                  <SelectItem value="ADMIN">Administrador (Acesso completo à gestão)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <DialogFooter className="mt-6 pt-2 border-t border-zinc-100">
              <Button type="button" variant="outline" onClick={() => setIsAddOpen(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={submitting} className="bg-emerald-600 hover:bg-emerald-700 text-white">
                {submitting ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                Cadastrar Vendedor
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* MODAL: Editar Funcionário */}
      <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
        <DialogContent className="sm:max-w-md bg-white">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-zinc-900">
              <Edit2 className="w-5 h-5 text-emerald-600" />
              Editar Funcionário & Comissão
            </DialogTitle>
            <DialogDescription>
              Atualize as informações e a taxa de comissão de {selectedEmployee?.name}.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleUpdateEmployee} className="space-y-4 py-2">
            <div className="space-y-1">
              <Label htmlFor="edit-name">Nome Completo</Label>
              <Input
                id="edit-name"
                value={editData.name}
                onChange={(e) => setEditData({ ...editData, name: e.target.value })}
                required
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="edit-email">E-mail</Label>
              <Input
                id="edit-email"
                type="email"
                value={editData.email}
                onChange={(e) => setEditData({ ...editData, email: e.target.value })}
                required
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="edit-commissionRate">Porcentagem de Comissão (%) sobre Vendas</Label>
              <div className="relative">
                <Input
                  id="edit-commissionRate"
                  type="number"
                  step="0.1"
                  min="0"
                  max="100"
                  value={editData.commissionRate}
                  onChange={(e) => setEditData({ ...editData, commissionRate: parseFloat(e.target.value) || 0 })}
                  className="pr-8"
                />
                <Percent className="w-4 h-4 absolute right-2.5 top-2.5 text-zinc-400" />
              </div>
            </div>

            {selectedEmployee?.role !== 'OWNER' && (
              <div className="space-y-1">
                <Label htmlFor="edit-role">Função / Cargo</Label>
                <Select
                  value={editData.role}
                  onValueChange={(val: 'EMPLOYEE' | 'ADMIN') => setEditData({ ...editData, role: val })}
                >
                  <SelectTrigger id="edit-role" className="bg-white">
                    <SelectValue placeholder="Selecione a função" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="EMPLOYEE">Vendedor / Funcionário</SelectItem>
                    <SelectItem value="ADMIN">Administrador</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}

            {selectedEmployee?.id !== currentUser?.id && selectedEmployee?.role !== 'OWNER' && (
              <div className="space-y-1 pt-2">
                <Label htmlFor="edit-active">Status do Acesso</Label>
                <Select
                  value={editData.active ? 'true' : 'false'}
                  onValueChange={(val) => setEditData({ ...editData, active: val === 'true' })}
                >
                  <SelectTrigger id="edit-active" className="bg-white">
                    <SelectValue placeholder="Status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="true">Ativo (Pode acessar o sistema)</SelectItem>
                    <SelectItem value="false">Inativo (Acesso bloqueado)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}

            <DialogFooter className="mt-6 pt-2 border-t border-zinc-100">
              <Button type="button" variant="outline" onClick={() => setIsEditOpen(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={submitting} className="bg-emerald-600 hover:bg-emerald-700 text-white">
                {submitting ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                Salvar Alterações
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* MODAL: Redefinir Senha */}
      <Dialog open={isResetPasswordOpen} onOpenChange={setIsResetPasswordOpen}>
        <DialogContent className="sm:max-w-md bg-white">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-zinc-900">
              <Key className="w-5 h-5 text-amber-600" />
              Redefinir Senha de {selectedEmployee?.name}
            </DialogTitle>
            <DialogDescription>
              Defina uma nova senha de acesso para o colaborador.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleResetPassword} className="space-y-4 py-2">
            <div className="space-y-1">
              <Label htmlFor="new-password">Nova Senha *</Label>
              <Input
                id="new-password"
                type="password"
                placeholder="Digite a nova senha..."
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
              />
              <p className="text-[11px] text-zinc-500">
                A senha deve conter ao menos 6 caracteres (contendo letras e números).
              </p>
            </div>

            <DialogFooter className="mt-6 pt-2 border-t border-zinc-100">
              <Button type="button" variant="outline" onClick={() => setIsResetPasswordOpen(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={submitting} className="bg-amber-600 hover:bg-amber-700 text-white">
                {submitting ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                Alterar Senha
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* MODAL: Extrato Detalhado de Comissões do Vendedor */}
      <Dialog open={isCommissionModalOpen} onOpenChange={setIsCommissionModalOpen}>
        <DialogContent className="sm:max-w-2xl bg-white">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-zinc-900">
              <Receipt className="w-5 h-5 text-emerald-600" />
              Extrato de Comissões — {selectedEmployee?.name}
            </DialogTitle>
            <DialogDescription>
              Vendas realizadas e comissão individual calculada (Taxa: {selectedEmployee?.commissionRate || 0}%).
            </DialogDescription>
          </DialogHeader>

          <div className="py-2 space-y-4">
            <div className="grid grid-cols-2 gap-3 p-3 bg-zinc-50 rounded-lg border border-zinc-200 text-sm">
              <div>
                <div className="text-xs text-zinc-500">Total de Vendas Acumuladas</div>
                <div className="text-lg font-bold text-zinc-900">{formatCurrency(selectedEmployee?.totalSalesAmount || 0)}</div>
              </div>
              <div className="text-right">
                <div className="text-xs text-zinc-500">Total em Comissões a Pagar</div>
                <div className="text-lg font-bold text-emerald-600">{formatCurrency(selectedEmployee?.commissionAmount || 0)}</div>
              </div>
            </div>

            {loadingSalesDetails ? (
              <div className="flex flex-col items-center justify-center py-10 text-zinc-500">
                <Loader2 className="w-6 h-6 animate-spin text-emerald-600 mb-2" />
                <p className="text-xs">Buscando histórico de vendas e comissões...</p>
              </div>
            ) : sellerSalesDetails.length === 0 ? (
              <div className="text-center py-8 text-zinc-500 text-sm">
                Nenhuma venda finalizada registrada para este vendedor no período.
              </div>
            ) : (
              <div className="max-h-80 overflow-y-auto border border-zinc-200 rounded-md">
                <table className="w-full text-left text-xs text-zinc-600">
                  <thead className="bg-zinc-100 border-b border-zinc-200 font-semibold text-zinc-600 uppercase">
                    <tr>
                      <th className="py-2.5 px-3">Venda</th>
                      <th className="py-2.5 px-3">Data</th>
                      <th className="py-2.5 px-3">Cliente</th>
                      <th className="py-2.5 px-3 text-right">Valor Venda</th>
                      <th className="py-2.5 px-3 text-right">Comissão</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-200">
                    {sellerSalesDetails.map((s) => (
                      <tr key={s.id} className="hover:bg-zinc-50">
                        <td className="py-2.5 px-3 font-semibold text-zinc-900">#{s.number}</td>
                        <td className="py-2.5 px-3 text-zinc-500">{new Date(s.createdAt).toLocaleDateString('pt-BR')}</td>
                        <td className="py-2.5 px-3 font-medium text-zinc-800">{s.client?.name || 'Cliente Avulso'}</td>
                        <td className="py-2.5 px-3 text-right font-medium text-zinc-900">{formatCurrency(s.totalAmount)}</td>
                        <td className="py-2.5 px-3 text-right font-bold text-emerald-700">{formatCurrency(s.commissionAmount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <DialogFooter className="mt-4 pt-2 border-t border-zinc-100">
            <Button variant="outline" onClick={() => setIsCommissionModalOpen(false)}>
              Fechar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

