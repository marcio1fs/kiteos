'use client'

import React, { useEffect, useState } from 'react'
import { useNavStore, useAuthStore } from '@/lib/store'
import { Sidebar, MobileNav } from '@/components/layout/sidebar'
import { LoginModule } from '@/components/modules/login'
import { DashboardModule } from '@/components/modules/dashboard'
import InventoryModule from '@/components/modules/inventory'
import FinancialModule from '@/components/modules/financial'
import { ServiceOrdersModule } from '@/components/modules/service-orders'
import { ClientsModule } from '@/components/modules/clients'
import { SuppliersModule } from '@/components/modules/suppliers'
import { MechanicsModule } from '@/components/modules/mechanics'
import { EmployeesModule } from '@/components/modules/employees'
import { NFeModule } from '@/components/modules/nfe'
import { SubscriptionsModule } from '@/components/modules/subscriptions'
import { NotificationsModule } from '@/components/modules/notifications'
import { AIAssistantModule } from '@/components/modules/ai-assistant'
import { OfficeProfileModule } from '@/components/modules/office-profile'
import { PDVModule } from '@/components/modules/pdv'
import { AdminSubscriptionsModule } from '@/components/modules/admin-subscriptions'
import { FiscalModule } from '@/components/modules/fiscal'
import { Loader2 } from 'lucide-react'

export default function Home() {
  const { currentPage } = useNavStore()
  const { isAuthenticated, checkAuth, user } = useAuthStore()
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const init = async () => {
      await checkAuth()
      setLoading(false)
    }
    init()
  }, [checkAuth])

  // Loading state while checking auth
  if (loading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-zinc-50">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl bg-emerald-600 flex items-center justify-center">
            <span className="text-white font-bold text-lg">K</span>
          </div>
          <span className="text-xl font-bold text-zinc-900">KiteOS</span>
        </div>
        <Loader2 className="w-6 h-6 animate-spin text-emerald-600" />
      </div>
    )
  }

  // Not authenticated - show login
  if (!isAuthenticated) {
    return <LoginModule />
  }

  // Render current page module
  const renderPage = () => {
    switch (currentPage) {
      case 'dashboard':
        return <DashboardModule />
      case 'pdv':
        return <PDVModule />
      case 'service-orders':
        return <ServiceOrdersModule />
      case 'inventory':
        return <InventoryModule />
      case 'financial':
        return <FinancialModule />
      case 'nfe':
        return <NFeModule />
      case 'fiscal':
        return <FiscalModule />
      case 'clients':
        return <ClientsModule />
      case 'suppliers':
        return <SuppliersModule />
      case 'mechanics':
        return <MechanicsModule />
      case 'employees':
        return <EmployeesModule />
      case 'subscriptions':
        return <SubscriptionsModule />
      case 'admin-subscriptions':
        return (user?.role === 'ADMIN' || user?.role === 'OWNER') ? <AdminSubscriptionsModule /> : <DashboardModule />
      case 'notifications':
        return <NotificationsModule />
      case 'ai-assistant':
        return <AIAssistantModule />
      case 'office-profile':
        return <OfficeProfileModule />
      default:
        return <DashboardModule />
    }
  }

  return (
    <div className="flex min-h-screen bg-zinc-50">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <MobileNav />
        <main className="flex-1 overflow-auto">
          {renderPage()}
        </main>
      </div>
    </div>
  )
}
