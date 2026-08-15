# KiteOS - Documentação da API e DDL do Banco de Dados

## Data Definition Language (DDL)

### Tabela: offices
```sql
CREATE TABLE offices (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  cnpj TEXT UNIQUE NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  address TEXT,
  city TEXT,
  state TEXT,
  zipCode TEXT,
  logo TEXT,
  active BOOLEAN DEFAULT 1,
  deleted BOOLEAN DEFAULT 0,
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### Tabela: users
```sql
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT DEFAULT 'EMPLOYEE', -- ADMIN, OWNER, EMPLOYEE
  active BOOLEAN DEFAULT 1,
  deleted BOOLEAN DEFAULT 0,
  officeId TEXT NOT NULL REFERENCES offices(id),
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### Tabela: clients
```sql
CREATE TABLE clients (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  cpfCnpj TEXT,
  email TEXT,
  phone TEXT,
  address TEXT,
  city TEXT,
  state TEXT,
  zipCode TEXT,
  deleted BOOLEAN DEFAULT 0,
  officeId TEXT NOT NULL REFERENCES offices(id),
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### Tabela: vehicles
```sql
CREATE TABLE vehicles (
  id TEXT PRIMARY KEY,
  plate TEXT NOT NULL,
  brand TEXT,
  model TEXT,
  year INTEGER,
  color TEXT,
  km INTEGER,
  chassi TEXT,
  deleted BOOLEAN DEFAULT 0,
  clientId TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  officeId TEXT NOT NULL,
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### Tabela: service_orders
```sql
CREATE TABLE service_orders (
  id TEXT PRIMARY KEY,
  number TEXT UNIQUE NOT NULL,
  status TEXT DEFAULT 'ABERTA', -- ABERTA, EM_EXECUCAO, FINALIZADA, PAGA, CANCELADA
  description TEXT,
  diagnosis TEXT,
  totalParts REAL DEFAULT 0,
  totalServices REAL DEFAULT 0,
  totalDiscount REAL DEFAULT 0,
  totalAmount REAL DEFAULT 0,
  paymentMethod TEXT, -- PIX, CARTAO, DINHEIRO
  paidAt DATETIME,
  deleted BOOLEAN DEFAULT 0,
  clientId TEXT NOT NULL REFERENCES clients(id),
  vehicleId TEXT NOT NULL REFERENCES vehicles(id),
  officeId TEXT NOT NULL REFERENCES offices(id),
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### Tabela: service_order_items
```sql
CREATE TABLE service_order_items (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL, -- SERVICO, PECA
  description TEXT NOT NULL,
  quantity REAL DEFAULT 1,
  unitPrice REAL NOT NULL,
  totalPrice REAL NOT NULL,
  partId TEXT,
  deleted BOOLEAN DEFAULT 0,
  serviceOrderId TEXT NOT NULL REFERENCES service_orders(id) ON DELETE CASCADE,
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### Tabela: parts
```sql
CREATE TABLE parts (
  id TEXT PRIMARY KEY,
  sku TEXT NOT NULL,
  description TEXT NOT NULL,
  ncm TEXT, -- Nomenclatura Comum do Mercosul
  cfop TEXT, -- Codigo Fiscal de Operacoes e Prestacoes
  unit TEXT DEFAULT 'UN',
  quantity REAL DEFAULT 0,
  minQuantity REAL DEFAULT 0,
  costPrice REAL DEFAULT 0,
  salePrice REAL DEFAULT 0,
  location TEXT,
  batch TEXT,
  validity DATETIME,
  cst TEXT, -- Codigo de Situacao Tributaria
  csosn TEXT,
  deleted BOOLEAN DEFAULT 0,
  officeId TEXT NOT NULL REFERENCES offices(id),
  supplierId TEXT REFERENCES suppliers(id),
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(sku, officeId)
);
```

### Tabela: stock_movements
```sql
CREATE TABLE stock_movements (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL, -- ENTRADA, SAIDA
  quantity REAL NOT NULL,
  unitCost REAL DEFAULT 0,
  reason TEXT,
  reference TEXT,
  deleted BOOLEAN DEFAULT 0,
  partId TEXT NOT NULL REFERENCES parts(id),
  officeId TEXT NOT NULL REFERENCES offices(id),
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### Tabela: suppliers
```sql
CREATE TABLE suppliers (
  id TEXT PRIMARY KEY,
  cnpj TEXT NOT NULL,
  razaoSocial TEXT NOT NULL,
  nomeFantasia TEXT,
  email TEXT,
  phone TEXT,
  address TEXT,
  city TEXT,
  state TEXT,
  zipCode TEXT,
  ie TEXT,
  deleted BOOLEAN DEFAULT 0,
  officeId TEXT NOT NULL REFERENCES offices(id),
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(cnpj, officeId)
);
```

### Tabela: invoices (NF-e)
```sql
CREATE TABLE invoices (
  id TEXT PRIMARY KEY,
  chave TEXT UNIQUE NOT NULL, -- Chave de acesso 44 digitos
  numero TEXT NOT NULL,
  serie TEXT NOT NULL,
  tipoOperacao TEXT DEFAULT 'ENTRADA',
  dataEmissao DATETIME NOT NULL,
  dataEntrada DATETIME,
  subtotal REAL DEFAULT 0,
  frete REAL DEFAULT 0,
  seguro REAL DEFAULT 0,
  desconto REAL DEFAULT 0,
  baseIcms REAL DEFAULT 0,
  valorIcms REAL DEFAULT 0,
  valorIpi REAL DEFAULT 0,
  valorPis REAL DEFAULT 0,
  valorCofins REAL DEFAULT 0,
  totalNf REAL DEFAULT 0,
  xmlContent TEXT,
  status TEXT DEFAULT 'IMPORTADA', -- IMPORTADA, CONFERIDA, DIVERGENTE, ESTOQUE_ATUALIZADO, PAGA
  observacao TEXT,
  deleted BOOLEAN DEFAULT 0,
  supplierId TEXT NOT NULL REFERENCES suppliers(id),
  officeId TEXT NOT NULL REFERENCES offices(id),
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### Tabela: invoice_items
```sql
CREATE TABLE invoice_items (
  id TEXT PRIMARY KEY,
  sku TEXT,
  descricao TEXT NOT NULL,
  ncm TEXT NOT NULL,
  cfop TEXT NOT NULL,
  cst TEXT,
  csosn TEXT,
  quantidade REAL NOT NULL,
  unidade TEXT DEFAULT 'UN',
  valorUnitario REAL NOT NULL,
  valorTotal REAL NOT NULL,
  baseIcms REAL DEFAULT 0,
  valorIcms REAL DEFAULT 0,
  valorIpi REAL DEFAULT 0,
  valorPis REAL DEFAULT 0,
  valorCofins REAL DEFAULT 0,
  lote TEXT,
  validade DATETIME,
  localizacao TEXT,
  divergencia BOOLEAN DEFAULT 0,
  deleted BOOLEAN DEFAULT 0,
  invoiceId TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  partId TEXT REFERENCES parts(id),
  officeId TEXT NOT NULL REFERENCES offices(id),
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### Tabela: receptions
```sql
CREATE TABLE receptions (
  id TEXT PRIMARY KEY,
  status TEXT DEFAULT 'PENDENTE', -- PENDENTE, CONFERIDA, DIVERGENTE, BLOQUEADA
  divergencia TEXT,
  quantidadeRecebida REAL,
  conferidoPor TEXT,
  observacao TEXT,
  deleted BOOLEAN DEFAULT 0,
  invoiceId TEXT UNIQUE NOT NULL REFERENCES invoices(id),
  officeId TEXT NOT NULL REFERENCES offices(id),
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### Tabela: financial_entries
```sql
CREATE TABLE financial_entries (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL, -- PAGAR, RECEBER
  category TEXT, -- ASSINATURA, OS, NF, OUTROS
  description TEXT NOT NULL,
  amount REAL NOT NULL,
  discount REAL DEFAULT 0,
  interest REAL DEFAULT 0,
  totalAmount REAL NOT NULL,
  status TEXT DEFAULT 'PENDENTE', -- PENDENTE, PAGO, ATRASADO, CANCELADO
  dueDate DATETIME NOT NULL,
  paymentDate DATETIME,
  paymentMethod TEXT,
  reference TEXT,
  deleted BOOLEAN DEFAULT 0,
  supplierId TEXT REFERENCES suppliers(id),
  officeId TEXT NOT NULL REFERENCES offices(id),
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### Tabela: subscriptions
```sql
CREATE TABLE subscriptions (
  id TEXT PRIMARY KEY,
  plan TEXT DEFAULT 'FREE', -- FREE, PRO, PRO_PLUS, PREMIUM
  status TEXT DEFAULT 'ATIVA', -- ATIVA, INADIMPLENTE, CANCELADA, TRIAL
  startDate DATETIME NOT NULL,
  endDate DATETIME,
  trialEndDate DATETIME,
  monthlyPrice REAL DEFAULT 0,
  currentPeriodStart DATETIME,
  currentPeriodEnd DATETIME,
  deleted BOOLEAN DEFAULT 0,
  officeId TEXT NOT NULL REFERENCES offices(id),
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### Tabela: notifications
```sql
CREATE TABLE notifications (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL, -- WHATSAPP, EMAIL, SYSTEM
  template TEXT,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  recipient TEXT,
  status TEXT DEFAULT 'PENDENTE', -- PENDENTE, ENVIADA, FALHOU
  sentAt DATETIME,
  serviceOrderId TEXT REFERENCES service_orders(id),
  officeId TEXT NOT NULL REFERENCES offices(id),
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### Tabela: audit_logs
```sql
CREATE TABLE audit_logs (
  id TEXT PRIMARY KEY,
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entityId TEXT,
  details TEXT,
  userId TEXT REFERENCES users(id),
  officeId TEXT NOT NULL REFERENCES offices(id),
  invoiceId TEXT REFERENCES invoices(id),
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### Tabela: tax_rules
```sql
CREATE TABLE tax_rules (
  id TEXT PRIMARY KEY,
  ncm TEXT NOT NULL,
  cfop TEXT NOT NULL,
  cst TEXT,
  csosn TEXT,
  aliqIcms REAL DEFAULT 0,
  aliqIpi REAL DEFAULT 0,
  aliqPis REAL DEFAULT 0,
  aliqCofins REAL DEFAULT 0,
  state TEXT DEFAULT 'BA',
  active BOOLEAN DEFAULT 1,
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(ncm, cfop, state)
);
```

---

## API Endpoints - OpenAPI Specification

### Autenticação

| Método | Endpoint | Descrição |
|--------|----------|-----------|
| POST | `/api/auth/login` | Login com email/senha, retorna JWT |
| POST | `/api/auth/register` | Registro de nova oficina + usuário owner |
| GET | `/api/auth/me` | Retorna dados do usuário autenticado |

### Clientes

| Método | Endpoint | Descrição |
|--------|----------|-----------|
| GET | `/api/clients?officeId=&search=` | Listar clientes com busca |
| POST | `/api/clients` | Criar cliente |
| GET | `/api/clients/[id]` | Buscar cliente por ID |
| PUT | `/api/clients/[id]` | Atualizar cliente |
| DELETE | `/api/clients/[id]` | Soft delete cliente |

### Veículos

| Método | Endpoint | Descrição |
|--------|----------|-----------|
| GET | `/api/vehicles?officeId=&clientId=` | Listar veículos |
| POST | `/api/vehicles` | Criar veículo |
| GET | `/api/vehicles/[id]` | Buscar veículo por ID |
| PUT | `/api/vehicles/[id]` | Atualizar veículo |
| DELETE | `/api/vehicles/[id]` | Soft delete veículo |

### Fornecedores

| Método | Endpoint | Descrição |
|--------|----------|-----------|
| GET | `/api/suppliers?officeId=&search=` | Listar fornecedores |
| POST | `/api/suppliers` | Criar fornecedor |
| GET | `/api/suppliers/[id]` | Buscar fornecedor por ID |
| PUT | `/api/suppliers/[id]` | Atualizar fornecedor |
| DELETE | `/api/suppliers/[id]` | Soft delete fornecedor |

### Ordens de Serviço

| Método | Endpoint | Descrição |
|--------|----------|-----------|
| GET | `/api/service-orders?officeId=&status=&search=` | Listar OS |
| POST | `/api/service-orders` | Criar OS com itens |
| GET | `/api/service-orders/[id]` | Buscar OS com detalhes |
| PUT | `/api/service-orders/[id]` | Atualizar OS |
| DELETE | `/api/service-orders/[id]` | Soft delete OS |
| PUT | `/api/service-orders/[id]/status` | Alterar status da OS |

### Estoque

| Método | Endpoint | Descrição |
|--------|----------|-----------|
| GET | `/api/parts?officeId=&search=&lowStock=` | Listar peças |
| POST | `/api/parts` | Criar peça |
| GET | `/api/parts/[id]` | Buscar peça com movimentações |
| PUT | `/api/parts/[id]` | Atualizar peça |
| DELETE | `/api/parts/[id]` | Soft delete peça |
| GET | `/api/stock-movements?officeId=&partId=&type=` | Listar movimentações |
| POST | `/api/stock-movements` | Criar movimentação de estoque |
| GET | `/api/stock-alerts?officeId=` | Alertas de estoque baixo |

### Financeiro

| Método | Endpoint | Descrição |
|--------|----------|-----------|
| GET | `/api/financial?officeId=&type=&status=` | Listar lançamentos |
| POST | `/api/financial` | Criar lançamento financeiro |
| GET | `/api/financial/[id]` | Buscar lançamento por ID |
| PUT | `/api/financial/[id]` | Atualizar lançamento |
| DELETE | `/api/financial/[id]` | Soft delete lançamento |
| PUT | `/api/financial/pay/[id]` | Marcar como pago |
| GET | `/api/financial/dashboard?officeId=` | Dashboard financeiro |
| GET | `/api/financial/reports?officeId=&period=` | Relatórios financeiros |

### Assinaturas

| Método | Endpoint | Descrição |
|--------|----------|-----------|
| GET | `/api/subscriptions?officeId=` | Listar assinaturas |
| POST | `/api/subscriptions` | Criar assinatura |
| GET | `/api/subscriptions/[id]` | Buscar assinatura |
| PUT | `/api/subscriptions/[id]` | Atualizar plano |
| GET | `/api/subscriptions/check?officeId=` | Verificar assinatura ativa |

### NF-e (Nota Fiscal Eletrônica)

| Método | Endpoint | Descrição |
|--------|----------|-----------|
| POST | `/api/nfe/import` | Importar NF-e via XML |
| POST | `/api/nfe/manual` | Criar NF-e manual |
| GET | `/api/nfe/[id]` | Buscar NF-e completa |
| PUT | `/api/nfe/[id]` | Atualizar NF-e |
| DELETE | `/api/nfe/[id]` | Soft delete NF-e |
| POST | `/api/nfe/[id]/validate` | Validar totais e impostos |
| POST | `/api/recebimento/[nfeId]/conferir` | Conferir recebimento |
| POST | `/api/estoque/movimentar` | Atualizar estoque via NF-e |
| POST | `/api/financeiro/titulo` | Gerar título a pagar via NF-e |

### Notificações

| Método | Endpoint | Descrição |
|--------|----------|-----------|
| GET | `/api/notifications?officeId=&type=&status=` | Listar notificações |
| POST | `/api/notifications` | Criar notificação |
| GET | `/api/notifications/[id]` | Buscar notificação |
| PUT | `/api/notifications/[id]` | Atualizar notificação |
| POST | `/api/notifications/send` | Enviar notificação |

### IA Assistente

| Método | Endpoint | Descrição |
|--------|----------|-----------|
| POST | `/api/ai/chat` | Chat com IA assistente |

### Regras Fiscais

| Método | Endpoint | Descrição |
|--------|----------|-----------|
| GET | `/api/tax-rules?ncm=&cfop=&state=` | Listar regras fiscais |
| POST | `/api/tax-rules` | Criar regra fiscal |
| PUT | `/api/tax-rules` | Atualizar regra fiscal |

### Seed

| Método | Endpoint | Descrição |
|--------|----------|-----------|
| POST | `/api/seed` | Popular banco com dados demo |

---

## Planos e Limites

| Recurso | FREE | PRO | PRO+ | PREMIUM |
|---------|------|-----|------|---------|
| Ordens de Serviço | 10 | 100 | 500 | Ilimitado |
| Clientes | 20 | 200 | 1.000 | Ilimitado |
| Peças no Estoque | 50 | 500 | 2.000 | Ilimitado |
| IA Assistente | Não | Sim | Sim | Sim |
| WhatsApp | Não | Não | Sim | Sim |
| Preço Mensal | R$ 0 | R$ 99,90 | R$ 199,90 | R$ 349,90 |

---

## Credenciais de Demo

- **Email**: admin@kiteos.com
- **Senha**: admin123
- **Oficina**: Oficina Central (CNPJ: 12.345.678/0001-90)
