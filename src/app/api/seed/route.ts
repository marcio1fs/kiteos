import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { hashPassword, requireAuth } from '@/lib/auth';

export async function POST(request: NextRequest) {
  try {
    if (process.env.NODE_ENV === 'production') {
      return NextResponse.json(
        { success: false, error: 'Rota indisponível em ambiente de produção' },
        { status: 403 }
      );
    }
    // ============================================================================
    // SECURITY FIX: Added authentication check — was completely unauthenticated!
    // Any request could create an admin account with known credentials.
    // ============================================================================
    const auth = await requireAuth(request, undefined, 'OWNER');
    if (!auth.payload) {
      return NextResponse.json(
        { success: false, error: 'Apenas OWNER pode carregar dados demo' },
        { status: 403 }
      );
    }
    // Check if already seeded
    const seedControl = await db.seedControl.findUnique({
      where: { module: 'demo_data' },
    });

    if (seedControl?.seeded) {
      return NextResponse.json(
        { success: false, error: 'Dados demo já foram carregados' },
        { status: 409 }
      );
    }

    // SECURITY FIX (AUD-05): Use strong passwords for demo data
    const adminPassword = await hashPassword('KiteOS@Demo2024!');

    // ==========================================
    // Create Demo Office
    // ==========================================
    const office = await db.office.create({
      data: {
        name: 'Oficina Central',
        cnpj: '12345678000190',
        email: 'contato@oficinacentral.com.br',
        phone: '(71) 99999-0001',
        address: 'Rua das Oficinas, 1500',
        city: 'Salvador',
        state: 'BA',
        zipCode: '40000-000',
      },
    });

    // ==========================================
    // Create Demo Owner User
    // ==========================================
    const owner = await db.user.create({
      data: {
        name: 'Admin KiteOS',
        email: 'admin@kiteos.com',
        password: adminPassword,
        role: 'OWNER',
        officeId: office.id,
      },
    });

    // Create additional employees
    await db.user.createMany({
      data: [
        {
          name: 'Carlos Mecânico',
          email: 'carlos@kiteos.com',
          password: await hashPassword('KiteOS@Func2024!'),
          role: 'EMPLOYEE',
          officeId: office.id,
        },
        {
          name: 'Maria Atendente',
          email: 'maria@kiteos.com',
          password: await hashPassword('KiteOS@Func2024!'),
          role: 'EMPLOYEE',
          officeId: office.id,
        },
      ],
    });

    // ==========================================
    // Create Demo Subscription (PRO plan)
    // ==========================================
    await db.subscription.create({
      data: {
        plan: 'PRO',
        status: 'ATIVA',
        startDate: new Date(),
        monthlyPrice: 149.90,
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        officeId: office.id,
      },
    });

    // ==========================================
    // Create Demo Clients
    // ==========================================
    const clientsData = [
      {
        name: 'João Silva',
        cpfCnpj: '12345678901',
        email: 'joao.silva@email.com',
        phone: '(71) 98888-1001',
        address: 'Rua das Flores, 100',
        city: 'Salvador',
        state: 'BA',
        zipCode: '40100-000',
        vehicles: [
          { plate: 'ABC-1D23', brand: 'Toyota', model: 'Corolla', year: 2022, color: 'Prata', km: 25000 },
          { plate: 'DEF-4G56', brand: 'Honda', model: 'Civic', year: 2020, color: 'Preto', km: 45000 },
        ],
      },
      {
        name: 'Maria Oliveira',
        cpfCnpj: '98765432100',
        email: 'maria.oliveira@email.com',
        phone: '(71) 98888-1002',
        address: 'Av. Atlântica, 250',
        city: 'Salvador',
        state: 'BA',
        zipCode: '40200-000',
        vehicles: [
          { plate: 'GHI-7H89', brand: 'Volkswagen', model: 'Gol', year: 2019, color: 'Branco', km: 60000 },
        ],
      },
      {
        name: 'Pedro Santos',
        cpfCnpj: '45678912300',
        email: 'pedro.santos@email.com',
        phone: '(71) 98888-1003',
        address: 'Rua do Comércio, 80',
        city: 'Lauro de Freitas',
        state: 'BA',
        zipCode: '42700-000',
        vehicles: [
          { plate: 'JKL-0I12', brand: 'Fiat', model: 'Uno', year: 2018, color: 'Vermelho', km: 78000 },
          { plate: 'MNO-3J45', brand: 'Chevrolet', model: 'Onix', year: 2021, color: 'Cinza', km: 32000 },
        ],
      },
      {
        name: 'Ana Costa',
        cpfCnpj: '32165498700',
        email: 'ana.costa@email.com',
        phone: '(71) 98888-1004',
        address: 'Rua da Paz, 45',
        city: 'Camaçari',
        state: 'BA',
        zipCode: '42800-000',
        vehicles: [
          { plate: 'PQR-6K78', brand: 'Hyundai', model: 'HB20', year: 2023, color: 'Azul', km: 12000 },
        ],
      },
      {
        name: 'Roberto Ferreira ME',
        cpfCnpj: '11222333000144',
        email: 'roberto.ferreira@empresa.com',
        phone: '(71) 98888-1005',
        address: 'Av. Industrial, 1000',
        city: 'Salvador',
        state: 'BA',
        zipCode: '40300-000',
        vehicles: [
          { plate: 'STU-9L01', brand: 'Fiat', model: 'Strada', year: 2021, color: 'Branco', km: 55000 },
          { plate: 'VWX-2M34', brand: 'Volkswagen', model: 'Saveiro', year: 2020, color: 'Prata', km: 68000 },
          { plate: 'YZA-5N67', brand: 'Chevrolet', model: 'S10', year: 2022, color: 'Preto', km: 40000 },
        ],
      },
    ];

    const createdClients: { id: string; name: string; email: string | null; phone: string | null; [key: string]: unknown }[] = [];
    for (const clientData of clientsData) {
      const { vehicles, ...clientFields } = clientData;
      const client = await db.client.create({
        data: {
          ...clientFields,
          officeId: office.id,
        },
      });

      // Create vehicles for this client
      for (const vehicleData of vehicles) {
        await db.vehicle.create({
          data: {
            ...vehicleData,
            clientId: client.id,
            officeId: office.id,
          },
        });
      }

      createdClients.push(client);
    }

    // ==========================================
    // Create Demo Suppliers
    // ==========================================
    const suppliersData = [
      {
        cnpj: '11111111000111',
        razaoSocial: 'Auto Peças Bahia Ltda',
        nomeFantasia: 'Auto Peças Bahia',
        email: 'vendas@autopecasbahia.com.br',
        phone: '(71) 3344-5500',
        address: 'Rua das Peças, 500',
        city: 'Salvador',
        state: 'BA',
        zipCode: '40500-000',
        ie: '12345678',
      },
      {
        cnpj: '22222222000122',
        razaoSocial: 'Distribuidora Nacional de Auto Peças S/A',
        nomeFantasia: 'DNAP Distribuidora',
        email: 'pedidos@dnap.com.br',
        phone: '(11) 4002-8922',
        address: 'Av. Paulista, 2000',
        city: 'São Paulo',
        state: 'SP',
        zipCode: '01310-000',
        ie: '87654321',
      },
      {
        cnpj: '33333333000133',
        razaoSocial: 'Lubrificantes do Nordeste Ltda',
        nomeFantasia: 'Lube Nordeste',
        email: 'comercial@lubene.com.br',
        phone: '(71) 3344-6600',
        address: 'Rod. BA-528, Km 12',
        city: 'Camaçari',
        state: 'BA',
        zipCode: '42800-000',
        ie: '11223344',
      },
      {
        cnpj: '44444444000144',
        razaoSocial: 'Pneus e Rodas Ltda',
        nomeFantasia: 'PneuCenter',
        email: 'vendas@pneucenter.com.br',
        phone: '(71) 3344-7700',
        address: 'Av. ACM, 3500',
        city: 'Salvador',
        state: 'BA',
        zipCode: '40600-000',
        ie: '44332211',
      },
    ];

    const createdSuppliers: { id: string; [key: string]: unknown }[] = [];
    for (const supplierData of suppliersData) {
      const supplier = await db.supplier.create({
        data: {
          ...supplierData,
          officeId: office.id,
        },
      });
      createdSuppliers.push(supplier);
    }

    // ==========================================
    // Create Demo Parts
    // ==========================================
    const partsData = [
      // Óleos e Lubrificantes (supplier: Lube Nordeste)
      { sku: 'OL-MOB-5W30-4L', description: 'Óleo Motor Mobil 5W30 4L', ncm: '27101932', cfop: '5102', unit: 'UN', quantity: 20, minQuantity: 5, costPrice: 85.00, salePrice: 120.00, location: 'Prateleira A1', supplierId: createdSuppliers[2].id },
      { sku: 'OL-MOB-10W40-4L', description: 'Óleo Motor Mobil 10W40 4L', ncm: '27101932', cfop: '5102', unit: 'UN', quantity: 15, minQuantity: 5, costPrice: 72.00, salePrice: 105.00, location: 'Prateleira A1', supplierId: createdSuppliers[2].id },
      { sku: 'OL-LUB-80W90-1L', description: 'Óleo Câmbio 80W90 1L', ncm: '27101932', cfop: '5102', unit: 'UN', quantity: 10, minQuantity: 3, costPrice: 28.00, salePrice: 45.00, location: 'Prateleira A2', supplierId: createdSuppliers[2].id },
      { sku: 'GX-UNIV-DX3', description: 'Graxa Universal DX3 500g', ncm: '27101999', cfop: '5102', unit: 'UN', quantity: 12, minQuantity: 3, costPrice: 15.00, salePrice: 25.00, location: 'Prateleira A3', supplierId: createdSuppliers[2].id },

      // Filtros (supplier: Auto Peças Bahia)
      { sku: 'FT-OLEO-UNIV', description: 'Filtro de Óleo Universal', ncm: '84212300', cfop: '5102', unit: 'UN', quantity: 25, minQuantity: 10, costPrice: 18.00, salePrice: 35.00, location: 'Prateleira B1', supplierId: createdSuppliers[0].id },
      { sku: 'FT-AR-COROLLA', description: 'Filtro de Ar Toyota Corolla 2020+', ncm: '84213100', cfop: '5102', unit: 'UN', quantity: 8, minQuantity: 3, costPrice: 35.00, salePrice: 65.00, location: 'Prateleira B1', supplierId: createdSuppliers[0].id },
      { sku: 'FT-COMB-GOL', description: 'Filtro de Combustível VW Gol', ncm: '84212300', cfop: '5102', unit: 'UN', quantity: 10, minQuantity: 4, costPrice: 22.00, salePrice: 42.00, location: 'Prateleira B2', supplierId: createdSuppliers[0].id },
      { sku: 'FT-CABINE-ONIX', description: 'Filtro de Cabine Chevrolet Onix', ncm: '84213900', cfop: '5102', unit: 'UN', quantity: 6, minQuantity: 2, costPrice: 30.00, salePrice: 55.00, location: 'Prateleira B2', supplierId: createdSuppliers[0].id },

      // Freios (supplier: DNAP)
      { sku: 'PD-FREIO-COROLLA', description: 'Pastilha de Freio Dianteira Toyota Corolla', ncm: '87083000', cfop: '5102', unit: 'JG', quantity: 6, minQuantity: 2, costPrice: 95.00, salePrice: 180.00, location: 'Prateleira C1', supplierId: createdSuppliers[1].id },
      { sku: 'PD-FREIO-GOL', description: 'Pastilha de Freio Dianteira VW Gol', ncm: '87083000', cfop: '5102', unit: 'JG', quantity: 8, minQuantity: 3, costPrice: 55.00, salePrice: 110.00, location: 'Prateleira C1', supplierId: createdSuppliers[1].id },
      { sku: 'DS-FREIO-ONIX', description: 'Disco de Freio Chevrolet Onix', ncm: '87083000', cfop: '5102', unit: 'UN', quantity: 4, minQuantity: 2, costPrice: 120.00, salePrice: 220.00, location: 'Prateleira C2', supplierId: createdSuppliers[1].id },
      { sku: 'LT-FREIO-UNIV', description: 'Líquido de Freio DOT4 500ml', ncm: '38119000', cfop: '5102', unit: 'UN', quantity: 15, minQuantity: 5, costPrice: 18.00, salePrice: 32.00, location: 'Prateleira C3', supplierId: createdSuppliers[1].id },

      // Pneus (supplier: PneuCenter)
      { sku: 'PN-19565R15', description: 'Pneu 195/65R15 Aro 15', ncm: '40111000', cfop: '5102', unit: 'UN', quantity: 8, minQuantity: 4, costPrice: 280.00, salePrice: 420.00, location: 'Depósito Externo', supplierId: createdSuppliers[3].id },
      { sku: 'PN-20555R16', description: 'Pneu 205/55R16 Aro 16', ncm: '40111000', cfop: '5102', unit: 'UN', quantity: 6, minQuantity: 4, costPrice: 320.00, salePrice: 480.00, location: 'Depósito Externo', supplierId: createdSuppliers[3].id },

      // Correias e Componentes (supplier: Auto Peças Bahia)
      { sku: 'CR-DENT-COROLLA', description: 'Correia Dentada Toyota Corolla', ncm: '40103500', cfop: '5102', unit: 'UN', quantity: 4, minQuantity: 2, costPrice: 75.00, salePrice: 140.00, location: 'Prateleira D1', supplierId: createdSuppliers[0].id },
      { sku: 'VL-ALTERN-CIVIC', description: 'Vela de Ignição Honda Civic Iridium', ncm: '85111000', cfop: '5102', unit: 'UN', quantity: 20, minQuantity: 8, costPrice: 38.00, salePrice: 65.00, location: 'Prateleira D2', supplierId: createdSuppliers[0].id },
      { sku: 'BT-60AH', description: 'Bateria 60Ah Moura', ncm: '85071000', cfop: '5102', unit: 'UN', quantity: 5, minQuantity: 2, costPrice: 280.00, salePrice: 450.00, location: 'Depósito Externo', supplierId: createdSuppliers[0].id },

      // Amortecedores (supplier: DNAP)
      { sku: 'AM-DIANT-GOL', description: 'Amortecedor Dianteiro VW Gol', ncm: '87088000', cfop: '5102', unit: 'UN', quantity: 4, minQuantity: 2, costPrice: 130.00, salePrice: 240.00, location: 'Prateleira E1', supplierId: createdSuppliers[1].id },
    ];

    for (const partData of partsData) {
      await db.part.create({
        data: {
          ...partData,
          officeId: office.id,
        },
      });
    }

    // ==========================================
    // Create Demo Tax Rules (Brazilian NCM)
    // ==========================================
    const taxRulesData = [
      // Óleos lubrificantes
      { ncm: '27101932', cfop: '5102', cst: '00', csosn: '101', aliqIcms: 18.0, aliqIpi: 0, aliqPis: 1.65, aliqCofins: 7.60, state: 'BA' },
      { ncm: '27101999', cfop: '5102', cst: '00', csosn: '101', aliqIcms: 18.0, aliqIpi: 0, aliqPis: 1.65, aliqCofins: 7.60, state: 'BA' },

      // Filtros
      { ncm: '84212300', cfop: '5102', cst: '00', csosn: '101', aliqIcms: 18.0, aliqIpi: 5.0, aliqPis: 1.65, aliqCofins: 7.60, state: 'BA' },
      { ncm: '84213100', cfop: '5102', cst: '00', csosn: '101', aliqIcms: 18.0, aliqIpi: 5.0, aliqPis: 1.65, aliqCofins: 7.60, state: 'BA' },
      { ncm: '84213900', cfop: '5102', cst: '00', csosn: '101', aliqIcms: 18.0, aliqIpi: 5.0, aliqPis: 1.65, aliqCofins: 7.60, state: 'BA' },

      // Peças de freio
      { ncm: '87083000', cfop: '5102', cst: '00', csosn: '101', aliqIcms: 18.0, aliqIpi: 10.0, aliqPis: 1.65, aliqCofins: 7.60, state: 'BA' },

      // Pneus
      { ncm: '40111000', cfop: '5102', cst: '00', csosn: '101', aliqIcms: 18.0, aliqIpi: 5.0, aliqPis: 1.65, aliqCofins: 7.60, state: 'BA' },

      // Correias
      { ncm: '40103500', cfop: '5102', cst: '00', csosn: '101', aliqIcms: 18.0, aliqIpi: 10.0, aliqPis: 1.65, aliqCofins: 7.60, state: 'BA' },

      // Velas
      { ncm: '85111000', cfop: '5102', cst: '00', csosn: '101', aliqIcms: 18.0, aliqIpi: 10.0, aliqPis: 1.65, aliqCofins: 7.60, state: 'BA' },

      // Baterias
      { ncm: '85071000', cfop: '5102', cst: '00', csosn: '101', aliqIcms: 18.0, aliqIpi: 5.0, aliqPis: 1.65, aliqCofins: 7.60, state: 'BA' },

      // Amortecedores
      { ncm: '87088000', cfop: '5102', cst: '00', csosn: '101', aliqIcms: 18.0, aliqIpi: 10.0, aliqPis: 1.65, aliqCofins: 7.60, state: 'BA' },

      // Líquido de freio
      { ncm: '38119000', cfop: '5102', cst: '00', csosn: '101', aliqIcms: 18.0, aliqIpi: 5.0, aliqPis: 1.65, aliqCofins: 7.60, state: 'BA' },

      // Entrada de mercadorias (CFOP 1102)
      { ncm: '87083000', cfop: '1102', cst: '00', csosn: '101', aliqIcms: 18.0, aliqIpi: 10.0, aliqPis: 1.65, aliqCofins: 7.60, state: 'BA' },
      { ncm: '84212300', cfop: '1102', cst: '00', csosn: '101', aliqIcms: 18.0, aliqIpi: 5.0, aliqPis: 1.65, aliqCofins: 7.60, state: 'BA' },
      { ncm: '27101932', cfop: '1102', cst: '00', csosn: '101', aliqIcms: 18.0, aliqIpi: 0, aliqPis: 1.65, aliqCofins: 7.60, state: 'BA' },
    ];

    for (const taxRuleData of taxRulesData) {
      // SECURITY FIX (#75): TaxRule now requires officeId - add the office reference
      await db.taxRule.create({
        data: {
          ...taxRuleData,
          officeId: office.id,
        },
      });
    }

    // ==========================================
    // Mark as seeded
    // ==========================================
    await db.seedControl.create({
      data: {
        module: 'demo_data',
        seeded: true,
      },
    });

    // ==========================================
    // Create audit log for seeding
    // ==========================================
    await db.auditLog.create({
      data: {
        action: 'SEED',
        entity: 'System',
        details: JSON.stringify({
          office: office.name,
          owner: owner.email,
          clients: createdClients.length,
          suppliers: createdSuppliers.length,
          parts: partsData.length,
          taxRules: taxRulesData.length,
        }),
        userId: owner.id,
        officeId: office.id,
      },
    });

    // ============================================================================
    // SECURITY FIX: Removed credentials from API response
    // Was exposing admin email + password in plain text
    // ============================================================================
    return NextResponse.json({
      success: true,
      data: {
        message: 'Dados demo carregados com sucesso',
        office: {
          id: office.id,
          name: office.name,
          cnpj: office.cnpj,
        },
        owner: {
          id: owner.id,
          name: owner.name,
        },
        stats: {
          clients: createdClients.length,
          suppliers: createdSuppliers.length,
          parts: partsData.length,
          taxRules: taxRulesData.length,
        },
      },
    }, { status: 201 });
  } catch (error) {
    // SECURITY FIX (#69): Don't expose seed error details
    console.error('Seed error: [REDACTED]');
    return NextResponse.json(
      { success: false, error: 'Erro ao carregar dados demo' },
      { status: 500 }
    );
  }
}
