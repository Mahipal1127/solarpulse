import { redirect } from 'next/navigation'
import { getSessionUser } from '@/lib/auth/guards'
import { homeRouteFor } from '@/lib/auth/home-route'

export default async function Home() {
  const user = await getSessionUser()
  if (!user) redirect('/login')

  redirect(homeRouteFor(user))
}
