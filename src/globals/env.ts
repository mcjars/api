import { filesystem } from "@rjweb/utils"
import { z } from "zod"

let env: Record<string, string | undefined>
try {
	env = filesystem.env('../.env', { async: false })
} catch {
	try {
		env = filesystem.env('../../.env', { async: false })
	} catch {
		env = process.env
	}
}

const base = z.object({
	SENTRY_URL: z.string().optional(),
	DATABASE_URL: z.string(),
	DATABASE_URL_PRIMARY: z.string().optional(),

	PORT: z.string().transform((str) => parseInt(str)).optional(),
	RATELIMIT_PER_MINUTE: z.string().transform((str) => parseInt(str)).optional().default('120'),

	GITHUB_CLIENT_ID: z.string().optional(),
	GITHUB_CLIENT_SECRET: z.string().optional(),

	S3_URL: z.string().optional(),
	S3_SSL: z.union([ z.literal('true'), z.literal('false') ]).transform((str) => str === 'true').default('true'),
	S3_BUCKET: z.string().optional(),
	S3_REGION: z.string().optional(),
	S3_HOST: z.string().optional(),
	S3_PUBLIC_HOST: z.string().optional(),
	S3_PORT: z.string().transform((str) => parseInt(str)).default('443'),
	S3_ACCESS_KEY: z.string().optional(),
	S3_SECRET_KEY: z.string().optional(),

	LOG_LEVEL: z.enum(['none', 'info', 'debug']),
	LOG_DIRECTORY: z.string().optional(),

	APP_URL: z.string(),
	APP_FRONTEND_URL: z.string().optional(),
	APP_COOKIE_DOMAIN: z.string().optional(),

	SERVER_NAME: z.string().optional()
})

const infos = z.union([
	z.object({
		REDIS_MODE: z.literal('redis').default('redis'),
		REDIS_URL: z.string()
	}).merge(base),
	z.object({
		REDIS_MODE: z.literal('sentinel'),
		REDIS_SENTINEL_NODES: z.string().transform((str) => str.split(',').map((node) => node.trim().split(':').map((part, i) => i === 1 ? parseInt(part) : part)) as [string, number][]),
	}).merge(base)
])

export type Environment = z.infer<typeof infos>

export default infos.parse(env)