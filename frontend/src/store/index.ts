import { create } from 'zustand'

export interface Column {
  name: string
  type: string
  nullable: boolean
  default?: string | null
  max_length?: number | null
  is_primary?: boolean
}

export interface ForeignKey {
  column: string
  references_table: string
  references_column: string
  constraint_name: string
}

export interface Index {
  name: string
  columns: string[]
  is_unique: boolean
  is_primary: boolean
}

export interface Table {
  name: string
  schema: string
  columns: Column[]
  indexes: Index[]
  foreign_keys: ForeignKey[]
  row_count: number
}

export interface Schema {
  tables: Table[]
  summary: {
    total_tables: number
    total_columns: number
    total_relationships: number
    total_indexes: number
  }
}

export type TabType = 'query' | 'schema' | 'performance' | 'charts' | 'history'

export type QuestionCategory =
  | 'SQL_GENERATION'
  | 'SCHEMA_QUESTION'
  | 'SQL_EXPLANATION'
  | 'GENERAL_QUESTION'
  | null

interface SQLBrainStore {
  sessionId: string | null
  isConnected: boolean
  dbType: string
  database: string
  setConnection: (sessionId: string, dbType: string, database: string) => void
  clearConnection: () => void

  schema: Schema | null
  setSchema: (schema: Schema) => void

  activeTab: TabType
  setActiveTab: (tab: TabType) => void

  currentSQL: string
  setCurrentSQL: (sql: string) => void

  selectedModel: string
  setSelectedModel: (model: string) => void

  ollamaAvailable: boolean
  availableModels: { name: string; size: number }[]
  setOllamaStatus: (available: boolean, models: { name: string; size: number }[]) => void

  queryResults: {
    columns: string[]
    rows: Record<string, unknown>[]
    row_count: number
    truncated: boolean
    loading: boolean
    error: string | null
    answer: string | null
    category: QuestionCategory
  }
  setQueryResults: (results: Partial<SQLBrainStore['queryResults']>) => void
}

export const useSQLBrainStore = create<SQLBrainStore>((set) => ({
  sessionId: null,
  isConnected: false,
  dbType: '',
  database: '',
  setConnection: (sessionId, dbType, database) =>
    set({ sessionId, isConnected: true, dbType, database }),
  clearConnection: () =>
    set({ sessionId: null, isConnected: false, dbType: '', database: '', schema: null }),

  schema: null,
  setSchema: (schema) => set({ schema }),

  activeTab: 'query',
  setActiveTab: (activeTab) => set({ activeTab }),

  currentSQL: '',
  setCurrentSQL: (currentSQL) => set({ currentSQL }),

  selectedModel: 'llama3.1',   // ← correct default
  setSelectedModel: (selectedModel) => set({ selectedModel }),

  ollamaAvailable: false,
  availableModels: [],
  setOllamaStatus: (ollamaAvailable, availableModels) =>
    set({ ollamaAvailable, availableModels }),

  queryResults: {
    columns: [],
    rows: [],
    row_count: 0,
    truncated: false,
    loading: false,
    error: null,
    answer: null,
    category: null,
  },
  setQueryResults: (results) =>
    set((state) => ({ queryResults: { ...state.queryResults, ...results } })),
}))