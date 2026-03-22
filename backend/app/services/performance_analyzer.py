import re
from typing import Any
from app.core.database import DatabaseConnector


class PerformanceAnalyzer:
    def __init__(self, connector: DatabaseConnector):
        self.connector = connector
        self.db_type = connector.config.db_type

    def analyze_mssql(self, sql: str) -> dict:
        results = {
            "execution_stats": {},
            "query_plan": None,
            "warnings": [],
            "suggestions": [],
        }

        # Get execution stats
        try:
            stats_sql = f"""
                SET STATISTICS TIME ON
                SET STATISTICS IO ON
                {sql}
                SET STATISTICS TIME OFF
                SET STATISTICS IO OFF
            """
            self.connector.execute_query(stats_sql)
        except Exception as e:
            results["warnings"].append(f"Could not get execution stats: {str(e)}")

        # Estimate execution plan
        try:
            plan_sql = f"SET SHOWPLAN_XML ON\n{sql}\nSET SHOWPLAN_XML OFF"
            plan_rows = self.connector.execute_query(plan_sql)
            if plan_rows:
                results["query_plan"] = str(plan_rows[0])
        except Exception as e:
            results["warnings"].append(f"Could not get execution plan: {str(e)}")

        # Static analysis
        results["suggestions"] = self._static_analysis(sql)
        results["complexity"] = self._compute_complexity(sql)
        return results

    def analyze_generic(self, sql: str) -> dict:
        return {
            "execution_stats": {},
            "query_plan": None,
            "warnings": ["Execution plan not available for this database type"],
            "suggestions": self._static_analysis(sql),
            "complexity": self._compute_complexity(sql),
        }

    def analyze(self, sql: str) -> dict:
        if self.db_type == "mssql":
            return self.analyze_mssql(sql)
        else:
            return self.analyze_generic(sql)

    def _static_analysis(self, sql: str) -> list[dict]:
        suggestions = []
        sql_upper = sql.upper()

        # SELECT *
        if re.search(r"SELECT\s+\*", sql_upper):
            suggestions.append({
                "type": "warning",
                "code": "SELECT_STAR",
                "message": "Avoid SELECT * — specify only needed columns to reduce I/O and improve performance",
                "severity": "medium",
            })

        # Functions on indexed columns in WHERE
        func_patterns = [
            (r"WHERE.*\bYEAR\s*\(", "YEAR() in WHERE prevents index usage. Use range: col >= '2024-01-01' AND col < '2025-01-01'"),
            (r"WHERE.*\bMONTH\s*\(", "MONTH() in WHERE prevents index usage. Use date ranges instead"),
            (r"WHERE.*\bUPPER\s*\(", "UPPER() on column prevents index usage. Consider case-insensitive collation"),
            (r"WHERE.*\bLOWER\s*\(", "LOWER() on column prevents index usage. Consider case-insensitive collation"),
            (r"WHERE.*\bCONVERT\s*\(", "CONVERT() on column may prevent index usage"),
            (r"WHERE.*\bCAST\s*\(", "CAST() on column may prevent index usage"),
        ]
        for pattern, msg in func_patterns:
            if re.search(pattern, sql_upper):
                suggestions.append({
                    "type": "warning",
                    "code": "FUNCTION_ON_COLUMN",
                    "message": msg,
                    "severity": "high",
                })

        # LIKE with leading wildcard
        if re.search(r"LIKE\s+['\"]%", sql_upper):
            suggestions.append({
                "type": "warning",
                "code": "LEADING_WILDCARD",
                "message": "Leading wildcard LIKE '%...' cannot use indexes. Consider full-text search",
                "severity": "high",
            })

        # Missing WHERE clause on large operations
        if re.search(r"UPDATE|DELETE", sql_upper) and "WHERE" not in sql_upper:
            suggestions.append({
                "type": "error",
                "code": "MISSING_WHERE",
                "message": "UPDATE/DELETE without WHERE clause will affect ALL rows!",
                "severity": "critical",
            })

        # NOT IN with subquery (can be slow)
        if re.search(r"NOT\s+IN\s*\(SELECT", sql_upper):
            suggestions.append({
                "type": "suggestion",
                "code": "NOT_IN_SUBQUERY",
                "message": "NOT IN with subquery can be slow. Consider NOT EXISTS or LEFT JOIN ... WHERE IS NULL",
                "severity": "medium",
            })

        # OR in WHERE (may not use indexes well)
        if re.search(r"WHERE.*\bOR\b", sql_upper):
            suggestions.append({
                "type": "info",
                "code": "OR_IN_WHERE",
                "message": "OR conditions may limit index usage. Consider UNION ALL for better performance",
                "severity": "low",
            })

        # Implicit type conversion
        if re.search(r"WHERE\s+\w+\s*=\s*\d+", sql_upper):
            # Heuristic only
            pass

        # N+1 pattern detection
        if sql_upper.count("SELECT") > 3:
            suggestions.append({
                "type": "info",
                "code": "MULTIPLE_SELECTS",
                "message": "Multiple SELECT statements detected. Verify this isn't an N+1 query pattern",
                "severity": "low",
            })

        if not suggestions:
            suggestions.append({
                "type": "success",
                "code": "NO_ISSUES",
                "message": "No obvious performance issues detected",
                "severity": "none",
            })

        return suggestions

    def _compute_complexity(self, sql: str) -> dict:
        sql_upper = sql.upper()
        score = 1
        factors = []

        join_count = len(re.findall(r"\bJOIN\b", sql_upper))
        if join_count > 0:
            score += join_count * 1.5
            factors.append(f"{join_count} JOIN{'s' if join_count > 1 else ''}")

        subquery_count = len(re.findall(r"\bSELECT\b", sql_upper)) - 1
        if subquery_count > 0:
            score += subquery_count * 2
            factors.append(f"{subquery_count} subquery{'s' if subquery_count > 1 else ''}")

        if re.search(r"\bGROUP BY\b", sql_upper):
            score += 1
            factors.append("GROUP BY aggregation")

        if re.search(r"\bHAVING\b", sql_upper):
            score += 1
            factors.append("HAVING filter")

        if re.search(r"\bORDER BY\b", sql_upper):
            score += 0.5
            factors.append("ORDER BY sort")

        if re.search(r"\bUNION\b", sql_upper):
            score += 2
            factors.append("UNION operation")

        if re.search(r"\bEXISTS\b|\bNOT EXISTS\b", sql_upper):
            score += 1.5
            factors.append("EXISTS subquery")

        if re.search(r"\bWITH\b.*AS\b", sql_upper):
            score += 1
            factors.append("CTE (WITH clause)")

        score = min(round(score), 10)
        level = "Low" if score <= 3 else "Medium" if score <= 6 else "High"

        return {"score": score, "level": level, "factors": factors}
