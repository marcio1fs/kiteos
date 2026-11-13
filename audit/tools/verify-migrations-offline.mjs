/**
 * Offline migration verification for environments where the Prisma engines
 * cannot be downloaded (binaries.prisma.sh is unreachable).
 *
 * It does two things against a REAL PostgreSQL:
 *   1. applies every migration in prisma/migrations in order;
 *   2. compares the resulting database structure with prisma/schema.prisma
 *      (via the DMMF, which is produced by Prisma's WASM pipeline and needs no
 *      engine binary): tables, columns, types, nullability, defaults, primary
 *      keys, uniques, indexes and foreign keys including ON DELETE rules — in
 *      both directions, so missing AND extra objects are reported.
 *
 * The canonical check remains `prisma migrate diff --exit-code` with real
 * engines (see .github/workflows/ci.yml). This harness is what can be executed
 * inside the audit sandbox, and it is strict enough to catch a migration that
 * does not reproduce the schema.
 *
 * Requirements (installed outside the repo so it stays dependency-free):
 *   npm i pg                      # PG_MODULE, if not resolvable from the repo
 *   npm i @prisma/internals@<cli> # INTERNALS_MODULE
 *
 * Usage:
 *   DATABASE_URL=postgresql://postgres@127.0.0.1:5433/kiteos_test \
 *   INTERNALS_MODULE=/home/user/audit-tools/node_modules/@prisma/internals \
 *   PG_MODULE=/home/user/dbtools/node_modules/pg \
 *   node audit/tools/verify-migrations-offline.mjs
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SCHEMA_PATH = path.join(REPO, 'prisma/schema.prisma');
const MIGRATIONS_DIR = path.join(REPO, 'prisma/migrations');
const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error('DATABASE_URL é obrigatório (PostgreSQL real).');
  process.exit(1);
}

function loadModule(name, envVar) {
  const explicit = process.env[envVar];
  try {
    return explicit ? require(explicit) : require(name);
  } catch (err) {
    console.error(`Não foi possível carregar ${name} (${envVar}). Instale-o ou aponte ${envVar} para o módulo.`);
    throw err;
  }
}

const pg = loadModule('pg', 'PG_MODULE');
const { getDMMF } = loadModule('@prisma/internals', 'INTERNALS_MODULE');

/** Prisma scalar -> PostgreSQL, sem @db.* nativos (o schema não usa nenhum). */
const TYPE_MAP = {
  String: { data_type: 'text' },
  Boolean: { data_type: 'boolean' },
  Int: { data_type: 'integer' },
  BigInt: { data_type: 'bigint' },
  Float: { data_type: 'double precision' },
  Decimal: { data_type: 'numeric', numeric_precision: 65, numeric_scale: 30 },
  DateTime: { data_type: 'timestamp without time zone', datetime_precision: 3 },
  Json: { data_type: 'jsonb' },
  Bytes: { data_type: 'bytea' },
};

const FK_DELETE = { a: 'NoAction', r: 'Restrict', c: 'Cascade', n: 'SetNull', d: 'SetDefault' };

const problems = [];
const note = (msg) => problems.push(msg);

function normalizeDefault(value) {
  if (value === null || value === undefined) return null;
  return String(value)
    .replace(/::[a-z "]+(\[\])?/g, '')
    .replace(/^\(|\)$/g, '')
    .trim();
}

/** Parses @@index([...]) out of each model block; the DMMF does not carry them. */
async function parseIndexDeclarations(schemaText) {
  const result = new Map(); // model name -> [{ fields: string[], unique: boolean }]
  const modelRe = /model\s+(\w+)\s*\{([\s\S]*?)\n\}/g;
  let match;
  while ((match = modelRe.exec(schemaText)) !== null) {
    const [, modelName, rawBody] = match;
    // Attributes inside `//` comments are not declarations: the Subscription
    // model documents a removed @@unique([officeId]) in a comment.
    const body = rawBody
      .split('\n')
      .map((line) => line.replace(/\/\/.*$/, ''))
      .join('\n');
    const entries = [];
    const attrRe = /@@(index|unique)\(\[([^\]]*)\]/g;
    let attr;
    while ((attr = attrRe.exec(body)) !== null) {
      const fields = attr[2]
        .split(',')
        .map((f) => f.trim().split(/\s+/)[0])
        .filter(Boolean);
      if (fields.length) entries.push({ fields, unique: attr[1] === 'unique' });
    }
    result.set(modelName, entries);
  }
  return result;
}

async function main() {
  const schemaText = await fs.readFile(SCHEMA_PATH, 'utf8');
  const dmmf = await getDMMF({ datamodel: schemaText });
  const models = dmmf.datamodel.models;
  const declaredIndexes = await parseIndexDeclarations(schemaText);

  // ---- 1. apply migrations -------------------------------------------------
  const admin = new pg.Client({ connectionString: DATABASE_URL });
  await admin.connect();
  await admin.query('DROP SCHEMA public CASCADE');
  await admin.query('CREATE SCHEMA public');

  const entries = (await fs.readdir(MIGRATIONS_DIR, { withFileTypes: true }))
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();

  for (const dir of entries) {
    const sql = await fs.readFile(path.join(MIGRATIONS_DIR, dir, 'migration.sql'), 'utf8');
    process.stdout.write(`applying ${dir} (${sql.length} bytes)... `);
    await admin.query('BEGIN');
    try {
      await admin.query(sql);
      await admin.query('COMMIT');
      console.log('ok');
    } catch (err) {
      await admin.query('ROLLBACK');
      console.log('FAILED');
      throw new Error(`migration ${dir} falhou: ${err.message}`);
    }
  }

  const serverVersion = (await admin.query('SHOW server_version')).rows[0].server_version;

  // ---- 2. read the real structure -----------------------------------------
  const tables = (
    await admin.query(
      `SELECT c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind = 'r' ORDER BY 1`,
    )
  ).rows.map((r) => r.name);

  const columns = (
    await admin.query(
      `SELECT table_name, column_name, data_type, is_nullable, column_default,
              numeric_precision, numeric_scale, datetime_precision
       FROM information_schema.columns WHERE table_schema = 'public'`,
    )
  ).rows;

  const indexes = (
    await admin.query(
      `SELECT t.relname AS table_name, i.relname AS index_name, ix.indisunique AS is_unique,
              array_agg(a.attname::text ORDER BY array_position(ix.indkey, a.attnum)) AS cols
       FROM pg_class t
       JOIN pg_index ix ON t.oid = ix.indrelid
       JOIN pg_class i ON i.oid = ix.indexrelid
       JOIN pg_namespace n ON n.oid = t.relnamespace
       JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(ix.indkey)
       WHERE n.nspname = 'public' AND NOT ix.indisprimary
       GROUP BY 1, 2, 3`,
    )
  ).rows;

  const constraints = (
    await admin.query(
      `SELECT cl.relname AS table_name, con.conname, con.contype, con.confdeltype,
              fcl.relname AS ref_table,
              (SELECT array_agg(a.attname::text ORDER BY array_position(con.conkey, a.attnum))
                 FROM pg_attribute a WHERE a.attrelid = con.conrelid AND a.attnum = ANY(con.conkey)) AS cols,
              (SELECT array_agg(a.attname::text ORDER BY array_position(con.confkey, a.attnum))
                 FROM pg_attribute a WHERE a.attrelid = con.confrelid AND a.attnum = ANY(con.confkey)) AS ref_cols
       FROM pg_constraint con
       JOIN pg_class cl ON cl.oid = con.conrelid
       JOIN pg_namespace n ON n.oid = cl.relnamespace
       LEFT JOIN pg_class fcl ON fcl.oid = con.confrelid
       WHERE n.nspname = 'public' AND con.contype IN ('p', 'f', 'u')`,
    )
  ).rows;

  await admin.end();

  // ---- 3. compare ----------------------------------------------------------
  const expectedTables = new Set(models.map((m) => m.dbName || m.name));
  for (const t of tables) {
    if (!expectedTables.has(t)) note(`tabela extra no banco, não existe no schema.prisma: "${t}"`);
  }
  for (const t of expectedTables) {
    if (!tables.includes(t)) note(`tabela ausente no banco: "${t}"`);
  }

  for (const model of models) {
    const table = model.dbName || model.name;
    const cols = columns.filter((c) => c.table_name === table);
    const colNames = new Set(cols.map((c) => c.column_name));
    const scalarFields = model.fields.filter((f) => f.kind !== 'object');

    for (const field of scalarFields) {
      const column = field.dbName || field.name;
      const actual = cols.find((c) => c.column_name === column);
      if (!actual) {
        note(`${table}.${column}: coluna ausente (campo ${model.name}.${field.name})`);
        continue;
      }
      colNames.delete(column);

      const expected = TYPE_MAP[field.type];
      if (!expected) {
        note(`${table}.${column}: tipo Prisma sem mapeamento no verificador: ${field.type}`);
        continue;
      }
      if (actual.data_type !== expected.data_type) {
        note(`${table}.${column}: tipo esperado ${expected.data_type}, banco tem ${actual.data_type}`);
      }
      if (expected.numeric_precision !== undefined && Number(actual.numeric_precision) !== expected.numeric_precision) {
        note(`${table}.${column}: precisão esperada ${expected.numeric_precision}, banco tem ${actual.numeric_precision}`);
      }
      if (expected.numeric_scale !== undefined && Number(actual.numeric_scale) !== expected.numeric_scale) {
        note(`${table}.${column}: escala esperada ${expected.numeric_scale}, banco tem ${actual.numeric_scale}`);
      }
      if (expected.datetime_precision !== undefined && Number(actual.datetime_precision) !== expected.datetime_precision) {
        note(`${table}.${column}: precisão temporal esperada ${expected.datetime_precision}, banco tem ${actual.datetime_precision}`);
      }

      const nullable = actual.is_nullable === 'YES';
      if (nullable === field.isRequired) {
        note(`${table}.${column}: nullability incompatível (isRequired=${field.isRequired}, banco nullable=${nullable})`);
      }

      const dbDefault = normalizeDefault(actual.column_default);
      const d = field.default;
      if (d && typeof d === 'object' && d.name === 'now') {
        if (!dbDefault || !/CURRENT_TIMESTAMP/i.test(dbDefault)) {
          note(`${table}.${column}: default @now esperado, banco tem ${dbDefault ?? 'NULL'}`);
        }
      } else if (d && typeof d === 'object' && d.name === 'autoincrement') {
        if (!dbDefault || !/nextval/i.test(dbDefault)) {
          note(`${table}.${column}: default autoincrement esperado, banco tem ${dbDefault ?? 'NULL'}`);
        }
      } else if (d && typeof d === 'object' && (d.name === 'cuid' || d.name === 'uuid')) {
        // Generated by the Prisma Client, never by the database.
        if (dbDefault !== null) note(`${table}.${column}: ${d.name}() é gerado no client; banco não deveria ter default (${dbDefault})`);
      } else if (d !== undefined && d !== null && typeof d !== 'object') {
        const expectedDefault = typeof d === 'string' ? d : String(d);
        const actualDefault = dbDefault === null ? null : dbDefault.replace(/^'|'$/g, '');
        if (actualDefault !== expectedDefault) {
          note(`${table}.${column}: default esperado ${expectedDefault}, banco tem ${dbDefault ?? 'NULL'}`);
        }
      } else if (dbDefault !== null && !field.isUpdatedAt) {
        note(`${table}.${column}: banco tem default ${dbDefault} mas o campo não declara default`);
      }
    }

    for (const extra of colNames) {
      note(`${table}.${extra}: coluna extra no banco, não existe no schema.prisma`);
    }

    // Primary key
    const pk = constraints.find((c) => c.table_name === table && c.contype === 'p');
    const expectedPk = model.primaryKey ? model.primaryKey.fields : model.fields.filter((f) => f.isId).map((f) => f.dbName || f.name);
    if (!pk) {
      note(`${table}: sem chave primária`);
    } else if (JSON.stringify(pk.cols) !== JSON.stringify(expectedPk)) {
      note(`${table}: PK esperada [${expectedPk}], banco tem [${pk.cols}]`);
    }

    // Uniques: field-level @unique + @@unique([...])
    const tableIndexes = indexes.filter((i) => i.table_name === table);
    const expectedUniques = [];
    for (const field of scalarFields) if (field.isUnique) expectedUniques.push([field.dbName || field.name]);
    for (const group of model.uniqueFields || []) expectedUniques.push(group.map((f) => f));

    for (const cols of expectedUniques) {
      const found = tableIndexes.find((i) => i.is_unique && JSON.stringify(i.cols) === JSON.stringify(cols));
      if (!found) note(`${table}: índice UNIQUE ausente para (${cols.join(', ')})`);
    }
    for (const index of tableIndexes.filter((i) => i.is_unique)) {
      const expected = expectedUniques.some((cols) => JSON.stringify(cols) === JSON.stringify(index.cols));
      if (!expected) note(`${table}: UNIQUE extra no banco para (${index.cols.join(', ')}) — ${index.index_name}`);
    }

    // @@index declarations
    const declared = declaredIndexes.get(model.name) || [];
    for (const decl of declared) {
      const cols = decl.fields.map((f) => {
        const field = model.fields.find((x) => x.name === f);
        return field ? field.dbName || field.name : f;
      });
      const found = tableIndexes.find(
        (i) => i.is_unique === decl.unique && JSON.stringify(i.cols) === JSON.stringify(cols),
      );
      if (!found) {
        note(`${table}: índice ${decl.unique ? 'UNIQUE ' : ''}ausente para (${cols.join(', ')}) declarado no schema`);
      }
    }
    for (const index of tableIndexes.filter((i) => !i.is_unique)) {
      const expected = declared.some((d) => !d.unique && JSON.stringify(d.fields) === JSON.stringify(index.cols));
      if (!expected) note(`${table}: índice extra no banco para (${index.cols.join(', ')}) — ${index.index_name}`);
    }

    // Foreign keys
    const relations = model.fields.filter((f) => f.kind === 'object' && (f.relationFromFields || []).length);
    const fks = constraints.filter((c) => c.table_name === table && c.contype === 'f');
    for (const rel of relations) {
      const cols = rel.relationFromFields;
      const target = models.find((m) => m.name === rel.type);
      const refTable = target ? target.dbName || target.name : rel.type;
      const refCols = rel.relationToFields && rel.relationToFields.length ? rel.relationToFields : ['id'];
      const found = fks.find(
        (fk) =>
          JSON.stringify(fk.cols) === JSON.stringify(cols) &&
          fk.ref_table === refTable &&
          JSON.stringify(fk.ref_cols) === JSON.stringify(refCols),
      );
      if (!found) {
        note(`${table}: FK ausente (${cols.join(', ')}) -> ${refTable}(${refCols.join(', ')}) [${model.name}.${rel.name}]`);
        continue;
      }
      const expectedDelete = rel.relationOnDelete || 'SetNull';
      const actualDelete = FK_DELETE[found.confdeltype] ?? `desconhecida(${found.confdeltype})`;
      if (actualDelete !== expectedDelete) {
        note(`${table}.${rel.name}: ON DELETE esperado ${expectedDelete}, banco tem ${actualDelete}`);
      }
      fks.splice(fks.indexOf(found), 1);
    }
    for (const extra of fks) {
      note(`${table}: FK extra no banco (${extra.cols.join(', ')}) -> ${extra.ref_table} — ${extra.conname}`);
    }
  }

  // ---- 4. report -----------------------------------------------------------
  console.log('');
  console.log(`PostgreSQL ${serverVersion}`);
  console.log(`migrations aplicadas: ${entries.join(', ')}`);
  console.log(`modelos no schema: ${models.length} | tabelas no banco: ${tables.length}`);
  console.log(`colunas: ${columns.length} | índices (não-PK): ${indexes.length} | constraints: ${constraints.length}`);

  if (problems.length) {
    console.error(`\nDRIFT: ${problems.length} divergência(s) entre schema.prisma e o banco migrado:`);
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(2);
  }
  console.log('\nOK: o banco migrado reproduz o schema.prisma (tabelas, colunas, tipos, defaults, PKs, uniques, índices e FKs).');
}

main().catch((err) => {
  console.error('FALHA:', err.message);
  process.exit(1);
});
