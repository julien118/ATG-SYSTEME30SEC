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
    },
  )
}
