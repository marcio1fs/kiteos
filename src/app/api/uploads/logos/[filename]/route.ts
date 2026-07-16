import { NextRequest, NextResponse } from 'next/server'
import { readFile, stat } from 'fs/promises'
import path from 'path'
import { requireAuth } from '@/lib/auth'

const MIME_MAP: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
}

// ============================================================================
// SECURITY FIX: Maximum file size for logo uploads (500KB)
// ============================================================================
const MAX_LOGO_SIZE = 500 * 1024

function getProjectRoot(): string {
  const cwd = process.cwd()
  if (cwd.endsWith('.next/standalone') || cwd.endsWith('.next\\standalone')) {
    return path.resolve(cwd, '..', '..')
  }
  return cwd
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ filename: string }> }
) {
  try {
    const { filename } = await params

    // ============================================================================
    // SECURITY FIX: Added authentication check for logo access
    // Was accessible without auth after removing blanket /api/uploads/ bypass
    // ============================================================================
    const auth = await requireAuth(request)
    if (!auth.payload) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
    }

    // ============================================================================
    // SECURITY FIX: Enhanced filename sanitization
    // - Reject hidden files (starting with .)
    // - Reject double extensions (e.g., file.png.exe)
    // - Reject path traversal attempts
    // ============================================================================
    if (!filename || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(filename)) {
      return NextResponse.json({ error: 'Invalid filename' }, { status: 400 })
    }

    // Reject hidden files
    if (filename.startsWith('.')) {
      return NextResponse.json({ error: 'Invalid filename' }, { status: 400 })
    }

    // Reject double extensions
    const parts = filename.split('.')
    if (parts.length > 2) {
      return NextResponse.json({ error: 'Invalid filename' }, { status: 400 })
    }

    const ext = filename.split('.').pop()?.toLowerCase() || ''
    const contentType = MIME_MAP[ext]
    if (!contentType) {
      return NextResponse.json({ error: 'Unsupported file type' }, { status: 400 })
    }

    // Try to find the file in multiple locations
    const projectRoot = getProjectRoot()
    const cwd = process.cwd()
    const searchPaths = [
      path.join(cwd, 'public', 'uploads', 'logos', filename),
      path.join(projectRoot, 'public', 'uploads', 'logos', filename),
    ]

    for (const filePath of searchPaths) {
      try {
        const fileStat = await stat(filePath)

        // ============================================================================
        // SECURITY FIX: Validate file is within expected directory
        // Prevents path traversal even after filename sanitization
        // ============================================================================
        const resolvedPath = path.resolve(filePath)
        const expectedDir = path.resolve(path.join(cwd, 'public', 'uploads', 'logos'))
        const expectedDir2 = path.resolve(path.join(projectRoot, 'public', 'uploads', 'logos'))
        if (!resolvedPath.startsWith(expectedDir) && !resolvedPath.startsWith(expectedDir2)) {
          console.error('Path traversal attempt detected:', resolvedPath)
          return NextResponse.json({ error: 'Invalid file path' }, { status: 400 })
        }

        if (fileStat.isFile()) {
          // SECURITY FIX: Check file size before serving
          if (fileStat.size > MAX_LOGO_SIZE) {
            return NextResponse.json({ error: 'File too large' }, { status: 400 })
          }

          const data = await readFile(filePath)
          return new NextResponse(data, {
            status: 200,
            headers: {
              'Content-Type': contentType,
              'Cache-Control': 'public, max-age=86400, immutable',
              'Content-Length': String(data.length),
              // SECURITY: Prevent logo files from being executed
              'Content-Disposition': `inline; filename="${filename}"`,
              'X-Content-Type-Options': 'nosniff',
            },
          })
        }
      } catch {
        // File not found at this path, try next
      }
    }

    return NextResponse.json({ error: 'File not found' }, { status: 404 })
  } catch (error) {
    console.error('Serve logo error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
