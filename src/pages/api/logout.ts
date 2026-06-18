import { deleteSession, deleteSessionTokenCookie, getSessionFromCookie } from "@auth/session";
import type { APIRoute } from "astro";


export const POST = (async ({ cookies, redirect }) => {
  
  const session = await getSessionFromCookie(cookies);
    
  if (!session) {
    return redirect("/login")
  }

  await deleteSession(session.id)
  await deleteSessionTokenCookie(cookies)
  
  return redirect("/")
  
}) satisfies APIRoute;