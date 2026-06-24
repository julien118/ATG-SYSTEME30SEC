// =============================================================
// Client Supabase avec service_role (bypass RLS)
// =============================================================
// À n'utiliser QUE côté serveur (Route Handlers, Server Components),
// jamais exposé au navigateur.
// Utile en mode démo ATG : les tables ont la RLS désactivée pour la plupart,
// mais bibliotheque_costructor reste avec RLS active, donc on lit en admin.

import { createClient } from '@supabase/supabase-js'

export function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: { persistSession: false, autoRefreshToken: false },
      // IMPORTANT : Next.js met en cache les `fetch` (Data Cache), y compris ceux
      // de supabase-js. Pour les requêtes à URL stable (ex. `ticket_id=eq.X`), ça
      // provoque des LECTURES PÉRIMÉES : le 1er appel (fil avec 1 message) est mis
      // en cache et tous les suivants le rejouent, donc les nouvelles réponses
      // n'apparaissent jamais. `force-dynamic` ne suffit pas ici. On force donc
      // `no-store` sur TOUTES les requêtes service_role : ces lectures/écritures
      // doivent toujours être fraîches.
      global: {
        fetch: (input: RequestInfo | URL, init?: RequestInit) =>
          fetch(input, { ...init, cache: 'no-store' }),
      },
    },
  )
}
