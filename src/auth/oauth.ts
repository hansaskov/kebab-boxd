import { Google } from "arctic";
import * as env from "astro:env/server"

export const google = new Google(
	env.GOOGLE_CLIENT_ID,
	env.GOOGLE_CLIENT_SECRET,
	"http://localhost:4321/api/auth/google/callback"
);
