import 'dotenv/config';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL is required for db:sync');
  process.exit(1);
}

const prismaBin = fileURLToPath(new URL('../node_modules/.bin/prisma', import.meta.url));
const refreshTokenFamilySql = fileURLToPath(new URL('./sql/pkg21-refresh-token-family.sql', import.meta.url));
const searchVectorPrepareSql = fileURLToPath(new URL('./sql/pkg11-search-vector-prepare.sql', import.meta.url));
const searchSql = fileURLToPath(new URL('./sql/pkg11-search-vector.sql', import.meta.url));
const psqlUrl = new URL(databaseUrl);
// `schema` is understood by Prisma but rejected by libpq/psql. The SQL file
// qualifies its objects, so removing this client-only option is safe.
psqlUrl.searchParams.delete('schema');

const familyMigrationResult = spawnSync('psql', [psqlUrl.toString(), '-v', 'ON_ERROR_STOP=1', '-f', refreshTokenFamilySql], {
  env: process.env,
  stdio: 'inherit',
});
if (familyMigrationResult.status !== 0) process.exit(familyMigrationResult.status ?? 1);

const searchVectorPrepareResult = spawnSync('psql', [psqlUrl.toString(), '-v', 'ON_ERROR_STOP=1', '-f', searchVectorPrepareSql], {
  env: process.env,
  stdio: 'inherit',
});
if (searchVectorPrepareResult.status !== 0) process.exit(searchVectorPrepareResult.status ?? 1);

const prismaResult = spawnSync(prismaBin, ['db', 'push'], {
  cwd: fileURLToPath(new URL('..', import.meta.url)),
  env: process.env,
  stdio: 'inherit',
});
if (prismaResult.status !== 0) process.exit(prismaResult.status ?? 1);

const searchResult = spawnSync('psql', [psqlUrl.toString(), '-v', 'ON_ERROR_STOP=1', '-f', searchSql], {
  env: process.env,
  stdio: 'inherit',
});
if (searchResult.status !== 0) process.exit(searchResult.status ?? 1);
