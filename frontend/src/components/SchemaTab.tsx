'use client'
import { useState, useEffect } from 'react'
import { Search, Table, Key, Link, Hash, RefreshCw, Loader2, ChevronRight, ChevronDown } from 'lucide-react'
import { useSQLBrainStore } from '@/store'
import { getSchema } from '@/lib/api'
import clsx from 'clsx'

export default function SchemaTab() {
  const { schema, sessionId, setSchema } = useSQLBrainStore()
  const [search, setSearch] = useState('')
  const [selectedTable, setSelectedTable] = useState<string | null>(null)
  const [expandedTables, setExpandedTables] = useState<Set<string>>(new Set())
  const [refreshing, setRefreshing] = useState(false)
  const [view, setView] = useState<'list' | 'graph'>('list')

  const filteredTables = schema?.tables.filter(t =>
    t.name.toLowerCase().includes(search.toLowerCase()) ||
    t.columns.some(c => c.name.toLowerCase().includes(search.toLowerCase()))
  ) ?? []

  const selectedTableData = schema?.tables.find(t => t.name === selectedTable)

  const handleRefresh = async () => {
    if (!sessionId) return
    setRefreshing(true)
    try {
      const res = await getSchema(sessionId, true)
      setSchema(res.data)
    } finally {
      setRefreshing(false)
    }
  }

  const toggleTable = (name: string) => {
    setExpandedTables(prev => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  if (!schema) return (
    <div className="flex items-center justify-center h-full text-[#64748B]">
      Connect to a database to explore the schema
    </div>
  )

  return (
    <div className="flex h-full gap-3">
      {/* Table list */}
      <div className="w-72 bg-[#0F1420] border border-[#1C2333] rounded-xl flex flex-col">
        <div className="p-3 border-b border-[#1C2333] space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs text-[#64748B] uppercase tracking-wider">
              {schema.summary.total_tables} Tables
            </span>
            <button onClick={handleRefresh} disabled={refreshing}
              className="p-1.5 text-[#64748B] hover:text-white transition-colors rounded">
              <RefreshCw size={13} className={refreshing ? 'animate-spin' : ''} />
            </button>
          </div>
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#2D3748]" />
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search tables & columns..."
              className="w-full bg-[#070A10] border border-[#1C2333] rounded-lg pl-7 pr-3 py-2 text-xs text-white placeholder-[#2D3748] focus:outline-none focus:border-[#00D4FF]/40" />
          </div>
        </div>

        <div className="flex-1 overflow-auto p-2 space-y-0.5">
          {filteredTables.map(table => (
            <div key={table.name}>
              <button
                onClick={() => { setSelectedTable(table.name); toggleTable(table.name) }}
                className={clsx(
                  "w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-left transition-all group",
                  selectedTable === table.name ? "bg-[#00D4FF]/10 text-[#00D4FF]" : "text-[#CBD5E1] hover:bg-[#1C2333]"
                )}
              >
                {expandedTables.has(table.name) ? <ChevronDown size={12} className="shrink-0" /> : <ChevronRight size={12} className="shrink-0" />}
                <Table size={13} className="shrink-0" />
                <span className="text-xs font-medium flex-1 truncate font-mono">{table.name}</span>
                <span className="text-[10px] text-[#2D3748] group-hover:text-[#64748B]">
                  {table.row_count >= 0 ? table.row_count.toLocaleString() : '?'}
                </span>
              </button>

              {expandedTables.has(table.name) && (
                <div className="ml-6 border-l border-[#1C2333] pl-2 py-0.5 space-y-0.5">
                  {table.columns.map(col => (
                    <div key={col.name}
                      className={clsx(
                        "flex items-center gap-2 px-2 py-1 rounded text-[10px]",
                        search && col.name.toLowerCase().includes(search.toLowerCase()) && "bg-[#7C3AED]/10"
                      )}>
                      <ColumnIcon col={col} table={table} />
                      <span className="font-mono text-[#94A3B8] truncate">{col.name}</span>
                      <span className="text-[#2D3748] ml-auto shrink-0">{col.type}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Detail panel */}
      <div className="flex-1 bg-[#0F1420] border border-[#1C2333] rounded-xl overflow-hidden">
        {selectedTableData ? (
          <TableDetail table={selectedTableData} schema={schema} />
        ) : (
          <SchemaOverview schema={schema} onSelectTable={setSelectedTable} />
        )}
      </div>
    </div>
  )
}

function ColumnIcon({ col, table }: { col: any; table: any }) {
  const isPK = table.indexes?.some((idx: any) => idx.is_primary && idx.columns?.includes(col.name))
  const isFK = table.foreign_keys?.some((fk: any) => fk.column === col.name)
  if (isPK) return <Key size={10} className="text-[#F59E0B] shrink-0" />
  if (isFK) return <Link size={10} className="text-[#7C3AED] shrink-0" />
  return <Hash size={10} className="text-[#2D3748] shrink-0" />
}

function TableDetail({ table, schema }: { table: any; schema: any }) {
  return (
    <div className="h-full overflow-auto">
      <div className="p-5 border-b border-[#1C2333]">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-[#00D4FF]/10 flex items-center justify-center">
            <Table size={16} className="text-[#00D4FF]" />
          </div>
          <div>
            <h2 className="text-white font-semibold font-mono">{table.name}</h2>
            <p className="text-[#64748B] text-xs">{table.row_count.toLocaleString()} rows · {table.columns.length} columns</p>
          </div>
        </div>
      </div>

      <div className="p-5 space-y-5">
        {/* Columns */}
        <Section title="Columns" count={table.columns.length}>
          <div className="rounded-xl overflow-hidden border border-[#1C2333]">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-[#070A10]">
                  <th className="text-left px-4 py-2.5 text-[#64748B] font-medium uppercase tracking-wider text-[10px]">Column</th>
                  <th className="text-left px-4 py-2.5 text-[#64748B] font-medium uppercase tracking-wider text-[10px]">Type</th>
                  <th className="text-left px-4 py-2.5 text-[#64748B] font-medium uppercase tracking-wider text-[10px]">Nullable</th>
                  <th className="text-left px-4 py-2.5 text-[#64748B] font-medium uppercase tracking-wider text-[10px]">Default</th>
                  <th className="text-left px-4 py-2.5 text-[#64748B] font-medium uppercase tracking-wider text-[10px]">Keys</th>
                </tr>
              </thead>
              <tbody>
                {table.columns.map((col: any) => {
                  const isPK = table.indexes?.some((idx: any) => idx.is_primary && idx.columns?.includes(col.name))
                  const isFK = table.foreign_keys?.some((fk: any) => fk.column === col.name)
                  const fkDest = table.foreign_keys?.find((fk: any) => fk.column === col.name)
                  return (
                    <tr key={col.name} className="border-t border-[#1C2333] hover:bg-[#070A10]/50">
                      <td className="px-4 py-2.5 font-mono text-white">{col.name}</td>
                      <td className="px-4 py-2.5 text-[#7C3AED] font-mono">{col.type}{col.max_length ? `(${col.max_length})` : ''}</td>
                      <td className="px-4 py-2.5">
                        <span className={clsx("px-2 py-0.5 rounded text-[10px]", col.nullable ? "bg-[#1C2333] text-[#64748B]" : "bg-[#00D4FF]/10 text-[#00D4FF]")}>
                          {col.nullable ? 'NULL' : 'NOT NULL'}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-[#64748B] font-mono">{col.default ?? '—'}</td>
                      <td className="px-4 py-2.5">
                        {isPK && <span className="px-1.5 py-0.5 bg-[#F59E0B]/10 text-[#F59E0B] rounded text-[10px] mr-1">PK</span>}
                        {isFK && <span className="px-1.5 py-0.5 bg-[#7C3AED]/10 text-[#7C3AED] rounded text-[10px]" title={`→ ${fkDest?.references_table}.${fkDest?.references_column}`}>FK</span>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Section>

        {/* Foreign Keys */}
        {table.foreign_keys?.length > 0 && (
          <Section title="Foreign Keys" count={table.foreign_keys.length}>
            <div className="space-y-2">
              {table.foreign_keys.map((fk: any, i: number) => (
                <div key={i} className="flex items-center gap-2 p-3 bg-[#070A10] border border-[#1C2333] rounded-lg text-xs">
                  <Link size={12} className="text-[#7C3AED] shrink-0" />
                  <span className="font-mono text-white">{table.name}.{fk.column}</span>
                  <span className="text-[#64748B]">→</span>
                  <span className="font-mono text-[#7C3AED]">{fk.references_table}.{fk.references_column}</span>
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* Indexes */}
        {table.indexes?.length > 0 && (
          <Section title="Indexes" count={table.indexes.length}>
            <div className="space-y-2">
              {table.indexes.map((idx: any, i: number) => (
                <div key={i} className="flex items-center gap-2 p-3 bg-[#070A10] border border-[#1C2333] rounded-lg text-xs">
                  <span className={clsx("px-1.5 py-0.5 rounded text-[10px]",
                    idx.is_primary ? "bg-[#F59E0B]/10 text-[#F59E0B]" :
                    idx.is_unique ? "bg-[#10B981]/10 text-[#10B981]" :
                    "bg-[#1C2333] text-[#64748B]"
                  )}>
                    {idx.is_primary ? 'PK' : idx.is_unique ? 'UNIQUE' : 'IDX'}
                  </span>
                  <span className="font-mono text-[#64748B]">{idx.name}</span>
                  <span className="text-[#2D3748] ml-auto font-mono">
                    ({Array.isArray(idx.columns) ? idx.columns.join(', ') : idx.columns})
                  </span>
                </div>
              ))}
            </div>
          </Section>
        )}
      </div>
    </div>
  )
}

function SchemaOverview({ schema, onSelectTable }: { schema: any; onSelectTable: (name: string) => void }) {
  return (
    <div className="p-5">
      <h2 className="text-white font-semibold mb-4">Schema Overview</h2>
      <div className="grid grid-cols-2 gap-3 mb-6">
        {[
          { label: 'Total Tables', value: schema.summary.total_tables, color: '#00D4FF' },
          { label: 'Total Columns', value: schema.summary.total_columns, color: '#7C3AED' },
          { label: 'Relationships', value: schema.summary.total_relationships, color: '#10B981' },
          { label: 'Indexes', value: schema.summary.total_indexes, color: '#F59E0B' },
        ].map(stat => (
          <div key={stat.label} className="bg-[#070A10] border border-[#1C2333] rounded-xl p-4">
            <div className="text-2xl font-bold font-mono" style={{ color: stat.color }}>{stat.value}</div>
            <div className="text-[#64748B] text-xs mt-1">{stat.label}</div>
          </div>
        ))}
      </div>
      <p className="text-[#64748B] text-sm">Select a table from the left to explore its structure.</p>
    </div>
  )
}

function Section({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <span className="text-xs text-[#64748B] uppercase tracking-wider font-medium">{title}</span>
        <span className="text-[10px] text-[#2D3748] bg-[#1C2333] px-1.5 py-0.5 rounded-full">{count}</span>
      </div>
      {children}
    </div>
  )
}
