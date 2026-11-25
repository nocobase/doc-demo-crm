# Reset a tutorial demonstration

Stop the application using this database before resetting it. Run commands from
the tutorial checkout root with its dependencies installed and config initialized.

```sh
node scripts/reset-tutorial.mjs --dry-run
node scripts/reset-tutorial.mjs --force
pnpm dev
```

The reset deletes **all main-database data**, including users, sessions, grants,
customers, contacts, follow-ups and migration history. It then applies the current
checkout's migrations, required initialization seeds and Sample seeds. The configured initial administrator is
recreated. Configuration, encryption keys, uploads and other storage files remain;
this is a database reset, not a full installation restore. Back up valuable data
separately. There is no automatic backup.

Sample data is loaded by default, restoring the English sample customers,
contacts, follow-ups, products, opportunity and quote. No extra option is needed,
even when the calling environment has `APP_SAMPLE_DATA=false`. Earlier edits are
discarded. `--samples` remains accepted for compatibility and has the same effect.
`--dry-run` previews the migrations and seeds without changing the database.

The script uses the installed NocoBase `db reset --connection main` command.
It honors `APP_CONFIG_FILE` and `DB_*` environment overrides, so check the target
configuration before running it. It refuses `NODE_ENV=production` and requires
explicit `--force` for execution. A failed reset exits nonzero and must be resolved
before starting the demonstration; reset is not an atomic backup/restore operation.

For a separate SQLite database, set `DB_DATABASE` to its absolute file path.
The SQLite driver prioritizes the configuration's `database` over `filename`;
`DB_FILENAME` alone does not reliably select another database. The helper refuses
that ambiguous override. Tests set both variables to the same temporary file.
