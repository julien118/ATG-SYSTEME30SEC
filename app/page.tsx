import { redirect } from 'next/navigation'

// Mode démo ATG : pas de page marketing, on file direct au dashboard.
export default function Home() {
  redirect('/chantiers')
}
