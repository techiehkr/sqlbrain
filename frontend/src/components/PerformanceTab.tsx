'use client'
import { useState } from 'react'
import { Zap, Loader2, AlertCircle, CheckCircle2, Info, AlertTriangle, Lightbulb } from 'lucide-react'
import { useSQLBrainStore } from '@/store'
import { analyzeQuery, getIndexRecommendations, getQueryHistory } from '@/lib/api'
import clsx from 'clsx'

export default function PerformanceTab() {
  const { sessionId, currentSQL, selectedModel } = useSQLBrainStore()
  const [sql, setSql] = useState(currentSQL || '')
  const [analyzing, setAnalyzing] = useState(false)
  const [loadingIndexes, setLoadingIndexes] = useState(false)
  const [result, setResult] = useState<any>(null)
  const [indexes, setIndexes] = useState('')
  const [activeTab, setActiveTab] = useState<'analysis' | 'indexes'>('analysis')

  const handleAnalyze = async () => {
    if (!sql.trim() || !sessionId) return
    setAnalyzing(true)
    try {
      const res = await analyzeQuery(sessionId, sql)
      setResult(res.data)
    } finally {
      setAnalyzing(false)
    }
  }

  const handleIndexes = async () => {
    if (!sql.trim() || !sessionId) return
    setLoadingIndexes(true)
    setActiveTab('indexes')
    try {
      const res = await getIndexRecommendations(sessionId, sql, selectedModel)
      setIndexes(res.data.recommendations)
    } finally {
      setLoadingIndexes(false)
    }
  }

  return (
    <div className="flex flex-col h-full gap-3">
      {/* Input */}
      <div className="bg-[#0F1420] border border-[#1C2333] rounded-xl p-4">
        <label className="text-xs text-[#64748B] uppercase tracking-wider mb-2 block">Query to Analyze</label>
        <textarea
          value={sql}
          onChange={e => setSql(e.target.value)}
          placeholder="Paste a SQL query to analyze its performance..."
          rows={5}
          className="w-full bg-[#070A10] border border-[#1C2333] rounded-lg px-4 py-3 text-sm text-white placeholder-[#2D3748] focus:outline-none focus:border-[#00D4FF]/40 font-mono resize-none"
        />
        <div className="flex gap-2 mt-3">
          <button onClick={handleAnalyze} disabled={analyzing || !sessionId || !sql}
            className="px-4 py-2 bg-[#00D4FF] hover:bg-[#00BFDF] text-[#0A0D14] text-sm font-semibold rounded-lg transition-all disabled:opacity-40 flex items-center gap-2">
            {analyzing ? <Loader2 size={14} className="animate-spin" /> : <Zap size={14} />}
            Analyze
          </button>
          <button onClick={handleIndexes} disabled={loadingIndexes || !sessionId || !sql}
            className="px-4 py-2 bg-[#7C3AED] hover:bg-[#6D28D9] text-white text-sm font-semibold rounded-lg transition-all disabled:opacity-40 flex items-center gap-2">
            {loadingIndexes ? <Loader2 size={14} className="animate-spin" /> : <Lightbulb size={14} />}
            Index Recommendations
          </button>
        </div>
      </div>

      {/* Results */}
      {(result || indexes) && (
        <div className="flex-1 bg-[#0F1420] border border-[#1C2333] rounded-xl overflow-hidden">
          <div className="flex border-b border-[#1C2333]">
            {['analysis', 'indexes'].map(tab => (
              <button key={tab} onClick={() => setActiveTab(tab as any)}
                className={clsx("px-5 py-3 text-xs font-medium capitalize transition-all border-b-2 -mb-px",
                  activeTab === tab ? "text-[#00D4FF] border-[#00D4FF]" : "text-[#64748B] border-transparent hover:text-white"
                )}>
                {tab === 'indexes' ? 'Index Recommendations' : 'Static Analysis'}
              </button>
            ))}
          </div>

          <div className="overflow-auto p-5">
            {activeTab === 'analysis' && result && (
              <AnalysisView result={result} />
            )}
            {activeTab === 'indexes' && (
              <div>
                {loadingIndexes ? (
                  <div className="flex items-center gap-2 text-[#64748B] text-sm">
                    <Loader2 size={14} className="animate-spin" /> Generating recommendations...
                  </div>
                ) : (
                  <pre className="text-sm text-[#CBD5E1] whitespace-pre-wrap font-sans leading-relaxed">{indexes}</pre>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function AnalysisView({ result }: { result: any }) {
  const complexity = result.complexity
  const suggestions = result.suggestions || []

  const severityConfig: Record<string, { icon: any; color: string; bg: string }> = {
    critical: { icon: AlertCircle, color: 'text-red-400', bg: 'bg-red-500/10 border-red-500/20' },
    high: { icon: AlertTriangle, color: 'text-yellow-400', bg: 'bg-yellow-500/10 border-yellow-500/20' },
    medium: { icon: AlertTriangle, color: 'text-orange-400', bg: 'bg-orange-500/10 border-orange-500/20' },
    low: { icon: Info, color: 'text-blue-400', bg: 'bg-blue-500/10 border-blue-500/20' },
    none: { icon: CheckCircle2, color: 'text-[#10B981]', bg: 'bg-[#10B981]/10 border-[#10B981]/20' },
  }

  return (
    <div className="space-y-5">
      {/* Complexity */}
      {complexity && (
        <div>
          <p className="text-xs text-[#64748B] uppercase tracking-wider mb-3">Query Complexity</p>
          <div className="flex items-center gap-4">
            <div className="relative w-24 h-24">
              <svg className="w-full h-full -rotate-90" viewBox="0 0 36 36">
                <circle cx="18" cy="18" r="15" fill="none" stroke="#1C2333" strokeWidth="3" />
                <circle cx="18" cy="18" r="15" fill="none"
                  stroke={complexity.score >= 8 ? '#EF4444' : complexity.score >= 5 ? '#F59E0B' : '#10B981'}
                  strokeWidth="3"
                  strokeDasharray={`${(complexity.score / 10) * 94} 94`}
                  strokeLinecap="round" />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-2xl font-bold text-white font-mono">{complexity.score}</span>
                <span className="text-[10px] text-[#64748B]">/10</span>
              </div>
            </div>
            <div>
              <p className={clsx("font-semibold text-lg",
                complexity.level === 'High' ? 'text-red-400' :
                complexity.level === 'Medium' ? 'text-yellow-400' : 'text-[#10B981]'
              )}>{complexity.level} Complexity</p>
              <div className="flex flex-wrap gap-2 mt-2">
                {complexity.factors.map((f: string, i: number) => (
                  <span key={i} className="px-2 py-1 bg-[#1C2333] text-[#64748B] text-xs rounded-lg">{f}</span>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Suggestions */}
      <div>
        <p className="text-xs text-[#64748B] uppercase tracking-wider mb-3">Performance Suggestions</p>
        <div className="space-y-2">
          {suggestions.map((s: any, i: number) => {
            const cfg = severityConfig[s.severity] || severityConfig.low
            const Icon = cfg.icon
            return (
              <div key={i} className={clsx("flex items-start gap-3 p-4 rounded-xl border", cfg.bg)}>
                <Icon size={16} className={clsx(cfg.color, 'mt-0.5 shrink-0')} />
                <div>
                  <p className={clsx("text-sm font-medium", cfg.color)}>{s.code?.replace(/_/g, ' ')}</p>
                  <p className="text-[#94A3B8] text-sm mt-0.5">{s.message}</p>
                </div>
                <span className={clsx("ml-auto text-[10px] uppercase px-2 py-0.5 rounded border shrink-0", cfg.bg, cfg.color)}>
                  {s.severity}
                </span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
