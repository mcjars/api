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

const infos = z.object({
	REDIS_URL: z.string(),
	SENTRY_URL: z.string().optional(),
	DATABASE_URL: z.string(),
	DATABASE_URL_PRIMARY: z.string().optional(),

	PORT: z.string().transform((str) => parseInt(str)).optional(),
	S3_URL: z.string(),

	GITHUB_CLIENT_ID: z.string().optional(),
	GITHUB_CLIENT_SECRET: z.string().optional(),

	LOG_LEVEL: z.enum(['none', 'info', 'debug']),
	LOG_DIRECTORY: z.string().optional(),

	APP_URL: z.string(),
	APP_FRONTEND_URL: z.string().optional(),
	APP_COOKIE_DOMAIN: z.string().optional(),

	SERVER_NAME: z.string().optional()
})

export type Environment = z.infer<typeof infos>

export default infos.parse(env)