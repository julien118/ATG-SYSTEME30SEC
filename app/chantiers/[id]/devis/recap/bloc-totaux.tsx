'use client'

// Bloc Totaux avec taux de TVA ajustable (lot 5.2). Olivier garde 10 % par
// defaut mais peut corriger le taux avant l'envoi. Le taux est persiste sur la
// ligne devis (table devis, colonne tva_taux) : c'est lui que la route de push
// relit pour poser le taxRate sur les lignes Costructor. Le total TTC se recalcule
// en direct cote client ; le HT vient du serveur (somme des metres).

import { useState } from 'react'

interface Props {
  devisId: string
  totalHT: number
  tvaTauxInitial: number
}

function formatEUR(n: number): string {
  return new Intl.NumberFormat('fr-FR', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 2,
  }).format(n)
}

// Borne le taux dans [0, 100] et arrondit au dixieme (assez fin pour 5,5 / 10 / 20).
function normaliserTaux(valeur: number): number {
  if (Number.isNaN(valeur)) return 0
  return Math.min(100, Math.max(0, Math.round(valeur * 10) / 10))
}

export default function BlocTotaux({ devisId, totalHT, tvaTauxInitial }: Props) {
  const [taux, setTaux] = useState<number>(normaliserTaux(tvaTauxInitial))
  // Texte brut du champ : permet la saisie intermediaire (champ vide, virgule).
  const [saisie, setSaisie] = useState<string>(String(normaliserTaux(tvaTauxInitial)))
  const [etat, setEtat] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')

  const tva = Math.round(totalHT * (taux / 100) * 100) / 100
  const totalTTC = Math.round((totalHT + tva) * 100) / 100

  // Persiste le taux choisi sur la ligne devis. Appelee a la validation du champ
  // (perte de focus ou touche Entree) pour eviter un appel a chaque frappe.
  async function enregistrer(tauxFinal: number) {
    setEtat('saving')
    try {
      const res = await fetch('/api/devis/tva', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ devisId, tva_taux: tauxFinal }),
      })
      if (!res.ok) throw new Error('echec')
      setEtat('saved')
    } catch {
      setEtat('error')
    }
  }

  function validerSaisie() {
    const t = normaliserTaux(parseFloat(saisie.replace(',', '.')))
    setTaux(t)
    setSaisie(String(t))
    if (t !== normaliserTaux(tvaTauxInitial) || etat !== 'idle') void enregistrer(t)
  }

  return (
    <div className="w-full sm:w-80 rounded-xl border border-border bg-white overflow-hidden">
      <div className="flex justify-between px-4 py-3 text-sm border-b border-border">
        <span className="text-gray-500">Total HT</span>
        <span className="font-semibold tabular-nums">{formatEUR(totalHT)}</span>
      </div>

      {/* Ligne TVA : taux ajustable + montant recalcule */}
      <div className="px-4 py-3 text-sm border-b border-border">
        <div className="flex items-center justify-between">
          <label htmlFor="tva-taux" className="flex items-center gap-1.5 text-gray-500">
            TVA
            <span className="inline-flex items-center rounded-md border border-border bg-gray-50 pr-1.5 focus-within:border-primary focus-within:ring-1 focus-within:ring-primary">
              <input
                id="tva-taux"
                type="number"
                inputMode="decimal"
                min={0}
                max={100}
                step={0.5}
                value={saisie}
                onChange={(e) => setSaisie(e.target.value)}
                onBlur={validerSaisie}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                }}
                aria-label="Taux de TVA en pourcentage"
                className="w-12 bg-transparent px-2 py-1 text-right tabular-nums text-foreground outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
              />
              <span className="text-gray-400">%</span>
            </span>
          </label>
          <span className="tabular-nums text-gray-700">{formatEUR(tva)}</span>
        </div>
        <p className="mt-1 h-4 text-[11px] text-gray-400">
          {etat === 'saving' && 'Enregistrement du taux...'}
          {etat === 'saved' && 'Taux enregistré.'}
          {etat === 'error' && (
            <span className="text-red-500">Échec de l&apos;enregistrement, réessayez.</span>
          )}
          {etat === 'idle' && 'Taux modifiable avant envoi (10 % par défaut).'}
        </p>
      </div>

      <div className="flex justify-between px-4 py-3 text-base bg-primary/5">
        <span className="font-semibold text-foreground">Total TTC</span>
        <span className="font-bold text-primary tabular-nums">{formatEUR(totalTTC)}</span>
      </div>
    </div>
  )
}
