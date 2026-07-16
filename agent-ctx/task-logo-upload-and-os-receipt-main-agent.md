# Task: Logo Upload API + OS Receipt Component

## Summary
Created two new features for the OSMECH SaaS system:

### 1. Logo Upload API (`/src/app/api/upload/logo/route.ts`)
- POST endpoint accepting multipart form data with `file` and `officeId`
- Validates: file existence, image type (PNG/JPG/WEBP), max 2MB size
- Validates office exists in database before uploading
- Saves file to `/public/uploads/logos/{officeId}.{ext}`
- Creates directory if it doesn't exist using `mkdir` with `recursive: true`
- Updates Office record's `logo` field with relative path
- Returns `{ success: true, data: { logo: path } }` on success
- Proper error handling with Portuguese error messages

### 2. OS Receipt Component (`/src/components/modules/os-receipt.tsx`)
- Professional thermal receipt (80mm style, ~302px width)
- 'use client' component using `useAuthStore` from `@/lib/store`
- Sections: Header (logo, office info), OS Info, Client & Vehicle, Items Table, Totals, Thank You, Footer
- Format helpers: `formatCurrency` (R$ 1.234,56), `formatDate` (dd/mm/yyyy), `formatCNPJ` (00.000.000/0000-00), `formatCPFCpf`, `formatPhone`
- Print functionality via `handlePrint` that opens new window with receipt content
- Print CSS: hides buttons, sets receipt to full width, 80mm page size
- Props: `os`, `office`, `mode` ('receipt' | 'closure'), `onClose`
- Mode-aware title: "RECIBO DE PAGAMENTO" for paid orders, "ORDEM DE SERVIÇO" for closure
- Items displayed as services first, then parts, with quantity x price format
- "Documento não fiscal" footer and OSMECH branding

## Files Modified/Created
- `/src/app/api/upload/logo/route.ts` (new)
- `/src/components/modules/os-receipt.tsx` (new)
- `/public/uploads/logos/` (directory created)

## Lint Status
- Clean: 0 errors, 0 warnings
