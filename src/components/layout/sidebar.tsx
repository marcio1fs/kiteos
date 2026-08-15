'use client'

import { cn } from '@/lib/utils'
import { useNavStore, useAuthStore } from '@/lib/store'
import {
  LayoutDashboard,
  ClipboardList,
  ShoppingCart,
  Package,
  DollarSign,
  FileText,
  CreditCard,
  Bell,
  Bot,
  Users,
  Settings,
  LogOut,
  Wrench,
  ChevronLeft,
  Menu,
  Truck,
  Wrench as WrenchIcon,
  Crown,
  Shield,
  ShieldCheck,
  UserCheck,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useState } from 'react'

const navItems = [
  { id: 'dashboard' as const, label: 'Dashboard', icon: LayoutDashboard },
  { id: 'pdv' as const, label: 'PDV', icon: ShoppingCart },
  { id: 'service-orders' as const, label: 'Ordens de Serviço', icon: ClipboardList },
  { id: 'inventory' as const, label: 'Estoque', icon: Package },
  { id: 'financial' as const, label: 'Financeiro', icon: DollarSign },
  { id: 'nfe' as const, label: 'Nota Fiscal', icon: FileText },
  { id: 'fiscal' as const, label: 'Dashboard Fiscal', icon: ShieldCheck },
  { id: 'clients' as const, label: 'Clientes', icon: Users },
  { id: 'suppliers' as const, label: 'Fornecedores', icon: Truck },
  { id: 'mechanics' as const, label: 'Mecânicos', icon: WrenchIcon },
  { id: 'employees' as const, label: 'Funcionários / Vendedores', icon: UserCheck },
  { id: 'subscriptions' as const, label: 'Planos', icon: CreditCard },
  { id: 'admin-subscriptions' as const, label: 'Admin Assinaturas', icon: Shield },
  { id: 'notifications' as const, label: 'Notificações', icon: Bell },
  { id: 'ai-assistant' as const, label: 'IA Assistente', icon: Bot },
  { id: 'office-profile' as const, label: 'Perfil Oficina', icon: Settings },
]

export function Sidebar() {
  const { currentPage, setPage } = useNavStore()
  const { user, office, logout } = useAuthStore()
  const [collapsed, setCollapsed] = useState(false)

  return (
    <aside
      className={cn(
        'hidden md:flex flex-col h-screen bg-zinc-900 text-white transition-all duration-300 relative shrink-0',
        collapsed ? 'w-16' : 'w-64'
      )}
    >
      {/* Header */}
      <div className="flex items-center gap-3 p-4 border-b border-zinc-800">
        <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-emerald-600 shrink-0">
          <Wrench className="w-4 h-4 text-white" />
        </div>
        {!collapsed && (
          <div className="overflow-hidden">
            <h1 className="text-lg font-bold tracking-tight text-emerald-400">KiteOS</h1>
            <p className="text-[10px] text-zinc-500 truncate">Gestão de Oficinas</p>
          </div>
        )}
      </div>

      {/* Toggle */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="absolute -right-3 top-16 z-10 w-6 h-6 rounded-full bg-zinc-700 border border-zinc-600 flex items-center justify-center hover:bg-zinc-600 transition-colors"
      >
        {collapsed ? <ChevronLeft className="w-3 h-3 rotate-180" /> : <ChevronLeft className="w-3 h-3" />}
      </button>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-2 px-2 space-y-1">
        {navItems
          .filter((item) => item.id !== 'admin-subscriptions' || user?.role === 'ADMIN' || user?.role === 'OWNER')
          .map((item) => {
            const Icon = item.icon
            const isActive = currentPage === item.id
            return (
              <button
                key={item.id}
                onClick={() => setPage(item.id)}
                className={cn(
                  'flex items-center gap-3 w-full px-3 py-2.5 rounded-lg text-sm transition-all duration-200',
                  isActive
                    ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-600/20'
                    : 'text-zinc-400 hover:text-white hover:bg-zinc-800'
                )}
              >
                <Icon className="w-4 h-4 shrink-0" />
                {!collapsed && <span className="truncate">{item.label}</span>}
              </button>
            )
          })}
      </nav>

      {/* Footer */}
      <div className="p-3 border-t border-zinc-800">
        {!collapsed && office && (
          <div className="px-3 py-2 mb-2 rounded-lg bg-zinc-800/50">
            <p className="text-xs font-medium text-zinc-300 truncate">{office.name}</p>
            <p className="text-[10px] text-zinc-500 truncate">{user?.name} · {user?.role}</p>
          </div>
        )}
        <Button
          variant="ghost"
          size="sm"
          onClick={logout}
          className="w-full text-zinc-400 hover:text-red-400 hover:bg-zinc-800 justify-start gap-2"
        >
          <LogOut className="w-4 h-4 shrink-0" />
          {!collapsed && <span>Sair</span>}
        </Button>
      </div>
    </aside>
  )
}

export function MobileNav() {
  const { currentPage, setPage } = useNavStore()
  const { logout, user, office } = useAuthStore()
  const [open, setOpen] = useState(false)

  const currentItem = navItems.find((i) => i.id === currentPage)
  const Icon = currentItem?.icon || LayoutDashboard

  return (
    <>
      <div className="flex items-center justify-between p-3 bg-zinc-900 text-white md:hidden">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-emerald-600 flex items-center justify-center">
            <Wrench className="w-3.5 h-3.5" />
          </div>
          <span className="font-bold text-emerald-400">KiteOS</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-zinc-400">{currentItem?.label}</span>
          <Button variant="ghost" size="sm" onClick={() => setOpen(true)} className="text-white p-1 h-auto">
            <Menu className="w-5 h-5" />
          </Button>
        </div>
      </div>
      {open && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div className="absolute inset-0 bg-black/60" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-0 bottom-0 w-64 bg-zinc-900 text-white flex flex-col">
            <div className="flex items-center gap-3 p-4 border-b border-zinc-800">
              <div className="w-8 h-8 rounded-lg bg-emerald-600 flex items-center justify-center">
                <Wrench className="w-4 h-4" />
              </div>
              <div>
                <h1 className="text-lg font-bold text-emerald-400">KiteOS</h1>
                <p className="text-[10px] text-zinc-500">Gestão de Oficinas</p>
              </div>
            </div>
            <nav className="flex-1 overflow-y-auto py-2 px-2 space-y-1">
              {navItems
                .filter((item) => item.id !== 'admin-subscriptions' || user?.role === 'ADMIN' || user?.role === 'OWNER')
                .map((item) => {
                  const NavIcon = item.icon
                  const isActive = currentPage === item.id
                  return (
                    <button
                      key={item.id}
                      onClick={() => {
                        setPage(item.id)
                        setOpen(false)
                      }}
                      className={cn(
                        'flex items-center gap-3 w-full px-3 py-2.5 rounded-lg text-sm transition-all',
                        isActive ? 'bg-emerald-600 text-white' : 'text-zinc-400 hover:text-white hover:bg-zinc-800'
                      )}
                    >
                      <NavIcon className="w-4 h-4" />
                      <span>{item.label}</span>
                    </button>
                  )
                })}
            </nav>
            <div className="p-3 border-t border-zinc-800">
              {office && (
                <div className="px-3 py-2 mb-2 rounded-lg bg-zinc-800/50">
                  <p className="text-xs font-medium text-zinc-300 truncate">{office.name}</p>
                  <p className="text-[10px] text-zinc-500 truncate">{user?.name}</p>
                </div>
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={logout}
                className="w-full text-zinc-400 hover:text-red-400 hover:bg-zinc-800 justify-start gap-2"
              >
                <LogOut className="w-4 h-4" />
                <span>Sair</span>
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
