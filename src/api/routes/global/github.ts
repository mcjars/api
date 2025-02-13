import { globalAPIRouter } from "@/api"
import { string, time } from "@rjweb/utils"
import { Cookie } from "rjweb-server"

export = new globalAPIRouter.Path('/')
	.http('GET', '/', (http) => http
		.onRequest((ctr) => {
			return ctr.redirect(ctr["@"].github().getWebFlowAuthorizationUrl({
				redirectUrl: `${ctr["@"].env.APP_URL}/api/github/callback`,
				scopes: ['read:user', 'user:email']
			}).url, 'temporary')
		})
	)
	.http('GET', '/callback', (http) => http
		.onRequest(async(ctr) => {
			const code = ctr.queries.get('code')
			if (!code) return ctr.status(ctr.$status.BAD_REQUEST).print('Missing code')

			const user = await ctr["@"].github().getUserOctokit({ code }).catch(() => null)
			if (!user) return ctr.status(ctr.$status.UNAUTHORIZED).print('Unauthorized')

			const [ data, email ] = await Promise.all([
				user.request('GET /user').then((r) => r.data),
				user.request('GET /user/emails').then((r) => r.data.find((email) => email.primary) ?? r.data[0])
			])

			const id = await ctr["@"].database.write.insert(ctr["@"].database.schema.users)
				.values({
					githubId: data.id,
					name: data.name,
					email: email.email,
					login: data.login
				})
				.onConflictDoUpdate({
					target: ctr["@"].database.schema.users.githubId,
					set: {
						email: email.email,
						name: data.name,
						login: data.login,
						lastLogin: new Date()
					}
				})
				.returning({
					id: ctr["@"].database.schema.users.id
				})
				.then((r) => r[0].id)

			const session = await ctr["@"].database.write.insert(ctr["@"].database.schema.userSessions)
				.values({ userId: id, session: string.hash(`${id}-${Date.now()}`, { algorithm: 'sha256' }) })
				.returning({ session: ctr["@"].database.schema.userSessions.session })
				.then((r) => r[0].session)

			ctr.cookies.set('session', new Cookie(session, {
				httpOnly: true,
				sameSite: 'lax',
				secure: true,
				domain: ctr["@"].env.APP_COOKIE_DOMAIN,
				expires: Math.floor(time(7).d() / 1000)
			}))

			return ctr.redirect(ctr["@"].env.APP_FRONTEND_URL ?? ctr["@"].env.APP_URL, 'temporary')
		})
	)