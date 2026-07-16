import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { signToken, hashPassword, auditLog, validatePasswordStrength } from '@/lib/auth';
import { isValidCNPJ } from '@/lib/server-validators';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      // Office data
      officeName,
      officeCnpj,
      officeEmail,
      officePhone,
      officeAddress,
      officeCity,
      officeState,
      officeZipCode,
      // User data
      userName,
      userEmail,
      userPassword,
    } = body;

    // Validate required fields
    if (!officeName || !officeCnpj || !officeEmail || !userName || !userEmail || !userPassword) {
      return NextResponse.json(
        { success: false, error: 'Campos obrigatórios: nome do escritório, CNPJ, email do escritório, nome do usuário, email do usuário, senha' },
        { status: 400 }
      );
    }

    // ============================================================================
    // SECURITY FIX: Validate email format to prevent invalid data
    // ============================================================================
    const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
    if (!emailRegex.test(userEmail)) {
      return NextResponse.json(
        { success: false, error: 'Email do usuário inválido' },
        { status: 400 }
      );
    }
    if (!emailRegex.test(officeEmail)) {
      return NextResponse.json(
        { success: false, error: 'Email do escritório inválido' },
        { status: 400 }
      );
    }

    // Validate CNPJ format
    if (!isValidCNPJ(officeCnpj)) {
      return NextResponse.json(
        { success: false, error: 'CNPJ inválido' },
        { status: 400 }
      );
    }

    // Check if office CNPJ already exists
    const existingOffice = await db.office.findUnique({
      where: { cnpj: officeCnpj },
    });

    if (existingOffice) {
      return NextResponse.json(
        { success: false, error: 'CNPJ já cadastrado' },
        { status: 409 }
      );
    }

    // Check if user email already exists
    // SECURITY FIX (AUD-04): Use findFirst instead of findUnique — 
    // User model has @@unique([email, officeId]), not @unique on email alone
    const existingUser = await db.user.findFirst({
      where: { email: userEmail.toLowerCase(), deleted: false },
    });

    if (existingUser) {
      return NextResponse.json(
        { success: false, error: 'Email já cadastrado' },
        { status: 409 }
      );
    }

    // ============================================================================
    // SECURITY FIX: Added password strength validation
    // Previously allowed any password like "123" — brute-force friendly
    // ============================================================================
    const passwordStrength = validatePasswordStrength(userPassword);
    if (!passwordStrength.valid) {
      return NextResponse.json(
        { success: false, error: `Senha fraca: ${passwordStrength.errors.join(', ')}` },
        { status: 400 }
      );
    }

    // SECURITY FIX: Added missing `await` on hashPassword
    // Was storing [object Promise] as the password hash, making accounts unusable
    const hashedPassword = await hashPassword(userPassword);

    // Create office with owner user in a transaction
    const result = await db.$transaction(async (tx) => {
      const office = await tx.office.create({
        data: {
          name: officeName,
          cnpj: officeCnpj,
          email: officeEmail,
          phone: officePhone || null,
          address: officeAddress || null,
          city: officeCity || null,
          state: officeState || null,
          zipCode: officeZipCode || null,
        },
      });

      const user = await tx.user.create({
        data: {
          name: userName,
          email: userEmail.toLowerCase(),
          password: hashedPassword,
          role: 'OWNER',
          officeId: office.id,
        },
      });

      // Create FREE subscription
      await tx.subscription.create({
        data: {
          plan: 'FREE',
          status: 'ATIVA',
          startDate: new Date(),
          monthlyPrice: 0,
          officeId: office.id,
        },
      });

      return { office, user };
    });

    // SECURITY FIX: Removed email from token payload (PII exposure)
    const token = await signToken({
      userId: result.user.id,
      role: result.user.role,
      officeId: result.office.id,
    });

    await auditLog({
      action: 'CREATE',
      entity: 'Office',
      entityId: result.office.id,
      details: JSON.stringify({ name: result.office.name, cnpj: result.office.cnpj }),
      userId: result.user.id,
      officeId: result.office.id,
    });

    await auditLog({
      action: 'CREATE',
      entity: 'User',
      entityId: result.user.id,
      details: JSON.stringify({ name: result.user.name, email: result.user.email, role: result.user.role }),
      userId: result.user.id,
      officeId: result.office.id,
    });

    return NextResponse.json({
      success: true,
      data: {
        token,
        user: {
          id: result.user.id,
          name: result.user.name,
          email: result.user.email,
          role: result.user.role,
          officeId: result.user.officeId,
        },
        office: {
          id: result.office.id,
          name: result.office.name,
          cnpj: result.office.cnpj,
          email: result.office.email,
        },
      },
    }, { status: 201 });
  } catch (error) {
    // SECURITY FIX (#69): Don't log error details that might contain PII
    console.error('Register error: [REDACTED]');
    return NextResponse.json(
      { success: false, error: 'Erro interno do servidor' },
      { status: 500 }
    );
  }
}
