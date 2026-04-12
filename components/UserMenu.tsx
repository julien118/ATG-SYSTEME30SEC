'use client'

import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

interface UserMenuProps {
  prenom: string
  nom: string
}

export default function UserMenu({ prenom, nom }: UserMenuProps) {
  const [open, setOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const router = useRouter()

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const handleLogout = async () => {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/')
    router.refresh()
  }

  const initials = `${prenom.charAt(0)}${nom.charAt(0)}`.toUpperCase()

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setOpen(!open)}
        className="w-9 h-9 rounded-full bg-header text-white flex items-center justify-center text-sm font-semibold transition-transform active:scale-95"
      >
        {initials}
      </button>

      {open && (
        <div className="absolute right-0 top-12 w-56 bg-white rounded-xl shadow-lg border border-border py-2 z-50 animate-scale-in origin-top-right">
          <div className="px-4 py-2 border-b border-border">
            <p className="font-medium text-foreground text-sm">{prenom} {nom}</p>
          </div>
          <button
            onClick={handleLogout}
            className="w-full text-left px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 transition-colors"
          >
            Se déconnecter
          </button>
        </div>
      )}
    </div>
  )
}
