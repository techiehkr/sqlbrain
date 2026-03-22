'use client'
import { Brain, Database, Code2, BarChart3, Zap, History, Settings, ChevronRight } from 'lucide-react'
import { useSQLBrainStore, TabType } from '@/store'
import clsx from 'clsx'

const TABS: { id: TabType; label: string; icon: React.ElementType; badge?: string }[] = [
  { id: 'query', label: 'Query', icon: Code2 },
  { id: 'schema', label: 'Schema', icon: Database },
  { id: 'performance', label: 'Performance', icon: Zap },
  { id: 'charts', label: 'Charts', icon: BarChart3 },
  { id: 'history', label: 'History', icon: History },
]

interface Props {
  onConnectClick: () => void
}

export default function Sidebar({ onConnectClick }: Props) {
  const { activeTab, setActiveTab, isConnected, dbType, database, schema } = useSQLBrainStore()

  return (
    <aside className="w-16 lg:w-56 bg-[#0F1420] border-r border-[#1C2333] flex flex-col shrink-0 transition-all">
      {/* Logo */}
      <div className="p-4 border-b border-[#1C2333]">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#00D4FF] to-[#7C3AED] flex items-center justify-center shrink-0">
            <Brain size={16} className="text-white" />
          </div>
          <div className="hidden lg:block">
            <div className="text-white font-bold text-sm tracking-tight">SQLBrain</div>
            <div className="text-[#64748B] text-[10px]">Local AI · v1.0</div>
          </div>
        </div>
      </div>

      {/* Connection Status */}
      <div className="p-3 border-b border-[#1C2333]">
        <button
          onClick={onConnectClick}
          className={clsx(
            "w-full rounded-lg p-2.5 transition-all flex items-center gap-2.5",
            isConnected
              ? "bg-[#10B981]/10 border border-[#10B981]/20 hover:bg-[#10B981]/15"
              : "bg-[#1C2333] hover:bg-[#2D3748] border border-transparent"
          )}
        >
          <div className={clsx(
            "w-2 h-2 rounded-full shrink-0",
            isConnected ? "bg-[#10B981] shadow-[0_0_6px_#10B981]" : "bg-[#64748B]"
          )} />
          <div className="hidden lg:block text-left overflow-hidden">
            {isConnected ? (
              <>
                <div className="text-[#10B981] text-xs font-medium truncate">{database || 'Connected'}</div>
                <div className="text-[#64748B] text-[10px] uppercase">{dbType}</div>
              </>
            ) : (
              <div className="text-[#64748B] text-xs">Click to connect</div>
            )}
          </div>
        </button>
      </div>

      {/* Schema Summary */}
      {schema && (
        <div className="hidden lg:block px-3 py-2 border-b border-[#1C2333]">
          <div className="grid grid-cols-2 gap-1.5">
            {[
              { label: 'Tables', value: schema.summary.total_tables },
              { label: 'Columns', value: schema.summary.total_columns },
              { label: 'Relations', value: schema.summary.total_relationships },
              { label: 'Indexes', value: schema.summary.total_indexes },
            ].map(item => (
              <div key={item.label} className="bg-[#070A10] rounded-lg p-2 text-center">
                <div className="text-white font-bold text-sm font-mono">{item.value}</div>
                <div className="text-[#64748B] text-[10px]">{item.label}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Nav */}
      <nav className="flex-1 p-2 space-y-1">
        {TABS.map(tab => {
          const Icon = tab.icon
          const active = activeTab === tab.id
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              disabled={!isConnected && tab.id !== 'query'}
              className={clsx(
                "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all group",
                active
                  ? "bg-[#00D4FF]/10 text-[#00D4FF] border border-[#00D4FF]/20"
                  : "text-[#64748B] hover:text-white hover:bg-[#1C2333] border border-transparent",
                !isConnected && tab.id !== 'query' && "opacity-40 cursor-not-allowed"
              )}
            >
              <Icon size={17} className="shrink-0" />
              <span className="hidden lg:block text-sm font-medium">{tab.label}</span>
              {active && <ChevronRight size={14} className="hidden lg:block ml-auto" />}
            </button>
          )
        })}
      </nav>

      {/* Bottom */}
      <div className="p-3 border-t border-[#1C2333]">
        <div className="hidden lg:block px-2 py-2 text-[10px] text-[#64748B] text-center">
          🔒 Local only · Zero data sent
        </div>
      </div>
    </aside>
  )
}
