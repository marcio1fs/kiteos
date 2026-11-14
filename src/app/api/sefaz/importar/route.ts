import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { validateChave } from '@/lib/nfe/xml-parser';
import { applyRateLimit } from '@/lib/sefaz/rate-limiter';
import { importNfeByChave } from '@/lib/sefaz/nfe-import';

/**
 * POST /api/sefaz/importar — importa uma NF-e pela chave de acesso.
 *
 * Camada HTTP fina: autenticação, rate limit e validação da chave ficam aqui; o
 * trabalho real (certificado → consulta → download → parse → nota persistida) está
 * em `importNfeByChave`, que é exatamente o que o job assíncrono chama. Ter os dois
 * caminhos sobre o mesmo núcleo é o que impede a fila de declarar sucesso sem
 * importar nada (FISC-04).
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { chave, officeId } = body;

    if (!officeId) {
      return NextResponse.json(
        { success: false, error: 'officeId é obrigatório' },
        { status: 400 }
      );
    }

    const auth = await requireAuth(request, officeId);
    if (!auth.payload) {
      return NextResponse.json({ success: false, error: auth.error.message }, { status: auth.error.status });
    }

    const rateLimitResult = applyRateLimit(officeId, 'IMPORTACAO');
    if (rateLimitResult) {
      return NextResponse.json(
        { success: false, error: rateLimitResult.message },
        { status: 429, headers: { 'Retry-After': String(Math.ceil((rateLimitResult.retryAfterMs || 120000) / 1000)) } }
      );
    }

    if (!chave || !validateChave(chave)) {
      return NextResponse.json(
        { success: false, error: 'Chave de acesso inválida. Deve conter 44 dígitos numéricos com dígito verificador válido.' },
        { status: 400 }
      );
    }

    const result = await importNfeByChave({
      chave,
      officeId,
      userId: auth.payload.userId,
    });

    if (!result.ok) {
      return NextResponse.json(
        {
          success: false,
          error: result.error,
          code: result.code,
          ...(result.data ? { data: result.data } : {}),
        },
        { status: result.status }
      );
    }

    return NextResponse.json({
      success: true,
      data: {
        nfeId: result.invoiceId,
        fornecedor: result.fornecedor,
        valorTotal: result.valorTotal,
        chave: result.chave,
        numero: result.numero,
      },
    }, { status: 201 });

  } catch (error) {
    console.error('Erro na importação SEFAZ:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Erro interno ao importar NF-e da SEFAZ',
        details: error instanceof Error ? error.message : 'Erro desconhecido',
      },
      { status: 500 }
    );
  }
}
