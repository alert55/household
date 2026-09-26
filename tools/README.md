# Checks

Run these before applying a new migration, or after changing date logic in
`data.js`. They need no database. The Python ones use `uv` to fetch `pglast`
(PostgreSQL's own parser) on the fly; the JavaScript ones need Node.

```bash
# Every migration and the seed parse as PostgreSQL
for f in supabase/migrations/*.sql supabase/seed.sql; do
  uv run --with pglast python tools/parsecheck.py "$f"
done

# Every function body compiles as PL/pgSQL
uv run --with pglast python tools/plpgsqlcheck.py supabase/migrations/*.sql supabase/seed.sql

# No table without row-level security, none deny-all, no view that reads past it
cat supabase/migrations/*.sql > /tmp/all.sql
uv run --with pglast python tools/rlscheck.py /tmp/all.sql

# Recurrence dates and timezone handling in data.js
node tools/recurcheck.js data.js
node tools/tzcheck.js data.js
```

| Check | Catches | Does not catch |
| --- | --- | --- |
| `parsecheck.py` | SQL syntax errors | Wrong column or table names |
| `plpgsqlcheck.py` | Broken function bodies: a missing `END`, a bad `IF` | Anything that needs a real catalog |
| `rlscheck.py` | A table anyone could read; a table nobody can; a view running as its owner | Policies that exist but say the wrong thing |
| `recurcheck.js` | Weekday numbering, the month-end clamp, backfilling | The database's copy of the same rules |
| `tzcheck.js` | Times or dates read in the browser's zone instead of the household's | — |

`rlscheck.py` is the one that matters most. The anon key ships in public code,
so a table or view that escapes row-level security is readable by anyone
(ADR 0004). It caught three such views before they were ever deployed.
