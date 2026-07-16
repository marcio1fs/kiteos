#!/bin/bash
# ============================================================
# KiteOS ERP — Setup para Máquina Local
# Execute: chmod +x setup-local.sh && ./setup-local.sh
# ============================================================

set -e

echo "========================================="
echo "  KiteOS ERP — Setup Local"
echo "========================================="
echo ""

# 1. Verificar pré-requisitos
echo "[1/7] Verificando pré-requisitos..."

command -v node >/dev/null 2>&1 || { echo "ERRO: Node.js não encontrado. Instale em https://nodejs.org"; exit 1; }
command -v bun >/dev/null 2>&1 || { echo "ERRO: Bun não encontrado. Instale com: curl -fsSL https://bun.sh/install | bash"; exit 1; }

echo "  Node.js: $(node --version)"
echo "  Bun: $(bun --version)"
echo ""

# 2. Instalar dependências
echo "[2/7] Instalando dependências..."
bun install
echo "  OK"
echo ""

generate_secret() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 32
  else
    head -c 32 /dev/urandom | base64 | tr -d '\n'
  fi
}
# 3. Configurar ambiente
echo "[3/7] Configurando .env..."
if [ ! -f .env ]; then
  cat > .env << EOF
DATABASE_URL=file:./db/kiteos.db
JWT_SECRET=$(generate_secret)
NEXTAUTH_SECRET=$(generate_secret)
CERT_ENCRYPTION_KEY=$(generate_secret)
EOF
  echo "  .env criado com valores de desenvolvimento"
else
  echo "  .env já existe — mantido"
fi
echo ""

# 4. Criar banco de dados
echo "[4/7] Criando banco de dados..."
mkdir -p db
bunx prisma db push
bunx prisma generate
echo "  OK"
echo ""

# 5. Criar usuário admin
echo "[5/7] Criando usuário admin..."
node -e "
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const db = new PrismaClient();
(async () => {
  const existing = await db.user.findFirst({ where: { email: 'admin@kiteos.com', deleted: false } });
  if (existing) {
    console.log('  Admin já existe — pulando');
  } else {
    const office = await db.office.create({ data: { name: 'KiteOS Admin', cnpj: '00000000000000', active: true } });
    const hash = await bcrypt.hash('KiteOS@Admin2024!', 12);
    await db.user.create({ data: { name: 'Admin', email: 'admin@kiteos.com', password: hash, role: 'OWNER', officeId: office.id, active: true } });
    console.log('  Admin criado: admin@kiteos.com / KiteOS@Admin2024!');
  }
  await db.\$disconnect();
})();
" 2>/dev/null || echo "  (Execute manualmente após iniciar o servidor)"
echo ""

# 6. Build
echo "[6/7] Compilando projeto..."
bun run build 2>&1 | tail -5
echo ""

# 7. Instruções
echo "[7/7] Tudo pronto!"
echo ""
echo "========================================="
echo "  COMO USAR"
echo "========================================="
echo ""
echo "  Modo desenvolvimento:"
echo "    bun run dev"
echo "    Acesse: http://localhost:3000"
echo ""
echo "  Modo produção:"
echo "    bun run start"
echo "    Acesse: http://localhost:3000"
echo ""
echo "  Login admin:"
echo "    Email: admin@kiteos.com"
echo "    Senha: KiteOS@Admin2024!"
echo ""
echo "  Comandos úteis:"
echo "    bun run db:push    — Atualizar schema no banco"
echo "    bun run db:generate — Regenerar cliente Prisma"
echo "    bun run lint       — Verificar código"
echo ""
echo "========================================="
