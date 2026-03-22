'use client'
import { useState, useEffect } from 'react'
import { History, Play, Copy, Clock, RefreshCw } from 'lucide-react'
import { useSQLBrainStore } from '@/store'
import { getQueryHistory } from '@/lib/api'
import clsx from 'clsx'

const TYPE_COLORS: Record<string, string> = {
  nl_to_sql: 'bg-[#7C3AED]/10 text-[#7C3AED] border-[#7C3AED]/20',
  manual: 'bg-[#00D4FF]/10 text-[#00D4FF] border-[#00D4FF]/20',
  optimized: 'bg-[#10B981]/10 text-[#10B981] border-[#10B981]/20',
}

export default function HistoryTab() {
  const { sessionId, setCurrentSQL, setActiveTab } = useSQLBrainStore()
  const [history, setHistory] = useState<any[]>([])
  const [loading, setLoading] = useState(false)

  const load = async () => {
    if (!sessionId) return
    setLoading(true)
    try {
      const res = await getQueryHistory(sessionId)
      setHistory(res.data)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [sessionId])

  const handleUse = (sql: string) => {
    setCurrentSQL(sql)
    setActiveTab('query')
  }

  const handleCopy = (sql: string) => {
    navigator.clipboard.writeText(sql)
  }

  return (
    <div className="flex flex-col h-full">
      <div className="bg-[#0F1420] border border-[#1C2333] rounded-xl overflow-hidden flex-1 flex flex-col">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-[#1C2333]">
          <div className="flex items-center gap-2">
            <History size={15} className="text-[#64748B]" />
            <span className="text-sm text-white font-medium">Query History</span>
            <span className="text-xs text-[#64748B] bg-[#1C2333] px-2 py-0.5 rounded-full">{history.length}</span>
          </div>
          <button onClick={load} className="p-1.5 text-[#64748B] hover:text-white transition-colors">
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>

        <div className="flex-1 overflow-auto">
          {history.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-[#64748B] gap-2">
              <History size={32} className="opacity-20" />
              <p className="text-sm">No queries yet. Run some queries first.</p>
            </div>
          ) : (
            <div className="divide-y divide-[#1C2333]">
              {history.map((item, i) => (
                <div key={i} className="px-5 py-4 hover:bg-[#070A10]/50 transition-colors group">
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <div className="flex items-center gap-2">
                      <span className={clsx("px-2 py-0.5 rounded border text-[10px] uppercase font-medium", TYPE_COLORS[item.type] || 'bg-[#1C2333] text-[#64748B]')}>
                        {item.type?.replace('_', '→')}
                      </span>
                      <div className="flex items-center gap-1 text-[#64748B] text-[10px]">
                        <Clock size={10} />
                        {new Date(item.timestamp).toLocaleString()}
                      </div>
                    </div>
                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button onClick={() => handleCopy(item.sql)} className="p-1.5 text-[#64748B] hover:text-white transition-colors rounded">
                        <Copy size={13} />
                      </button>
                      <button onClick={() => handleUse(item.sql)} className="p-1.5 text-[#00D4FF] hover:text-[#00BFDF] transition-colors rounded">
                        <Play size={13} />
                      </button>
                    </div>
                  </div>

                  {item.input && item.type === 'nl_to_sql' && (
                    <p className="text-[#94A3B8] text-xs mb-1.5 italic">"{item.input}"</p>
                  )}

                  <pre className="text-xs text-[#64748B] font-mono bg-[#070A10] rounded-lg px-3 py-2 overflow-hidden" style={{ maxHeight: '80px' }}>
                    {item.sql}
                  </pre>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
