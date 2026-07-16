/**
 * GET /api/sefaz/consultas/[id]
 * Retorna detalhes completos de uma consulta SEFAZ, incluindo XML
 * Apenas usuários autenticados do mesmo escritório podem acessar
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAuth } from '@/lib/auth'
import { maskSensitiveData } from '@/lib/sefaz'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const { searchParams } = new URL(request.url)
    const officeId = searchParams.get('officeId')

    if (!officeId) {
      return NextResponse.json(
        { success: false, error: 'officeId é obrigatório' },
        { status: 400 }
      )
    }

    const auth = await requireAuth(request, officeId)
    if (!auth.payload) {
      return NextResponse.json(
        { success: false, error: auth.error.message },
        { status: auth.error.status }
      )
    }

    const consulta = await db.sefazConsulta.findFirst({
      where: { id, officeId },
    })

    if (!consulta) {
      return NextResponse.json(
        { success: false, error: 'Consulta não encontrada' },
        { status: 404 }
      )
    }

    // Mask sensitive data in the response
    const maskedConsulta = {
      ...consulta,
      fornecedorCnpj: consulta.fornecedorCnpj
        ? maskSensitiveData(consulta.fornecedorCnpj)
        : null,
      // xmlContent is included but should only be accessible to authenticated users
      // who explicitly request the detail view
      xmlContent: consulta.xmlContent, // Full XML only in detail view
    }

    return NextResponse.json({
      success: true,
      data: maskedConsulta,
    })

  } catch (error) {
    console.error('Erro ao buscar detalhes da consulta SEFAZ:', error)
    return NextResponse.json(
      { success: false, error: 'Erro interno ao buscar detalhes da consulta' },
      { status: 500 }
    )
  }
}
