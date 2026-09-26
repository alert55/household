"""Cross-check row-level security coverage across all migrations.

Three failure modes:
  * a table with no RLS at all       -> readable by anyone with the anon key
  * RLS on, but no policy            -> deny-all, so the app silently sees nothing
  * a view without security_invoker  -> runs as its owner and reads past RLS

Pass every migration, in order, as one file:

    cat supabase/migrations/*.sql > /tmp/all.sql
    uv run --with pglast python tools/rlscheck.py /tmp/all.sql
"""
import re
import sys
import pglast
from pglast import ast

sql = open(sys.argv[1], encoding="utf-8").read()
stmts = pglast.parse_sql(sql)

created, rls_on, policies = [], set(), {}
views = {}  # name -> declared security_invoker? (last definition wins)

for raw in stmts:
    s = raw.stmt
    if isinstance(s, ast.ViewStmt):
        invoker = False
        for opt in s.options or []:
            if getattr(opt, "defname", None) == "security_invoker":
                arg = getattr(opt, "arg", None)
                val = getattr(arg, "sval", None) or getattr(arg, "boolval", None) or getattr(arg, "ival", None)
                invoker = str(val).lower() in ("true", "on", "1", "t", "boolean(boolval=true)") or val is True
                if arg is None:  # WITH (security_invoker) alone means true
                    invoker = True
        views[s.view.relname] = invoker
    elif isinstance(s, ast.CreateStmt):
        created.append(s.relation.relname)
    elif isinstance(s, ast.AlterTableStmt):
        for cmd in s.cmds or []:
            if getattr(cmd, "subtype", None) == pglast.enums.parsenodes.AlterTableType.AT_EnableRowSecurity:
                rls_on.add(s.relation.relname)
    elif isinstance(s, ast.CreatePolicyStmt):
        policies.setdefault(s.table.relname, []).append(s.policy_name)

# Policies created by 0001's DO-block format() loop.
block = re.search(r"foreach t in array array\[(.*?)\]", sql, re.S)
looped = set(re.findall(r"'([a-z_]+)'", block.group(1))) if block else set()
for t in looped:
    policies.setdefault(t, []).append("<generated>_read")

print(f"tables created: {len(created)}\n")

unprotected = [t for t in created if t not in rls_on]
denyall = sorted(t for t in rls_on if t not in policies)
leaky = sorted(v for v, inv in views.items() if not inv)

print("DANGEROUS - table with no RLS (world readable):")
print("  " + (", ".join(unprotected) if unprotected else "none"))
print()
print("BROKEN - RLS enabled but no policy (deny-all):")
print("  " + (", ".join(denyall) if denyall else "none"))
print()
print("DANGEROUS - view without security_invoker (runs as owner, bypasses RLS):")
print("  " + (", ".join(leaky) if leaky else "none"))
print()
print("coverage:")
for t in created:
    n = len(policies.get(t, []))
    print(f"  {'ok ' if t in rls_on and n else 'FAIL'}  {t:<20} rls={'yes' if t in rls_on else 'NO':<3} policies={n}")

sys.exit(1 if unprotected or denyall or leaky else 0)
