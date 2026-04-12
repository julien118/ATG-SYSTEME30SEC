'use client'

import { useState } from 'react'

interface DeleteChantierModalProps {
  chantierNom: string
  onConfirm: () => Promise<void>
  onCancel: () => void
}

export default function DeleteChantierModal({ chantierNom, onConfirm, onCancel }: DeleteChantierModalProps) {
  const [deleting, setDeleting] = useState(false)

  const handleConfirm = async () => {
    setDeleting(true)
    await onConfirm()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40" onClick={onCancel} />

      {/* Modal */}
      <div className="relative w-full sm:max-w-sm bg-white rounded-t-2xl sm:rounded-2xl p-6 pb-safe animate-slide-up sm:animate-scale-in">
        <h3 className="text-lg font-bold text-foreground mb-2">
          Supprimer ce chantier ?
        </h3>
        <p className="text-gray-500 text-sm mb-6">
          Le chantier <span className="font-medium text-foreground">&quot;{chantierNom}&quot;</span> sera
          définitivement supprimé avec toutes ses photos, enregistrements et son rapport.
        </p>

        <div className="flex gap-3">
          <button
            onClick={onCancel}
            disabled={deleting}
            className="btn-tertiary flex-1"
          >
            Annuler
          </button>
          <button
            onClick={handleConfirm}
            disabled={deleting}
            className="flex-1 inline-flex items-center justify-center rounded-xl px-6 py-3 bg-red-600 text-white font-semibold transition-all active:scale-97 disabled:opacity-50"
          >
            {deleting ? 'Suppression...' : 'Supprimer'}
          </button>
        </div>
      </div>
    </div>
  )
}
