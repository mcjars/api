import database from "@/globals/database"
import logger from "@/globals/logger"
import { network, string, time } from "@rjweb/utils"
import { Content, JSONParsed, ValueCollection } from "rjweb-server"
import * as schema from "@/schema"
import cache from "@/globals/cache"
import env from "@/globals/env"
import { lookup } from "@/globals/ip"

export type Request = {
	id: string
	organizationId: number | null
	end: boolean

	origin: string
	method: schema.Method
	path: string
	time: number
	status: number
	body: Record<string, any> | null
	ip: string
	continent: string | null
	country: string | null
	data: Record<string, any> | null
	userAgent: string
	created: Date
}

const pending: Request[] = [],
	processing: Request[] = []

/**
 * Log a new request
 * @since 1.18.0
*/ export async function log(method: schema.Method, path: string, body: JSONParsed | null, ip: network.IPAddress, origin: string, userAgent: string, organization: { id: number, verified: boolean } | null, headers: ValueCollection<string, string, Content>): Promise<Request> {
	const request: Request = {
		id: string.generate({ length: 12 }),
		organizationId: organization?.id ?? null,
		end: false,

		origin,
		method,
		path,
		time: 0,
		status: 0,
		body: typeof body === 'object' ? body : null,
		ip: ip.usual(),
		continent: null,
		country: null,
		data: {},
		userAgent,
		created: new Date()
	}

	pending.push(request)

	if (!organization || !organization.verified) {
		let ratelimitKey = 'ratelimit::'
		if (ip['type'] === 4) ratelimitKey += ip.long()
		else ratelimitKey += ip.rawData.slice(0, 4).join(':')

		const ratelimit = organization ? env.RATELIMIT_PER_MINUTE * 2 : env.RATELIMIT_PER_MINUTE

		const count = await cache.incr(ratelimitKey)
		if (count === 1) await cache.expire(ratelimitKey, Math.floor(time(1).m() / 1000))

		const expires = await cache.ttl(ratelimitKey)

		headers.set('X-RateLimit-Limit', ratelimit)
		headers.set('X-RateLimit-Remaining', ratelimit - count)
		headers.set('X-RateLimit-Reset', expires)

		if (count > ratelimit) request.end = true
	}

	return request
}

/**
 * Finish a request
 * @since 1.18.0
*/ export function finish(request: Request, status: number, ms: number, data: Record<string, any>): void {
	request.status = status
	request.time = Math.round(ms)
	request.data = data

	pending.splice(pending.indexOf(request), 1)
	processing.push(request)
}

async function process() {
	const requests = processing.splice(0, 30)
	if (!requests.length) return

	try {
		const ips = await lookup(requests.map((r) => r.ip)).catch(() => null)

		for (const request of requests) {
			const ip = ips?.find((ip) => ip.query === request.ip)
			if (ip) {
				request.continent = ip.continent
				request.country = ip.country
			}
		}

		await database.write.insert(schema.requests)
			.values(requests)
			.onConflictDoNothing()
	} catch (err) {
		processing.push(...requests)
		throw err
	}

	logger()
		.text('Processed')
		.text(requests.length, (c) => c.cyan)
		.text('requests')
		.info()
}

setInterval(() => {
	process()
		.catch((err: unknown) => {
			logger()
				.text('Failed to process requests', (c) => c.red)
				.text('\n')
				.text(String(err && typeof err === 'object' && 'stack' in err ? err.stack : err), (c) => c.red)
				.error()
		})
}, time(5).s())