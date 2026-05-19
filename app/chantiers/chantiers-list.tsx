'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import type { Chantier, Profile } from '@/lib/types'
import ChantierCard from '@/components/ChantierCard'
import DeleteChantierModal from '@/components/DeleteChantierModal'
import { useToast } from '@/components/ToastProvider'

type Tab = 'tous' | 'en_cours' | 'rapports'

interface ChantiersListProps {
  chantiers: Chantier[]
  profile: Profile
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export default function ChantiersList({ chantiers, profile: _profile }: ChantiersListProps) {
  const [tab, setTab] = useState<Tab>('tous')
  const [search, setSearch] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<Chantier | null>(null)
  const router = useRouter()
  const toast = useToast()

  // Filter by tab
  const tabFiltered = chantiers.filter((c) => {
    if (tab === 'en_cours') return ['planifie', 'en_cours', 'termine'].includes(c.statut)
    if (tab === 'rapports') return c.statut === 'rapport_genere'
    return true
  })

  // Filter by search
  const searchLower = search.toLowerCase()
  const filtered = tabFiltered.filter((c) => {
    if (!search) return true
    return (
      c.client_nom.toLowerCase().includes(searchLower) ||
      (c.client_adresse?.toLowerCase().includes(searchLower)) ||
      (c.objet_travaux?.toLowerCase().includes(searchLower))
    )
  })

  const handleDelete = async () => {
    if (!deleteTarget) return
    try {
      await fetch(`/api/chantiers/${deleteTarget.id}`, { method: 'DELETE' })
      toast.show('Chantier supprimé', 'success')
      setDeleteTarget(null)
      router.refresh()
    } catch {
      toast.show('Erreur lors de la suppression', 'error')
    }
  }

  const countEnCours = chantiers.filter((c) => ['planifie', 'en_cours', 'termine'].includes(c.statut)).length
  const countRapports = chantiers.filter((c) => c.statut === 'rapport_genere').length

  const tabs: { key: Tab; label: string; count: number }[] = [
    { key: 'tous', label: 'Tous', count: chantiers.length },
    { key: 'en_cours', label: 'En cours', count: countEnCours },
    { key: 'rapports', label: 'Rapports', count: countRapports },
  ]

  return (
    <div className="pb-24">
      {/* Tabs */}
      <div className="flex gap-1 mb-4 bg-gray-100 rounded-xl p-1">
        {tabs.map(({ key, label, count }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex-1 py-2 px-3 rounded-lg text-sm font-medium transition-all flex items-center justify-center gap-1.5 ${
              tab === key
                ? 'bg-white text-foreground shadow-sm'
                : 'text-gray-400 hover:text-gray-600'
            }`}
          >
            {label}
            {count > 0 && (
              <span className={`text-xs min-w-[18px] h-[18px] flex items-center justify-center rounded-full ${
                tab === key ? 'bg-primary/10 text-primary' : 'bg-gray-200/80 text-gray-400'
              }`}>
                {count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Search */}
      {chantiers.length > 0 && (
        <div className="mb-4">
          <div className="relative">
            <svg className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Rechercher par nom, adresse, objet..."
              className="input-ionnyx pl-10"
            />
          </div>
        </div>
      )}

      {/* List or empty state */}
      {chantiers.length === 0 ? (
        <EmptyState />
      ) : filtered.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-gray-400 text-sm">Aucun chantier trouvé.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((chantier) => (
            <ChantierCard
              key={chantier.id}
              chantier={chantier}
              onLongPress={setDeleteTarget}
            />
          ))}
        </div>
      )}

      {/* FAB création */}
      <Link
        href="/chantiers/nouveau"
        className="fixed bottom-8 right-5 mb-safe w-14 h-14 btn-primary rounded-full flex items-center justify-center shadow-lg z-40 p-0"
      >
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
      </Link>

      {/* Delete modal */}
      {deleteTarget && (
        <DeleteChantierModal
          chantierNom={deleteTarget.client_nom}
          onConfirm={handleDelete}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </div>
  )
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="w-24 h-24 rounded-3xl bg-input-focus flex items-center justify-center mb-6">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#10B981" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
          <polyline points="9 22 9 12 15 12 15 22" />
        </svg>
      </div>
      <h2 className="text-lg font-semibold text-foreground mb-2">
        Aucune visite pour l&apos;instant
      </h2>
      <p className="text-gray-400 text-sm mb-8 max-w-xs">
        Créez votre premier chantier et testez la capture terrain.
      </p>
      <Link href="/chantiers/nouveau" className="btn-primary text-base px-8 py-3">
        Créer ma première visite
      </Link>
    </div>
  )
}
