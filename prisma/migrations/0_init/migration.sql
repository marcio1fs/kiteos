-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "offices" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "cnpj" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "address" TEXT,
    "city" TEXT,
    "state" TEXT,
    "zipCode" TEXT,
    "logo" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "deleted" BOOLEAN NOT NULL DEFAULT false,
    "mpEnabled" BOOLEAN NOT NULL DEFAULT false,
    "mpSandbox" BOOLEAN NOT NULL DEFAULT true,
    "mpAccessToken" TEXT,
    "mpPublicKey" TEXT,
    "mpRefreshToken" TEXT,
    "mpUserId" TEXT,
    "mpWebhookSecret" TEXT,
    "waEnabled" BOOLEAN NOT NULL DEFAULT false,
    "waApiUrl" TEXT,
    "waApiToken" TEXT,
    "waInstance" TEXT,
    "waPhone" TEXT,
    "waWebhookSecret" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "offices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'EMPLOYEE',
    "commissionRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "deleted" BOOLEAN NOT NULL DEFAULT false,
    "officeId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sequencers" (
    "id" TEXT NOT NULL,
    "officeId" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "currentValue" INTEGER NOT NULL DEFAULT 0,
    "prefix" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sequencers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clients" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "cpfCnpj" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "city" TEXT,
    "state" TEXT,
    "zipCode" TEXT,
    "deleted" BOOLEAN NOT NULL DEFAULT false,
    "officeId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "clients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicles" (
    "id" TEXT NOT NULL,
    "plate" TEXT NOT NULL,
    "brand" TEXT,
    "model" TEXT,
    "year" INTEGER,
    "color" TEXT,
    "km" INTEGER,
    "chassi" TEXT,
    "deleted" BOOLEAN NOT NULL DEFAULT false,
    "clientId" TEXT NOT NULL,
    "officeId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vehicles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_orders" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ABERTA',
    "description" TEXT,
    "diagnosis" TEXT,
    "totalParts" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "totalServices" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "totalDiscount" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "totalAmount" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "paymentMethod" TEXT,
    "paidAt" TIMESTAMP(3),
    "deleted" BOOLEAN NOT NULL DEFAULT false,
    "clientId" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "officeId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "service_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_order_items" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(65,30) NOT NULL DEFAULT 1,
    "unitPrice" DECIMAL(65,30) NOT NULL,
    "totalPrice" DECIMAL(65,30) NOT NULL,
    "commissionPct" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "commissionValue" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "partId" TEXT,
    "mechanicId" TEXT,
    "deleted" BOOLEAN NOT NULL DEFAULT false,
    "serviceOrderId" TEXT NOT NULL,
    "officeId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "service_order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mechanics" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "cpf" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "specialty" TEXT,
    "commissionPct" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "deleted" BOOLEAN NOT NULL DEFAULT false,
    "officeId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mechanics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "parts" (
    "id" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "ncm" TEXT,
    "cfop" TEXT,
    "unit" TEXT NOT NULL DEFAULT 'UN',
    "quantity" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "minQuantity" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "costPrice" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "salePrice" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "location" TEXT,
    "batch" TEXT,
    "validity" TIMESTAMP(3),
    "cst" TEXT,
    "csosn" TEXT,
    "deleted" BOOLEAN NOT NULL DEFAULT false,
    "officeId" TEXT NOT NULL,
    "supplierId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "parts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_movements" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "quantity" DECIMAL(65,30) NOT NULL,
    "unitCost" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "reason" TEXT,
    "reference" TEXT,
    "deleted" BOOLEAN NOT NULL DEFAULT false,
    "partId" TEXT NOT NULL,
    "officeId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "suppliers" (
    "id" TEXT NOT NULL,
    "cnpj" TEXT NOT NULL,
    "razaoSocial" TEXT NOT NULL,
    "nomeFantasia" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "city" TEXT,
    "state" TEXT,
    "zipCode" TEXT,
    "ie" TEXT,
    "deleted" BOOLEAN NOT NULL DEFAULT false,
    "officeId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "paymentTerms" INTEGER NOT NULL DEFAULT 30,

    CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoices" (
    "id" TEXT NOT NULL,
    "chave" TEXT NOT NULL,
    "numero" TEXT NOT NULL,
    "serie" TEXT NOT NULL,
    "tipoOperacao" TEXT NOT NULL DEFAULT 'ENTRADA',
    "naturezaOperacao" TEXT,
    "modelo" TEXT NOT NULL DEFAULT '55',
    "finalidade" TEXT NOT NULL DEFAULT '1',
    "formaPagamento" TEXT NOT NULL DEFAULT '0',
    "consumidorFinal" TEXT NOT NULL DEFAULT '1',
    "dataEmissao" TIMESTAMP(3) NOT NULL,
    "dataEntrada" TIMESTAMP(3),
    "subtotal" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "frete" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "seguro" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "desconto" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "outrasDespesas" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "baseIcms" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "valorIcms" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "baseIcmsSt" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "valorIcmsSt" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "valorIpi" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "valorPis" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "valorCofins" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "totalNf" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "xmlContent" TEXT,
    "status" TEXT NOT NULL DEFAULT 'IMPORTADA',
    "observacao" TEXT,
    "deleted" BOOLEAN NOT NULL DEFAULT false,
    "destCpfCnpj" TEXT,
    "destNome" TEXT,
    "destEndereco" TEXT,
    "destCidade" TEXT,
    "destEstado" TEXT,
    "destCep" TEXT,
    "destTelefone" TEXT,
    "destEmail" TEXT,
    "destIe" TEXT,
    "modFrete" TEXT DEFAULT '0',
    "transportadoraCnpj" TEXT,
    "transportadoraNome" TEXT,
    "veiculoPlaca" TEXT,
    "veiculoUf" TEXT,
    "volumes" TEXT,
    "duplicatas" TEXT,
    "supplierId" TEXT NOT NULL,
    "officeId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_items" (
    "id" TEXT NOT NULL,
    "sku" TEXT,
    "descricao" TEXT NOT NULL,
    "ncm" TEXT NOT NULL,
    "cfop" TEXT NOT NULL,
    "cst" TEXT,
    "csosn" TEXT,
    "quantidade" DECIMAL(65,30) NOT NULL,
    "unidade" TEXT NOT NULL DEFAULT 'UN',
    "valorUnitario" DECIMAL(65,30) NOT NULL,
    "valorTotal" DECIMAL(65,30) NOT NULL,
    "baseIcms" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "valorIcms" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "baseIcmsSt" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "valorIcmsSt" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "percIcmsSt" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "mvast" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "valorIpi" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "percIpi" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "cstIpi" TEXT,
    "valorPis" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "cstPis" TEXT,
    "valorCofins" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "cstCofins" TEXT,
    "fci" TEXT,
    "lote" TEXT,
    "validade" TIMESTAMP(3),
    "localizacao" TEXT,
    "divergencia" BOOLEAN NOT NULL DEFAULT false,
    "deleted" BOOLEAN NOT NULL DEFAULT false,
    "invoiceId" TEXT NOT NULL,
    "partId" TEXT,
    "officeId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoice_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "receptions" (
    "id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDENTE',
    "divergencia" TEXT,
    "quantidadeRecebida" DECIMAL(65,30),
    "conferidoPor" TEXT,
    "observacao" TEXT,
    "deleted" BOOLEAN NOT NULL DEFAULT false,
    "invoiceId" TEXT NOT NULL,
    "officeId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "receptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "financial_entries" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "category" TEXT,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(65,30) NOT NULL,
    "discount" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "interest" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "totalAmount" DECIMAL(65,30) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDENTE',
    "dueDate" TIMESTAMP(3) NOT NULL,
    "paymentDate" TIMESTAMP(3),
    "paymentMethod" TEXT,
    "reference" TEXT,
    "deleted" BOOLEAN NOT NULL DEFAULT false,
    "invoiceId" TEXT,
    "supplierId" TEXT,
    "saleId" TEXT,
    "officeId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "financial_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscriptions" (
    "id" TEXT NOT NULL,
    "plan" TEXT NOT NULL DEFAULT 'FREE',
    "status" TEXT NOT NULL DEFAULT 'ATIVA',
    "subscriptionCode" TEXT,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "trialEndDate" TIMESTAMP(3),
    "monthlyPrice" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "currentPeriodStart" TIMESTAMP(3),
    "currentPeriodEnd" TIMESTAMP(3),
    "deleted" BOOLEAN NOT NULL DEFAULT false,
    "officeId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "mpPreferenceId" TEXT,
    "mpPaymentId" TEXT,
    "mpStatus" TEXT,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "template" TEXT,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "recipient" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDENTE',
    "sentAt" TIMESTAMP(3),
    "serviceOrderId" TEXT,
    "officeId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT,
    "details" TEXT,
    "oldValues" TEXT,
    "newValues" TEXT,
    "userId" TEXT,
    "officeId" TEXT NOT NULL,
    "invoiceId" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_rules" (
    "id" TEXT NOT NULL,
    "ncm" TEXT NOT NULL,
    "cfop" TEXT NOT NULL,
    "cst" TEXT,
    "csosn" TEXT,
    "aliqIcms" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "aliqIpi" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "aliqPis" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "aliqCofins" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "state" TEXT NOT NULL DEFAULT 'BA',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "officeId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tax_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_chats" (
    "id" TEXT NOT NULL,
    "officeId" TEXT NOT NULL,
    "userId" TEXT,
    "type" TEXT NOT NULL DEFAULT 'GERAL',
    "message" TEXT NOT NULL,
    "response" TEXT NOT NULL,
    "context" TEXT,
    "confirmed" BOOLEAN NOT NULL DEFAULT false,
    "deleted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_chats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "client_invoices" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'EMITIDA',
    "dataEmissao" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dataCancelamento" TIMESTAMP(3),
    "chave" TEXT,
    "serie" TEXT,
    "naturezaOperacao" TEXT,
    "modelo" TEXT NOT NULL DEFAULT '55',
    "finalidade" TEXT NOT NULL DEFAULT '1',
    "formaPagamento" TEXT NOT NULL DEFAULT '0',
    "consumidorFinal" TEXT NOT NULL DEFAULT '1',
    "destNome" TEXT NOT NULL,
    "destCpfCnpj" TEXT,
    "destEndereco" TEXT,
    "destCidade" TEXT,
    "destEstado" TEXT,
    "destCep" TEXT,
    "destTelefone" TEXT,
    "destEmail" TEXT,
    "destIe" TEXT,
    "veiculoPlaca" TEXT,
    "veiculoModelo" TEXT,
    "veiculoAno" INTEGER,
    "veiculoCor" TEXT,
    "subtotal" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "desconto" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "totalAmount" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "baseIcms" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "valorIcms" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "baseIcmsSt" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "valorIcmsSt" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "valorIpi" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "valorPis" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "valorCofins" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "modFrete" TEXT DEFAULT '9',
    "transportadoraCnpj" TEXT,
    "transportadoraNome" TEXT,
    "veiculoPlacaTransp" TEXT,
    "volumes" TEXT,
    "duplicatas" TEXT,
    "observacao" TEXT,
    "motivoCancelamento" TEXT,
    "protocoloAutorizacao" TEXT,
    "saleId" TEXT,
    "serviceOrderId" TEXT,
    "deleted" BOOLEAN NOT NULL DEFAULT false,
    "officeId" TEXT NOT NULL,
    "clientId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "client_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "client_invoice_items" (
    "id" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "descricao" TEXT NOT NULL,
    "quantidade" DECIMAL(65,30) NOT NULL,
    "unidade" TEXT NOT NULL DEFAULT 'UN',
    "valorUnitario" DECIMAL(65,30) NOT NULL,
    "valorTotal" DECIMAL(65,30) NOT NULL,
    "ncm" TEXT,
    "cfop" TEXT,
    "cst" TEXT,
    "csosn" TEXT,
    "baseIcms" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "valorIcms" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "baseIcmsSt" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "valorIcmsSt" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "valorIpi" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "valorPis" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "valorCofins" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "cstIpi" TEXT,
    "cstPis" TEXT,
    "cstCofins" TEXT,
    "fci" TEXT,
    "partId" TEXT,
    "clientInvoiceId" TEXT NOT NULL,
    "deleted" BOOLEAN NOT NULL DEFAULT false,
    "officeId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "client_invoice_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seed_control" (
    "id" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "seeded" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "seed_control_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ABERTA',
    "discount" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "totalAmount" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "paymentMethod" TEXT,
    "paidAt" TIMESTAMP(3),
    "obs" TEXT,
    "deleted" BOOLEAN NOT NULL DEFAULT false,
    "clientId" TEXT,
    "userId" TEXT,
    "cashSessionId" TEXT,
    "officeId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sales_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sale_items" (
    "id" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(65,30) NOT NULL DEFAULT 1,
    "unitPrice" DECIMAL(65,30) NOT NULL,
    "totalPrice" DECIMAL(65,30) NOT NULL,
    "partId" TEXT,
    "deleted" BOOLEAN NOT NULL DEFAULT false,
    "saleId" TEXT NOT NULL,
    "officeId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sale_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sefaz_consultas" (
    "id" TEXT NOT NULL,
    "chave" TEXT NOT NULL,
    "ambiente" TEXT NOT NULL,
    "protocolo" TEXT,
    "status" TEXT NOT NULL,
    "fornecedorCnpj" TEXT,
    "xmlArmazenado" BOOLEAN NOT NULL DEFAULT false,
    "xmlContent" TEXT,
    "codigoStatus" TEXT,
    "motivoStatus" TEXT,
    "tempoResposta" INTEGER,
    "tentativas" INTEGER NOT NULL DEFAULT 1,
    "erroMensagem" TEXT,
    "erroAmigavel" TEXT,
    "officeId" TEXT NOT NULL,
    "usuarioId" TEXT,
    "invoiceId" TEXT,
    "deleted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sefaz_consultas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "certificados_digitais" (
    "id" TEXT NOT NULL,
    "nomeArquivo" TEXT NOT NULL,
    "arquivoContent" TEXT NOT NULL,
    "senhaCriptografada" TEXT NOT NULL,
    "validade" TIMESTAMP(3),
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "ambiente" TEXT NOT NULL DEFAULT 'HOMOLOGACAO',
    "uf" TEXT NOT NULL DEFAULT 'BA',
    "cnpjCpf" TEXT,
    "razaoSocial" TEXT,
    "deleted" BOOLEAN NOT NULL DEFAULT false,
    "officeId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "certificados_digitais_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "manifestacoes_destinatario" (
    "id" TEXT NOT NULL,
    "chave" TEXT NOT NULL,
    "tipoEvento" TEXT NOT NULL,
    "codigoEvento" TEXT NOT NULL,
    "protocolo" TEXT,
    "dataEvento" TIMESTAMP(3) NOT NULL,
    "justificativa" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDENTE',
    "codigoRetorno" TEXT,
    "motivoRetorno" TEXT,
    "tentativas" INTEGER NOT NULL DEFAULT 1,
    "erroMensagem" TEXT,
    "officeId" TEXT NOT NULL,
    "usuarioId" TEXT,
    "deleted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "manifestacoes_destinatario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conhecimentos_transporte" (
    "id" TEXT NOT NULL,
    "chave" TEXT NOT NULL,
    "numero" TEXT NOT NULL,
    "serie" TEXT NOT NULL,
    "dataEmissao" TIMESTAMP(3) NOT NULL,
    "tipoCte" TEXT NOT NULL DEFAULT 'CTE',
    "modal" TEXT,
    "naturezaOperacao" TEXT,
    "emitenteCnpj" TEXT NOT NULL,
    "emitenteRazao" TEXT NOT NULL,
    "destinatarioCnpj" TEXT,
    "destinatarioRazao" TEXT,
    "valorTotal" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "valorImpostos" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "xmlContent" TEXT,
    "status" TEXT NOT NULL DEFAULT 'IMPORTADA',
    "nfeVinculadas" TEXT,
    "observacao" TEXT,
    "deleted" BOOLEAN NOT NULL DEFAULT false,
    "officeId" TEXT NOT NULL,
    "supplierId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "conhecimentos_transporte_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "nfse_servicos" (
    "id" TEXT NOT NULL,
    "numero" TEXT NOT NULL,
    "codigoVerificacao" TEXT,
    "dataEmissao" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "competencia" TEXT,
    "tipoTributacao" TEXT NOT NULL DEFAULT 'ISSQN',
    "itemListaServico" TEXT,
    "discriminacao" TEXT NOT NULL,
    "valorServicos" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "valorDeducoes" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "valorIssqn" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "valorPis" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "valorCofins" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "valorIr" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "valorCsll" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "valorInss" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "valorTotal" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "baseCalculo" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "aliqIssqn" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "clienteCpfCnpj" TEXT,
    "clienteNome" TEXT,
    "clienteEndereco" TEXT,
    "clienteEmail" TEXT,
    "status" TEXT NOT NULL DEFAULT 'EMITIDA',
    "motivoCancelamento" TEXT,
    "xmlContent" TEXT,
    "deleted" BOOLEAN NOT NULL DEFAULT false,
    "officeId" TEXT NOT NULL,
    "clientId" TEXT,
    "serviceOrderId" TEXT,
    "saleId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "nfse_servicos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sped_registros" (
    "id" TEXT NOT NULL,
    "periodo" TEXT NOT NULL,
    "bloco" TEXT NOT NULL,
    "registro" TEXT NOT NULL,
    "linha" TEXT NOT NULL,
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "officeId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sped_registros_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fiscal_alertas" (
    "id" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "severidade" TEXT NOT NULL DEFAULT 'AVISO',
    "titulo" TEXT NOT NULL,
    "descricao" TEXT NOT NULL,
    "dados" TEXT,
    "referenciaId" TEXT,
    "referenciaTipo" TEXT,
    "lido" BOOLEAN NOT NULL DEFAULT false,
    "resolvido" BOOLEAN NOT NULL DEFAULT false,
    "dataVencimento" TIMESTAMP(3),
    "officeId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fiscal_alertas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefreshToken" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "officeId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "replacedBy" TEXT,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isRevoked" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "RefreshToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TokenBlacklist" (
    "id" TEXT NOT NULL,
    "jti" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "officeId" TEXT NOT NULL,
    "reason" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TokenBlacklist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cash_sessions" (
    "id" TEXT NOT NULL,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "initialBalance" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "finalBalance" DECIMAL(65,30),
    "expectedBalance" DECIMAL(65,30),
    "status" TEXT NOT NULL DEFAULT 'ABERTO',
    "obs" TEXT,
    "userId" TEXT NOT NULL,
    "officeId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cash_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cash_movements" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "amount" DECIMAL(65,30) NOT NULL,
    "description" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "officeId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cash_movements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "offices_cnpj_key" ON "offices"("cnpj");

-- CreateIndex
CREATE INDEX "offices_active_deleted_idx" ON "offices"("active", "deleted");

-- CreateIndex
CREATE INDEX "users_officeId_idx" ON "users"("officeId");

-- CreateIndex
CREATE INDEX "users_active_deleted_idx" ON "users"("active", "deleted");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_officeId_key" ON "users"("email", "officeId");

-- CreateIndex
CREATE UNIQUE INDEX "sequencers_officeId_entity_key" ON "sequencers"("officeId", "entity");

-- CreateIndex
CREATE INDEX "clients_officeId_idx" ON "clients"("officeId");

-- CreateIndex
CREATE INDEX "clients_name_idx" ON "clients"("name");

-- CreateIndex
CREATE INDEX "clients_deleted_idx" ON "clients"("deleted");

-- CreateIndex
CREATE UNIQUE INDEX "clients_cpfCnpj_officeId_key" ON "clients"("cpfCnpj", "officeId");

-- CreateIndex
CREATE INDEX "vehicles_clientId_idx" ON "vehicles"("clientId");

-- CreateIndex
CREATE INDEX "vehicles_officeId_idx" ON "vehicles"("officeId");

-- CreateIndex
CREATE UNIQUE INDEX "vehicles_plate_officeId_key" ON "vehicles"("plate", "officeId");

-- CreateIndex
CREATE INDEX "service_orders_officeId_idx" ON "service_orders"("officeId");

-- CreateIndex
CREATE INDEX "service_orders_clientId_idx" ON "service_orders"("clientId");

-- CreateIndex
CREATE INDEX "service_orders_vehicleId_idx" ON "service_orders"("vehicleId");

-- CreateIndex
CREATE INDEX "service_orders_status_idx" ON "service_orders"("status");

-- CreateIndex
CREATE INDEX "service_orders_createdAt_idx" ON "service_orders"("createdAt");

-- CreateIndex
CREATE INDEX "service_orders_officeId_status_idx" ON "service_orders"("officeId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "service_orders_number_officeId_key" ON "service_orders"("number", "officeId");

-- CreateIndex
CREATE INDEX "service_order_items_serviceOrderId_idx" ON "service_order_items"("serviceOrderId");

-- CreateIndex
CREATE INDEX "service_order_items_mechanicId_idx" ON "service_order_items"("mechanicId");

-- CreateIndex
CREATE INDEX "service_order_items_officeId_idx" ON "service_order_items"("officeId");

-- CreateIndex
CREATE INDEX "mechanics_officeId_idx" ON "mechanics"("officeId");

-- CreateIndex
CREATE INDEX "mechanics_active_deleted_idx" ON "mechanics"("active", "deleted");

-- CreateIndex
CREATE UNIQUE INDEX "mechanics_cpf_officeId_key" ON "mechanics"("cpf", "officeId");

-- CreateIndex
CREATE INDEX "parts_officeId_idx" ON "parts"("officeId");

-- CreateIndex
CREATE INDEX "parts_supplierId_idx" ON "parts"("supplierId");

-- CreateIndex
CREATE INDEX "parts_description_idx" ON "parts"("description");

-- CreateIndex
CREATE INDEX "parts_ncm_idx" ON "parts"("ncm");

-- CreateIndex
CREATE UNIQUE INDEX "parts_sku_officeId_key" ON "parts"("sku", "officeId");

-- CreateIndex
CREATE INDEX "stock_movements_partId_idx" ON "stock_movements"("partId");

-- CreateIndex
CREATE INDEX "stock_movements_officeId_idx" ON "stock_movements"("officeId");

-- CreateIndex
CREATE INDEX "stock_movements_type_idx" ON "stock_movements"("type");

-- CreateIndex
CREATE INDEX "stock_movements_createdAt_idx" ON "stock_movements"("createdAt");

-- CreateIndex
CREATE INDEX "suppliers_officeId_idx" ON "suppliers"("officeId");

-- CreateIndex
CREATE INDEX "suppliers_razaoSocial_idx" ON "suppliers"("razaoSocial");

-- CreateIndex
CREATE UNIQUE INDEX "suppliers_cnpj_officeId_key" ON "suppliers"("cnpj", "officeId");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_chave_key" ON "invoices"("chave");

-- CreateIndex
CREATE INDEX "invoices_officeId_idx" ON "invoices"("officeId");

-- CreateIndex
CREATE INDEX "invoices_supplierId_idx" ON "invoices"("supplierId");

-- CreateIndex
CREATE INDEX "invoices_status_idx" ON "invoices"("status");

-- CreateIndex
CREATE INDEX "invoices_dataEmissao_idx" ON "invoices"("dataEmissao");

-- CreateIndex
CREATE INDEX "invoices_officeId_status_idx" ON "invoices"("officeId", "status");

-- CreateIndex
CREATE INDEX "invoice_items_invoiceId_idx" ON "invoice_items"("invoiceId");

-- CreateIndex
CREATE INDEX "invoice_items_partId_idx" ON "invoice_items"("partId");

-- CreateIndex
CREATE INDEX "invoice_items_officeId_idx" ON "invoice_items"("officeId");

-- CreateIndex
CREATE UNIQUE INDEX "receptions_invoiceId_key" ON "receptions"("invoiceId");

-- CreateIndex
CREATE INDEX "receptions_officeId_idx" ON "receptions"("officeId");

-- CreateIndex
CREATE INDEX "receptions_status_idx" ON "receptions"("status");

-- CreateIndex
CREATE INDEX "financial_entries_officeId_idx" ON "financial_entries"("officeId");

-- CreateIndex
CREATE INDEX "financial_entries_status_idx" ON "financial_entries"("status");

-- CreateIndex
CREATE INDEX "financial_entries_type_idx" ON "financial_entries"("type");

-- CreateIndex
CREATE INDEX "financial_entries_dueDate_idx" ON "financial_entries"("dueDate");

-- CreateIndex
CREATE INDEX "financial_entries_officeId_status_idx" ON "financial_entries"("officeId", "status");

-- CreateIndex
CREATE INDEX "financial_entries_officeId_type_status_idx" ON "financial_entries"("officeId", "type", "status");

-- CreateIndex
CREATE INDEX "financial_entries_supplierId_idx" ON "financial_entries"("supplierId");

-- CreateIndex
CREATE INDEX "financial_entries_saleId_idx" ON "financial_entries"("saleId");

-- CreateIndex
CREATE INDEX "financial_entries_invoiceId_idx" ON "financial_entries"("invoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_subscriptionCode_key" ON "subscriptions"("subscriptionCode");

-- CreateIndex
CREATE INDEX "subscriptions_status_idx" ON "subscriptions"("status");

-- CreateIndex
CREATE INDEX "notifications_officeId_idx" ON "notifications"("officeId");

-- CreateIndex
CREATE INDEX "notifications_status_idx" ON "notifications"("status");

-- CreateIndex
CREATE INDEX "notifications_serviceOrderId_idx" ON "notifications"("serviceOrderId");

-- CreateIndex
CREATE INDEX "notifications_createdAt_idx" ON "notifications"("createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_officeId_idx" ON "audit_logs"("officeId");

-- CreateIndex
CREATE INDEX "audit_logs_entity_idx" ON "audit_logs"("entity");

-- CreateIndex
CREATE INDEX "audit_logs_entityId_idx" ON "audit_logs"("entityId");

-- CreateIndex
CREATE INDEX "audit_logs_userId_idx" ON "audit_logs"("userId");

-- CreateIndex
CREATE INDEX "audit_logs_createdAt_idx" ON "audit_logs"("createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_officeId_entity_createdAt_idx" ON "audit_logs"("officeId", "entity", "createdAt");

-- CreateIndex
CREATE INDEX "tax_rules_officeId_idx" ON "tax_rules"("officeId");

-- CreateIndex
CREATE INDEX "tax_rules_ncm_idx" ON "tax_rules"("ncm");

-- CreateIndex
CREATE UNIQUE INDEX "tax_rules_ncm_cfop_state_officeId_key" ON "tax_rules"("ncm", "cfop", "state", "officeId");

-- CreateIndex
CREATE INDEX "ai_chats_officeId_idx" ON "ai_chats"("officeId");

-- CreateIndex
CREATE INDEX "ai_chats_createdAt_idx" ON "ai_chats"("createdAt");

-- CreateIndex
CREATE INDEX "client_invoices_officeId_idx" ON "client_invoices"("officeId");

-- CreateIndex
CREATE INDEX "client_invoices_clientId_idx" ON "client_invoices"("clientId");

-- CreateIndex
CREATE INDEX "client_invoices_status_idx" ON "client_invoices"("status");

-- CreateIndex
CREATE INDEX "client_invoices_dataEmissao_idx" ON "client_invoices"("dataEmissao");

-- CreateIndex
CREATE INDEX "client_invoices_chave_idx" ON "client_invoices"("chave");

-- CreateIndex
CREATE UNIQUE INDEX "client_invoices_number_officeId_key" ON "client_invoices"("number", "officeId");

-- CreateIndex
CREATE INDEX "client_invoice_items_clientInvoiceId_idx" ON "client_invoice_items"("clientInvoiceId");

-- CreateIndex
CREATE INDEX "client_invoice_items_partId_idx" ON "client_invoice_items"("partId");

-- CreateIndex
CREATE INDEX "client_invoice_items_officeId_idx" ON "client_invoice_items"("officeId");

-- CreateIndex
CREATE UNIQUE INDEX "seed_control_module_key" ON "seed_control"("module");

-- CreateIndex
CREATE INDEX "sales_officeId_idx" ON "sales"("officeId");

-- CreateIndex
CREATE INDEX "sales_clientId_idx" ON "sales"("clientId");

-- CreateIndex
CREATE INDEX "sales_userId_idx" ON "sales"("userId");

-- CreateIndex
CREATE INDEX "sales_cashSessionId_idx" ON "sales"("cashSessionId");

-- CreateIndex
CREATE INDEX "sales_status_idx" ON "sales"("status");

-- CreateIndex
CREATE INDEX "sales_createdAt_idx" ON "sales"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "sales_number_officeId_key" ON "sales"("number", "officeId");

-- CreateIndex
CREATE INDEX "sale_items_saleId_idx" ON "sale_items"("saleId");

-- CreateIndex
CREATE INDEX "sale_items_partId_idx" ON "sale_items"("partId");

-- CreateIndex
CREATE INDEX "sale_items_officeId_idx" ON "sale_items"("officeId");

-- CreateIndex
CREATE INDEX "sefaz_consultas_chave_idx" ON "sefaz_consultas"("chave");

-- CreateIndex
CREATE INDEX "sefaz_consultas_officeId_idx" ON "sefaz_consultas"("officeId");

-- CreateIndex
CREATE INDEX "sefaz_consultas_status_idx" ON "sefaz_consultas"("status");

-- CreateIndex
CREATE INDEX "certificados_digitais_officeId_idx" ON "certificados_digitais"("officeId");

-- CreateIndex
CREATE INDEX "certificados_digitais_ativo_idx" ON "certificados_digitais"("ativo");

-- CreateIndex
CREATE INDEX "certificados_digitais_validade_idx" ON "certificados_digitais"("validade");

-- CreateIndex
CREATE INDEX "manifestacoes_destinatario_chave_idx" ON "manifestacoes_destinatario"("chave");

-- CreateIndex
CREATE INDEX "manifestacoes_destinatario_officeId_idx" ON "manifestacoes_destinatario"("officeId");

-- CreateIndex
CREATE INDEX "manifestacoes_destinatario_tipoEvento_idx" ON "manifestacoes_destinatario"("tipoEvento");

-- CreateIndex
CREATE INDEX "manifestacoes_destinatario_status_idx" ON "manifestacoes_destinatario"("status");

-- CreateIndex
CREATE UNIQUE INDEX "conhecimentos_transporte_chave_key" ON "conhecimentos_transporte"("chave");

-- CreateIndex
CREATE INDEX "conhecimentos_transporte_chave_idx" ON "conhecimentos_transporte"("chave");

-- CreateIndex
CREATE INDEX "conhecimentos_transporte_officeId_idx" ON "conhecimentos_transporte"("officeId");

-- CreateIndex
CREATE INDEX "conhecimentos_transporte_emitenteCnpj_idx" ON "conhecimentos_transporte"("emitenteCnpj");

-- CreateIndex
CREATE INDEX "conhecimentos_transporte_status_idx" ON "conhecimentos_transporte"("status");

-- CreateIndex
CREATE INDEX "nfse_servicos_officeId_idx" ON "nfse_servicos"("officeId");

-- CreateIndex
CREATE INDEX "nfse_servicos_numero_idx" ON "nfse_servicos"("numero");

-- CreateIndex
CREATE INDEX "nfse_servicos_dataEmissao_idx" ON "nfse_servicos"("dataEmissao");

-- CreateIndex
CREATE INDEX "nfse_servicos_status_idx" ON "nfse_servicos"("status");

-- CreateIndex
CREATE INDEX "nfse_servicos_competencia_idx" ON "nfse_servicos"("competencia");

-- CreateIndex
CREATE INDEX "sped_registros_officeId_periodo_idx" ON "sped_registros"("officeId", "periodo");

-- CreateIndex
CREATE INDEX "sped_registros_bloco_idx" ON "sped_registros"("bloco");

-- CreateIndex
CREATE INDEX "sped_registros_registro_idx" ON "sped_registros"("registro");

-- CreateIndex
CREATE INDEX "fiscal_alertas_officeId_lido_resolvido_idx" ON "fiscal_alertas"("officeId", "lido", "resolvido");

-- CreateIndex
CREATE INDEX "fiscal_alertas_tipo_idx" ON "fiscal_alertas"("tipo");

-- CreateIndex
CREATE INDEX "fiscal_alertas_dataVencimento_idx" ON "fiscal_alertas"("dataVencimento");

-- CreateIndex
CREATE INDEX "fiscal_alertas_severidade_idx" ON "fiscal_alertas"("severidade");

-- CreateIndex
CREATE UNIQUE INDEX "RefreshToken_token_key" ON "RefreshToken"("token");

-- CreateIndex
CREATE INDEX "RefreshToken_userId_idx" ON "RefreshToken"("userId");

-- CreateIndex
CREATE INDEX "RefreshToken_token_idx" ON "RefreshToken"("token");

-- CreateIndex
CREATE INDEX "RefreshToken_expiresAt_idx" ON "RefreshToken"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "TokenBlacklist_jti_key" ON "TokenBlacklist"("jti");

-- CreateIndex
CREATE INDEX "TokenBlacklist_jti_idx" ON "TokenBlacklist"("jti");

-- CreateIndex
CREATE INDEX "TokenBlacklist_expiresAt_idx" ON "TokenBlacklist"("expiresAt");

-- CreateIndex
CREATE INDEX "cash_sessions_officeId_idx" ON "cash_sessions"("officeId");

-- CreateIndex
CREATE INDEX "cash_sessions_userId_idx" ON "cash_sessions"("userId");

-- CreateIndex
CREATE INDEX "cash_sessions_status_idx" ON "cash_sessions"("status");

-- CreateIndex
CREATE INDEX "cash_movements_sessionId_idx" ON "cash_movements"("sessionId");

-- CreateIndex
CREATE INDEX "cash_movements_officeId_idx" ON "cash_movements"("officeId");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_officeId_fkey" FOREIGN KEY ("officeId") REFERENCES "offices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sequencers" ADD CONSTRAINT "sequencers_officeId_fkey" FOREIGN KEY ("officeId") REFERENCES "offices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clients" ADD CONSTRAINT "clients_officeId_fkey" FOREIGN KEY ("officeId") REFERENCES "offices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_orders" ADD CONSTRAINT "service_orders_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_orders" ADD CONSTRAINT "service_orders_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "vehicles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_orders" ADD CONSTRAINT "service_orders_officeId_fkey" FOREIGN KEY ("officeId") REFERENCES "offices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_order_items" ADD CONSTRAINT "service_order_items_mechanicId_fkey" FOREIGN KEY ("mechanicId") REFERENCES "mechanics"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_order_items" ADD CONSTRAINT "service_order_items_serviceOrderId_fkey" FOREIGN KEY ("serviceOrderId") REFERENCES "service_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mechanics" ADD CONSTRAINT "mechanics_officeId_fkey" FOREIGN KEY ("officeId") REFERENCES "offices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parts" ADD CONSTRAINT "parts_officeId_fkey" FOREIGN KEY ("officeId") REFERENCES "offices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parts" ADD CONSTRAINT "parts_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_partId_fkey" FOREIGN KEY ("partId") REFERENCES "parts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_officeId_fkey" FOREIGN KEY ("officeId") REFERENCES "offices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_officeId_fkey" FOREIGN KEY ("officeId") REFERENCES "offices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_officeId_fkey" FOREIGN KEY ("officeId") REFERENCES "offices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_partId_fkey" FOREIGN KEY ("partId") REFERENCES "parts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_officeId_fkey" FOREIGN KEY ("officeId") REFERENCES "offices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receptions" ADD CONSTRAINT "receptions_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receptions" ADD CONSTRAINT "receptions_officeId_fkey" FOREIGN KEY ("officeId") REFERENCES "offices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_entries" ADD CONSTRAINT "financial_entries_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_entries" ADD CONSTRAINT "financial_entries_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_entries" ADD CONSTRAINT "financial_entries_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "sales"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_entries" ADD CONSTRAINT "financial_entries_officeId_fkey" FOREIGN KEY ("officeId") REFERENCES "offices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_officeId_fkey" FOREIGN KEY ("officeId") REFERENCES "offices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_serviceOrderId_fkey" FOREIGN KEY ("serviceOrderId") REFERENCES "service_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_officeId_fkey" FOREIGN KEY ("officeId") REFERENCES "offices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_officeId_fkey" FOREIGN KEY ("officeId") REFERENCES "offices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_rules" ADD CONSTRAINT "tax_rules_officeId_fkey" FOREIGN KEY ("officeId") REFERENCES "offices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_chats" ADD CONSTRAINT "ai_chats_officeId_fkey" FOREIGN KEY ("officeId") REFERENCES "offices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_invoices" ADD CONSTRAINT "client_invoices_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "sales"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_invoices" ADD CONSTRAINT "client_invoices_serviceOrderId_fkey" FOREIGN KEY ("serviceOrderId") REFERENCES "service_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_invoices" ADD CONSTRAINT "client_invoices_officeId_fkey" FOREIGN KEY ("officeId") REFERENCES "offices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_invoices" ADD CONSTRAINT "client_invoices_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_invoice_items" ADD CONSTRAINT "client_invoice_items_clientInvoiceId_fkey" FOREIGN KEY ("clientInvoiceId") REFERENCES "client_invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_cashSessionId_fkey" FOREIGN KEY ("cashSessionId") REFERENCES "cash_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_officeId_fkey" FOREIGN KEY ("officeId") REFERENCES "offices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "sales"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sefaz_consultas" ADD CONSTRAINT "sefaz_consultas_officeId_fkey" FOREIGN KEY ("officeId") REFERENCES "offices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "certificados_digitais" ADD CONSTRAINT "certificados_digitais_officeId_fkey" FOREIGN KEY ("officeId") REFERENCES "offices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manifestacoes_destinatario" ADD CONSTRAINT "manifestacoes_destinatario_officeId_fkey" FOREIGN KEY ("officeId") REFERENCES "offices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conhecimentos_transporte" ADD CONSTRAINT "conhecimentos_transporte_officeId_fkey" FOREIGN KEY ("officeId") REFERENCES "offices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conhecimentos_transporte" ADD CONSTRAINT "conhecimentos_transporte_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nfse_servicos" ADD CONSTRAINT "nfse_servicos_officeId_fkey" FOREIGN KEY ("officeId") REFERENCES "offices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nfse_servicos" ADD CONSTRAINT "nfse_servicos_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sped_registros" ADD CONSTRAINT "sped_registros_officeId_fkey" FOREIGN KEY ("officeId") REFERENCES "offices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fiscal_alertas" ADD CONSTRAINT "fiscal_alertas_officeId_fkey" FOREIGN KEY ("officeId") REFERENCES "offices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_officeId_fkey" FOREIGN KEY ("officeId") REFERENCES "offices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_sessions" ADD CONSTRAINT "cash_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_sessions" ADD CONSTRAINT "cash_sessions_officeId_fkey" FOREIGN KEY ("officeId") REFERENCES "offices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "cash_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_officeId_fkey" FOREIGN KEY ("officeId") REFERENCES "offices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
