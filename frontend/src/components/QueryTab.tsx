'use client'
import { useState } from 'react'
import {
  Play, Sparkles, Wand2, BookOpen, Loader2, Copy,
  Download, AlertCircle, CheckCircle2, MessageSquare,
  Table2, Search, Plus, X, ChevronRight,
} from 'lucide-react'
import dynamic from 'next/dynamic'
import { useSQLBrainStore, QuestionCategory } from '@/store'
import {
  getTableCandidates, confirmAndGenerate,
  executeQuery, explainQuery, optimizeQuery, analyzeQuery,
} from '@/lib/api'
import ComplexityBadge from './ui/ComplexityBadge'
import clsx from 'clsx'

const CodeMirror = dynamic(() => import('@uiw/react-codemirror'), { ssr: false })

const CATEGORY_LABELS: Record<NonNullable<QuestionCategory>, string> = {
  SQL_GENERATION:   'Data query',
  SCHEMA_QUESTION:  'Schema lookup',
  SQL_EXPLANATION:  'Explanation',
  GENERAL_QUESTION: 'General answer',
}

const CATEGORY_COLORS: Record<NonNullable<QuestionCategory>, string> = {
  SQL_GENERATION:   'bg-[#00D4FF]/10 text-[#00D4FF]',
  SCHEMA_QUESTION:  'bg-[#0891B2]/20 text-[#67E8F9]',
  SQL_EXPLANATION:  'bg-[#10B981]/10 text-[#10B981]',
  GENERAL_QUESTION: 'bg-[#7C3AED]/20 text-[#A78BFA]',
}

interface TableCandidate {
  name: string
  score: number
  confident: boolean
  row_count: number
  columns: any[]
  foreign_keys: any[]
  reason: string
}

export default function QueryTab() {
  const {
    sessionId, currentSQL, setCurrentSQL,
    selectedModel, setQueryResults, queryResults,
  } = useSQLBrainStore()

  const [nlQuestion, setNlQuestion]   = useState('')
  const [generating, setGenerating]   = useState(false)
  const [explaining, setExplaining]   = useState(false)
  const [optimizing, setOptimizing]   = useState(false)
  const [explanation, setExplanation] = useState('')
  const [optimization, setOptimization] = useState<{ optimized_sql: string; analysis: string } | null>(null)
  const [complexity, setComplexity]   = useState<{ score: number; level: string; factors: string[] } | null>(null)
  const [activeResultTab, setActiveResultTab] = useState<'results' | 'explain' | 'optimize' | 'answer'>('results')
  const [copied, setCopied]           = useState(false)
  const [suggestions, setSuggestions] = useState<any[]>([])

  // ── Table confirmation state ──────────────────────────────────────────────
  const [showConfirm, setShowConfirm]         = useState(false)
  const [candidates, setCandidates]           = useState<TableCandidate[]>([])
  const [allTables, setAllTables]             = useState<TableCandidate[]>([])
  const [checkedTables, setCheckedTables]     = useState<Set<string>>(new Set())
  const [tableSearch, setTableSearch]         = useState('')
  const [pendingQuestion, setPendingQuestion] = useState('')
  const [confirming, setConfirming]           = useState(false)

  // ── Step 1: Ask AI → get candidates ──────────────────────────────────────
  const handleAsk = async () => {
    if (!nlQuestion.trim() || !sessionId) return
    setGenerating(true)
    setQueryResults({ loading: true, error: null, answer: null, category: null, rows: [], columns: [] })
    setExplanation('')
    setOptimization(null)
    setComplexity(null)
    setSuggestions([])
    setShowConfirm(false)

    try {
      const res = await getTableCandidates(sessionId, nlQuestion, selectedModel)
      const data = res.data

      // General / schema questions → answered immediately, no confirmation
      if (!data.needs_confirmation) {
        if (data.category === 'GENERAL_QUESTION') {
          setQueryResults({ loading: false, answer: data.answer || '', category: data.category, error: null })
          setActiveResultTab('answer')
        } else if (data.sql) {
          setCurrentSQL(data.sql)
          setQueryResults({ loading: false, answer: null, category: data.category, error: null })
          setActiveResultTab('results')
          await runExecute(data.sql)
        }
        return
      }

      // SQL generation → show table confirmation UI
      const cands: TableCandidate[] = data.candidates || []
      const initialChecked = new Set<string>(
        cands.filter(t => t.confident || t.score >= 1.5).map(t => t.name)
      )

      setCandidates(cands)
      setAllTables(data.all_tables || [])
      setCheckedTables(initialChecked)
      setPendingQuestion(nlQuestion)
      setShowConfirm(true)
      setQueryResults({ loading: false, category: data.category, error: null })

    } catch (e: any) {
      setQueryResults({
        loading: false,
        error: e.response?.data?.detail || 'Failed to process question',
        answer: null, category: null,
      })
    } finally {
      setGenerating(false)
    }
  }

  // ── Step 2: User confirms tables → generate SQL ───────────────────────────
  const handleConfirm = async () => {
    if (!sessionId || checkedTables.size === 0) return
    setConfirming(true)

    // Build confirmed table objects from checked names
    const confirmedTableObjects = [
      ...candidates.filter(t => checkedTables.has(t.name)),
      ...allTables.filter(t =>
        checkedTables.has(t.name) && !candidates.find(c => c.name === t.name)
      ),
    ]

    try {
      const res = await confirmAndGenerate(
        sessionId, pendingQuestion, confirmedTableObjects, selectedModel
      )
      const { sql, answer, category } = res.data

      setCurrentSQL(sql)
      setQueryResults({ loading: false, answer: null, category, error: null })
      setActiveResultTab('results')
      setShowConfirm(false)

      if (sql) await runExecute(sql)

    } catch (e: any) {
      setQueryResults({
        loading: false,
        error: e.response?.data?.detail || 'Failed to generate SQL',
        answer: null, category: null,
      })
    } finally {
      setConfirming(false)
    }
  }

  const toggleTable = (name: string) => {
    setCheckedTables(prev => {
      const next = new Set(prev)
      next.has(name) ? next.delete(name) : next.add(name)
      return next
    })
  }

  // Tables shown in the search/add section (not already in candidates list)
  const searchResults = tableSearch.length > 1
    ? allTables.filter(t =>
        t.name.toLowerCase().includes(tableSearch.toLowerCase()) &&
        !candidates.find(c => c.name === t.name)
      ).slice(0, 8)
    : []

  // ── Execute SQL ───────────────────────────────────────────────────────────
  const runExecute = async (sqlOverride?: string) => {
    const sql = sqlOverride || currentSQL
    if (!sql.trim() || !sessionId) return
    setQueryResults({ loading: true, error: null, rows: [], columns: [] })
    setActiveResultTab('results')
    try {
      const [execRes, analyzeRes] = await Promise.all([
        executeQuery(sessionId, sql),
        analyzeQuery(sessionId, sql),
      ])
      setQueryResults({ ...execRes.data, loading: false, error: null })
      setComplexity(analyzeRes.data.complexity)
      setSuggestions(analyzeRes.data.suggestions || [])
    } catch (e: any) {
      setQueryResults({
        loading: false,
        error: e.response?.data?.detail || String(e),
        rows: [], columns: [], row_count: 0,
      })
    }
  }

  const handleExplain = async () => {
    if (!currentSQL.trim() || !sessionId) return
    setExplaining(true)
    setActiveResultTab('explain')
    try {
      const res = await explainQuery(sessionId, currentSQL, selectedModel)
      setExplanation(res.data.explanation)
    } catch (e: any) {
      setExplanation(`Error: ${e.response?.data?.detail || String(e)}`)
    } finally {
      setExplaining(false)
    }
  }

  const handleOptimize = async () => {
    if (!currentSQL.trim() || !sessionId) return
    setOptimizing(true)
    setActiveResultTab('optimize')
    try {
      const res = await optimizeQuery(sessionId, currentSQL, selectedModel)
      setOptimization(res.data)
    } catch {
      setOptimization(null)
    } finally {
      setOptimizing(false)
    }
  }

  const handleCopy = () => {
    navigator.clipboard.writeText(currentSQL)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const handleDownload = () => {
    if (!queryResults.rows.length) return
    const headers = queryResults.columns.join(',')
    const rows = queryResults.rows.map(row =>
      Object.values(row).map(v => JSON.stringify(v ?? '')).join(',')
    )
    const csv = [headers, ...rows].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = 'results.csv'; a.click()
  }

  const { category } = queryResults
  const resultTabs = [
    'results', 'explain', 'optimize',
    ...(category === 'GENERAL_QUESTION' ? ['answer'] : []),
  ] as const

  return (
    <div className="flex flex-col h-full gap-3">

      {/* ── Natural language input ── */}
      <div className="bg-[#0F1420] border border-[#1C2333] rounded-xl p-4">
        <div className="flex items-center gap-2 mb-3">
          <Sparkles size={15} className="text-[#7C3AED]" />
          <span className="text-xs text-[#64748B] uppercase tracking-wider">Ask AI</span>
          {category && (
            <span className={clsx('ml-auto text-[10px] px-2 py-0.5 rounded-full font-medium', CATEGORY_COLORS[category])}>
              {CATEGORY_LABELS[category]}
            </span>
          )}
        </div>
        <div className="flex gap-2">
          <input
            value={nlQuestion}
            onChange={e => setNlQuestion(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleAsk()}
            placeholder="Ask anything — 'show memberships', 'find users with no login', 'what is a CTE'..."
            className="flex-1 bg-[#070A10] border border-[#1C2333] rounded-lg px-4 py-2.5 text-sm
                       text-white placeholder-[#2D3748] focus:outline-none focus:border-[#7C3AED]/50 transition-colors"
          />
          <button
            onClick={handleAsk}
            disabled={generating || !sessionId}
            className="px-4 py-2.5 bg-[#7C3AED] hover:bg-[#6D28D9] text-white rounded-lg text-sm
                       font-medium transition-all disabled:opacity-50 flex items-center gap-2 shrink-0"
          >
            {generating ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
            {generating ? 'Thinking...' : 'Ask'}
          </button>
        </div>
      </div>

      {/* ── Table confirmation panel ── */}
      {showConfirm && (
        <div className="bg-[#0F1420] border border-[#7C3AED]/40 rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Table2 size={14} className="text-[#7C3AED]" />
              <span className="text-sm font-medium text-white">
                Confirm tables for: <span className="text-[#7C3AED]">"{pendingQuestion}"</span>
              </span>
            </div>
            <button onClick={() => setShowConfirm(false)} className="text-[#64748B] hover:text-white">
              <X size={15} />
            </button>
          </div>

          <p className="text-xs text-[#64748B] mb-3">
            AI found these relevant tables. Check the ones to include, then click Generate SQL.
          </p>

          {/* Candidate checkboxes */}
          <div className="space-y-1.5 mb-4 max-h-[280px] overflow-y-auto pr-1">
            {candidates.map(table => (
              <label
                key={table.name}
                className={clsx(
                  'flex items-start gap-3 p-2.5 rounded-lg border cursor-pointer transition-all',
                  checkedTables.has(table.name)
                    ? 'border-[#7C3AED]/50 bg-[#7C3AED]/5'
                    : 'border-[#1C2333] hover:border-[#2D3748]'
                )}
              >
                <input
                  type="checkbox"
                  checked={checkedTables.has(table.name)}
                  onChange={() => toggleTable(table.name)}
                  className="mt-0.5 accent-[#7C3AED]"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-mono text-white truncate">{table.name}</span>
                    {table.confident && (
                      <span className="text-[10px] px-1.5 py-0.5 bg-[#10B981]/15 text-[#10B981] rounded-full">
                        confident
                      </span>
                    )}
                    <span className="text-[10px] text-[#64748B] ml-auto shrink-0">
                      {table.columns.length} cols
                      {table.row_count >= 0 ? ` · ${table.row_count.toLocaleString()} rows` : ''}
                    </span>
                  </div>
                  <p className="text-[11px] text-[#64748B] mt-0.5 truncate">{table.reason}</p>
                  {/* Preview first 5 column names */}
                  <p className="text-[10px] text-[#2D3748] mt-0.5 truncate">
                    {table.columns.slice(0, 5).map((c: any) => c.name).join(', ')}
                    {table.columns.length > 5 ? ` +${table.columns.length - 5} more` : ''}
                  </p>
                </div>
              </label>
            ))}
          </div>

          {/* Search + add missing tables */}
          <div className="border-t border-[#1C2333] pt-3 mb-3">
            <div className="flex items-center gap-2 mb-2">
              <Search size={12} className="text-[#64748B]" />
              <span className="text-xs text-[#64748B]">Add a missing table</span>
            </div>
            <input
              value={tableSearch}
              onChange={e => setTableSearch(e.target.value)}
              placeholder="Search all 238 tables..."
              className="w-full bg-[#070A10] border border-[#1C2333] rounded-lg px-3 py-2 text-sm
                         text-white placeholder-[#2D3748] focus:outline-none focus:border-[#7C3AED]/50"
            />
            {searchResults.length > 0 && (
              <div className="mt-1.5 space-y-1 max-h-[160px] overflow-y-auto">
                {searchResults.map(table => (
                  <button
                    key={table.name}
                    onClick={() => {
                      // Add to candidates list and check it
                      if (!candidates.find(c => c.name === table.name)) {
                        setCandidates(prev => [...prev, { ...table, score: 0, confident: false, reason: 'manually added' }])
                      }
                      setCheckedTables(prev => new Set(Array.from(prev).concat(table.name)))
                      setTableSearch('')
                    }}
                    className="w-full flex items-center justify-between px-3 py-2 bg-[#070A10]
                               border border-[#1C2333] hover:border-[#7C3AED]/40 rounded-lg text-left transition-all"
                  >
                    <div>
                      <span className="text-sm font-mono text-white">{table.name}</span>
                      <span className="text-[10px] text-[#64748B] ml-2">{table.columns.length} cols</span>
                    </div>
                    <Plus size={13} className="text-[#7C3AED] shrink-0" />
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Action buttons */}
          <div className="flex items-center justify-between">
            <span className="text-xs text-[#64748B]">
              {checkedTables.size} table{checkedTables.size !== 1 ? 's' : ''} selected
            </span>
            <div className="flex gap-2">
              <button
                onClick={() => setShowConfirm(false)}
                className="px-3 py-1.5 text-xs text-[#64748B] hover:text-white border border-[#1C2333]
                           hover:border-[#2D3748] rounded-lg transition-all"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirm}
                disabled={confirming || checkedTables.size === 0}
                className="px-4 py-1.5 bg-[#7C3AED] hover:bg-[#6D28D9] text-white text-xs font-medium
                           rounded-lg transition-all disabled:opacity-40 flex items-center gap-1.5"
              >
                {confirming
                  ? <Loader2 size={12} className="animate-spin" />
                  : <ChevronRight size={12} />}
                {confirming ? 'Generating...' : 'Generate SQL'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── SQL Editor ── */}
      <div className="bg-[#0F1420] border border-[#1C2333] rounded-xl overflow-hidden flex-1 flex flex-col min-h-0">
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-[#1C2333]">
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-[#64748B] font-mono">SQL Editor</span>
            {complexity && <ComplexityBadge score={complexity.score} level={complexity.level} />}
          </div>
          <div className="flex items-center gap-1.5">
            <IconBtn onClick={handleCopy} title="Copy SQL">
              {copied ? <CheckCircle2 size={14} className="text-[#10B981]" /> : <Copy size={14} />}
            </IconBtn>
            <button onClick={handleExplain} disabled={explaining || !sessionId || !currentSQL}
              className="px-3 py-1.5 text-xs bg-[#1C2333] hover:bg-[#2D3748] text-[#64748B]
                         hover:text-white rounded-lg transition-all disabled:opacity-40 flex items-center gap-1.5">
              {explaining ? <Loader2 size={12} className="animate-spin" /> : <BookOpen size={12} />}
              Explain
            </button>
            <button onClick={handleOptimize} disabled={optimizing || !sessionId || !currentSQL}
              className="px-3 py-1.5 text-xs bg-[#1C2333] hover:bg-[#2D3748] text-[#64748B]
                         hover:text-white rounded-lg transition-all disabled:opacity-40 flex items-center gap-1.5">
              {optimizing ? <Loader2 size={12} className="animate-spin" /> : <Wand2 size={12} />}
              Optimize
            </button>
            <button onClick={() => runExecute()} disabled={!sessionId || !currentSQL || queryResults.loading}
              className="px-4 py-1.5 bg-[#00D4FF] hover:bg-[#00BFDF] text-[#0A0D14] text-xs
                         font-semibold rounded-lg transition-all disabled:opacity-40 flex items-center gap-1.5">
              {queryResults.loading ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
              Run
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-auto">
          <CodeMirrorEditor value={currentSQL} onChange={setCurrentSQL} />
        </div>
      </div>

      {/* ── Results panel ── */}
      <div className="bg-[#0F1420] border border-[#1C2333] rounded-xl overflow-hidden"
           style={{ minHeight: '220px', maxHeight: '40vh' }}>
        <div className="flex items-center justify-between px-4 border-b border-[#1C2333]">
          <div className="flex">
            {resultTabs.map(tab => (
              <button key={tab} onClick={() => setActiveResultTab(tab as any)}
                className={clsx(
                  'px-4 py-2.5 text-xs font-medium capitalize transition-all border-b-2 -mb-px flex items-center gap-1.5',
                  activeResultTab === tab
                    ? 'text-[#00D4FF] border-[#00D4FF]'
                    : 'text-[#64748B] border-transparent hover:text-white'
                )}>
                {tab === 'answer' && <MessageSquare size={11} />}
                {tab}
              </button>
            ))}
          </div>
          {activeResultTab === 'results' && queryResults.row_count > 0 && (
            <div className="flex items-center gap-3">
              <span className="text-xs text-[#64748B] font-mono">
                {queryResults.row_count} rows{queryResults.truncated ? ' (truncated)' : ''}
              </span>
              <IconBtn onClick={handleDownload} title="Download CSV">
                <Download size={14} />
              </IconBtn>
            </div>
          )}
        </div>

        <div className="overflow-auto h-full">
          {activeResultTab === 'results' && (
            <ResultsView results={queryResults} suggestions={suggestions} />
          )}
          {activeResultTab === 'explain' && (
            <ExplainView explanation={explanation} loading={explaining} />
          )}
          {activeResultTab === 'optimize' && (
            <OptimizeView optimization={optimization} loading={optimizing} onApply={setCurrentSQL} />
          )}
          {activeResultTab === 'answer' && (
            <AnswerView answer={queryResults.answer} loading={generating} />
          )}
        </div>
      </div>
    </div>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────────

function CodeMirrorEditor({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <textarea
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder="-- Write your SQL here, or use Ask AI above..."
      className="w-full h-full min-h-[200px] bg-[#070A10] text-[#E2E8F0] font-mono text-sm p-4 resize-none focus:outline-none"
      spellCheck={false}
    />
  )
}

function ResultsView({ results, suggestions }: { results: any; suggestions: any[] }) {
  if (results.loading) return <LoadingState />
  if (results.error) return (
    <div className="flex items-start gap-3 p-4">
      <AlertCircle size={16} className="text-red-400 mt-0.5 shrink-0" />
      <div>
        <p className="text-red-400 text-sm font-medium">Query Error</p>
        <p className="text-[#64748B] text-xs mt-1 font-mono">{results.error}</p>
      </div>
    </div>
  )
  if (!results.rows.length && !suggestions.length) return (
    <div className="flex items-center justify-center h-full text-[#64748B] text-sm">
      Run a query to see results
    </div>
  )
  return (
    <div>
      {suggestions.filter((s: any) => s.code !== 'NO_ISSUES').map((s: any, i: number) => (
        <div key={i} className={clsx(
          'flex items-start gap-2 px-4 py-2 border-b border-[#1C2333] text-xs',
          s.severity === 'critical' && 'bg-red-500/5 text-red-400',
          s.severity === 'high'     && 'bg-yellow-500/5 text-yellow-400',
          s.severity === 'medium'   && 'bg-orange-500/5 text-orange-400',
          s.severity === 'low'      && 'text-[#64748B]',
        )}>
          <AlertCircle size={12} className="mt-0.5 shrink-0" />{s.message}
        </div>
      ))}
      {results.rows.length > 0 && (
        <div className="overflow-auto">
          <table className="data-table w-full">
            <thead>
              <tr>{results.columns.map((col: string) => <th key={col}>{col}</th>)}</tr>
            </thead>
            <tbody>
              {results.rows.map((row: any, i: number) => (
                <tr key={i}>
                  {results.columns.map((col: string) => (
                    <td key={col} title={String(row[col] ?? 'NULL')}>
                      {row[col] === null
                        ? <span className="text-[#2D3748] italic">NULL</span>
                        : String(row[col])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function ExplainView({ explanation, loading }: { explanation: string; loading: boolean }) {
  if (loading) return <LoadingState message="Explaining query..." />
  if (!explanation) return (
    <div className="flex items-center justify-center h-full text-[#64748B] text-sm">
      Click Explain to understand the query
    </div>
  )
  return (
    <div className="p-4">
      <pre className="text-sm text-[#CBD5E1] whitespace-pre-wrap font-sans leading-relaxed">{explanation}</pre>
    </div>
  )
}

function OptimizeView({ optimization, loading, onApply }: {
  optimization: any; loading: boolean; onApply: (sql: string) => void
}) {
  if (loading) return <LoadingState message="Optimizing query..." />
  if (!optimization) return (
    <div className="flex items-center justify-center h-full text-[#64748B] text-sm">
      Click Optimize to improve the query
    </div>
  )
  return (
    <div className="p-4 space-y-4">
      {optimization.optimized_sql && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-[#64748B] uppercase tracking-wider">Optimized SQL</span>
            <button onClick={() => onApply(optimization.optimized_sql)}
              className="px-3 py-1 bg-[#10B981]/20 text-[#10B981] text-xs rounded-lg hover:bg-[#10B981]/30 transition-all">
              Apply
            </button>
          </div>
          <pre className="bg-[#070A10] border border-[#1C2333] rounded-lg p-3 text-sm text-[#00D4FF] font-mono overflow-auto">
            {optimization.optimized_sql}
          </pre>
        </div>
      )}
      <div>
        <p className="text-xs text-[#64748B] uppercase tracking-wider mb-2">Analysis</p>
        <pre className="text-sm text-[#CBD5E1] whitespace-pre-wrap font-sans leading-relaxed">{optimization.analysis}</pre>
      </div>
    </div>
  )
}

function AnswerView({ answer, loading }: { answer: string | null; loading: boolean }) {
  if (loading) return <LoadingState message="Thinking..." />
  if (!answer) return (
    <div className="flex items-center justify-center h-full text-[#64748B] text-sm">No answer yet</div>
  )
  return (
    <div className="p-4 flex items-start gap-3">
      <div className="w-7 h-7 rounded-lg bg-[#7C3AED]/20 flex items-center justify-center shrink-0 mt-0.5">
        <MessageSquare size={13} className="text-[#A78BFA]" />
      </div>
      <pre className="text-sm text-[#CBD5E1] whitespace-pre-wrap font-sans leading-relaxed flex-1">{answer}</pre>
    </div>
  )
}

function LoadingState({ message = 'Loading...' }: { message?: string }) {
  return (
    <div className="flex items-center gap-2 justify-center h-full text-[#64748B] text-sm">
      <Loader2 size={14} className="animate-spin" />{message}
    </div>
  )
}

function IconBtn({ children, onClick, title }: {
  children: React.ReactNode; onClick: () => void; title: string
}) {
  return (
    <button onClick={onClick} title={title}
      className="p-1.5 text-[#64748B] hover:text-white transition-colors rounded">
      {children}
    </button>
  )
}