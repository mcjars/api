import { globalAPIRouter } from "@/api"
import { object, time } from "@rjweb/utils"
import { z } from "zod"
import { ServerType, types } from "@/schema"
import { eq, sql } from "drizzle-orm"
import cache from "@/globals/cache"
import database, { ReturnRow } from "@/globals/database"

const buildSearch = z.object({
	id: z.number().int().optional(),
	type: z.string().toUpperCase()
		.refine((str) => types.includes(str as 'VANILLA'))
		.transform((str) => str as ServerType)
		.optional(),
	versionId: z.string().max(31).nullable().optional(),
	projectVersionId: z.string().max(31).nullable().optional(),
	buildNumber: z.number().int().optional(),
	experimental: z.boolean().optional(),
	hash: z.object({
		primary: z.boolean().optional(),
		sha1: z.string().length(40).optional(),
		sha224: z.string().length(56).optional(),
		sha256: z.string().length(64).optional(),
		sha384: z.string().length(96).optional(),
		sha512: z.string().length(128).optional(),
		md5: z.string().length(32).optional()
	}).optional(),
	jarUrl: z.string().nullable().optional(),
	jarSize: z.number().int().nullable().optional(),
	zipUrl: z.string().nullable().optional(),
	zipSize: z.number().int().nullable().optional(),
})

function toSnakeCase(str: string) {
	return str.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)
}

function escapeString(str: string) {
	return str.replace(/'/g, "''")
}

async function lookupBuild(data: z.infer<typeof buildSearch>) {
	const { rows: [ build, latest ] } = await cache.use(`build::${JSON.stringify(data)}`, async() => {
		return database.execute<ReturnRow>(sql`
			WITH spec_build AS (
				SELECT builds.*
				FROM ${data.hash && Object.keys(data.hash).length > 0
					? sql.raw('build_hashes INNER JOIN builds ON builds.id = build_hashes.build_id')
					: sql.identifier('builds')
				} WHERE ${sql.raw(
					Object.keys(data).filter((k) => k !== 'hash').map((key) => `builds.${toSnakeCase(key)} ${typeof data[key as keyof typeof data] === 'number'
						? `= ${data[key as keyof typeof data]}`
						: typeof data[key as keyof typeof data] === 'string'
							? `= '${escapeString(data[key as keyof typeof data] as any)}'`
							: typeof data[key as keyof typeof data] === 'boolean'
								? `= ${data[key as keyof typeof data]}`
								: 'IS NULL'}`)
					.concat(data.hash && Object.keys(data.hash).length > 0
						? Object.keys(data.hash).map((key) => `"${key}" = ${typeof data.hash![key as keyof typeof data.hash] === 'string'
							? `'${escapeString(data.hash![key as keyof typeof data.hash] as any)}'`
							: data.hash![key as keyof typeof data.hash]}`)
						: []
					).join(' AND ')
				)} LIMIT 1
			)

			, filtered_builds AS (
				SELECT b.*
				FROM builds b
				INNER JOIN spec_build sb
					ON sb.id = b.id 
					OR (COALESCE(sb.version_id, sb.project_version_id) = COALESCE(b.version_id, b.project_version_id) AND sb.type = b.type)
				WHERE b.type != 'ARCLIGHT' OR (
					(sb.project_version_id LIKE '%-fabric' AND b.project_version_id LIKE '%-fabric')
					OR (sb.project_version_id LIKE '%-forge' AND b.project_version_id LIKE '%-forge')
					OR (sb.project_version_id LIKE '%-neoforge' AND b.project_version_id LIKE '%-neoforge')
					OR (sb.project_version_id NOT LIKE '%-fabric' AND sb.project_version_id NOT LIKE '%-forge' AND sb.project_version_id NOT LIKE '%-neoforge')
				)
			)

			SELECT *, 0 AS build_count, now()::timestamp as version2_created, '' AS _version_id, 'RELEASE' AS version_type, false AS version_supported, 0 AS version_java, now() AS version_created
			FROM spec_build

			UNION ALL

			SELECT x.*, mv.*
			FROM (
				SELECT *
				FROM (
					SELECT b.*, count(1) OVER () AS build_count, min(b.created) OVER () AS version2_created
					FROM filtered_builds b
					ORDER BY b.id DESC
				) LIMIT 1
			) x
			LEFT JOIN minecraft_versions mv ON mv.id = x.version_id;
		`)
	}, time(30).m())

	if (!build) return [ null, null, [] ] as const

	const configs = await cache.use(`configs::build::${build.id}`, () => database.select({
			location: database.schema.configs.location,
			type: database.schema.configs.type,
			format: database.schema.configs.format,
			value: database.schema.configValues.value
		})
			.from(database.schema.buildConfigs)
			.innerJoin(database.schema.configs, eq(database.schema.buildConfigs.configId, database.schema.configs.id))
			.innerJoin(database.schema.configValues, eq(database.schema.buildConfigs.configValueId, database.schema.configValues.id))
			.where(eq(database.schema.buildConfigs.buildId, build.id))
	)

	return [ build, latest, configs ] as const
}

export = new globalAPIRouter.Path('/')
	.http('POST', '/', (http) => http
		.document({
			requestBody: {
				content: {
					'application/json': {
						schema: {
							$ref: '#/components/schemas/buildSearch'
						}
					}
				}
			}, responses: {
				200: {
					description: 'Success',
					content: {
						'application/json': {
							schema: {
								oneOf: [
									{
										type: 'object',
										properties: {
											success: {
												type: 'boolean',
												const: true
											}, build: {
												$ref: '#/components/schemas/build'
											}, latest: {
												$ref: '#/components/schemas/build'
											}, version: {
												$ref: '#/components/schemas/minifiedVersion'
											}, configs: {
												type: 'object',
												additionalProperties: {
													type: 'object',
													properties: {
														type: {
															$ref: '#/components/schemas/types'
														}, format: {
															type: 'string',
															enum: database.schema.formats
														}, value: {
															type: 'string'
														}
													}, required: [
														'type',
														'format',
														'value'
													]
												}
											}
										}, required: [
											'success',
											'build',
											'latest',
											'version',
											'configs'
										]
									},
									{
										type: 'object',
										properties: {
											success: {
												type: 'boolean',
												const: true
											}, builds: {
												type: 'array',
												items: {
													type: 'object',
													properties: {
														build: {
															$ref: '#/components/schemas/build'
														}, latest: {
															$ref: '#/components/schemas/build'
														}, version: {
															$ref: '#/components/schemas/minifiedVersion'
														}, configs: {
															type: 'object',
															additionalProperties: {
																type: 'object',
																properties: {
																	type: {
																		$ref: '#/components/schemas/types'
																	}, format: {
																		type: 'string',
																		enum: database.schema.formats
																	}, value: {
																		type: 'string'
																	}
																}, required: [
																	'type',
																	'format',
																	'value'
																]
															}
														}
													}, required: [
														'build',
														'latest',
														'version',
														'configs'
													]
												}
											}
										}, required: [
											'success',
											'builds'
										]
									}
								]
							}
						}
					}
				}
			}
		})
		.onRequest(async(ctr) => {
			const data = z.union([
				buildSearch,
				buildSearch.array().min(1).max(10)
			]).safeParse(await ctr.$body().json().catch(() => null))

			const fields = Array.from(new Set((ctr.queries.get('fields', ''))
				.split(',')
				.filter((field) => field.length > 0)
			)) as 'id'[]

			if (!data.success) return ctr.status(ctr.$status.BAD_REQUEST).print({ success: false, errors: data.error.errors.map((err) => `${err.path.join('.')}: ${err.message}`) })

			if (Array.isArray(data.data)) {
				const builds = await Promise.all(data.data.map(lookupBuild))

				return ctr.print({
					success: true,
					builds: builds.map((build) => !build[0] || !build[1] ? null : ({
						build: fields.length > 0 ? object.pick(database.prepare.rawBuild(build[0]), fields) : database.prepare.rawBuild(build[0]),
						latest: fields.length > 0 && build[1] ? object.pick(database.prepare.rawBuild(build[1]), fields) : database.prepare.rawBuild(build[1]),
						version: {
							id: build[1].version_id || build[1].project_version_id,
							type: build[1].version_type ?? 'RELEASE',
							java: build[1].version_java ?? 21,
							supported: build[1].version_supported ? Boolean(build[1].version_supported) : true,
							created: build[1].version_created ? new Date(build[1].version_created) : new Date(build[1].version2_created),
							builds: parseInt(build[1].build_count)
						}, configs: Object.fromEntries(build[2].map((config) => [config.location, {
							type: config.type,
							format: config.format,
							value: config.value
						}]))
					}))
				})
			}

			const [ build, latest, configs ] = await lookupBuild(data.data)
			if (!build || !latest) return ctr.status(ctr.$status.NOT_FOUND).print({ success: false, errors: ['Build not found'] })

			ctr["@"].data.type = 'lookup'
			ctr["@"].data.build = {
				id: build.id,
				type: build.type,
				versionId: build.version_id,
				projectVersionId: build.project_version_id,
				buildNumber: build.build_number,
				java: latest.version_java
			}

			return ctr.print({
				success: true,
				build: fields.length > 0 ? object.pick(database.prepare.rawBuild(build), fields) : database.prepare.rawBuild(build),
				latest: fields.length > 0 && latest ? object.pick(database.prepare.rawBuild(latest), fields) : database.prepare.rawBuild(latest),
				version: {
					id: latest.version_id || latest.project_version_id,
					type: latest.version_type ?? 'RELEASE',
					java: latest.version_java ?? 21,
					supported: latest.version_supported ?? true,
					created: latest.version_created ? new Date(latest.version_created) : new Date(latest.version2_created),
					builds: parseInt(latest.build_count)
				}, configs: Object.fromEntries(configs.map((config) => [config.location, {
					type: config.type,
					format: config.format,
					value: config.value
				}]))
			})
		})
	)