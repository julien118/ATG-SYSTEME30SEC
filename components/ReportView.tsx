'use client'

import { useState } from 'react'
import type { RapportContenu } from '@/lib/types'

interface ReportViewProps {
  contenu: RapportContenu
  onUpdate: (updated: RapportContenu) => void
}

export default function ReportView({ contenu, onUpdate }: ReportViewProps) {
  const [fullscreenPhoto, setFullscreenPhoto] = useState<string | null>(null)
  const [editingObs, setEditingObs] = useState<{ index: number; field: 'description' } | null>(null)
  const [editText, setEditText] = useState('')

  const startEdit = (index: number) => {
    setEditingObs({ index, field: 'description' })
    setEditText(contenu.observations[index].description)
  }

  const saveEdit = () => {
    if (!editingObs) return
    const updated = { ...contenu }
    updated.observations = [...contenu.observations]
    updated.observations[editingObs.index] = {
      ...updated.observations[editingObs.index],
      description: editText,
    }
    onUpdate(updated)
    setEditingObs(null)
  }

  return (
    <>
      <div className="space-y-6">
        {/* Client info */}
        <section className="bg-white rounded-xl border border-border p-4">
          <h3 className="text-xs font-semibold text-primary uppercase tracking-wider mb-3">
            Informations client
          </h3>
          <div className="space-y-1.5 text-sm">
            <p><span className="text-gray-400">Nom :</span> <span className="text-foreground font-medium">{contenu.client.nom}</span></p>
            {contenu.client.adresse && (
              <p><span className="text-gray-400">Adresse :</span> <span className="text-foreground">{contenu.client.adresse}</span></p>
            )}
            {contenu.client.telephone && (
              <p><span className="text-gray-400">Tél :</span> <span className="text-foreground">{contenu.client.telephone}</span></p>
            )}
            {contenu.client.date_visite && (
              <p><span className="text-gray-400">Visite :</span> <span className="text-foreground">{contenu.client.date_visite}</span></p>
            )}
          </div>
        </section>

        {/* Observations */}
        {contenu.observations.map((obs, i) => (
          <section key={i} className="bg-white rounded-xl border border-border overflow-hidden">
            <div className="p-4">
              <h3 className="font-semibold text-foreground mb-2">{obs.titre}</h3>

              {editingObs?.index === i ? (
                <textarea
                  value={editText}
                  onChange={(e) => setEditText(e.target.value)}
                  onBlur={saveEdit}
                  autoFocus
                  rows={5}
                  className="input-ionnyx text-sm resize-none"
                />
              ) : (
                <p
                  onClick={() => startEdit(i)}
                  className="text-sm text-gray-600 leading-relaxed whitespace-pre-wrap cursor-pointer hover:bg-input-focus rounded-lg -mx-2 px-2 py-1 transition-colors"
                  dangerouslySetInnerHTML={{
                    __html: obs.description.replace(
                      /\*\*(.*?)\*\*/g,
                      '<strong class="text-foreground">$1</strong>'
                    ),
                  }}
                />
              )}
            </div>

            {/* Photos */}
            {obs.photos.length > 0 && (
              <div className="px-4 pb-3 space-y-3">
                {obs.photos.map((photo, pi) => (
                  <div key={pi}>
                    <img
                      src={photo.url}
                      alt={photo.legende}
                      onClick={() => setFullscreenPhoto(photo.url)}
                      className="max-w-full max-h-80 rounded-lg object-contain mx-auto cursor-pointer hover:opacity-95 transition-opacity"
                    />
                    <p className="text-xs text-gray-400 italic mt-1.5 text-center">{photo.legende}</p>
                  </div>
                ))}
              </div>
            )}

            {/* Points de vigilance */}
            {obs.points_vigilance.length > 0 && (
              <div className="mx-4 mb-4 bg-input-focus border border-primary/10 rounded-xl p-3">
                <p className="text-xs font-semibold text-primary mb-2">Points de vigilance</p>
                <ul className="space-y-1">
                  {obs.points_vigilance.map((point, pi) => (
                    <li key={pi} className="text-sm text-gray-600 flex gap-2">
                      <span className="text-primary mt-0.5">•</span>
                      <span>{point}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        ))}

        {/* Extra sections */}
        {contenu.acces_chantier && (
          <section className="bg-white rounded-xl border border-border p-4">
            <h3 className="text-xs font-semibold text-primary uppercase tracking-wider mb-2">Accès chantier</h3>
            <p className="text-sm text-gray-600">{contenu.acces_chantier}</p>
          </section>
        )}

        {contenu.duree_estimee && (
          <section className="bg-white rounded-xl border border-border p-4">
            <h3 className="text-xs font-semibold text-primary uppercase tracking-wider mb-2">Durée estimée</h3>
            <p className="text-sm text-gray-600">{contenu.duree_estimee}</p>
          </section>
        )}

        {contenu.notes && (
          <section className="bg-white rounded-xl border border-border p-4">
            <h3 className="text-xs font-semibold text-primary uppercase tracking-wider mb-2">Notes</h3>
            <p className="text-sm text-gray-600 whitespace-pre-wrap">{contenu.notes}</p>
          </section>
        )}
      </div>

      {/* Fullscreen photo viewer */}
      {fullscreenPhoto && (
        <div
          className="fixed inset-0 z-50 bg-black flex items-center justify-center"
          onClick={() => setFullscreenPhoto(null)}
        >
          <button
            onClick={() => setFullscreenPhoto(null)}
            className="absolute top-4 right-4 z-10 w-10 h-10 rounded-full bg-white/10 flex items-center justify-center text-white"
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
          <img
            src={fullscreenPhoto}
            alt="Photo plein écran"
            className="max-w-full max-h-full object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </>
  )
}
