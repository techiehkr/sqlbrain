'use client'
import { useState, useEffect } from 'react'
import Sidebar from '@/components/Sidebar'
import Header from '@/components/Header'
import ConnectModal from '@/components/ConnectModal'
import QueryTab from '@/components/QueryTab'
import SchemaTab from '@/components/SchemaTab'
import PerformanceTab from '@/components/PerformanceTab'
import ChartsTab from '@/components/ChartsTab'
import HistoryTab from '@/components/HistoryTab'
import { useSQLBrainStore } from '@/store'
import { checkOllama } from '@/lib/api'

export default function Home() {
  const [showConnect, setShowConnect] = useState(false)
  const { activeTab, setOllamaStatus } = useSQLBrainStore()

  useEffect(() => {
    const poll = async () => {
      try {
        const res = await checkOllama()
        const { available, models } = res.data
        setOllamaStatus(available, models ?? [])
      } catch {
        setOllamaStatus(false, [])
      }
    }
    poll()
    const interval = setInterval(poll, 10_000)
    return () => clearInterval(interval)
  }, [])

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar onConnectClick={() => setShowConnect(true)} />
      <div className="flex-1 flex flex-col min-w-0">
        <Header />
        <main className="flex-1 overflow-auto p-4">
          {activeTab === 'query'       && <QueryTab />}
          {activeTab === 'schema'      && <SchemaTab />}
          {activeTab === 'performance' && <PerformanceTab />}
          {activeTab === 'charts'      && <ChartsTab />}
          {activeTab === 'history'     && <HistoryTab />}
        </main>
      </div>
      {showConnect && <ConnectModal onClose={() => setShowConnect(false)} />}
    </div>
  )
}