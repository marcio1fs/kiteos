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
  register: (data: RegisterData) => Promise<boolean>
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
        const { token, user, office } = data.data
        localStorage.setItem('kiteos_token', token)
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
        const { token, user, office } = result.data
        localStorage.setItem('kiteos_token', token)
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

  logout: () => {
    localStorage.removeItem('kiteos_token')
    localStorage.removeItem('kiteos_user')
    localStorage.removeItem('kiteos_office')
    set({ user: null, office: null, token: null, isAuthenticated: false })
  },

  checkAuth: async () => {
    const token = localStorage.getItem('kiteos_token')
    const userStr = localStorage.getItem('kiteos_user')
    const officeStr = localStorage.getItem('kiteos_office')
    if (!token || !userStr || !officeStr) {
      set({ user: null, office: null, token: null, isAuthenticated: false })
      return
    }

    try {
      // Verify token server-side to ensure it's still valid
      const res = await fetch('/api/auth/me', {
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = await res.json()

      if (data.success && data.data?.user) {
        const user = data.data.user
        const office = data.data.office
        // Update stored data with fresh server data
        localStorage.setItem('kiteos_user', JSON.stringify(user))
        localStorage.setItem('kiteos_office', JSON.stringify(office))
        set({ token, user, office, isAuthenticated: true })
      } else {
        // Token is invalid or expired - clear everything
        localStorage.removeItem('kiteos_token')
        localStorage.removeItem('kiteos_user')
        localStorage.removeItem('kiteos_office')
        set({ user: null, office: null, token: null, isAuthenticated: false })
      }
    } catch {
      // Network error - trust localStorage but mark as authenticated
      // The middleware will handle invalid tokens on next API call
      try {
        set({
          token,
          user: JSON.parse(userStr),
          office: JSON.parse(officeStr),
          isAuthenticated: true,
        })
      } catch {
        localStorage.removeItem('kiteos_token')
        localStorage.removeItem('kiteos_user')
        localStorage.removeItem('kiteos_office')
        set({ user: null, office: null, token: null, isAuthenticated: false })
      }
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
// API HELPER
// =============================================
export async function apiFetch(path: string, options?: RequestInit) {
  const token = localStorage.getItem('kiteos_token')
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options?.headers as Record<string, string> || {}),
  }
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }
  try {
    const res = await fetch(path, { ...options, headers })
    const data = await res.json()
    // If token expired, redirect to login
    if (res.status === 401 && typeof window !== 'undefined') {
      localStorage.removeItem('kiteos_token')
      localStorage.removeItem('kiteos_user')
      localStorage.removeItem('kiteos_office')
      // Use zustand to clear auth state instead of hard reload
      useAuthStore.setState({ user: null, office: null, token: null, isAuthenticated: false })
    }
    return data
  } catch (error) {
    console.error('apiFetch error:', error)
    return { success: false, error: 'Erro de conexão com o servidor' }
  }
}
