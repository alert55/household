"""Parse every PL/pgSQL body with Postgres's own PL/pgSQL parser.

The plain SQL parser treats a function body as an opaque string, so a typo
inside `pay_bill` or the seed's DO block passes it untouched. This compiles each
body as PL/pgSQL. It still cannot catch a wrong column name - that needs a real
catalog - but a broken IF, a missing END or a bad declaration will show.

    uv run --with pglast python tools/plpgsqlcheck.py supabase/migrations/*.sql supabase/seed.sql
"""
import os
import sys
import pglast
from pglast import ast

total = failed = 0

for path in sys.argv[1:]:
    sql = open(path, encoding="utf-8").read()
    for raw in pglast.parse_sql(sql):
        s = raw.stmt
        text = sql[raw.stmt_location: raw.stmt_location + raw.stmt_len] if raw.stmt_len else sql[raw.stmt_location:]

        if isinstance(s, ast.CreateFunctionStmt):
            lang = next((o.arg.sval for o in (s.options or []) if o.defname == "language"), None)
            if lang != "plpgsql":
                continue
            name = ".".join(n.sval for n in s.funcname)
            candidate = text
        elif isinstance(s, ast.DoStmt):
            body = next(o.arg.sval for o in s.args if o.defname == "as")
            name = "DO block"
            # parse_plpgsql wants a function; wrap the block in one.
            candidate = "create function _do_block() returns void language plpgsql as $body$" + body + "$body$"
        else:
            continue

        total += 1
        try:
            # parse_plpgsql_json, not parse_plpgsql: the latter decodes JSON that
            # pglast v8.4 emits malformed for every trigger function, so even a
            # correct trigger "fails". The raw parser still raises ParseError on
            # a real syntax error, which is the only thing being checked here.
            pglast.parser.parse_plpgsql_json(candidate)
        except Exception as exc:  # noqa: BLE001 - report any parser failure
            failed += 1
            print(f"FAIL  {os.path.basename(path)}  {name}: {exc}")

print(f"\nPL/pgSQL bodies parsed: {total}, failed: {failed}")
sys.exit(1 if failed else 0)
