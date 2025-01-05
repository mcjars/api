import { globalAPIRouter } from "@/api"
import database, { configs } from "@/globals/database"
import { object, time, string } from "@rjweb/utils"
import { and, desc, eq, like, sql } from "drizzle-orm"
import { z } from "zod"

const buildsWithConfigBestMatch = database.select({
	build: database.fields.build,
	value: database.schema.configValues.value,
	similarity: sql`SIMILARITY(${database.schema.configValues.value}, ${sql.placeholder('config')})`.as('similarity')
})
	.from(database.schema.configValues)
	.innerJoin(database.schema.configs, eq(database.schema.configs.id, database.schema.configValues.configId))
	.innerJoin(database.schema.buildConfigs, eq(database.schema.buildConfigs.configValueId, database.schema.configValues.id))
	.innerJoin(database.schema.builds, and(
		eq(database.schema.builds.id, database.schema.buildConfigs.buildId),
		eq(database.schema.builds.type, sql.placeholder('type'))
	))
	.where(and(
		eq(database.schema.configs.type, sql.placeholder('type')),
		eq(database.schema.configs.format, sql.placeholder('format'))
	))
	.orderBy(desc(sql`similarity`))
	.limit(3)
	.prepare('builds_with_config_best_match')

const buildsWithConfigContains = database.select({
	build: database.fields.build,
	value: database.schema.configValues.value
})
	.from(database.schema.buildConfigs)
	.innerJoin(database.schema.configValues, eq(database.schema.configValues.id, database.schema.buildConfigs.configValueId))
	.innerJoin(database.schema.configs, eq(database.schema.configs.id, database.schema.configValues.configId))
	.where(and(
		eq(database.schema.configs.type, sql.placeholder('type')),
		eq(database.schema.configs.format, sql.placeholder('format')),
		like(database.schema.configValues.value, sql.placeholder('contains'))
	))
	.innerJoin(database.schema.builds, and(
		eq(database.schema.builds.id, database.schema.buildConfigs.buildId),
		eq(database.schema.builds.type, sql.placeholder('type'))
	))
	.groupBy(database.schema.configValues.id, database.schema.builds.id)
	.limit(3)
	.prepare('builds_with_config_contains')

export = new globalAPIRouter.Path('/')
	.http('POST', '/', (http) => http
		.document({
			responses: {
				200: {
					description: 'Success',
					content: {
						'application/json': {
							schema: {
								type: 'object',
								properties: {
									success: {
										type: 'boolean',
										const: true
									}, formatted: {
										type: 'string'
									}, configs: {
										type: 'array',
										maxItems: 3,
										items: {
											type: 'object',
											properties: {
												from: {
													$ref: '#/components/schemas/types'
												}, value: {
													type: 'string'
												}, build: {
													oneOf: [
														{ $ref: '#/components/schemas/build' },
														{ type: 'null' }
													]
												}
											}, required: ['from', 'value', 'build']
										}
									}
								}, required: ['success', 'formatted', 'configs']
							}
						}
					}
				}, 400: {
					description: 'Bad Request',
					content: {
						'application/json': {
							schema: {
								$ref: '#/components/schemas/error'
							}
						}
					}
				}
			}, requestBody: {
				content: {
					'application/json': {
						schema: {
							type: 'object',
							properties: {
								file: {
									type: 'string',
									enum: Object.keys(configs)
								}, config: {
									type: 'string'
								}
							}, required: ['file', 'config']
						}
					}
				}
			}
		})
		.onRequest(async(ctr) => {
			const data = z.object({
				file: z.string().refine((file) => file in configs, `file must be one of: ${Object.keys(configs).join(', ')}`),
				config: z.string().transform((str) => str.replaceAll('\\n', '\n'))
			}).safeParse(await ctr.$body().json().catch(() => null))

			const fields = Array.from(new Set((ctr.queries.get('fields', ''))
				.split(',')
				.filter((field) => field.length > 0)
			)) as 'id'[]

			if (!data.success) return ctr.status(ctr.$status.BAD_REQUEST).print({ success: false, errors: data.error.errors.map((err) => `${err.path.join('.')}: ${err.message}`) })

			const formatted = database.formatConfig(data.data.file, data.data.config),
				format = configs[data.data.file].format

			const valueMatches = await ctr["@"].cache.use(`config::${string.hash(formatted, { algorithm: 'sha256' })}`, async() => {
				const file = Object.keys(configs).find((file) => file.endsWith(data.data.file))
				if (!file) return []

				let contains: string | null = null

				if (data.data.file !== 'pufferfish.yml') switch (format) {
					case "YAML": {
						if (!contains) {
							const configVersion = formatted.match(/config-version:\s*(.+)/)?.[1]
							if (configVersion) contains = `config-version: ${configVersion}`
						}

						if (!contains) {
							const configVersion = formatted.match(/version:\s*(.+)/)?.[1]
							if (configVersion) contains = `version: ${configVersion}`
						}

						break
					}

					case "TOML": {
						if (!contains) {
							const configVersion = formatted.match(/config-version\s*=\s*(.+)/)?.[1]
							if (configVersion) contains = `config-version = ${configVersion}`
						}

						break
					}
				}

				if (!contains) {
					return buildsWithConfigBestMatch.execute({
						type: configs[file].type,
						config: formatted,
						format
					})
				}

				return buildsWithConfigContains.execute({
					type: configs[file].type,
					contains: `%${contains}%`,
					format
				})
			}, time(1).h())

			return ctr.print({
				success: true,
				formatted,
				configs: valueMatches.map((match) => ({
					from: match.build.type,
					value: match.value,
					build: fields.length > 0
						? object.pick(database.prepare.build(match.build), fields)
						: database.prepare.build(match.build)
				}))
			})
		})
	)