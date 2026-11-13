/* eslint-disable @typescript-eslint/no-require-imports, no-undef -- CommonJS tooling script, executed directly by Node. */
/**
 * Offline Prisma client generation for the audit sandbox.
 *
 * `prisma generate` cannot run here: it downloads the query/schema engine
 * binaries from binaries.prisma.sh, which is outside this sandbox's network
 * allowlist. The generated *client* (types + JS) does not need those binaries to
 * be written — only to be used. So this script drives Prisma's own generator
 * directly, with downloads skipped and the engine paths pointed at placeholders:
 *
 *   getGenerators({ registry: { 'prisma-client-js': rpc(generator-build) },
 *                   skipDownload: true, noEngine: true, binaryPathsOverride })
 *
 * The generator resolves `output` relative to the schema's directory, which
 * would land in `prisma/.prisma/client`. To keep the emitted `relativePath`
 * (used by the client to find its runtime) correct for `node_modules`, the
 * schema is copied next to the original with an explicit output. The copy and
 * any intermediate directory are removed afterwards; the repo's schema.prisma
 * is never modified.
 *
 * Result: a complete `node_modules/.prisma/client` (real index.d.ts, so tsc
 * checks the actual schema-derived types). Queries still cannot execute,
 * because no engine binary exists. Every database test in this repo therefore
 * mocks `@/lib/db`.
 *
 * Usage: node /home/user/audit-tools/gen-types.cjs
 */
const fs = require('fs');
const path = require('path');

const REPO = '/home/user/kiteos';
const SCHEMA = path.join(REPO, 'prisma/schema.prisma');
const TMP_SCHEMA = path.join(REPO, 'prisma/schema.offline-gen.prisma');
const OUT = path.join(REPO, 'node_modules/.prisma/client');
const GENERATOR = path.join(REPO, 'node_modules/@prisma/client/generator-build/index.js');
const DUMMY_ENGINE = '/tmp/prisma-engine-placeholder';

function writeTmpSchema() {
  const schema = fs.readFileSync(SCHEMA, 'utf8');
  const patched = schema.replace(
    'generator client {\n  provider = "prisma-client-js"\n}',
    'generator client {\n  provider = "prisma-client-js"\n  output   = "../node_modules/.prisma/client"\n}',
  );
  if (patched === schema) throw new Error('could not patch the generator block');
  fs.writeFileSync(TMP_SCHEMA, patched);
}

async function main() {
  const { getGenerators } = require('/home/user/audit-tools/node_modules/@prisma/internals');
  const clientVersion = require(path.join(REPO, 'node_modules/@prisma/client/package.json')).version;

  fs.writeFileSync(DUMMY_ENGINE, 'placeholder: query engine binary is not downloadable offline\n');
  writeTmpSchema();

  let generators = [];
  try {
    generators = await getGenerators({
      schemaPath: TMP_SCHEMA,
      version: clientVersion,
      printDownloadProgress: () => {},
      skipDownload: true,
      noEngine: true,
      allowNoModels: false,
      binaryPathsOverride: {
        queryEngine: DUMMY_ENGINE,
        libqueryEngine: DUMMY_ENGINE,
        schemaEngine: DUMMY_ENGINE,
      },
      registry: {
        'prisma-client-js': { type: 'rpc', generatorPath: GENERATOR, isNode: true },
      },
    });

    for (const generator of generators) {
      await generator.generate();
    }
  } finally {
    await Promise.all(generators.map((g) => g.stop()));
    fs.rmSync(TMP_SCHEMA, { force: true });
    fs.rmSync(path.join(REPO, 'prisma/.prisma'), { recursive: true, force: true });
  }

  const dts = path.join(OUT, 'index.d.ts');
  if (!fs.existsSync(dts)) throw new Error(`generation produced no ${dts}`);
  const types = fs.readFileSync(dts, 'utf8');
  // Guard against a partial emit: delegates and runtime types must all be there.
  for (const needle of ['namespace Prisma', 'Decimal', 'ITXClientDenyList', 'get subscription()', 'get user()', 'get serviceOrder()']) {
    if (!types.includes(needle)) throw new Error(`generated types are missing ${needle}`);
  }

  const js = path.join(OUT, 'index.js');
  if (!fs.existsSync(js)) throw new Error(`generation produced no ${js}`);
  const { Prisma, PrismaClient } = require(path.join(REPO, 'node_modules/@prisma/client'));
  if (typeof Prisma?.Decimal !== 'function') throw new Error('Prisma.Decimal unavailable after generation');
  if (typeof PrismaClient !== 'function') throw new Error('PrismaClient unavailable after generation');
  new PrismaClient({ log: ['error'] }); // must be constructible without an engine

  console.log('generated client at', OUT, '| index.d.ts bytes:', types.length);
}

main().catch((err) => {
  console.error('FAILED:', err && err.stack ? err.stack : err);
  process.exit(1);
});
