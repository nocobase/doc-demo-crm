import { spawnSync } from 'node:child_process';
import {
  closeSync,
  openSync,
  readFileSync,
  copyFileSync,
  existsSync,
  mkdtempSync,
  rmSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { expect, it } from 'vitest';

it('previews, clears edits, restores samples and works from a copied script', () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'crm-reset-test-'));
  const filename = path.join(directory, 'database.sqlite');
  const config = path.join(directory, 'config.yml');
  const script = path.join(directory, 'reset.mjs');
  copyFileSync('scripts/reset-tutorial.mjs', script);
  const env = {
    PATH: process.env.PATH,
    APP_CONFIG_FILE: config,
    DB_DIALECT: 'sqlite',
    DB_DATABASE: filename,
    DB_FILENAME: filename,
    APP_SAMPLE_DATA: 'false',
    NODE_ENV: 'test',
  };
  const execute = (command: string, args: string[], environment = env) => {
    const out = path.join(directory, 'stdout');
    const err = path.join(directory, 'stderr');
    const stdout = openSync(out, 'w');
    const stderr = openSync(err, 'w');
    try {
      const result = spawnSync(command, args, {
        env: environment,
        stdio: ['ignore', stdout, stderr],
      });
      if (result.error) throw result.error;
      return {
        status: result.status,
        stdout: readFileSync(out, 'utf8'),
        stderr: readFileSync(err, 'utf8'),
      };
    } finally {
      closeSync(stdout);
      closeSync(stderr);
    }
  };
  const run = (...args: string[]) =>
    execute(process.execPath, [script, ...args]);
  try {
    const init = execute('node_modules/.bin/nocobase', [
      'config',
      'init',
      '--config',
      config,
      '--dialect',
      'sqlite',
      '--json',
    ]);
    expect({ status: init.status, stderr: init.stderr }).toMatchObject({
      status: 0,
    });
    expect(run().status).toBe(2);
    expect(run('--unknown').status).toBe(2);
    const ambiguous = execute(process.execPath, [script, '--force'], {
      ...env,
      DB_DATABASE: '',
    });
    expect(ambiguous.status).toBe(1);
    expect(ambiguous.stderr).toContain('DB_FILENAME alone');
    const production = execute(process.execPath, [script, '--force'], {
      ...env,
      NODE_ENV: 'production',
    });
    expect(production.status).toBe(1);
    expect(existsSync(filename)).toBe(false);
    const preview = run('--dry-run');
    expect({ status: preview.status, stderr: preview.stderr }).toMatchObject({
      status: 0,
    });
    expect(JSON.parse(preview.stdout).status).toBe('success-noop');
    expect(existsSync(filename)).toBe(false);

    const inspect = (sql: string) => {
      const db = new DatabaseSync(filename);
      try {
        return db.prepare(sql).all();
      } finally {
        db.close();
      }
    };
    const samples = run('--force');
    expect({ status: samples.status, stderr: samples.stderr }).toMatchObject({
      status: 0,
    });
    expect(
      inspect("SELECT name FROM sqlite_master WHERE name = 'crm_customers'"),
    ).toHaveLength(1);
    expect(inspect('SELECT count(*) AS n FROM crm_customers')[0]?.n).toBe(3);
    inspect("UPDATE crm_customers SET name = 'Edited during class'");
    const reset = run('--force');
    expect({ status: reset.status, stderr: reset.stderr }).toMatchObject({
      status: 0,
    });
    expect(inspect('SELECT count(*) AS n FROM crm_customers')[0]?.n).toBe(3);
    expect(inspect('SELECT count(*) AS n FROM crm_contacts')[0]?.n).toBe(3);
    expect(inspect('SELECT count(*) AS n FROM crm_follow_ups')[0]?.n).toBe(3);
    expect(
      inspect(
        "SELECT count(*) AS n FROM crm_customers WHERE name = 'Edited during class'",
      )[0]?.n,
    ).toBe(0);
    const repeat = run('--force', '--samples');
    expect({ status: repeat.status, stderr: repeat.stderr }).toMatchObject({
      status: 0,
    });
    expect(inspect('SELECT count(*) AS n FROM crm_customers')[0]?.n).toBe(3);
    expect(
      inspect(
        "SELECT count(*) AS n FROM crm_customers WHERE name = 'Edited during class'",
      )[0]?.n,
    ).toBe(0);
    const failed = execute(process.execPath, [script, '--force'], {
      ...env,
      APP_CONFIG_FILE: path.join(directory, 'missing.yml'),
    });
    expect(failed.status).not.toBe(0);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}, 120_000);
