import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

// Resolve from the checkout, so a copy in ignored storage/ survives tag switches.
const args = process.argv.slice(2);
const allowed = new Set(['--help', '--dry-run', '--force', '--samples']);
if (args.some((arg) => !allowed.has(arg))) {
  console.error('Unknown option. Use --help.');
  process.exit(2);
}
if (args.includes('--help')) {
  console.log(`Usage: node scripts/reset-tutorial.mjs --dry-run
       node scripts/reset-tutorial.mjs --force

Run from the tutorial checkout root, after stopping its application.
Rebuild the main database using the CURRENT checkout's migrations and seeds.
All main-database records, accounts and sessions are removed; initial accounts
are recreated from configuration. Required seeds and sample seeds always run.
--samples is accepted for compatibility; samples are already enabled by default.
Configuration and uploaded files are retained. No backup is created.
APP_CONFIG_FILE and DB_* overrides are honored, just like nocobase db reset.`);
  process.exit(0);
}
if (!args.includes('--dry-run') && !args.includes('--force')) {
  console.error('Reset requires --force. Preview first with --dry-run.');
  process.exit(2);
}
try {
  // SQLite's config.database takes precedence over config.filename.
  if (process.env.DB_FILENAME && !process.env.DB_DATABASE) {
    throw new Error(
      'For SQLite isolation, set DB_DATABASE to the target file; DB_FILENAME alone may be overridden by config.yml.',
    );
  }
  const root = process.cwd();
  const manifest = JSON.parse(
    readFileSync(path.join(root, 'package.json'), 'utf8'),
  );
  if (
    manifest.name !== 'doc-demo-crm' ||
    process.env.NODE_ENV === 'production'
  ) {
    throw new Error('Run from the tutorial source checkout in development.');
  }
  const require = createRequire(path.join(root, 'package.json'));
  const cliManifest = require.resolve('@nocobase/app-cli/package.json');
  const cli = JSON.parse(readFileSync(cliManifest, 'utf8'));
  const result = spawnSync(
    process.execPath,
    [
      path.resolve(path.dirname(cliManifest), cli.bin.nocobase),
      'db',
      'reset',
      '--connection',
      'main',
      '--json',
      args.includes('--dry-run') ? '--dry-run' : '--force',
    ],
    {
      cwd: root,
      stdio: 'inherit',
      env: {
        ...process.env,
        APP_SAMPLE_DATA: 'true',
      },
    },
  );
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
