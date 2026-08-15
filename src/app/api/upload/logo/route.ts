import { NextRequest, NextResponse } from 'next/server'
import { logger } from '@/lib/logger'
import { writeFile, mkdir, unlink } from 'fs/promises'
import path from 'path'
import { db } from '@/lib/db'
import { requireAuth, auditLog } from '@/lib/auth'

const ALLOWED_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp']
const MAX_FILE_SIZE = 2 * 1024 * 1024 // 2MB

function getProjectRoot(): string {
  const cwd = process.cwd()
  if (cwd.endsWith('.next/standalone') || cwd.endsWith('.next\\standalone')) {
    return path.resolve(cwd, '..', '..')
  }
  return cwd
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth(request)
    if (!auth.payload) {
      return NextResponse.json(
        { success: false, error: auth.error.message },
        { status: auth.error.status }
      )
    }

    if (auth.payload.role === 'EMPLOYEE') {
      return NextResponse.json(
        { success: false, error: 'Funcionários não podem alterar o logo da oficina' },
        { status: 403 }
      )
    }

    const formData = await request.formData()
    const file = formData.get('file') as File | null
    const officeId = (formData.get('officeId') as string) || auth.payload.officeId

    if (!file) {
      return NextResponse.json(
        { success: false, error: 'Nenhum arquivo enviado' },
        { status: 400 }
      )
    }

    if (officeId !== auth.payload.officeId) {
      return NextResponse.json(
        { success: false, error: 'Acesso negado' },
        { status: 403 }
      )
    }

    if (!ALLOWED_MIME_TYPES.includes(file.type)) {
      return NextResponse.json(
        { success: false, error: 'Tipo de arquivo inválido. Use PNG, JPG ou WEBP.' },
        { status: 400 }
      )
    }

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { success: false, error: 'Arquivo muito grande. Máximo 2MB.' },
        { status: 400 }
      )
    }

    const ext = file.type.split('/')[1] === 'jpeg' ? 'jpg' : file.type.split('/')[1]
    const filename = `logo_${officeId}_${Date.now()}.${ext}`

    const cwd = process.cwd()
    const projectRoot = getProjectRoot()
    const uploadDirs = [
      path.join(cwd, 'public', 'uploads', 'logos'),
      path.join(projectRoot, 'public', 'uploads', 'logos'),
    ]

    const bytes = await file.arrayBuffer()
    const buffer = Buffer.from(bytes)

    for (const dir of uploadDirs) {
      await mkdir(dir, { recursive: true })
      await writeFile(path.join(dir, filename), buffer)
    }

    const relativeLogoPath = `/uploads/logos/${filename}`

    await db.office.update({
      where: { id: officeId },
      data: { logo: relativeLogoPath },
    })

    await auditLog({
      action: 'UPDATE_LOGO',
      entity: 'Office',
      entityId: officeId,
      details: JSON.stringify({ filename }),
      userId: auth.payload.userId,
      officeId,
    })

    return NextResponse.json({
      success: true,
      data: { logo: relativeLogoPath },
    })
  } catch (error) {
    logger.error('Logo upload error:', { error: error instanceof Error ? error.message : String(error) })
    return NextResponse.json(
      { success: false, error: 'Erro interno do servidor ao fazer upload' },
      { status: 500 }
    )
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const auth = await requireAuth(request)
    if (!auth.payload) {
      return NextResponse.json(
        { success: false, error: auth.error.message },
        { status: auth.error.status }
      )
    }

    if (auth.payload.role === 'EMPLOYEE') {
      return NextResponse.json(
        { success: false, error: 'Funcionários não podem remover o logo da oficina' },
        { status: 403 }
      )
    }

    const { searchParams } = new URL(request.url)
    const officeId = searchParams.get('officeId') || auth.payload.officeId

    if (officeId !== auth.payload.officeId) {
      return NextResponse.json(
        { success: false, error: 'Acesso negado' },
        { status: 403 }
      )
    }

    const office = await db.office.findUnique({
      where: { id: officeId },
      select: { logo: true },
    })

    if (office?.logo) {
      const filename = path.basename(office.logo)
      const cwd = process.cwd()
      const projectRoot = getProjectRoot()
      const pathsToDelete = [
        path.join(cwd, 'public', 'uploads', 'logos', filename),
        path.join(projectRoot, 'public', 'uploads', 'logos', filename),
      ]

      for (const filePath of pathsToDelete) {
        try {
          await unlink(filePath)
        } catch {
          // File might not exist, silently ignore
        }
      }
    }

    await db.office.update({
      where: { id: officeId },
      data: { logo: null },
    })

    await auditLog({
      action: 'REMOVE_LOGO',
      entity: 'Office',
      entityId: officeId,
      userId: auth.payload.userId,
      officeId,
    })

    return NextResponse.json({
      success: true,
    })
  } catch (error) {
    logger.error('Logo remove error:', { error: error instanceof Error ? error.message : String(error) })
    return NextResponse.json(
      { success: false, error: 'Erro interno do servidor ao remover logo' },
      { status: 500 }
    )
  }
}
