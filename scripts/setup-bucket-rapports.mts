// Cree le bucket public 'rapports' sur le compte test (service_role, idempotent).
// Lancer : npx tsx --env-file=.env.local scripts/setup-bucket-rapports.mts
import { createClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!
const sb = createClient(url, key, { auth: { persistSession: false } })

const { data: buckets } = await sb.storage.listBuckets()
if (buckets?.some((b) => b.name === 'rapports')) {
  console.log("Bucket 'rapports' deja present, rien a faire.")
} else {
  const { error } = await sb.storage.createBucket('rapports', {
    public: true,
    fileSizeLimit: '10MB',
    allowedMimeTypes: ['application/pdf'],
  })
  if (error) {
    console.error('Echec creation bucket :', error.message)
    process.exit(1)
  }
  console.log("Bucket public 'rapports' cree (pdf uniquement, 10MB).")
}
const { data: after } = await sb.storage.listBuckets()
console.log('Buckets :', after?.map((b) => `${b.name}(public=${b.public})`).join(', '))
