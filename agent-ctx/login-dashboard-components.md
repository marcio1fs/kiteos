# Task: OSMECH Login & Dashboard Components

## Summary
Created the Login and Dashboard frontend components for the OSMECH SaaS system.

## Files Created/Modified

### Created
1. **`/src/components/modules/login.tsx`** - Login/Register page
   - Beautiful centered card with OSMECH branding (Wrench icon + gradient background)
   - Two tabs: "Entrar" (Login) and "Registrar" (Register)
   - Login: email + password with show/hide toggle, "Entrar" button with loading state
   - Register: User section (name, email, password) + Office section (office name, CNPJ with auto-format, office email), "Criar Conta" button with loading state
   - Error messages shown as inline red banners
   - Uses `useAuthStore` for `login` and `register` functions
   - CNPJ input auto-formats with mask (00.000.000/0000-00)
   - All text in Brazilian Portuguese
   - Emerald-600 primary color, zinc neutrals

2. **`/src/components/modules/dashboard.tsx`** - Comprehensive dashboard
   - Header with "Dashboard" title and greeting (Bom dia/Boa tarde/Boa noite, {userName})
   - 4 KPI cards: OS Abertas (emerald), Faturamento Mensal (green), Estoque Crítico (orange), Assinatura (sky blue)
   - Bar chart showing OS by status using recharts
   - Line chart showing cash flow (receitas, despesas, saldo) last 30 days
   - Recent service orders list (last 5) with status badges and amounts
   - Alerts section: overdue payments (red), pending payments (amber), low stock alerts (red/amber by severity)
   - Financial summary bar: Recebido, Pago, A Receber, A Pagar
   - All data fetched from API endpoints using `apiFetch` with `useEffect`
   - Loading skeleton states throughout
   - Responsive grid layout (mobile-first)
   - All text in Brazilian Portuguese

3. **`/src/app/page.tsx`** - Updated main page
   - Auth-gated: checks `useAuthStore.checkAuth()` on mount
   - Shows `LoginModule` if not authenticated
   - Shows `Sidebar` + current page module if authenticated
   - `MobileNav` for responsive mobile navigation
   - Placeholder pages for other nav items

### Modified
4. **`/src/lib/store.ts`** - Fixed register function
   - Mapped RegisterData fields to API-expected field names:
     - `name` → `userName`, `email` → `userEmail`, `password` → `userPassword`
     - `cnpj` → `officeCnpj`

## API Endpoints Used
- `POST /api/auth/login` - Login
- `POST /api/auth/register` - Register
- `GET /api/service-orders?officeId=X` - Service orders
- `GET /api/financial/dashboard?officeId=X` - Financial dashboard data
- `GET /api/stock-alerts?officeId=X` - Low stock alerts
- `GET /api/subscriptions?officeId=X` - Subscription data

## Lint Status
✅ All lint checks pass
