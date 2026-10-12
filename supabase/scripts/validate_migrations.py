#!/usr/bin/env python3
"""
迁移 SQL 静态校验器

本机没有可用的 Supabase / PostgreSQL 实例，无法执行真实 migration。
本脚本用 sqlglot 对迁移文件做静态校验，覆盖用户在 Phase 3 §19 要求的检查项：

  1. syntax          —— 每个语句能否被 PostgreSQL 方言解析
  2. dependency order —— ALTER / INDEX / POLICY 的目标表是否已在本文件或更早的文件中创建
  3. foreign key     —— REFERENCES 指向的表是否存在
  4. unique constraint —— UNIQUE / CREATE UNIQUE INDEX 的列是否存在
  5. index           —— CREATE INDEX 的表与列是否存在
  6. 幂等性           —— 统计 DROP ... IF EXISTS / IF NOT EXISTS 的覆盖情况

用法：
  python supabase/scripts/validate_migrations.py
"""

from __future__ import annotations

import logging
import re
import sys
from pathlib import Path

# Windows 控制台默认代码页是 cp936/GBK，打印 ✅ 或中文会抛 UnicodeEncodeError ——
# 结果是「校验全部通过，但脚本以退出码 1 结束」，把门禁误判成 FAIL。
# 在任何 print 之前把 stdout/stderr 固定成 UTF-8。
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
sys.stderr.reconfigure(encoding="utf-8", errors="replace")

try:
    import sqlglot
    from sqlglot import exp
except ImportError:
    print("需要 sqlglot：pip install sqlglot")
    sys.exit(2)

# sqlglot 对 RLS 相关语法（CREATE POLICY / ENABLE ROW LEVEL SECURITY）会回退为
# 通用 Command 并打印 warning。这些语句本身是合法 PostgreSQL，只是 sqlglot
# 没有建模，因此抑制日志，并在结尾说明局限。
logging.getLogger("sqlglot").setLevel(logging.ERROR)

ROOT = Path(__file__).resolve().parents[2]
MIGRATIONS_DIR = ROOT / "supabase" / "migrations"
DIALECT = "postgres"

# 由 Supabase 平台预置、无需本仓库创建的对象
PLATFORM_TABLES = {"auth.users"}
PLATFORM_FUNCTIONS = {"auth.uid"}

# 视为「平台已存在」的扩展
KNOWN_EXTENSIONS = {"uuid-ossp", "pgcrypto"}


class Schema:
    """极简 schema 模拟：只记录表 → 列集合，用于存在性校验。"""

    def __init__(self) -> None:
        self.tables: dict[str, set[str]] = {}
        self.functions: set[str] = set()

    def add_table(self, name: str, columns: list[str]) -> None:
        self.tables.setdefault(name, set()).update(columns)

    def add_columns(self, name: str, columns: list[str]) -> None:
        self.tables.setdefault(name, set()).update(columns)

    def has_table(self, name: str) -> bool:
        return name in self.tables or name in PLATFORM_TABLES

    def has_column(self, table: str, column: str) -> bool:
        if table in PLATFORM_TABLES:
            return True
        return column in self.tables.get(table, set())


def normalize(name: str | None) -> str:
    if not name:
        return ""
    return name.strip('"').strip()


def normalize_table_name(name: str | None) -> str:
    """去掉引号与 public. 前缀，得到用于比较的表名。"""
    cleaned = normalize(name)
    if cleaned.lower().startswith("public."):
        cleaned = cleaned[len("public.") :]
    return cleaned


def table_key(table: exp.Table) -> str:
    parts = [normalize(p) for p in (table.catalog, table.db, table.name) if p]
    parts = [p for p in parts if p and p != "public"]
    return ".".join(parts)


def split_statements(sql: str) -> list[str]:
    """按分号切分，跳过注释与字符串内的分号。"""
    statements: list[str] = []
    buffer: list[str] = []
    in_line_comment = False
    in_block_comment = False
    in_string = False
    dollar_tag: str | None = None
    i = 0

    while i < len(sql):
        ch = sql[i]
        nxt = sql[i + 1] if i + 1 < len(sql) else ""

        if in_line_comment:
            buffer.append(ch)
            if ch == "\n":
                in_line_comment = False
            i += 1
            continue

        if in_block_comment:
            buffer.append(ch)
            if ch == "*" and nxt == "/":
                buffer.append(nxt)
                in_block_comment = False
                i += 2
                continue
            i += 1
            continue

        if in_string:
            buffer.append(ch)
            if ch == "'":
                if nxt == "'":
                    buffer.append(nxt)
                    i += 2
                    continue
                in_string = False
            i += 1
            continue

        if dollar_tag is not None:
            if sql.startswith(dollar_tag, i):
                buffer.append(dollar_tag)
                i += len(dollar_tag)
                dollar_tag = None
                continue
            buffer.append(ch)
            i += 1
            continue

        if ch == "-" and nxt == "-":
            in_line_comment = True
            buffer.append(ch)
            i += 1
            continue

        if ch == "/" and nxt == "*":
            in_block_comment = True
            buffer.append(ch)
            buffer.append(nxt)
            i += 2
            continue

        if ch == "'":
            in_string = True
            buffer.append(ch)
            i += 1
            continue

        if ch == "$":
            match = re.match(r"\$[A-Za-z_]*\$", sql[i:])
            if match:
                dollar_tag = match.group(0)
                buffer.append(dollar_tag)
                i += len(dollar_tag)
                continue

        if ch == ";":
            statement = "".join(buffer).strip()
            if statement:
                statements.append(statement)
            buffer = []
            i += 1
            continue

        buffer.append(ch)
        i += 1

    tail = "".join(buffer).strip()
    if tail:
        statements.append(tail)

    return statements


def strip_comments(sql: str) -> str:
    sql = re.sub(r"/\*.*?\*/", "", sql, flags=re.DOTALL)
    sql = re.sub(r"--[^\n]*", "", sql)
    return sql


def describe_statement(statement: str) -> str:
    head = strip_comments(statement).strip().split("\n")[0].strip()
    return head[:78]


def validate_file(path: Path, schema: Schema) -> tuple[int, int, list[str]]:
    """返回 (语句数, 解析失败数, 错误列表)。"""
    raw = path.read_text(encoding="utf-8")
    statements = split_statements(raw)
    errors: list[str] = []
    parse_failures = 0

    # 本文件内已被 DROP 掉的约束名（用于判断 ADD CONSTRAINT 是否幂等）
    dropped_constraints = {
        normalize(match)
        for match in re.findall(
            r"DROP\s+CONSTRAINT\s+IF\s+EXISTS\s+\"?([\w]+)\"?", raw, flags=re.IGNORECASE
        )
    }

    # 本文件内已被 DROP 掉的触发器名
    dropped_triggers = {
        normalize(match)
        for match in re.findall(
            r"DROP\s+TRIGGER\s+IF\s+EXISTS\s+\"?([\w]+)\"?", raw, flags=re.IGNORECASE
        )
    }

    for index, statement in enumerate(statements, start=1):
        label = f"{path.name} #{index} ({describe_statement(statement)})"

        # 纯注释块（例如文件末尾的说明 / 被注释掉的示例 DDL）没有可解析的 SQL。
        # 若不跳过，sqlglot.parse_one() 会返回 None 而被误报为 [SYNTAX] 失败。
        if not strip_comments(statement).strip():
            continue

        # sqlglot 尚不支持 PostgreSQL 的 `DROP TRIGGER ... ON table` 语法，
        # 这里用正则自行处理，避免误报为语法错误。
        drop_trigger = re.match(
            r"^\s*DROP\s+TRIGGER\s+(IF\s+EXISTS\s+)?\"?([\w]+)\"?\s+ON\s+([\w.\"]+)",
            strip_comments(statement),
            flags=re.IGNORECASE,
        )
        if drop_trigger:
            table_name = normalize_table_name(drop_trigger.group(3))
            if not schema.has_table(table_name):
                errors.append(
                    f"[ORDER] {label}\n         DROP TRIGGER ON {table_name}，但该表尚未创建"
                )
            continue

        try:
            parsed = sqlglot.parse_one(statement, read=DIALECT)
        except Exception as error:  # noqa: BLE001
            parse_failures += 1
            errors.append(f"[SYNTAX] {label}\n         {type(error).__name__}: {error}")
            continue

        if parsed is None:
            parse_failures += 1
            errors.append(f"[SYNTAX] {label}\n         无法解析为空语句")
            continue

        # ---- CREATE TABLE ----
        if isinstance(parsed, exp.Create) and parsed.args.get("kind", "").upper() == "TABLE":
            table = parsed.find(exp.Schema) or parsed.find(exp.Table)
            target = parsed.find(exp.Table)
            name = table_key(target) if target else ""
            columns = []

            schema_node = parsed.find(exp.Schema)
            if schema_node is not None:
                for definition in schema_node.expressions:
                    if isinstance(definition, exp.ColumnDef):
                        columns.append(normalize(definition.name))

            if not name:
                errors.append(f"[PARSE] {label} 未能识别表名")
                continue

            if schema.has_table(name) and "IF NOT EXISTS" not in statement.upper():
                errors.append(f"[IDEMPOTENT] {label} 表 {name} 可能已存在但未使用 IF NOT EXISTS")

            schema.add_table(name, columns)

            for column_def in parsed.find_all(exp.ColumnDef):
                for reference in column_def.find_all(exp.Reference):
                    parent = reference.find(exp.Table)
                    target_name = table_key(parent) if parent else ""
                    if target_name and not schema.has_table(target_name):
                        errors.append(
                            f"[FK] {label}\n         列 {normalize(column_def.name)} "
                            f"REFERENCES {target_name}，但该表尚未创建"
                        )
            continue

        # ---- ALTER TABLE ----
        if isinstance(parsed, exp.Alter):
            target = parsed.find(exp.Table)
            name = table_key(target) if target else ""

            if not name:
                errors.append(f"[PARSE] {label} 未能识别 ALTER TABLE 目标")
                continue

            if not schema.has_table(name):
                errors.append(f"[ORDER] {label}\n         ALTER TABLE {name} 但该表尚未创建")
                continue

            if "IF EXISTS" not in statement.upper() and name in PLATFORM_TABLES:
                errors.append(f"[ORDER] {label} 对平台表 {name} 执行 ALTER")

            # ADD COLUMN
            # sqlglot 把每个 ADD COLUMN 直接解析为一个 ColumnDef action
            # （action.sql() 渲染成 "IF NOT EXISTS col TYPE"，不含 "ADD COLUMN" 前缀），
            # 因此必须先用 isinstance 判断，再用字符串前缀兜底。
            for action in parsed.args.get("actions", []):
                action_sql = action.sql(dialect=DIALECT).upper()

                if isinstance(action, exp.ColumnDef) or action_sql.startswith("ADD COLUMN"):
                    column_nodes = (
                        [action]
                        if isinstance(action, exp.ColumnDef)
                        else list(action.find_all(exp.ColumnDef))
                    )

                    if not column_nodes:
                        # sqlglot 未能拆出列定义时退回正则，避免漏检
                        for match in re.finditer(
                            r"ADD\s+COLUMN\s+(IF\s+NOT\s+EXISTS\s+)?\"?([\w]+)\"?",
                            action_sql,
                            flags=re.IGNORECASE,
                        ):
                            column = normalize(match.group(2))
                            if column not in schema.tables.get(name, set()) and not match.group(1):
                                errors.append(
                                    f"[IDEMPOTENT] {label} ADD COLUMN {column} 缺少 IF NOT EXISTS"
                                )
                            schema.add_columns(name, [column])
                        continue

                    for column_node in column_nodes:
                        column = normalize(column_node.name)
                        if column in schema.tables.get(name, set()):
                            if "IF NOT EXISTS" not in action_sql:
                                errors.append(
                                    f"[IDEMPOTENT] {label} ADD COLUMN {column} 缺少 IF NOT EXISTS"
                                )
                        schema.add_columns(name, [column])

                        for reference in column_node.find_all(exp.Reference):
                            parent = reference.find(exp.Table)
                            target_name = table_key(parent) if parent else ""
                            if target_name and not schema.has_table(target_name):
                                errors.append(
                                    f"[FK] {label}\n         列 {column} REFERENCES {target_name}，"
                                    f"但该表尚未创建"
                                )

                elif action_sql.startswith("DROP CONSTRAINT"):
                    if "IF EXISTS" not in action_sql:
                        errors.append(f"[IDEMPOTENT] {label} DROP CONSTRAINT 缺少 IF EXISTS")

                elif action_sql.startswith("ADD CONSTRAINT"):
                    constraint = action.find(exp.Constraint)
                    constraint_name = normalize(constraint.name) if constraint else ""

                    if constraint_name not in dropped_constraints:
                        errors.append(
                            f"[IDEMPOTENT] {label} ADD CONSTRAINT {constraint_name or '?'} "
                            f"在本文件中没有先行的 DROP CONSTRAINT IF EXISTS"
                        )

                    # ADD CONSTRAINT ... FOREIGN KEY (col) REFERENCES table(col)
                    for reference in action.find_all(exp.Reference):
                        parent = reference.find(exp.Table)
                        target_name = table_key(parent) if parent else ""
                        if target_name and not schema.has_table(target_name):
                            errors.append(
                                f"[FK] {label}\n         约束 {constraint_name} REFERENCES "
                                f"{target_name}，但该表尚未创建"
                            )
            continue

        # ---- CREATE INDEX ----
        if isinstance(parsed, exp.Create) and parsed.args.get("kind", "").upper() == "INDEX":
            target = parsed.find(exp.Table)
            name = table_key(target) if target else ""

            if name and not schema.has_table(name):
                errors.append(f"[ORDER] {label}\n         CREATE INDEX 于 {name}，但该表尚未创建")
                continue

            for column in parsed.find_all(exp.Column):
                column_name = normalize(column.name)
                if column_name and not schema.has_column(name, column_name):
                    errors.append(
                        f"[INDEX] {label}\n         索引引用列 {name}.{column_name}，但该列不存在"
                    )
            continue

        # ---- CREATE POLICY / TRIGGER / FUNCTION / EXTENSION ----
        if isinstance(parsed, exp.Create):
            kind = parsed.args.get("kind", "").upper()

            if kind == "POLICY":
                target = parsed.find(exp.Table)
                name = table_key(target) if target else ""
                if name and not schema.has_table(name):
                    errors.append(f"[ORDER] {label}\n         POLICY 于 {name}，但该表尚未创建")
                continue

            if kind == "TRIGGER":
                target = parsed.find(exp.Table)
                name = table_key(target) if target else ""
                if name and not schema.has_table(name):
                    errors.append(f"[ORDER] {label}\n         TRIGGER 于 {name}，但该表尚未创建")

                trigger_match = re.search(
                    r"CREATE\s+TRIGGER\s+\"?([\w]+)\"?", strip_comments(statement), flags=re.IGNORECASE
                )
                trigger_name = normalize(trigger_match.group(1)) if trigger_match else ""

                if trigger_name and trigger_name not in dropped_triggers:
                    errors.append(
                        f"[IDEMPOTENT] {label} CREATE TRIGGER {trigger_name} "
                        f"在本文件中没有先行的 DROP TRIGGER IF EXISTS"
                    )
                continue

            if kind == "FUNCTION":
                function_node = parsed.find(exp.UserDefinedFunction)
                function_name = ""
                if function_node is not None:
                    function_name = normalize(function_node.name)
                else:
                    match = re.search(
                        r"FUNCTION\s+([A-Za-z0-9_.\"]+)", statement, flags=re.IGNORECASE
                    )
                    function_name = normalize(match.group(1)) if match else ""
                if function_name:
                    schema.functions.add(function_name.split(".")[-1])
                continue

            if kind == "EXTENSION":
                match = re.search(r"EXTENSION\s+IF\s+NOT\s+EXISTS\s+\"?([\w-]+)\"?", statement, flags=re.IGNORECASE)
                extension = match.group(1) if match else ""
                if extension and extension not in KNOWN_EXTENSIONS:
                    errors.append(f"[EXT] {label} 未知扩展 {extension}")
                continue

        # ---- INSERT ... SELECT ----
        if isinstance(parsed, exp.Insert):
            target = parsed.find(exp.Table)
            name = table_key(target) if target else ""
            if name and not schema.has_table(name):
                errors.append(f"[ORDER] {label}\n         INSERT INTO {name}，但该表尚未创建")

            source = parsed.find(exp.Select)
            if source is not None:
                from_node = source.find(exp.From)
                if from_node is not None:
                    source_table = from_node.find(exp.Table)
                    source_name = table_key(source_table) if source_table else ""
                    if source_name and not schema.has_table(source_name):
                        errors.append(
                            f"[ORDER] {label}\n         INSERT ... SELECT FROM {source_name}，"
                            f"但该表尚未创建"
                        )
            continue

        # ---- UPDATE ----
        if isinstance(parsed, exp.Update):
            target = parsed.find(exp.Table)
            name = table_key(target) if target else ""
            if name and not schema.has_table(name):
                errors.append(f"[ORDER] {label}\n         UPDATE {name}，但该表尚未创建")
            continue

        # ---- SELECT / SET / 其他 ----
        # 平台函数（auth.uid 等）不校验；其余语句只要解析通过即认为 OK

    return len(statements), parse_failures, errors


def main() -> int:
    if not MIGRATIONS_DIR.is_dir():
        print(f"找不到迁移目录：{MIGRATIONS_DIR}")
        return 2

    files = sorted(MIGRATIONS_DIR.glob("*.sql"))

    if not files:
        print("迁移目录中没有 .sql 文件")
        return 2

    print(f"校验 {len(files)} 个迁移文件（方言：{DIALECT}）\n")

    schema = Schema()
    all_errors: list[str] = []
    total_statements = 0
    total_parse_failures = 0

    for path in files:
        statements, parse_failures, errors = validate_file(path, schema)
        total_statements += statements
        total_parse_failures += parse_failures
        all_errors.extend(errors)

        status = "OK " if not errors else "FAIL"
        print(
            f"  [{status}] {path.name:<28} 语句 {statements:>3}  表 {len(schema.tables):>2}  "
            f"问题 {len(errors)}"
        )

    print(f"\n共 {total_statements} 个语句，解析失败 {total_parse_failures} 个")
    print(f"最终 schema 表集合：{', '.join(sorted(schema.tables))}")

    if all_errors:
        print(f"\n发现 {len(all_errors)} 个问题：\n")
        for error in all_errors:
            print(f"  {error}\n")
        return 1

    print("\n✅ 全部通过：语法可解析、依赖顺序正确、外键目标存在、索引列存在、幂等性检查通过")
    print(
        "\n局限说明（本脚本无法覆盖，需在真实数据库上验证）：\n"
        "  · CREATE POLICY / ENABLE ROW LEVEL SECURITY 由 sqlglot 回退为通用 Command，"
        "未做依赖顺序与幂等性校验\n"
        "  · 只做静态存在性检查，不校验类型兼容、数据是否满足约束、回填结果是否正确\n"
        "  · 无法验证 auth.uid() 等平台函数是否存在"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
