# Task: OSMECH API Routes - NF-e, Notifications, AI Assistant

## Summary

Created all 12 API route files plus XML parser helper and audit log utility for the OSMECH SaaS system.

## Files Created

### Helper Libraries
1. **`/src/lib/nfe/xml-parser.ts`** - NF-e XML parser with regex-based extraction
   - Extracts: chave, numero, serie, dataEmissao, supplier CNPJ/razaoSocial, items, totals, taxes
   - Handles various ICMS CST types (ICMS00-ICMS90, ICMSSN101-900)
   - Validates XML structure, chave format (44 digits), CNPJ format (14 digits)
   - Supports Brazilian number format (comma as decimal)

2. **`/src/lib/audit.ts`** - Safe audit log creation utility
   - Validates user existence before FK reference
   - Prevents Prisma FK constraint errors

### NF-e Module (4 routes)
3. **`/src/app/api/nfe/import/route.ts`** - POST: Import NF-e from XML upload
   - Multipart form data with XML file
   - Creates/finds Supplier by CNPJ
   - Creates Invoice + InvoiceItems
   - Creates Reception (PENDENTE)
   - Tax rule validation with warnings
   - Total verification

4. **`/src/app/api/nfe/manual/route.ts`** - POST: Create NF-e manually
   - Full validation (CFOP mandatory, qty > 0)
   - Auto-calculates totals
   - Creates Supplier if needed

5. **`/src/app/api/nfe/[id]/route.ts`** - GET/PUT/DELETE
   - GET: Complete invoice with items, supplier, reception, audit logs
   - PUT: Only if status IMPORTADA
   - DELETE: Soft delete with cascade

6. **`/src/app/api/nfe/[id]/validate/route.ts`** - POST: Validate NF-e
   - Subtotal check: sum(items) = subtotal
   - Total NF check: subtotal + frete + seguro - desconto + IPI = totalNf
   - Tax validation using TaxRule by NCM/CFOP
   - SKU mapping check
   - Item-level quantity and value verification

### Recebimento Module (1 route)
7. **`/src/app/api/recebimento/[nfeId]/conferir/route.ts`** - POST: Conference
   - Compare NF quantities vs received
   - >50% divergence → BLOQUEADA
   - >tolerance → DIVERGENTE
   - All match → CONFERIDA
   - Configurable tolerance (default 5%)

### Estoque Module (1 route)
8. **`/src/app/api/estoque/movimentar/route.ts`** - POST: Stock update
   - Only after CONFERIDA
   - Find or create Part by SKU
   - Weighted average cost calculation
   - StockMovement (ENTRADA) creation
   - Links InvoiceItem to Part

### Financeiro Module (1 route)
9. **`/src/app/api/financeiro/titulo/route.ts`** - POST: Generate accounts payable
   - Creates FinancialEntry (PAGAR)
   - Amount = totalNf
   - Due date = dataEntrada + supplier payment terms (default 30 days)

### Notifications Module (3 routes)
10. **`/src/app/api/notifications/route.ts`** - GET/POST
    - GET: List with pagination, filter by officeId/status/type
    - POST: Create notification

11. **`/src/app/api/notifications/[id]/route.ts`** - GET/PUT
    - GET: Get with service order details
    - PUT: Update status (mark as ENVIADA, etc.)

12. **`/src/app/api/notifications/send/route.ts`** - POST: Send notification
    - Simulates WhatsApp/Email/SYSTEM sending
    - Marks as ENVIADA with sentAt timestamp

### AI Assistant Module (1 route)
13. **`/src/app/api/ai/chat/route.ts`** - POST: AI chat
    - Uses z-ai-web-dev-sdk for AI responses
    - Context-aware: office, inventory, financial, service orders, invoices
    - Supports types: DIAGNOSTICO, SUGESTAO_SERVICO, EXPLICACAO_CLIENTE, AUXILIO_FINANCEIRO, GERAL
    - NEVER executes actions without human confirmation
    - Falls back to predefined responses if AI SDK fails

### Tax Rules Module (1 route)
14. **`/src/app/api/tax-rules/route.ts`** - GET/POST/PUT
    - GET: List with filters (ncm, cfop, state) + pagination
    - POST: Create with NCM/CFOP/state uniqueness validation
    - PUT: Update with duplicate check

## Schema Changes
- Added `paymentTerms Int @default(30)` to Supplier model
- Added `AIChat` model for AI assistant chat history
- Added `aiChats AIChat[]` relation to Office model

## Testing Results
All endpoints tested and working:
- ✅ NF-e manual creation with items
- ✅ NF-e validation (subtotal + total checks)
- ✅ Reception conference (OK, DIVERGENTE, BLOQUEADA)
- ✅ Stock movement (only after CONFERIDA, blocked when BLOQUEADA)
- ✅ Financial entry generation with due date calculation
- ✅ Notifications CRUD + send (WHATSAPP simulated)
- ✅ AI chat with context-aware responses
- ✅ Tax rules CRUD with filtering

## Business Rules Enforced
1. ✅ No duplicate NF-e (chave + supplierId unique)
2. ✅ XML structure validation before processing
3. ✅ Total verification: sum items + frete + seguro - desconto + IPI = totalNf
4. ✅ Stock only updates after CONFERIDA
5. ✅ Blocked reception prevents stock update
6. ✅ Divergence tolerance configurable (default 5%)
7. ✅ Critical divergence (>50%) blocks reception
8. ✅ Financial entry auto-generated from NF
9. ✅ All operations create audit logs (safely)
10. ✅ AI assistant never executes without human confirmation
