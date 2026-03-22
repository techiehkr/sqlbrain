'use client'
import { useState } from 'react'
import { Cpu, Download, Trash2, X, ChevronDown, Check, Loader2 } from 'lucide-react'
import { useSQLBrainStore } from '@/store'
import { pullModel, deleteModel } from '@/lib/api'
import clsx from 'clsx'

// Models available to download — shown in the manager even if not installed
const AVAILABLE_MODELS = [
  { value: 'llama3.1',          label: 'Llama 3.1',          size: '4.7 GB', recommended: true },
  { value: 'qwen2.5-coder:14b', label: 'Qwen 2.5 Coder 14B', size: '9 GB',   recommended: true },
  { value: 'phi3:medium',       label: 'Phi-3 Medium',        size: '7.9 GB', recommended: false },
  { value: 'gemma2',            label: 'Gemma 2',             size: '5.4 GB', recommended: false },
  { value: 'mistral',           label: 'Mistral',             size: '4.1 GB', recommended: false },
  { value: 'codellama',         label: 'Code Llama',          size: '3.8 GB', recommended: false },
  { value: 'deepseek-coder',    label: 'DeepSeek Coder',      size: '776 MB', recommended: false },
]

const TAB_LABELS: Record<string, string> = {
  query:       'Query Editor',
  schema:      'Schema Explorer',
  performance: 'Performance Analyzer',
  charts:      'Chart Generator',
  history:     'Query History',
}

interface DownloadState {
  status: 'idle' | 'downloading' | 'done' | 'error'
  progress: number   // 0–100
  message: string
}

export default function Header() {
  const { activeTab, selectedModel, setSelectedModel, ollamaAvailable, availableModels, setOllamaStatus } = useSQLBrainStore()
  const [showManager, setShowManager] = useState(false)
  const [downloads, setDownloads] = useState<Record<string, DownloadState>>({})
  const [deleting, setDeleting] = useState<string | null>(null)

  const installedNames = availableModels.map(m => m.name)

  const setDownload = (model: string, patch: Partial<DownloadState>) =>
setDownloads(prev => ({
  ...prev,
  [model]: { ...{ status: 'idle', progress: 0, message: '' }, ...prev[model], ...patch },
}))
  const handlePull = async (modelName: string) => {
    setDownload(modelName, { status: 'downloading', progress: 0, message: 'Starting download...' })
    try {
      const res = await pullModel(modelName)
      if (!res.body) throw new Error('No stream')
      const reader = res.body.getReader()
      const decoder = new TextDecoder()

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const text = decoder.decode(value)
        for (const line of text.split('\n')) {
          if (!line.startsWith('data: ')) continue
          try {
            const data = JSON.parse(line.slice(6))
            if (data.error) throw new Error(data.error)
            if (data.status === 'done') {
              setDownload(modelName, { status: 'done', progress: 100, message: 'Installed!' })
              // Refresh model list in store
              const statusRes = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'}/api/ollama/status`)
              const statusData = await statusRes.json()
              setOllamaStatus(statusData.available, statusData.models ?? [])
              setSelectedModel(modelName)
              break
            }
            // Parse progress
            if (data.completed && data.total) {
              const pct = Math.round((data.completed / data.total) * 100)
              setDownload(modelName, {
                status: 'downloading',
                progress: pct,
                message: `${data.status} ${pct}%`,
              })
            } else if (data.status) {
              setDownload(modelName, { message: data.status })
            }
          } catch {
            // non-JSON line, skip
          }
        }
      }
    } catch (e: any) {
      setDownload(modelName, { status: 'error', message: e.message || 'Download failed' })
    }
  }

  const handleDelete = async (modelName: string) => {
    if (!confirm(`Delete ${modelName}? You can re-download it later.`)) return
    setDeleting(modelName)
    try {
      await deleteModel(modelName)
      // If deleted model was selected, switch to first remaining
      if (selectedModel === modelName) {
        const remaining = installedNames.filter(n => n !== modelName)
        if (remaining.length) setSelectedModel(remaining[0])
      }
      // Refresh
      const statusRes = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'}/api/ollama/status`)
      const statusData = await statusRes.json()
      setOllamaStatus(statusData.available, statusData.models ?? [])
    } catch {
      alert('Delete failed')
    } finally {
      setDeleting(null)
    }
  }

  // Merge installed + available-to-download into one list for the manager
  const allModels = [
    ...AVAILABLE_MODELS,
    // Any installed models not in our known list
    ...installedNames
      .filter(n => !AVAILABLE_MODELS.find(m => n.startsWith(m.value)))
      .map(n => ({ value: n, label: n, size: '', recommended: false })),
  ]

  return (
    <>
      <header className="bg-[#0F1420] border-b border-[#1C2333] px-6 py-3 flex items-center justify-between shrink-0">
        <h1 className="text-white font-medium text-sm">{TAB_LABELS[activeTab]}</h1>

        <div className="flex items-center gap-3">
          {/* Ollama status */}
          <div className="flex items-center gap-2 px-3 py-1.5 bg-[#070A10] border border-[#1C2333] rounded-lg">
            <div className={`w-1.5 h-1.5 rounded-full ${ollamaAvailable ? 'bg-[#10B981]' : 'bg-red-500'}`} />
            <span className="text-xs text-[#64748B]">Ollama</span>
            <span className={`text-xs font-medium ${ollamaAvailable ? 'text-[#10B981]' : 'text-red-400'}`}>
              {ollamaAvailable ? 'Running' : 'Offline'}
            </span>
          </div>

          {/* Model selector + manage button */}
          <div className="flex items-center gap-1">
            <Cpu size={13} className="text-[#64748B]" />
            <select
              value={selectedModel}
              onChange={e => setSelectedModel(e.target.value)}
              className="bg-[#070A10] border border-[#1C2333] text-[#CBD5E1] text-xs rounded-lg px-2 py-1.5 focus:outline-none focus:border-[#00D4FF]/40"
            >
              {installedNames.length > 0
                ? installedNames.map(name => {
                    const known = AVAILABLE_MODELS.find(m => name.startsWith(m.value))
                    return <option key={name} value={name}>{known ? known.label : name}</option>
                  })
                : <option value="">No models installed</option>}
            </select>
            <button
              onClick={() => setShowManager(true)}
              title="Manage models"
              className="p-1.5 text-[#64748B] hover:text-[#00D4FF] transition-colors rounded"
            >
              <Download size={13} />
            </button>
          </div>
        </div>
      </header>

      {/* ── Model Manager Modal ── */}
      {showManager && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-[#0F1420] border border-[#1C2333] rounded-2xl w-full max-w-lg mx-4 shadow-2xl max-h-[80vh] flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between p-5 border-b border-[#1C2333]">
              <div>
                <h2 className="text-white font-semibold">Model Manager</h2>
                <p className="text-[#64748B] text-xs mt-0.5">
                  {installedNames.length} model{installedNames.length !== 1 ? 's' : ''} installed
                </p>
              </div>
              <button onClick={() => setShowManager(false)} className="text-[#64748B] hover:text-white">
                <X size={18} />
              </button>
            </div>

            {/* Model list */}
            <div className="overflow-y-auto flex-1 p-3 space-y-2">
              {allModels.map(model => {
                const installed = installedNames.some(n => n === model.value || n.startsWith(model.value + ':'))
                const installedName = installedNames.find(n => n === model.value || n.startsWith(model.value + ':'))
                const dl = downloads[model.value]
                const isActive = selectedModel === installedName || selectedModel === model.value

                return (
                  <div
                    key={model.value}
                    className={clsx(
                      'flex items-center gap-3 p-3 rounded-xl border transition-all',
                      isActive ? 'border-[#00D4FF]/30 bg-[#00D4FF]/5' : 'border-[#1C2333]'
                    )}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-white">{model.label}</span>
                        {model.recommended && (
                          <span className="text-[10px] px-1.5 py-0.5 bg-[#10B981]/15 text-[#10B981] rounded-full">
                            recommended
                          </span>
                        )}
                        {isActive && (
                          <span className="text-[10px] px-1.5 py-0.5 bg-[#00D4FF]/10 text-[#00D4FF] rounded-full ml-auto">
                            active
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-[11px] text-[#64748B] font-mono">{model.value}</span>
                        {model.size && <span className="text-[10px] text-[#2D3748]">{model.size}</span>}
                      </div>

                      {/* Progress bar */}
                      {dl?.status === 'downloading' && (
                        <div className="mt-2">
                          <div className="w-full bg-[#1C2333] rounded-full h-1.5">
                            <div
                              className="bg-[#7C3AED] h-1.5 rounded-full transition-all"
                              style={{ width: `${dl.progress}%` }}
                            />
                          </div>
                          <p className="text-[10px] text-[#64748B] mt-1">{dl.message}</p>
                        </div>
                      )}
                      {dl?.status === 'error' && (
                        <p className="text-[10px] text-red-400 mt-1">{dl.message}</p>
                      )}
                      {dl?.status === 'done' && (
                        <p className="text-[10px] text-[#10B981] mt-1">✓ Installed successfully</p>
                      )}
                    </div>

                    {/* Action buttons */}
                    <div className="flex items-center gap-1.5 shrink-0">
                      {installed ? (
                        <>
                          {!isActive && (
                            <button
                              onClick={() => setSelectedModel(installedName || model.value)}
                              className="px-2.5 py-1 text-xs text-[#00D4FF] border border-[#00D4FF]/30 hover:bg-[#00D4FF]/10 rounded-lg transition-all"
                            >
                              Use
                            </button>
                          )}
                          <button
                            onClick={() => handleDelete(installedName || model.value)}
                            disabled={deleting === (installedName || model.value)}
                            className="p-1.5 text-[#64748B] hover:text-red-400 transition-colors rounded disabled:opacity-40"
                            title="Delete model"
                          >
                            {deleting === (installedName || model.value)
                              ? <Loader2 size={13} className="animate-spin" />
                              : <Trash2 size={13} />}
                          </button>
                        </>
                      ) : (
                        <button
                          onClick={() => handlePull(model.value)}
                          disabled={dl?.status === 'downloading'}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-[#7C3AED] hover:bg-[#6D28D9] text-white text-xs rounded-lg transition-all disabled:opacity-50"
                        >
                          {dl?.status === 'downloading'
                            ? <Loader2 size={11} className="animate-spin" />
                            : <Download size={11} />}
                          {dl?.status === 'downloading' ? `${dl.progress}%` : 'Download'}
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>

            <div className="p-4 border-t border-[#1C2333]">
              <p className="text-[11px] text-[#2D3748] text-center">
                Models are downloaded from Ollama and stored locally. No data leaves your machine.
              </p>
            </div>
          </div>
        </div>
      )}
    </>
  )
}