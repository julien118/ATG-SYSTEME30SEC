// =============================================================
// Constantes démo ATG (mode single-user always logged in)
// =============================================================
// Ce fichier remplace toute la logique auth.uid() de Supabase.
// Tout le code serveur utilise ATG_USER_ID comme user_id en dur.
// Le row correspondant est inséré dans la table `profiles`
// par la migration 002_atg_bypass_auth.sql.

import type { Profile } from './types'

// UUID en dur du user démo ATG.
// Doit correspondre à la ligne insérée dans la table profiles.
export const ATG_USER_ID = '00000000-0000-0000-0000-0000000000a7'

// Profil par défaut, utilisé en fallback si la table profiles est vide
// ou si on veut éviter une requête supplémentaire côté serveur.
export const ATG_PROFIL: Profile = {
  id: ATG_USER_ID,
  prenom: 'Olivier',
  nom: 'GRAVIOU',
  telephone: null,
  metier: 'Ravalement de façade',
  entreprise: 'ATG',
  rapports_generes: 0,
  created_at: new Date().toISOString(),
}
