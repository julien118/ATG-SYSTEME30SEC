'use client'

import { createContext, useContext, useState, useCallback } from 'react'

type ToastType = 'success' | 'error' | 'info'

interface Toast {
  id: string
  message: string
  type: ToastType
}

interface ToastContextValue {
  show: (message: string, type?: ToastType) => void
}

const ToastContext = createContext<ToastContextValue>({ show: () => {} })

export function useToast() {
  return useContext(ToastContext)
}

export default function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])

  const show = useCallback((message: string, type: ToastType = 'success') => {
    const id = Math.random().toString(36).slice(2)
    setToasts((prev) => [...prev, { id, message, type }])
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id))
    }, type === 'error' ? 4000 : 3000)
  }, [])

  const dismiss = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }

  const colors: Record<ToastType, string> = {
    success: 'bg-primary text-white',
    error: 'bg-red-600 text-white',
    info: 'bg-header text-white',
  }

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      <div className="fixed top-0 inset-x-0 z-[60] pt-safe px-4 pointer-events-none">
        <div className="max-w-lg mx-auto space-y-2 mt-2">
          {toasts.map((toast) => (
            <div
              key={toast.id}
              className={`${colors[toast.type]} rounded-xl px-4 py-3 text-sm font-medium shadow-lg flex items-center justify-between animate-slide-down pointer-events-auto`}
            >
              <span>{toast.message}</span>
              <button onClick={() => dismiss(toast.id)} className="ml-3 opacity-70 hover:opacity-100">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      </div>
    </ToastContext.Provider>
  )
}
