import { Server, version as Version, Cors, Cookie, html } from "rjweb-server"
import getVersion from "@/index"
import logger from "@/globals/logger"
import database from "@/globals/database"
import env from "@/globals/env"
import cache from "@/globals/cache"
import github from "@/globals/github"
import s3 from "@/globals/s3"
import { Runtime } from "@rjweb/runtime-node"
import * as requests from "@/globals/requests"
import { ServerType, types } from "@/schema"
import { and, eq, or, sql } from "drizzle-orm"
import { time } from "@rjweb/utils"
import { sentry } from "@rjweb/sentry"
import * as Sentry from "@sentry/node"

const startTime = performance.now()

export const server = new Server(Runtime, {
	port: env.PORT,
	proxy: {
		enabled: true,
		credentials: {
			authenticate: false
		}
	}, logging: {
		debug: env.LOG_LEVEL === 'debug'
	}, compression: {
		http: {
			enabled: false
		}
	}
}, [
	Cors.use({
		credentials: true,
		allowAll: false,
		origins: [env.APP_FRONTEND_URL ?? '*', '*'],
		methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
		headers: ['Authorization', 'Content-Type', 'Accept'],
		exposeHeaders: ['Authorization', 'Content-Type', 'Accept']
	}),
	sentry.use({
		dsn: env.SENTRY_URL,
		environment: process.env.NODE_ENV,
		release: getVersion(),
		tracesSampleRate: 1.0,
		profilesSampleRate: 1.0,
		serverName: env.SERVER_NAME,
		attachStacktrace: true,
		includeBody: true,
		integrations: [
			Sentry.postgresIntegration(),
			Sentry.redisIntegration(),
			Sentry.httpIntegration({ disableIncomingRequestSpans: true })
		]
	})
], {
	appVersion: getVersion(),
	database,
	logger,
	env,
	s3,
	cache,
	github,
	data: {} as Record<string, any>,
	join(...strings: (string | number | undefined | null | boolean)[]): string {
		return strings.filter((str) => str === '' || Boolean(str)).join('\n')
	}
})

const organizationValidator = new server.Validator<{ force: boolean }>()
	.context<{
		organization: {
			id: number
			name: string
			icon: string | null
			types: ServerType[]
			verified: boolean
			public: boolean
			created: Date
		}

		request: requests.Request | null
	}>()
	.httpRequest(async(ctr, end, options) => {
		const authorization = ctr.headers.get('authorization', '')
		if (authorization.length !== 64 && options.force) return end(ctr.status(ctr.$status.UNAUTHORIZED).print({ success: false, errors: ['Invalid Authorization'] }))

		if (authorization.length === 64) {
			const organization = await ctr["@"].database.select({
				id: ctr["@"].database.schema.organizations.id,
				name: ctr["@"].database.schema.organizations.name,
				icon: ctr["@"].database.schema.organizations.icon,
				types: ctr["@"].database.schema.organizations.types,
				verified: ctr["@"].database.schema.organizations.verified,
				public: ctr["@"].database.schema.organizations.public,
				created: ctr["@"].database.schema.organizations.created
			})
				.from(ctr["@"].database.schema.organizationKeys)
				.innerJoin(ctr["@"].database.schema.organizations, eq(ctr["@"].database.schema.organizationKeys.organizationId, ctr["@"].database.schema.organizations.id))
				.where(eq(ctr["@"].database.schema.organizationKeys.key, authorization))
				.limit(1)
				.then((r) => r[0])

			if (!organization && options.force) return end(ctr.status(ctr.$status.UNAUTHORIZED).print({ success: false, errors: ['Invalid Authorization'] }))

			ctr["@"].organization = organization

			if (organization && ctr["@"].request) {
				ctr["@"].request.organizationId = organization.id

				ctr.span()?.setAttribute('organization_id', organization.id)
			}
		}
	})
	.httpRequest(async(ctr, end) => {
		if (
			!ctr.url.query.includes('tracking=none') &&
			ctr.url.path.startsWith('/api') &&
			!ctr.url.path.includes('github') &&
			ctr.context.route?.type === 'http' &&
			ctr.url.method !== 'OPTIONS' &&
			ctr.url.method !== 'HEAD' &&
			ctr.url.method !== 'TRACE' &&
			ctr.url.method !== 'CONNECT'
		) {
			ctr["@"].request = await requests.log(
				ctr.url.method,
				ctr.url.href,
				await ctr.$body().json().catch(() => null),
				ctr.client.ip,
				ctr.client.origin,
				ctr.client.userAgent,
				ctr["@"].organization ?? null,
				ctr.headers
			)

			ctr.headers.set('X-Request-ID', ctr["@"].request.id)
			ctr.span()?.setAttribute('request_id', ctr["@"].request.id)

			if (ctr["@"].request.end) return end(ctr.status(ctr.$status.TOO_MANY_REQUESTS).print({ success: false, errors: ['You are making too many requests! Slow down.'] }))
		} else {
			ctr["@"].request = null
		}
	})
	.httpRequestFinish((ctr) => {
		if (ctr["@"].request) {
			requests.finish(ctr["@"].request, ctr.context.response.status, ctr.context.elapsed(), ctr["@"].data)
		}
	})

const userValidator = new server.Validator()
	.context<{
		user: {
			id: number
			githubId: number
			name: string | null
			email: string
			login: string
			admin: boolean

			sessionId: number
		}
	}>()
	.httpRequest(async(ctr, end) => {
		const session = ctr.cookies.get('session')
		if (!session) return end(ctr.status(ctr.$status.UNAUTHORIZED).print({ success: false, errors: ['Unauthorized'] }))

		const user = await ctr["@"].cache.use(`session::${session}`, () => ctr["@"].database.select({
				id: ctr["@"].database.schema.users.id,
				githubId: ctr["@"].database.schema.users.githubId,
				admin: ctr["@"].database.schema.users.admin,
				name: ctr["@"].database.schema.users.name,
				email: ctr["@"].database.schema.users.email,
				login: ctr["@"].database.schema.users.login,

				sessionId: ctr["@"].database.schema.userSessions.id
			})
				.from(ctr["@"].database.schema.userSessions)
				.innerJoin(ctr["@"].database.schema.users, eq(ctr["@"].database.schema.userSessions.userId, ctr["@"].database.schema.users.id))
				.where(eq(ctr["@"].database.schema.userSessions.session, session))
				.limit(1)
				.then((r) => r[0])
		)

		if (!user) return end(ctr.status(ctr.$status.UNAUTHORIZED).print({ success: false, errors: ['Unauthorized'] }))
		ctr["@"].user = user

		ctr.scope().setUser({
			id: user.id,
			email: user.email,
			username: user.login,
			ip_address: ctr.client.ip.usual(),
		})

		await ctr["@"].database.write.update(ctr["@"].database.schema.userSessions)
			.set({
				lastUsed: new Date()
			})
			.where(eq(ctr["@"].database.schema.userSessions.id, user.sessionId))

		ctr.cookies.set('session', new Cookie(session, {
			httpOnly: true,
			sameSite: 'lax',
			secure: true,
			domain: ctr["@"].env.APP_COOKIE_DOMAIN,
			expires: Math.floor(time(7).d() / 1000)
		}))

		ctr.headers.set('X-User-ID', user.id.toString())
	})

export const userOrganizationValidator = new server.Validator()
	.extend(userValidator)
	.context<{
		organization: {
			id: number
			name: string
			icon: string | null
			types: ServerType[]
			ownerId: number
			verified: boolean
			public: boolean
			created: Date
		}
	}>()
	.document({
		parameters: [
			{
				name: 'organization',
				in: 'path',
				required: true,
				schema: {
					type: 'integer'
				}
			}
		]
	})
	.httpRequest(async(ctr, end) => {
		const organizationId = parseInt(ctr.params.get('organization', '0'))
		if (!organizationId || isNaN(organizationId)) return end(ctr.status(ctr.$status.BAD_REQUEST).print({ success: false, errors: ['Invalid Organization ID'] }))

		const organization = await ctr["@"].cache.use(`organization::${organizationId}`, () => ctr["@"].database.select({
				id: ctr["@"].database.schema.organizations.id,
				name: ctr["@"].database.schema.organizations.name,
				icon: ctr["@"].database.schema.organizations.icon,
				types: ctr["@"].database.schema.organizations.types,
				verified: ctr["@"].database.schema.organizations.verified,
				public: ctr["@"].database.schema.organizations.public,
				ownerId: ctr["@"].database.schema.organizations.ownerId,
				created: ctr["@"].database.schema.organizations.created
			})
				.from(ctr["@"].database.schema.organizations)
				.innerJoin(ctr["@"].database.schema.users, eq(ctr["@"].database.schema.organizations.ownerId, ctr["@"].database.schema.users.id))
				.leftJoin(ctr["@"].database.schema.organizationSubusers, and(
					eq(ctr["@"].database.schema.organizations.id, ctr["@"].database.schema.organizationSubusers.organizationId),
					eq(ctr["@"].database.schema.organizationSubusers.pending, false)
				))
				.where(and(
					or(
						eq(ctr["@"].database.schema.organizations.ownerId, ctr["@"].user.id),
						eq(ctr["@"].database.schema.organizationSubusers.userId, ctr["@"].user.id),
						ctr["@"].user.admin ? sql`true` : sql`false`
					),
					eq(ctr["@"].database.schema.organizations.id, organizationId)
				))
				.limit(1)
				.then((r) => r[0]),
			time(1).m()
		)

		if (!organization) return end(ctr.status(ctr.$status.UNAUTHORIZED).print({ success: false, errors: ['Unauthorized'] }))
		ctr["@"].organization = organization
	})

export const globalAPIRouter = new server.FileLoader('/api')
	.load('api/routes/global', {
		fileBasedRouting: true
	})
	.validate(organizationValidator.use({ force: false }))
	.export()

export const organizationAPIRouter = new server.FileLoader('/api/organization')
	.load('api/routes/organization', {
		fileBasedRouting: true
	})
	.validate(organizationValidator.use({ force: true }))
	.export()

export const userAPIRouter = new server.FileLoader('/api/user')
	.load('api/routes/user', {
		fileBasedRouting: true
	})
	.validate(userValidator.use({}))
	.export()

function getPriority(path: string) {
	if (!path.startsWith('/api')) return 0
	if (path.includes('/api/v2')) return 1
	if (path.includes('/api/v1')) return 2
	if (path.includes('/api/organization')) return 3

	return 4
}

server.path('/', (path) => path
	.http('GET', '/openapi.json', (http) => http
		.onRequest((ctr) => {
			const openAPI = ctr["@"].cache.local.use('openapi', () => {
				const openAPI = server.openAPI('MCJars Versions API', ctr["@"].appVersion, {
					url: env.APP_URL
				}, {
					email: 'me@rjns.dev',
					name: 'GitHub',
					url: 'https://github.com/mcjars'
				})

				openAPI.components = {
					...openAPI.components,
					securitySchemes: {
						api_key: {
							type: 'apiKey',
							in: 'header',
							name: 'Authorization',
							scheme: 'token'
						}
					}
				}

				const endpoints = Object.assign({}, openAPI.paths!)

				for (const path in endpoints) {
					if (!path.startsWith('/api')) continue

					const type = path.includes('/api/v1')
						? '/api/v1'
						: path.includes('/api/v2')
							? '/api/v2'
							: path.includes('/api/organization')
								? '/api/organization'
								: '/api/user'

					for (const method in endpoints[path]) {
						endpoints[path][method as 'delete']!.tags = [type]
					}
				}

				const sortedPaths = Object.keys(endpoints).sort((a, b) => {			
					const priorityA = getPriority(a)
					const priorityB = getPriority(b)

					if (priorityA !== priorityB) {
						return priorityA - priorityB
					}
					
					return a.localeCompare(b)
				})
				
				const sortedEndpoints: typeof endpoints = {}
				for (const path of sortedPaths) {
					sortedEndpoints[path] = endpoints[path]
				}

				openAPI.paths = sortedEndpoints

				return openAPI
			})

			return ctr.print(openAPI)
		})
	)
	.http('GET', '/icons/{type}', (path) => path
		.document({
			parameters: [
				{
					name: 'type',
					in: 'path',
					required: true,
					schema: {
						type: 'string',
						enum: Array.from(types)
					}
				}
			], responses: {
				default: {
					description: 'Permanent Redirect',
					headers: {
						Location: {
							schema: {
								type: 'string'
							}
						}
					}, content: {
						'image/png': {
							schema: {
								type: 'string',
								format: 'binary'
							}
						}
					}
				}
			}
		})
		.onRequest((ctr) => {
			let file = ctr.params.get('type', '').toLowerCase()
			if (!file.endsWith('.png')) file += '.png'

			return ctr.redirect(`${env.S3_URL}/icons/${file}`, 'permanent')
		})
	)
	.http('GET', '/', (http) => http
		.onRequest((ctr) => {
			ctr.headers.set('Content-Type', 'text/html')

			return ctr.print(html`
<!DOCTYPE html>
<html>
	<head>
		<meta charset="UTF-8" />
		<script defer data-domain="versions.mcjars.app" src="https://cat.rjns.dev/js/script.js"></script>
		<link rel="icon" type="image/png" href="${env.S3_URL}/icons/vanilla.png" />
		<meta name="viewport" content="width=device-width, initial-scale=1.0" />
		<meta name="darkreader-lock" />
		<title>MCJars API Docs</title>
		<meta property="og:type" content="website">
		<meta property="og:title" content="MCJars">
		<meta property="og:url" content="https://versions.mcjars.app">
		<meta property="og:image" content="${env.S3_URL}/icons/vanilla.png">
		<meta property="og:description" content="MCJars is a Minecraft Server Jar Website which allows you to download versions or reverse lookup for your favourite projects easily.">
		<meta name="description" content="MCJars is a Minecraft Server Jar Website which allows you to download versions or reverse lookup for your favourite projects easily.">
	</head>
	<body>
		<script id="api-reference" data-url="/openapi.json" data-configuration="${JSON.stringify({ defaultOpenAllTags: true, hideClientButton: true })}"></script>
		<script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"></script>
		<script>
			const query = new URLSearchParams(window.location.search)

			if (query.has('warn')) {
				alert('IMPORTANT NOTICE:\\n\\nIf you want to use the api for automated tasks such as collecting data, please either contact me@rjns.dev or add ?tracking=none at the end of your urls. This is to prevent unnecessary tracking of automated tasks.')

				query.delete('warn')
				window.history.replaceState({}, document.title, \`\${window.location.pathname}\${query.toString() ? '?' : ''}\${query.toString()}\${window.location.hash}\`)
			}
		</script>
	</body>
</html>
			`.trim())
		})
	)
)

server.http(async(ctr) => {
	ctr.headers.set('X-Server-Version', ctr["@"].appVersion)
	ctr.headers.set('X-Server-Name', env.SERVER_NAME)

	ctr["@"].data = {}
	logger()
		.text(`${ctr.type.toUpperCase()} ${ctr.url.method}`, (c) => c.green)
		.text(':')
		.text(ctr.url.href, (c) => c.green)
		.text(ctr.client.ip.usual(), (c) => c.cyan)
		.text(ctr.context.ip.isProxied ? '(proxied)' : '(raw)', (c) => c.gray)
		.info()
})

if (env.LOG_LEVEL === 'debug') server.finish('httpRequest', (ctr) => {
	logger()
		.text(`${ctr.context.response.status} ${ctr.url.method}`, (c) => c.green)
		.text(':')
		.text(ctr.url.href, (c) => c.green)
		.text(ctr.client.ip.usual(), (c) => c.cyan)
		.text(`(${ctr.context.elapsed().toFixed(2)}ms)`, (c) => c.gray)
		.debug()
})

server.rateLimit('httpRequest', (ctr) => {
	return ctr.status(ctr.$status.TOO_MANY_REQUESTS).print({ success: false, errors: ['You are making too many requests! Slow down.'] })
})

server.error('httpRequest', (ctr, error) => {
	if (process.env.NODE_ENV === 'development') ctr.status(ctr.$status.INTERNAL_SERVER_ERROR).print({ success: false, errors: [error.toString()] })
	else ctr.status(ctr.$status.INTERNAL_SERVER_ERROR).print({ success: false, errors: ['An Unknown Server Error has occured'] })

	logger()
		.text('HTTP Request Error')
		.text('\n')
		.text(error.toString(), (c) => c.red)
		.error()
})

server.notFound(async(ctr) => {
	return ctr.status(ctr.$status.NOT_FOUND).print({ success: false, errors: ['Route not found'] })
})

server.start()
	.then((port) => {
		logger()
			.text('HTTP Server', (c) => c.redBright)
			.text(`(${Version}) started on port`)
			.text(port, (c) => c.cyan)
			.text(`(${(performance.now() - startTime).toFixed(1)}ms)`, (c) => c.gray)
			.info()
	})
	.catch((err: Error) => {
		logger()
			.text('HTTP Server', (c) => c.redBright)
			.text('failed starting')
			.text('\n')
			.text(err.stack!, (c) => c.red)
			.error()
	})

require('@/globals/openapi')
require('@/api/routes/download')