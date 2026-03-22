'use client'
import { useState } from 'react'
import { BarChart3, Loader2, Sparkles, TrendingUp, PieChart, Activity } from 'lucide-react'
import { useSQLBrainStore } from '@/store'
import { generateChart } from '@/lib/api'
import {
  BarChart, Bar, LineChart, Line, PieChart as RechartsPie, Pie, Cell,
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend
} from 'recharts'
import clsx from 'clsx'

const CHART_TYPES = [
  { value: 'bar', label: 'Bar', icon: BarChart3 },
  { value: 'line', label: 'Line', icon: TrendingUp },
  { value: 'area', label: 'Area', icon: Activity },
  { value: 'pie', label: 'Pie', icon: PieChart },
]

const COLORS = ['#00D4FF', '#7C3AED', '#10B981', '#F59E0B', '#EF4444', '#EC4899', '#06B6D4', '#84CC16']

export default function ChartsTab() {
  const { sessionId, selectedModel } = useSQLBrainStore()
  const [question, setQuestion] = useState('')
  const [chartType, setChartType] = useState('bar')
  const [loading, setLoading] = useState(false)
  const [chartData, setChartData] = useState<any>(null)
  const [error, setError] = useState('')

  const handleGenerate = async () => {
    if (!question.trim() || !sessionId) return
    setLoading(true)
    setError('')
    try {
      const res = await generateChart(sessionId, question, selectedModel, chartType)
      setChartData(res.data)
    } catch (e: any) {
      setError(e.response?.data?.detail || 'Chart generation failed')
    } finally {
      setLoading(false)
    }
  }

  const exampleQueries = [
    'Revenue by month this year',
    'Top 10 customers by order count',
    'Orders by status (pie chart)',
    'Daily signups over last 30 days',
  ]

  return (
    <div className="flex flex-col h-full gap-3">
      {/* Input */}
      <div className="bg-[#0F1420] border border-[#1C2333] rounded-xl p-4">
        <div className="flex items-center gap-2 mb-3">
          <Sparkles size={15} className="text-[#7C3AED]" />
          <span className="text-xs text-[#64748B] uppercase tracking-wider">AI Chart Generator</span>
        </div>

        {/* Chart type */}
        <div className="flex gap-2 mb-3">
          {CHART_TYPES.map(ct => {
            const Icon = ct.icon
            return (
              <button key={ct.value} onClick={() => setChartType(ct.value)}
                className={clsx("flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition-all",
                  chartType === ct.value ? "bg-[#00D4FF]/10 border border-[#00D4FF]/30 text-[#00D4FF]" : "bg-[#1C2333] text-[#64748B] hover:text-white border border-transparent"
                )}>
                <Icon size={12} />
                {ct.label}
              </button>
            )
          })}
        </div>

        <div className="flex gap-2">
          <input
            value={question}
            onChange={e => setQuestion(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleGenerate()}
            placeholder="Describe the chart you want... e.g. Revenue by month"
            className="flex-1 bg-[#070A10] border border-[#1C2333] rounded-lg px-4 py-2.5 text-sm text-white placeholder-[#2D3748] focus:outline-none focus:border-[#7C3AED]/50"
          />
          <button onClick={handleGenerate} disabled={loading || !sessionId || !question}
            className="px-4 py-2.5 bg-[#7C3AED] hover:bg-[#6D28D9] text-white rounded-lg text-sm font-medium transition-all disabled:opacity-40 flex items-center gap-2 shrink-0">
            {loading ? <Loader2 size={14} className="animate-spin" /> : <BarChart3 size={14} />}
            {loading ? 'Generating...' : 'Generate'}
          </button>
        </div>

        {/* Examples */}
        <div className="flex flex-wrap gap-2 mt-3">
          {exampleQueries.map(q => (
            <button key={q} onClick={() => setQuestion(q)}
              className="px-2.5 py-1 bg-[#070A10] border border-[#1C2333] text-[#64748B] hover:text-white hover:border-[#2D3748] text-xs rounded-lg transition-all">
              {q}
            </button>
          ))}
        </div>
      </div>

      {/* Chart */}
      <div className="flex-1 bg-[#0F1420] border border-[#1C2333] rounded-xl overflow-hidden">
        {loading ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-[#64748B]">
            <Loader2 size={24} className="animate-spin" />
            <p className="text-sm">Generating SQL and chart...</p>
          </div>
        ) : error ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-red-400 text-sm">{error}</p>
          </div>
        ) : chartData ? (
          <ChartDisplay data={chartData} />
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-[#64748B] gap-2">
            <BarChart3 size={32} className="opacity-20" />
            <p className="text-sm">Describe what you want to visualize</p>
          </div>
        )}
      </div>
    </div>
  )
}

function ChartDisplay({ data }: { data: any }) {
  const { chart_type, title, x_axis, y_axis, data: rows, sql, row_count } = data

  return (
    <div className="h-full flex flex-col">
      <div className="px-5 py-4 border-b border-[#1C2333] flex items-center justify-between">
        <div>
          <h3 className="text-white font-medium">{title}</h3>
          <p className="text-[#64748B] text-xs mt-0.5">{row_count} data points · {chart_type} chart</p>
        </div>
      </div>

      <div className="flex-1 p-5">
        <ResponsiveContainer width="100%" height="85%">
          {chart_type === 'pie' ? (
            <RechartsPie>
              <Pie data={rows} dataKey={y_axis || Object.keys(rows[0] || {})[1]} nameKey={x_axis || Object.keys(rows[0] || {})[0]}
                cx="50%" cy="50%" outerRadius={120} label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}>
                {rows.map((_: any, i: number) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
              </Pie>
              <Tooltip contentStyle={{ background: '#0F1420', border: '1px solid #1C2333', borderRadius: '8px', color: '#E2E8F0' }} />
              <Legend />
            </RechartsPie>
          ) : chart_type === 'line' ? (
            <LineChart data={rows}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1C2333" />
              <XAxis dataKey={x_axis} tick={{ fill: '#64748B', fontSize: 11 }} axisLine={{ stroke: '#1C2333' }} />
              <YAxis tick={{ fill: '#64748B', fontSize: 11 }} axisLine={{ stroke: '#1C2333' }} />
              <Tooltip contentStyle={{ background: '#0F1420', border: '1px solid #1C2333', borderRadius: '8px', color: '#E2E8F0' }} />
              <Line type="monotone" dataKey={y_axis} stroke="#00D4FF" strokeWidth={2} dot={{ fill: '#00D4FF', r: 3 }} />
            </LineChart>
          ) : chart_type === 'area' ? (
            <AreaChart data={rows}>
              <defs>
                <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#00D4FF" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#00D4FF" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#1C2333" />
              <XAxis dataKey={x_axis} tick={{ fill: '#64748B', fontSize: 11 }} axisLine={{ stroke: '#1C2333' }} />
              <YAxis tick={{ fill: '#64748B', fontSize: 11 }} axisLine={{ stroke: '#1C2333' }} />
              <Tooltip contentStyle={{ background: '#0F1420', border: '1px solid #1C2333', borderRadius: '8px', color: '#E2E8F0' }} />
              <Area type="monotone" dataKey={y_axis} stroke="#00D4FF" strokeWidth={2} fill="url(#areaGrad)" />
            </AreaChart>
          ) : (
            <BarChart data={rows}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1C2333" />
              <XAxis dataKey={x_axis} tick={{ fill: '#64748B', fontSize: 11 }} axisLine={{ stroke: '#1C2333' }} />
              <YAxis tick={{ fill: '#64748B', fontSize: 11 }} axisLine={{ stroke: '#1C2333' }} />
              <Tooltip contentStyle={{ background: '#0F1420', border: '1px solid #1C2333', borderRadius: '8px', color: '#E2E8F0' }} />
              <Bar dataKey={y_axis} fill="#00D4FF" radius={[4, 4, 0, 0]}>
                {rows.map((_: any, i: number) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
              </Bar>
            </BarChart>
          )}
        </ResponsiveContainer>
      </div>

      <div className="px-5 py-3 border-t border-[#1C2333]">
        <p className="text-[10px] text-[#2D3748] font-mono truncate">{sql}</p>
      </div>
    </div>
  )
}
