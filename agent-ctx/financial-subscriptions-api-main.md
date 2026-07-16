# Task: Financial and Subscriptions API Routes for OSMECH SaaS

## Summary
Created all 8 API route files for the Financial and Subscriptions modules of the OSMECH SaaS system for mechanical workshops.

## Files Created

### Financial Module
1. **`/src/app/api/financial/route.ts`** - GET (list with filters) + POST (create with validation & auto-calculation)
2. **`/src/app/api/financial/[id]/route.ts`** - GET + PUT (update with auto-calculation) + DELETE (soft delete)
3. **`/src/app/api/financial/pay/[id]/route.ts`** - PUT (mark as paid with paymentDate & status)
4. **`/src/app/api/financial/dashboard/route.ts`** - GET (dashboard with totals, categories, cash flow)
5. **`/src/app/api/financial/reports/route.ts`** - GET (grouped reports by period & category)

### Subscriptions Module
6. **`/src/app/api/subscriptions/route.ts`** - GET (list) + POST (create with auto financial entry)
7. **`/src/app/api/subscriptions/[id]/route.ts`** - GET + PUT (upgrade/downgrade with proration)
8. **`/src/app/api/subscriptions/check/route.ts`** - GET (check active, auto-create FREE, usage limits)

## Business Rules Implemented
- ✅ totalAmount = amount - discount + interest (auto-calculated)
- ✅ Auto-overdue: PENDENTE entries with dueDate < today → ATRASADO
- ✅ Payment: Sets paymentDate to now, status to PAGO
- ✅ Subscription overdue: currentPeriodEnd < today → INADIMPLENTE
- ✅ Trial expiry: auto-downgrade to FREE
- ✅ Plan limits checked: maxOS, maxClients, maxParts
- ✅ Upgrade proration: charges proportional difference
- ✅ Downgrade proration: creates credit entry
- ✅ Auto-generates financial entry on subscription creation/renewal
- ✅ No-edit protection for paid entries
- ✅ Soft delete for financial entries
- ✅ Multi-tenant via officeId on all queries

## All Routes Tested & Working
- All endpoints return `{ success: true, data: ... }` format
- Lint passes cleanly
- Dev server running without errors
