# Task: Service Orders & Clients Module Components

## Agent: Main Developer

## Summary
Created two comprehensive module components for the OSMECH SaaS system:

### 1. Service Orders Module (`src/components/modules/service-orders.tsx`)
- **List View**: Header with title + "Nova OS" button, status filter dropdown (Todas, ABERTA, EM_EXECUCAO, FINALIZADA, PAGA, CANCELADA), search input, table with columns (Nº OS, Cliente, Veículo, Status, Total, Data), responsive mobile cards view, pagination
- **Status Badges**: Color-coded (ABERTA=blue, EM_EXECUCAO=yellow, FINALIZADA=green, PAGA=emerald, CANCELADA=red)
- **New/Edit OS Dialog**: Client search + dropdown, vehicle selection (filtered by client), description/diagnosis textareas, items section with add/remove, type toggle (SERVICO/PECA), part selection dropdown for PECA items, auto-calc totals, discount field
- **OS Detail View**: Full info cards (client, vehicle), status timeline visual (ABERTA → EM_EXECUCAO → FINALIZADA → PAGA), items table with service/peca badges, totals summary, action buttons based on status (Iniciar Execução, Finalizar, Registrar Pagamento, Cancelar OS), payment dialog with method selection (PIX, Cartão, Dinheiro)

### 2. Clients Module (`src/components/modules/clients.tsx`)
- **List View**: Header + "Novo Cliente" button, search input, responsive card grid with name initials avatar, CPF/CNPJ, phone, email, vehicle count badge, click to view details, pagination
- **New/Edit Client Dialog**: Name (required), CPF/CNPJ with mask, email, phone with mask, address, city, state (UF), CEP
- **Client Detail View**: Info card with icons (CPF/CNPJ, phone, email, address), tabs for Vehicles and Service Orders
- **Vehicles Tab**: Card grid with edit/delete on hover, add vehicle button
- **Vehicle Form Dialog**: Plate (required), brand, model, year, color, KM, chassi
- **Service Orders Tab**: Table with OS number, vehicle, status badge, total, date

### 3. Page Integration (`src/app/page.tsx`)
- Updated to import and render ServiceOrdersModule and ClientsModule
- Added to navigation switch statement

## API Integration
Both modules use `apiFetch` from `@/lib/store` with proper `officeId` from `useAuthStore`. All existing API routes are utilized:
- `GET/POST /api/service-orders` - List/Create OS
- `GET/PUT /api/service-orders/[id]` - Get/Update OS
- `PUT /api/service-orders/[id]/status` - Change OS status
- `GET/POST /api/clients` - List/Create clients
- `GET/PUT /api/clients/[id]` - Get/Update client
- `GET/POST /api/vehicles` - List/Create vehicles
- `PUT/DELETE /api/vehicles/[id]` - Update/Delete vehicle
- `GET /api/parts` - List parts (for PECA item selection)

## Design Choices
- All text in Brazilian Portuguese
- Emerald-600 primary color, zinc neutrals
- shadcn/ui components (Button, Card, Input, Select, Dialog, Badge, Table, Tabs, Label, Textarea, Separator)
- Lucide icons throughout
- Responsive design (mobile cards, desktop tables)
- Loading states with spinner
- Error/empty states with icons and messages
