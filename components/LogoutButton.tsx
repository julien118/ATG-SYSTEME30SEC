'use client'

import { useState } from 'react'

// Déconnexion discrète : efface le cookie de session puis renvoie vers /login.
export default function LogoutButton() {
  const [enCours, setEnCours] = useState(false)

  async function deconnexion() {
    if (enCours) return
    setEnCours(true)
    try {
      await fetch('/api/auth/signout', { method: 'POST' })
    } catch {
      // on redirige quand même : le middleware bloquera sans cookie valide
    } finally {
      window.location.assign('/login')
    }
  }

  return (
    <button
      type="button"
      onClick={deconnexion}
      disabled={enCours}
      className="text-xs text-gray-400 hover:text-white transition-colors disabled:opacity-50"
      title="Se déconnecter"
    >
      Déconnexion
    </button>
  )
}
