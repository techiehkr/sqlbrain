import json
from typing import Optional, Dict, Any
import pyodbc
import psycopg2
import pymysql
import sqlite3
from dataclasses import dataclass


@dataclass
class ConnectionConfig:
    db_type: str  # mssql, postgresql, mysql, sqlite
    host: str = ""
    port: int = 0
    username: str = ""
    password: str = ""
    database: str = ""
    filepath: str = ""  # for sqlite


class DatabaseConnector:
    def __init__(self, config: ConnectionConfig):
        self.config = config
        self.connection = None

    def connect(self):
        if self.config.db_type == "mssql":
            conn_str = (
                f"DRIVER={{ODBC Driver 17 for SQL Server}};"
                f"SERVER={self.config.host},{self.config.port or 1433};"
                f"DATABASE={self.config.database};"
                f"UID={self.config.username};"
                f"PWD={self.config.password};"
                f"Encrypt=yes;"
                f"TrustServerCertificate=yes;"
            )

            self.connection = pyodbc.connect(conn_str)

        elif self.config.db_type == "postgresql":
            self.connection = psycopg2.connect(
                host=self.config.host,
                port=self.config.port or 5432,
                user=self.config.username,
                password=self.config.password,
                dbname=self.config.database
            )

        elif self.config.db_type == "mysql":
            self.connection = pymysql.connect(
                host=self.config.host,
                port=self.config.port or 3306,
                user=self.config.username,
                password=self.config.password,
                database=self.config.database
            )

        elif self.config.db_type == "sqlite":
            self.connection = sqlite3.connect(self.config.filepath)

        else:
            raise ValueError(f"Unsupported database type: {self.config.db_type}")

        return self.connection

    def disconnect(self):
        if self.connection:
            self.connection.close()
            self.connection = None

    def execute_query(self, sql: str, params=None) -> list[dict]:
        if not self.connection:
            self.connect()
        cursor = self.connection.cursor()
        if params:
            cursor.execute(sql, params)
        else:
            cursor.execute(sql)
        columns = [desc[0] for desc in cursor.description] if cursor.description else []
        rows = cursor.fetchall()
        return [dict(zip(columns, row)) for row in rows]

    def test_connection(self) -> bool:
        try:
            self.connect()
            self.execute_query("SELECT 1")
            return True
        except Exception:
            return False
        finally:
            self.disconnect()


# In-memory connection store (per session)
_active_connections: Dict[str, DatabaseConnector] = {}


def get_connection(session_id: str) -> Optional[DatabaseConnector]:
    return _active_connections.get(session_id)


def store_connection(session_id: str, connector: DatabaseConnector):
    _active_connections[session_id] = connector


def remove_connection(session_id: str):
    if session_id in _active_connections:
        _active_connections[session_id].disconnect()
        del _active_connections[session_id]
