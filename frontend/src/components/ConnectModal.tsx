'use client'
import { useState } from 'react'
import { Database, X, Loader2, CheckCircle2, AlertCircle } from 'lucide-react'
import { connectDB, getSchema } from '@/lib/api'
import { useSQLBrainStore } from '@/store'

const DB_TYPES = [
  { value: 'mssql', label: 'SQL Server', icon: '🏢', port: 1433 },
  { value: 'postgresql', label: 'PostgreSQL', icon: '🐘', port: 5432 },
  { value: 'mysql', label: 'MySQL', icon: '🐬', port: 3306 },
  { value: 'sqlite', label: 'SQLite', icon: '📁', port: 0 },
]

interface Props {
  onClose: () => void
}

export default function ConnectModal({ onClose }: Props) {
  const { setConnection, setSchema } = useSQLBrainStore()
  const [dbType, setDbType] = useState('mssql')
  const [form, setForm] = useState({ host: 'localhost', port: 1433, username: 'sa', password: '', database: '', filepath: '' })
  const [status, setStatus] = useState<'idle' | 'connecting' | 'success' | 'error'>('idle')
  const [error, setError] = useState('')

  const selectedDb = DB_TYPES.find(d => d.value === dbType)!

  const handleDbTypeChange = (type: string) => {
    setDbType(type)
    const db = DB_TYPES.find(d => d.value === type)!
    setForm(f => ({ ...f, port: db.port }))
  }

  const handleConnect = async () => {
    setStatus('connecting')
    setError('')
    try {
      const res = await connectDB({ db_type: dbType, ...form })
      const { session_id } = res.data
      setConnection(session_id, dbType, form.database)

      // Load schema
      const schemaRes = await getSchema(session_id)
      setSchema(schemaRes.data)

      setStatus('success')
      setTimeout(onClose, 800)
    } catch (err: any) {
      setStatus('error')
      setError(err.response?.data?.detail || 'Connection failed')
    }
  }

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 animate-fade-in">
      <div className="bg-[#0F1420] border border-[#1C2333] rounded-2xl w-full max-w-lg mx-4 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-[#1C2333]">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#00D4FF]/10 flex items-center justify-center">
              <Database size={20} className="text-[#00D4FF]" />
            </div>
            <div>
              <h2 className="text-white font-semibold">Connect Database</h2>
              <p className="text-[#64748B] text-sm">All connections stay local</p>
            </div>
          </div>
          <button onClick={onClose} className="text-[#64748B] hover:text-white transition-colors">
            <X size={20} />
          </button>
        </div>

        <div className="p-6 space-y-5">
          {/* DB Type */}
          <div>
            <label className="text-xs text-[#64748B] uppercase tracking-wider mb-2 block">Database Type</label>
            <div className="grid grid-cols-4 gap-2">
              {DB_TYPES.map(db => (
                <button
                  key={db.value}
                  onClick={() => handleDbTypeChange(db.value)}
                  className={`p-3 rounded-xl border text-center transition-all ${
                    dbType === db.value
                      ? 'border-[#00D4FF] bg-[#00D4FF]/10 text-[#00D4FF]'
                      : 'border-[#1C2333] text-[#64748B] hover:border-[#2D3748] hover:text-white'
                  }`}
                >
                  <div className="text-lg mb-1">{db.icon}</div>
                  <div className="text-xs font-medium">{db.label}</div>
                </button>
              ))}
            </div>
          </div>

          {dbType === 'sqlite' ? (
            <Input label="File Path" value={form.filepath} onChange={v => setForm(f => ({ ...f, filepath: v }))} placeholder="/path/to/database.db" />
          ) : (
            <>
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2">
                  <Input label="Host" value={form.host} onChange={v => setForm(f => ({ ...f, host: v }))} placeholder="localhost" />
                </div>
                <Input label="Port" value={String(form.port)} onChange={v => setForm(f => ({ ...f, port: Number(v) }))} placeholder={String(selectedDb.port)} />
              </div>
              <Input label="Database" value={form.database} onChange={v => setForm(f => ({ ...f, database: v }))} placeholder="my_database" />
              <div className="grid grid-cols-2 gap-3">
                <Input label="Username" value={form.username} onChange={v => setForm(f => ({ ...f, username: v }))} placeholder="sa" />
                <Input label="Password" type="password" value={form.password} onChange={v => setForm(f => ({ ...f, password: v }))} placeholder="••••••••" />
              </div>
            </>
          )}

          {error && (
            <div className="flex items-start gap-2 p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
              <AlertCircle size={16} className="text-red-400 mt-0.5 shrink-0" />
              <p className="text-red-400 text-sm">{error}</p>
            </div>
          )}

          <button
            onClick={handleConnect}
            disabled={status === 'connecting'}
            className={`w-full py-3 rounded-xl font-medium transition-all flex items-center justify-center gap-2 ${
              status === 'success'
                ? 'bg-[#10B981] text-white'
                : 'bg-[#00D4FF] hover:bg-[#00BFDF] text-[#0A0D14] disabled:opacity-50'
            }`}
          >
            {status === 'connecting' && <Loader2 size={16} className="animate-spin" />}
            {status === 'success' && <CheckCircle2 size={16} />}
            {status === 'connecting' ? 'Connecting...' : status === 'success' ? 'Connected!' : 'Connect'}
          </button>
        </div>
      </div>
    </div>
  )
}

function Input({ label, value, onChange, placeholder, type = 'text' }: {
  label: string; value: string; onChange: (v: string) => void;
  placeholder?: string; type?: string;
}) {
  return (
    <div>
      <label className="text-xs text-[#64748B] uppercase tracking-wider mb-1.5 block">{label}</label>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full bg-[#070A10] border border-[#1C2333] rounded-lg px-3 py-2.5 text-sm text-white placeholder-[#2D3748] focus:outline-none focus:border-[#00D4FF]/50 transition-colors font-mono"
      />
    </div>
  )
}
