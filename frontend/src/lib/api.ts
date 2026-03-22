import axios from 'axios'

const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000',
  timeout: 120000,
})

// ── Database ──────────────────────────────────────────────────────────────────
export const connectDB = (data: {
  db_type: string; host: string; port: number;
  username: string; password: string; database: string; filepath: string;
}) => api.post('/api/database/connect', data)

export const disconnectDB = (sessionId: string) =>
  api.delete(`/api/database/disconnect/${sessionId}`)

export const getSchema = (sessionId: string, refresh = false) =>
  api.get(`/api/database/schema/${sessionId}?refresh=${refresh}`)

export const getConnectionStatus = (sessionId: string) =>
  api.get(`/api/database/status/${sessionId}`)

// ── Query ─────────────────────────────────────────────────────────────────────
export const getTableCandidates = (sessionId: string, question: string, model: string) =>
  api.post('/api/query/nl-to-sql/candidates', { session_id: sessionId, question, model })

export const confirmAndGenerate = (
  sessionId: string,
  question: string,
  confirmedTables: any[],
  model: string,
) => api.post('/api/query/nl-to-sql/confirm', {
  session_id: sessionId, question, confirmed_tables: confirmedTables, model,
})

export const executeQuery = (sessionId: string, sql: string) =>
  api.post('/api/query/execute', { session_id: sessionId, sql })

export const explainQuery = (sessionId: string, sql: string, model: string) =>
  api.post('/api/query/explain', { session_id: sessionId, sql, model })

export const optimizeQuery = (sessionId: string, sql: string, model: string) =>
  api.post('/api/query/optimize', { session_id: sessionId, sql, model })

export const getIndexRecommendations = (sessionId: string, sql: string, model: string) =>
  api.post('/api/query/index-recommendations', { session_id: sessionId, sql, model })

// ── Schema ────────────────────────────────────────────────────────────────────
export const getSchemaGraph = (sessionId: string) =>
  api.get(`/api/schema/graph/${sessionId}`)

// ── Performance ───────────────────────────────────────────────────────────────
export const analyzeQuery = (sessionId: string, sql: string) =>
  api.post('/api/performance/analyze', { session_id: sessionId, sql })

export const getQueryHistory = (sessionId: string) =>
  api.get(`/api/performance/history/${sessionId}`)

// ── Charts ────────────────────────────────────────────────────────────────────
export const generateChart = (
  sessionId: string, question: string, model: string, chartType?: string,
) => api.post('/api/charts/generate', {
  session_id: sessionId, question, model, chart_type: chartType,
})

// ── Ollama ────────────────────────────────────────────────────────────────────
export const checkOllama = () => api.get('/api/ollama/status')

export const pullModel = (model: string) =>
  fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'}/api/ollama/pull`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model }),
  })

export const deleteModel = (model: string) =>
  api.delete('/api/ollama/delete', { data: { model } })

export default api