import { create } from 'zustand'

// =============================================
// AUTH STORE
// =============================================
interface User {
  id: string
  email: string
  name: string
  role: string
  officeId: string
}

interface Office {
  id: string
  name: string
  cnpj: string
  email: string
  phone: string | null
  address: string | null
  city: string | null
  state: string | null
  zipCode: string | null
  logo: string | null
}

interface AuthState {
  user: User | null
  office: Office | null
  token: string | null
  isAuthenticated: boolean
  login: (email: string, password: string) => Promise<boolean>
  register: (data: RegisterData) => Promise<{ success: boolean; error?: string }>
  logout: () => void
  checkAuth: () => Promise<void>
}

interface RegisterData {
  name: string
  email: string
  password: string
  officeName: string
  cnpj: string
  officeEmail: string
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  office: null,
  token: null,
  isAuthenticated: false,

  login: async (email: string, password: string) => {
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })
      const data = await res.json()
      if (data.success) {
        const { token, refreshToken, user, office } = data.data
        if (token) localStorage.setItem('kiteos_token', token)
        if (refreshToken) localStorage.setItem('kiteos_refresh', refreshToken)
        localStorage.setItem('kiteos_user', JSON.stringify(user))
        localStorage.setItem('kiteos_office', JSON.stringify(office))
        set({ user, office, token, isAuthenticated: true })
        return true
      }
      return false
    } catch {
      return false
    }
  },

  register: async (data: RegisterData) => {
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userName: data.name,
          userEmail: data.email,
          userPassword: data.password,
          officeName: data.officeName,
          officeCnpj: data.cnpj,
          officeEmail: data.officeEmail,
        }),
      })
      const result = await res.json()
      if (result.success) {
        const { token, refreshToken, user, office } = result.data
        if (token) localStorage.setItem('kiteos_token', token)
        if (refreshToken) localStorage.setItem('kiteos_refresh', refreshToken)
        localStorage.setItem('kiteos_user', JSON.stringify(user))
        localStorage.setItem('kiteos_office', JSON.stringify(office))
        set({ user, office, token, isAuthenticated: true })
        return { success: true }
      }
      return { success: false, error: result.error || 'Erro ao criar conta' }
    } catch {
      return { success: false, error: 'Erro de conexão com o servidor' }
    }
  },

  logout: async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' })
    } catch {}
    localStorage.removeItem('kiteos_token')
    localStorage.removeItem('kiteos_refresh')
    localStorage.removeItem('kiteos_user')
    localStorage.removeItem('kiteos_office')
    set({ user: null, office: null, token: null, isAuthenticated: false })
  },

  checkAuth: async () => {
    const userStr = localStorage.getItem('kiteos_user')
    const officeStr = localStorage.getItem('kiteos_office')
    const localToken = localStorage.getItem('kiteos_token')

    if (!userStr || !officeStr || !localToken) {
      localStorage.removeItem('kiteos_token')
      localStorage.removeItem('kiteos_refresh')
      localStorage.removeItem('kiteos_user')
      localStorage.removeItem('kiteos_office')
      set({ user: null, office: null, token: null, isAuthenticated: false })
      return
    }

    try {
      const headers: Record<string, string> = {
        'Authorization': `Bearer ${localToken}`
      }
      const res = await fetch('/api/auth/me', {
        headers,
        credentials: 'same-origin',
      })
      const data = await res.json()

      if (data.success && data.data?.user) {
        const user = data.data.user
        const office = data.data.office
        localStorage.setItem('kiteos_user', JSON.stringify(user))
        localStorage.setItem('kiteos_office', JSON.stringify(office))
        set({ token: localToken, user, office, isAuthenticated: true })
      } else {
        // Try refresh token before clearing session
        const newToken = await performTokenRefresh()
        if (newToken) {
          // Re-validate with fresh token to get correct user/office data
          try {
            const meRes = await fetch('/api/auth/me', {
              headers: { 'Authorization': `Bearer ${newToken}` },
              credentials: 'same-origin',
            })
            const meData = await meRes.json()
            if (meData.success && meData.data?.user) {
              const user = meData.data.user
              const office = meData.data.office
              localStorage.setItem('kiteos_user', JSON.stringify(user))
              localStorage.setItem('kiteos_office', JSON.stringify(office))
              set({ token: newToken, user, office, isAuthenticated: true })
              return
            }
          } catch {}
          // If re-validation failed, clear everything
        }
        // Token and refresh failed — clear state and show login
        localStorage.removeItem('kiteos_token')
        localStorage.removeItem('kiteos_refresh')
        localStorage.removeItem('kiteos_user')
        localStorage.removeItem('kiteos_office')
        set({ user: null, office: null, token: null, isAuthenticated: false })
      }
    } catch {
      // On connection error, reset state safely
      localStorage.removeItem('kiteos_token')
      localStorage.removeItem('kiteos_refresh')
      localStorage.removeItem('kiteos_user')
      localStorage.removeItem('kiteos_office')
      set({ user: null, office: null, token: null, isAuthenticated: false })
    }
  },
}))

// =============================================
// NAVIGATION STORE
// =============================================
export type NavPage =
  | 'dashboard'
  | 'service-orders'
  | 'pdv'
  | 'inventory'
  | 'financial'
  | 'nfe'
  | 'fiscal'
  | 'subscriptions'
  | 'admin-subscriptions'
  | 'notifications'
  | 'ai-assistant'
  | 'clients'
  | 'suppliers'
  | 'mechanics'
  | 'employees'
  | 'office-profile'

interface NavState {
  currentPage: NavPage
  setPage: (page: NavPage) => void
}

export const useNavStore = create<NavState>((set) => ({
  currentPage: 'dashboard',
  setPage: (page) => set({ currentPage: page }),
}))

// =============================================
// CONCURRENT TOKEN REFRESH PIPELINE
// =============================================
let refreshTokenPromise: Promise<string | null> | null = null

async function performTokenRefresh(): Promise<string | null> {
  if (typeof window === 'undefined') return null
  if (refreshTokenPromise) return refreshTokenPromise

  refreshTokenPromise = (async () => {
    try {
      const refreshToken = localStorage.getItem('kiteos_refresh')
      const refreshRes = await fetch('/api/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: refreshToken || undefined }),
        credentials: 'same-origin',
      })
      const refreshData = await refreshRes.json()
      if (refreshData.success && refreshData.data?.token) {
        const newToken = refreshData.data.token
        localStorage.setItem('kiteos_token', newToken)
        if (refreshData.data.refreshToken) {
          localStorage.setItem('kiteos_refresh', refreshData.data.refreshToken)
        }
        useAuthStore.setState({ token: newToken })
        return newToken
      }
      return null
    } catch {
      return null
    } finally {
      refreshTokenPromise = null
    }
  })()

  return refreshTokenPromise
}

// =============================================
// API HELPER
// =============================================
export async function apiFetch(path: string, options?: RequestInit) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options?.headers as Record<string, string> || {}),
  }
  
  if (!headers['Authorization'] && typeof window !== 'undefined') {
    const token = localStorage.getItem('kiteos_token') || useAuthStore.getState().token
    if (token) {
      headers['Authorization'] = `Bearer ${token}`
    }
  }

  try {
    let res = await fetch(path, { 
      ...options, 
      headers,
      credentials: 'same-origin' 
    })

    // If 401 Unauthorized, trigger single-flight token refresh across all parallel requests
    if (res.status === 401 && typeof window !== 'undefined' && !path.includes('/api/auth/')) {
      const newToken = await performTokenRefresh()
      if (newToken) {
        headers['Authorization'] = `Bearer ${newToken}`
        // Retry original request with newly issued token
        res = await fetch(path, {
          ...options,
          headers,
          credentials: 'same-origin',
        })
      }
    }

    const contentType = res.headers.get('content-type') || ''
    let data: any
    if (contentType.includes('application/json')) {
      try {
        data = await res.json()
      } catch (jsonErr) {
        console.warn(`apiFetch JSON parse error from ${path}:`, jsonErr)
        data = { success: false, error: `Erro ao interpretar dados do servidor (HTTP ${res.status})` }
      }
    } else {
      const htmlText = await res.text().catch(() => '')
      console.warn(`apiFetch recebeu resposta não-JSON (HTML/Texto) de ${path} (status ${res.status}):`, htmlText.substring(0, 150))
      data = {
        success: false,
        error: `Resposta do servidor em formato inválido (${res.status})`
      }
    }

    // If status is still 401 after retry, clear auth state
    if (res.status === 401 && typeof window !== 'undefined' && !path.includes('/api/auth/')) {
      localStorage.removeItem('kiteos_token')
      localStorage.removeItem('kiteos_refresh')
      localStorage.removeItem('kiteos_user')
      localStorage.removeItem('kiteos_office')
      useAuthStore.setState({ user: null, office: null, token: null, isAuthenticated: false })
    }
    return data
  } catch (error) {
    console.error('apiFetch error:', error)
    return { success: false, error: 'Erro de conexão com o servidor' }
  }
}
