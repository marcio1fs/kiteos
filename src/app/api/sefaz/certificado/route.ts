import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import { createAuditLog } from '@/lib/audit';
import {
  encryptPassword,
  encryptFileContent,
  validatePfxBasic,
} from '@/lib/sefaz';
import { applyRateLimit } from '@/lib/sefaz/rate-limiter';

/**
 * GET - Returns active certificate info for the office
 * Never exposes senha or arquivoContent
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const officeId = searchParams.get('officeId');

    if (!officeId) {
      return NextResponse.json(
        { success: false, error: 'officeId é obrigatório' },
        { status: 400 }
      );
    }

    const auth = await requireAuth(request, officeId);
    if (!auth.payload) {
      return NextResponse.json(
        { success: false, error: auth.error.message },
        { status: auth.error.status }
      );
    }

    const certificado = await db.certificadoDigital.findFirst({
      where: {
        officeId,
        ativo: true,
        deleted: false,
      },
      select: {
        id: true,
        nomeArquivo: true,
        validade: true,
        ativo: true,
        ambiente: true,
        uf: true,
        cnpjCpf: true,
        razaoSocial: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!certificado) {
      return NextResponse.json(
        { success: false, error: 'Nenhum certificado digital ativo encontrado' },
        { status: 404 }
      );
    }

    // Check if expired
    const isExpired = certificado.validade
      ? new Date(certificado.validade) < new Date()
      : false;

    return NextResponse.json({
      success: true,
      data: {
        id: certificado.id,
        nomeArquivo: certificado.nomeArquivo,
        validade: certificado.validade,
        ativo: certificado.ativo,
        ambiente: certificado.ambiente,
        uf: certificado.uf,
        cnpjCpf: certificado.cnpjCpf,
        razaoSocial: certificado.razaoSocial,
        isExpired,
        createdAt: certificado.createdAt,
        updatedAt: certificado.updatedAt,
      },
    });

  } catch (error) {
    console.error('Erro ao buscar certificado:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Erro interno ao buscar certificado digital',
        details: error instanceof Error ? error.message : 'Erro desconhecido',
      },
      { status: 500 }
    );
  }
}

/**
 * POST - Upload certificate
 * Receives FormData with: arquivo (PFX file), senha, ambiente, uf
 */
export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const officeId = formData.get('officeId') as string | null;
    const arquivo = formData.get('arquivo') as File | null;
    const senha = formData.get('senha') as string | null;
    const ambiente = formData.get('ambiente') as string | null;
    const uf = formData.get('uf') as string | null;

    if (!officeId) {
      return NextResponse.json(
        { success: false, error: 'officeId é obrigatório' },
        { status: 400 }
      );
    }

    const auth = await requireAuth(request, officeId);
    if (!auth.payload) {
      return NextResponse.json(
        { success: false, error: auth.error.message },
        { status: auth.error.status }
      );
    }

    // Rate limiting for certificate operations
    const rateLimitResult = applyRateLimit(officeId, 'CERTIFICADO');
    if (rateLimitResult) {
      return NextResponse.json(
        { success: false, error: rateLimitResult.message },
        { status: 429, headers: { 'Retry-After': String(Math.ceil((rateLimitResult.retryAfterMs || 300000) / 1000)) } }
      );
    }

    if (!arquivo) {
      return NextResponse.json(
        { success: false, error: 'Arquivo PFX é obrigatório' },
        { status: 400 }
      );
    }

    if (!senha) {
      return NextResponse.json(
        { success: false, error: 'Senha do certificado é obrigatória' },
        { status: 400 }
      );
    }

    if (!ambiente || !['HOMOLOGACAO', 'PRODUCAO'].includes(ambiente)) {
      return NextResponse.json(
        { success: false, error: 'Ambiente inválido. Use HOMOLOGACAO ou PRODUCAO' },
        { status: 400 }
      );
    }

    if (!uf || uf.length !== 2) {
      return NextResponse.json(
        { success: false, error: 'UF inválida. Use a sigla de 2 letras (ex: BA)' },
        { status: 400 }
      );
    }

    // Read file content as base64
    const fileBuffer = Buffer.from(await arquivo.arrayBuffer());
    const base64Content = fileBuffer.toString('base64');

    // Validate PFX basic structure
    const pfxValidation = validatePfxBasic(base64Content);
    if (!pfxValidation.valid) {
      return NextResponse.json(
        { success: false, error: pfxValidation.error || 'Arquivo PFX inválido' },
        { status: 400 }
      );
    }

    // Encrypt password and file content
    const senhaCriptografada = encryptPassword(senha);
    const arquivoContentCriptografado = encryptFileContent(base64Content);

    // Deactivate previous certificates for this office
    await db.certificadoDigital.updateMany({
      where: {
        officeId,
        ativo: true,
        deleted: false,
      },
      data: {
        ativo: false,
      },
    });

    // Save new certificate
    const certificado = await db.certificadoDigital.create({
      data: {
        nomeArquivo: arquivo.name,
        arquivoContent: arquivoContentCriptografado,
        senhaCriptografada,
        validade: null, // Will be determined by actual certificate parsing if available
        ativo: true,
        ambiente,
        uf: uf.toUpperCase(),
        officeId,
      },
    });

    // Create audit log
    await createAuditLog({
      action: 'SEFAZ_CERTIFICADO_UPLOAD',
      entity: 'CertificadoDigital',
      entityId: certificado.id,
      details: JSON.stringify({
        nomeArquivo: arquivo.name,
        ambiente,
        uf: uf.toUpperCase(),
      }),
      userId: auth.payload.userId,
      officeId,
    });

    return NextResponse.json({
      success: true,
      data: {
        id: certificado.id,
        nomeArquivo: certificado.nomeArquivo,
        validade: certificado.validade,
        ativo: certificado.ativo,
        ambiente: certificado.ambiente,
        uf: certificado.uf,
        createdAt: certificado.createdAt,
      },
    }, { status: 201 });

  } catch (error) {
    console.error('Erro ao upload certificado:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Erro interno ao salvar certificado digital',
        details: error instanceof Error ? error.message : 'Erro desconhecido',
      },
      { status: 500 }
    );
  }
}

/**
 * DELETE - Soft-delete certificate
 * Receives { officeId, certificadoId }
 */
export async function DELETE(request: NextRequest) {
  try {
    const body = await request.json();
    const { officeId, certificadoId } = body;

    if (!officeId) {
      return NextResponse.json(
        { success: false, error: 'officeId é obrigatório' },
        { status: 400 }
      );
    }

    if (!certificadoId) {
      return NextResponse.json(
        { success: false, error: 'certificadoId é obrigatório' },
        { status: 400 }
      );
    }

    const auth = await requireAuth(request, officeId);
    if (!auth.payload) {
      return NextResponse.json(
        { success: false, error: auth.error.message },
        { status: auth.error.status }
      );
    }

    // Verify certificate exists and belongs to the office
    const certificado = await db.certificadoDigital.findFirst({
      where: {
        id: certificadoId,
        officeId,
        deleted: false,
      },
    });

    if (!certificado) {
      return NextResponse.json(
        { success: false, error: 'Certificado digital não encontrado' },
        { status: 404 }
      );
    }

    // Soft-delete: set deleted=true and ativo=false
    await db.certificadoDigital.update({
      where: { id: certificadoId },
      data: {
        deleted: true,
        ativo: false,
      },
    });

    // Create audit log
    await createAuditLog({
      action: 'SEFAZ_CERTIFICADO_DELETE',
      entity: 'CertificadoDigital',
      entityId: certificadoId,
      details: JSON.stringify({
        nomeArquivo: certificado.nomeArquivo,
        ambiente: certificado.ambiente,
        uf: certificado.uf,
      }),
      userId: auth.payload.userId,
      officeId,
    });

    return NextResponse.json({
      success: true,
      data: { id: certificadoId, deleted: true },
    });

  } catch (error) {
    console.error('Erro ao deletar certificado:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Erro interno ao deletar certificado digital',
        details: error instanceof Error ? error.message : 'Erro desconhecido',
      },
      { status: 500 }
    );
  }
}
