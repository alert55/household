"""Parse a migration with PostgreSQL's own grammar (libpg_query via pglast).

This proves the SQL is syntactically valid Postgres. It does NOT prove the
semantics: unknown columns, bad references and wrong policy logic all parse fine.

    uv run --with pglast python tools/parsecheck.py supabase/migrations/0001_initial_schema.sql
"""
import sys
import pglast

path = sys.argv[1]
sql = open(path, encoding="utf-8").read()

try:
    stmts = pglast.parse_sql(sql)
except pglast.parser.ParseError as exc:
    print(f"PARSE ERROR: {exc}")
    loc = getattr(exc, "location", None)
    if isinstance(loc, int) and loc >= 0:
        line = sql.count("\n", 0, loc) + 1
        start = sql.rfind("\n", 0, loc) + 1
        end = sql.find("\n", loc)
        print(f"  at line {line}: {sql[start:end if end != -1 else len(sql)].strip()}")
    sys.exit(1)

kinds = {}
for s in stmts:
    name = type(s.stmt).__name__
    kinds[name] = kinds.get(name, 0) + 1

print(f"OK - parsed {len(stmts)} statements as PostgreSQL\n")
for name, n in sorted(kinds.items(), key=lambda kv: (-kv[1], kv[0])):
    print(f"  {n:>3}  {name}")
