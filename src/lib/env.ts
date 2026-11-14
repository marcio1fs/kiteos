/**
 * Configuração do servidor — única fonte de verdade sobre variáveis de ambiente.
 *
 * PASSO 6 (CFG-01/03/04/07). Antes deste módulo cada biblioteca lia
 * `process.env` por conta própria e falhava **no primeiro request** que precisasse
 * dela: `auth.ts` lançava ao assinar um token, `certificate.ts` ao criptografar uma
 * senha, as rotas do Mercado Pago caiam num fallback silencioso. O container subia
 * "saudável" e quebrava na frente do cliente.
 *
 * Regras de projeto:
 *
 * 1. **Não lança ao importar.** `readEnv()` coleta problemas e devolve um relatório;
 *    só `getEnv()`/`validateEnvOrThrow()` lançam. Assim os testes podem montar
 *    cenários incompletos de propósito.
 * 2. **Não guarda cache.** `process.env` é relido a cada chamada — barato (só
 *    strings) e evita que um snapshot congelado esconda uma mudança.
 * 3. **Sem `node:` imports.** Este arquivo é importado pelo middleware
 *    (`src/proxy.ts`), que roda em edge runtime. Verificações que precisam de
 *    sistema de arquivos ficam em `instrumentation.ts`.
 * 4. **Ausência de `NODE_ENV` é tratada como produção.** O comportamento inseguro
 *    precisa ser opt-in explícito, nunca consequência de um `NODE_ENV` que o
 *    orquestrador esqueceu de definir.
 */

/**
 * Fonte de configuração lida por este módulo.
 *
 * Um alias próprio em vez de `NodeJS.ProcessEnv`: a tipagem global do Node não é
 * resolvida pelo eslint deste repo (`no-undef`), e `process.env` é atribuível a
 * este tipo porque tem índice de assinatura compatível.
 */
export type EnvSource = Record<string, string | undefined>;

/** Níveis de problema. `error` impede a subida em produção; `warning` só alerta. */
export type EnvLevel = 'error' | 'warning';

export interface EnvIssue {
  level: EnvLevel;
  /** Nome exato da variável, para a mensagem apontar o que corrigir. */
  variable: string;
  message: string;
}

export type NodeEnv = 'development' | 'test' | 'production';

export interface MercadoPagoPlatformConfig {
  /** Token de plataforma real presente (não é placeholder). */
  configured: boolean;
  accessToken: string | null;
  webhookSecret: string | null;
  /** Um placeholder foi encontrado — quase sempre `.env.example` não editado. */
  placeholderDetected: boolean;
  /** `TEST-` no token: checkout em sandbox. */
  sandbox: boolean;
}

export interface EnvConfig {
  nodeEnv: NodeEnv;
  /** `true` quando NODE_ENV é development ou test — e somente aí. */
  isDevLike: boolean;
  databaseUrl: string | null;
  jwtSecret: string | null;
  certEncryptionKey: string | null;
  /** URL pública absoluta, sem barra final. */
  appUrl: string | null;
  redisUrl: string | null;
  sefazExtraCaCerts: string | null;
  platformAdminUserIds: string[];
  mercadoPago: MercadoPagoPlatformConfig;
  /** Permite gravar segredo de oficina em texto puro (só fora de produção). */
  allowInsecurePlaintextTokens: boolean;
}

export interface EnvReport {
  config: EnvConfig;
  errors: EnvIssue[];
  warnings: EnvIssue[];
  /** `true` quando não há nenhum `error`. */
  ok: boolean;
}

/** Tamanho mínimo de segredos. Abaixo disso são força-bruteáveis. */
export const MIN_SECRET_LENGTH = 32;

/**
 * Valores literais do `.env.example` e variações comuns de "preencha depois".
 * Um segredo igual a qualquer um destes é configuração não feita, não segredo.
 */
const PLACEHOLDER_VALUES = new Set([
  'your-jwt-secret-here',
  'your-encryption-key-here',
  'your-mp-access-token',
  'your-whatsapp-token',
  'your-nextauth-secret-here',
  'changeme',
  'change-me',
  'replace-me',
  'placeholder',
  'segredo',
  'secret',
  'senha',
  'todo',
  'tbd',
  'none',
  'null',
]);

const PLACEHOLDER_PATTERNS: RegExp[] = [
  /x{6,}/i, // APP_USR-xxxxxxxx…
  /^your[-_].*[-_]here$/i,
  /insert[-_ ]?here/i,
  /^<.*>$/, // <seu-secret-aqui>
  /^(test|dev|local|demo)[-_]?(secret|key|token)?$/i,
];

/**
 * Detecta valor que não é um segredo de verdade: placeholder de documentação,
 * "xxxx…", ou texto genérico de exemplo.
 *
 * Substitui a comparação com um único padrão de placeholder (`x` repetido) que
 * estava espalhada pelas rotas do Mercado Pago (CFG-04) e decidia se a integração
 * estava configurada em cinco lugares com semânticas divergentes.
 */
export function isPlaceholderSecret(value: string | null | undefined): boolean {
  if (!value) return true;
  const normalized = value.trim();
  if (!normalized) return true;
  if (PLACEHOLDER_VALUES.has(normalized.toLowerCase())) return true;
  return PLACEHOLDER_PATTERNS.some((re) => re.test(normalized));
}

/** Hosts que não servem como URL pública: o callback nunca alcançaria o cliente. */
function isNonRoutableHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  if (host.endsWith('.local') || host.endsWith('.internal')) return true;
  if (host === '127.0.0.1' || host.startsWith('127.')) return true;
  if (host === '::1' || host === '[::1]') return true;
  if (host === '0.0.0.0') return true;
  // 192.168.x, 10.x, 172.16-31.x
  const privateV4 = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/;
  if (privateV4.test(host)) return true;
  return false;
}

function normalizeNodeEnv(raw: string | undefined): NodeEnv {
  // Falhar seguro: NODE_ENV ausente é tratado como produção. Um container sem
  // NODE_ENV não pode herdar as conveniências de desenvolvimento.
  if (raw === 'development' || raw === 'test') return raw;
  return 'production';
}

/**
 * Interpreta `PLATFORM_ADMIN_USER_IDS`.
 *
 * Aceita vírgula, ponto e vírgula, espaço e quebra de linha como separadores: o
 * valor costuma ser colado de planilha ou de um arquivo multi-linha, e recusar em
 * silêncio um operador legítimo é pior do que aceitar separadores alternativos.
 * Um separador inesperado vira `warning`, nunca perda silenciosa de acesso.
 */
export function parsePlatformAdminIds(raw: string | undefined): {
  ids: string[];
  usedFallbackSeparator: boolean;
} {
  if (!raw || !raw.trim()) return { ids: [], usedFallbackSeparator: false };

  const porVirgula = raw.split(',').map((v) => v.trim()).filter(Boolean);
  // Se algum "id" resultante ainda contém ';' ou espaço, a vírgula não era o
  // separador de fato (ex.: 'user-1;user-2' ou 'user-1 user-2' colados de
  // planilha). Reinterpretar com o conjunto amplo é o que evita perder um
  // operador legítimo em silêncio.
  const separadorErrado = porVirgula.some((id) => /[;\s]/.test(id));
  if (porVirgula.length > 0 && !separadorErrado) {
    return { ids: dedupe(porVirgula), usedFallbackSeparator: false };
  }

  const porQualquerSeparador = raw.split(/[,;\s]+/).map((v) => v.trim()).filter(Boolean);
  return {
    ids: dedupe(porQualquerSeparador),
    usedFallbackSeparator: porQualquerSeparador.length > 0,
  };
}

function dedupe(values: string[]): string[] {
  return [...new Set(values)];
}

/**
 * Lê e valida `process.env` sem lançar. Use `getEnv()` quando precisar da
 * configuração já garantida, e `readEnv()` para relatórios (health/ready, startup).
 */
export function readEnv(source: EnvSource = process.env): EnvReport {
  const errors: EnvIssue[] = [];
  const warnings: EnvIssue[] = [];
  const error = (variable: string, message: string) => errors.push({ level: 'error', variable, message });
  const warn = (variable: string, message: string) => warnings.push({ level: 'warning', variable, message });

  const nodeEnv = normalizeNodeEnv(source.NODE_ENV);
  const isDevLike = nodeEnv !== 'production';

  if (!source.NODE_ENV) {
    warn('NODE_ENV', 'NODE_ENV não definido — assumindo "production" e o comportamento mais restritivo.');
  } else if (!['development', 'test', 'production'].includes(source.NODE_ENV)) {
    // "staging", "homolog", "prod": valores comuns que NÃO são 'production' e, no
    // código antigo, desligavam proteções. Aqui viram produção e são relatados.
    warn(
      'NODE_ENV',
      `NODE_ENV="${source.NODE_ENV}" não é um dos valores reconhecidos (development/test/production); tratado como production.`
    );
  }

  // --- Segredos obrigatórios -------------------------------------------------
  const jwtSecret = source.JWT_SECRET?.trim() || null;
  if (!jwtSecret) {
    error('JWT_SECRET', 'JWT_SECRET é obrigatório: sem ele nenhum token de sessão pode ser assinado.');
  } else if (jwtSecret.length < MIN_SECRET_LENGTH) {
    error('JWT_SECRET', `JWT_SECRET tem ${jwtSecret.length} caracteres; o mínimo é ${MIN_SECRET_LENGTH}. Gere um com \`openssl rand -hex 32\`.`);
  } else if (isPlaceholderSecret(jwtSecret)) {
    error('JWT_SECRET', 'JWT_SECRET é um valor de exemplo (placeholder). Troque por um segredo aleatório.');
  }

  const certEncryptionKey = source.CERT_ENCRYPTION_KEY?.trim() || null;
  if (!certEncryptionKey) {
    // Sem esta chave não há como proteger certificado A1 nem token de oficina em
    // repouso. Em dev/test vira aviso para não travar quem está começando; em
    // produção é erro.
    if (isDevLike) {
      warn('CERT_ENCRYPTION_KEY', 'CERT_ENCRYPTION_KEY ausente: segredos de oficina não poderão ser gravados (encryptToken lança).');
    } else {
      error('CERT_ENCRYPTION_KEY', 'CERT_ENCRYPTION_KEY é obrigatório em produção: protege certificado A1 e tokens de oficina em repouso.');
    }
  } else if (certEncryptionKey.length < MIN_SECRET_LENGTH) {
    error('CERT_ENCRYPTION_KEY', `CERT_ENCRYPTION_KEY tem ${certEncryptionKey.length} caracteres; o mínimo é ${MIN_SECRET_LENGTH}.`);
  } else if (isPlaceholderSecret(certEncryptionKey)) {
    error('CERT_ENCRYPTION_KEY', 'CERT_ENCRYPTION_KEY é um valor de exemplo (placeholder). Troque por uma chave aleatória.');
  }

  // --- Banco -----------------------------------------------------------------
  const databaseUrl = source.DATABASE_URL?.trim() || null;
  if (!databaseUrl) {
    error('DATABASE_URL', 'DATABASE_URL é obrigatório.');
  } else if (!/^postgres(ql)?:\/\//i.test(databaseUrl)) {
    error('DATABASE_URL', 'DATABASE_URL precisa ser uma URL postgres:// ou postgresql:// (SQLite não é mais suportado).');
  }

  // --- URL pública -----------------------------------------------------------
  const rawAppUrl = source.NEXT_PUBLIC_APP_URL?.trim() || null;
  let appUrl: string | null = null;
  if (!rawAppUrl) {
    // CFG-03: o fallback antigo era `|| 'http://localhost:3000'` dentro das rotas
    // de pagamento. Em produção isso mandava back_urls e notification_url do
    // Mercado Pago para localhost — o cliente caía numa URL que não existe e o
    // webhook nunca chegava. Aqui a ausência é erro em produção.
    if (isDevLike) {
      appUrl = 'http://localhost:3000';
      warn('NEXT_PUBLIC_APP_URL', 'NEXT_PUBLIC_APP_URL ausente — usando http://localhost:3000 (somente desenvolvimento).');
    } else {
      error('NEXT_PUBLIC_APP_URL', 'NEXT_PUBLIC_APP_URL é obrigatório em produção: é a base dos callbacks de pagamento e dos links enviados ao cliente.');
    }
  } else {
    let parsed: URL | null = null;
    try {
      parsed = new URL(rawAppUrl);
    } catch {
      parsed = null;
    }
    if (!parsed) {
      error('NEXT_PUBLIC_APP_URL', `NEXT_PUBLIC_APP_URL="${rawAppUrl}" não é uma URL absoluta válida (esperado https://app.exemplo.com.br).`);
    } else if (parsed.protocol !== 'https:' && !(isDevLike && parsed.protocol === 'http:')) {
      error('NEXT_PUBLIC_APP_URL', 'NEXT_PUBLIC_APP_URL precisa usar https:// em produção.');
    } else if (!isDevLike && isNonRoutableHost(parsed.hostname)) {
      error('NEXT_PUBLIC_APP_URL', `NEXT_PUBLIC_APP_URL aponta para "${parsed.hostname}", que não é alcançável pelos clientes nem pelo Mercado Pago.`);
    } else {
      appUrl = parsed.origin; // normaliza: sem barra final, sem caminho
      if (parsed.search || parsed.hash) {
        warn('NEXT_PUBLIC_APP_URL', 'NEXT_PUBLIC_APP_URL continha query/fragment, que foram descartados.');
      }
    }
  }

  // --- Mercado Pago (plataforma) --------------------------------------------
  const rawMpToken = source.MP_PLATFORM_ACCESS_TOKEN?.trim() || null;
  const rawMpSecret = source.MP_PLATFORM_WEBHOOK_SECRET?.trim() || null;
  const mpPlaceholderDetected = Boolean(rawMpToken && isPlaceholderSecret(rawMpToken));
  const mpConfigured = Boolean(rawMpToken && !isPlaceholderSecret(rawMpToken));
  if (mpPlaceholderDetected) {
    // Não é erro: a plataforma pode legítimamente não estar configurada e as
    // oficinas usarem contas próprias. Mas o operador que colou o exemplo precisa
    // saber que o token foi ignorado.
    warn('MP_PLATFORM_ACCESS_TOKEN', 'MP_PLATFORM_ACCESS_TOKEN parece um placeholder do .env.example e será ignorado (integração de plataforma desativada).');
  }
  if (mpConfigured && !rawMpSecret) {
    // Token sem secret significa webhook de plataforma sem como validar assinatura:
    // a rota recusaria tudo com 401 e ninguém entenderia o motivo.
    error('MP_PLATFORM_WEBHOOK_SECRET', 'MP_PLATFORM_ACCESS_TOKEN está configurado, mas MP_PLATFORM_WEBHOOK_SECRET não: os webhooks de assinatura não têm como ser autenticados.');
  }
  if (!mpConfigured && rawMpSecret) {
    warn('MP_PLATFORM_WEBHOOK_SECRET', 'MP_PLATFORM_WEBHOOK_SECRET definido sem MP_PLATFORM_ACCESS_TOKEN — o secret será ignorado.');
  }
  const mercadoPago: MercadoPagoPlatformConfig = {
    configured: mpConfigured,
    accessToken: mpConfigured ? rawMpToken : null,
    webhookSecret: mpConfigured ? rawMpSecret : null,
    placeholderDetected: mpPlaceholderDetected,
    sandbox: mpConfigured ? Boolean(rawMpToken?.startsWith('TEST-')) : false,
  };

  // --- Operadores de plataforma (CFG-07) ------------------------------------
  const { ids: platformAdminUserIds, usedFallbackSeparator } = parsePlatformAdminIds(source.PLATFORM_ADMIN_USER_IDS);
  if (usedFallbackSeparator) {
    warn('PLATFORM_ADMIN_USER_IDS', 'PLATFORM_ADMIN_USER_IDS não usa vírgula como separador; os ids foram separados por espaço/quebra de linha. Prefira vírgula.');
  }
  if (!source.PLATFORM_ADMIN_USER_IDS?.trim()) {
    // Default seguro (ninguém é operador), mas indistinguível de "esqueci de
    // configurar" — por isso o aviso, que é o que faltava.
    warn('PLATFORM_ADMIN_USER_IDS', 'Nenhum operador de plataforma configurado: as rotas /api/admin/* vão recusar todo mundo com 403.');
  }

  // --- Opcionais -------------------------------------------------------------
  const redisUrl = source.REDIS_URL?.trim() || null;
  if (redisUrl && !/^rediss?:\/\//i.test(redisUrl)) {
    error('REDIS_URL', 'REDIS_URL precisa ser redis:// ou rediss:// (ou pode ficar ausente para rate limiting em memória).');
  }
  const sefazExtraCaCerts = source.SEFAZ_EXTRA_CA_CERTS?.trim() || null;

  const allowInsecurePlaintextTokens =
    source.ALLOW_INSECURE_PLAINTEXT_TOKENS === 'true' && isDevLike;
  if (source.ALLOW_INSECURE_PLAINTEXT_TOKENS === 'true' && !isDevLike) {
    error('ALLOW_INSECURE_PLAINTEXT_TOKENS', 'ALLOW_INSECURE_PLAINTEXT_TOKENS não pode ser usado em produção: segredos de oficina têm de ser gravados criptografados.');
  }

  return {
    config: {
      nodeEnv,
      isDevLike,
      databaseUrl,
      jwtSecret,
      certEncryptionKey,
      appUrl,
      redisUrl,
      sefazExtraCaCerts,
      platformAdminUserIds,
      mercadoPago,
      allowInsecurePlaintextTokens,
    },
    errors,
    warnings,
    ok: errors.length === 0,
  };
}

/** Erro de configuração: lista as variáveis pelo nome, nunca os valores. */
export class ConfigError extends Error {
  readonly issues: EnvIssue[];
  constructor(issues: EnvIssue[]) {
    super(
      'Configuração inválida:\n' +
        issues.map((i) => `  - ${i.variable}: ${i.message}`).join('\n')
    );
    this.name = 'ConfigError';
    this.issues = issues;
  }
}

/**
 * Configuração validada. Lança `ConfigError` se houver erro.
 *
 * Nunca lança em development/test apenas por opcionais ausentes — as regras
 * obrigatórias (JWT_SECRET, DATABASE_URL) valem em qualquer ambiente, porque sem
 * elas o sistema não funciona, só falha mais tarde e com mensagem pior.
 */
export function getEnv(source: EnvSource = process.env): EnvConfig {
  const report = readEnv(source);
  if (!report.ok) throw new ConfigError(report.errors);
  return report.config;
}

/** Mesmo contrato de `getEnv()`, mas devolve o relatório para quem quer logar. */
export function validateEnvOrThrow(source: EnvSource = process.env): EnvReport {
  const report = readEnv(source);
  if (!report.ok) throw new ConfigError(report.errors);
  return report;
}

/**
 * URL pública absoluta. Em produção a ausência é erro de configuração — não existe
 * mais fallback para localhost (CFG-03).
 */
export function requireAppUrl(source: EnvSource = process.env): string {
  const { config } = readEnv(source);
  if (!config.appUrl) {
    throw new ConfigError([
      {
        level: 'error',
        variable: 'NEXT_PUBLIC_APP_URL',
        message: 'NEXT_PUBLIC_APP_URL não está configurado; recusando-se a usar localhost como URL pública.',
      },
    ]);
  }
  return config.appUrl;
}

/** Ids de operadores de plataforma, já validados. */
export function platformAdminUserIds(source: EnvSource = process.env): string[] {
  return readEnv(source).config.platformAdminUserIds;
}

/** Formata problemas para log/startup, sem expor valores de segredo. */
export function formatIssues(issues: EnvIssue[]): string[] {
  return issues.map((i) => `[${i.level.toUpperCase()}] ${i.variable}: ${i.message}`);
}
