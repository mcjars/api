import { globalAPIRouter } from "@/api"
import { object, time } from "@rjweb/utils"
import { and, count, desc, eq } from "drizzle-orm"

export = new globalAPIRouter.Path('/')
	.http('GET', '/version/{version}', (http) => http
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
									}, builds: {
										type: 'object',
										additionalProperties: {
											type: 'number'
										}
									}
								}
							}
						}
					}
				}
			}, parameters: [
				{
					name: 'version',
					in: 'path',
					description: 'The version to get information for',
					required: true,
					example: '1.17.1',
					schema: {
						type: 'string'
					}
				}
			]
		})
		.onRequest(async(ctr) => {
			const version = ctr.params.get('version', '')

			const versionData = await ctr["@"].cache.use(`version::${version}`, () => ctr["@"].database.select()
					.from(ctr["@"].database.schema.minecraftVersions)
					.where(eq(ctr["@"].database.schema.minecraftVersions.id, version))
					.limit(1)
					.then((r) => r[0]),
				time(3).h()
			)

			if (!versionData) return ctr.status(ctr.$status.NOT_FOUND).print({ success: false, errors: ['Version not found'] })

			const builds = await ctr["@"].cache.use(`versions::${version}::all`, async() => {
				const data = await ctr["@"].database.select({
					type: ctr["@"].database.schema.builds.type,
					builds: count()
				})
					.from(ctr["@"].database.schema.builds)
					.where(eq(ctr["@"].database.schema.builds.versionId, version))
					.groupBy(ctr["@"].database.schema.builds.type)

				return Object.fromEntries(ctr["@"].database.schema.types.map((type) => [
					type,
					data.find((build) => build.type === type)?.builds ?? 0
				]))
			}, time(30).m())

			return ctr.print({
				success: true,
				builds
			})
		})
	)
	.http('GET', '/{type}', (http) => http
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
									}, builds: {
										type: 'object',
										additionalProperties: {
											$ref: '#/components/schemas/version'
										}
									}
								}
							}
						}
					}
				}
			}, parameters: [
				{
					name: 'type',
					in: 'path',
					description: 'The type of server to get versions for',
					required: true,
					example: 'VANILLA',
					schema: {
						$ref: '#/components/schemas/types'
					}
				}
			]
		})
		.onRequest(async(ctr) => {
			const type = ctr["@"].database.matchType(ctr.params.get('type', ''))
			if (!type) return ctr.status(ctr.$status.BAD_REQUEST).print({ success: false, errors: ['Invalid type'] })

			const fields = Array.from(new Set((ctr.queries.get('fields', ''))
				.split(',')
				.filter((field) => field.length > 0)
			)) as 'id'[]

			return ctr.print({
				success: true,
				builds: fields.length > 0
					? await ctr["@"].database.versions(type).then((versions) => Object.fromEntries(Object.entries(versions).map(([ version, data ]) => [
							version,
							{
								...data,
								latest: data.latest ? object.pick(data.latest, fields) : null
							}
						]))
					)
					: await ctr["@"].database.versions(type)
			})
		})
	)
	.http('GET', '/{type}/{version}', (http) => http
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
									}, builds: {
										type: 'array',
										items: {
											$ref: '#/components/schemas/build'
										}
									}
								}
							}
						}
					}
				}
			}, parameters: [
				{
					name: 'type',
					in: 'path',
					description: 'The type of server to get versions for',
					required: true,
					example: 'VANILLA',
					schema: {
						$ref: '#/components/schemas/types'
					}
				},
				{
					name: 'version',
					in: 'path',
					description: 'The version to get information for',
					required: true,
					example: '1.17.1',
					schema: {
						type: 'string'
					}
				}
			]
		})
		.onRequest(async(ctr) => {
			const type = ctr["@"].database.matchType(ctr.params.get('type', ''))
			if (!type) return ctr.status(ctr.$status.BAD_REQUEST).print({ success: false, errors: ['Invalid type'] })

			const version = ctr.params.get('version', ''),
				location = await ctr["@"].database.version(version, type)
			if (!location) return ctr.status(ctr.$status.NOT_FOUND).print({ success: false, errors: ['Version not found'] })

			const fields = Array.from(new Set((ctr.queries.get('fields', ''))
				.split(',')
				.filter((field) => field.length > 0)
			)) as 'id'[]

			const builds = await ctr["@"].cache.use(`builds::${type}::${version}`, () => ctr["@"].database.select(ctr["@"].database.fields.build)
					.from(ctr["@"].database.schema.builds)
					.where(and(
						eq(ctr["@"].database.schema.builds.type, type),
						location === 'minecraft'
							? eq(ctr["@"].database.schema.builds.versionId, version)
							: eq(ctr["@"].database.schema.builds.projectVersionId, version)
					))
					.orderBy(desc(ctr["@"].database.schema.builds.id))
					.then((builds) => builds.map(ctr["@"].database.prepare.build)),
				time(10).m()
			)

			return ctr.print({
				success: true,
				builds: fields.length > 0 ? builds.map((build) => object.pick(build, fields)) : builds
			})
		})
	)
	.http('GET', '/{type}/{version}/changes', (http) => http
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
									}, changes: {
										type: 'array',
										items: {
											type: 'object',
											properties: {
												id: {
													type: 'number'
												}, changes: {
													type: 'array',
													items: {
														type: 'string'
													}
												}
											}
										}
									}
								}
							}
						}
					}
				}
			}, parameters: [
				{
					name: 'type',
					in: 'path',
					description: 'The type of server to get versions for',
					required: true,
					example: 'VANILLA',
					schema: {
						$ref: '#/components/schemas/types'
					}
				},
				{
					name: 'version',
					in: 'path',
					description: 'The version to get information for',
					required: true,
					example: '1.17.1',
					schema: {
						type: 'string'
					}
				}
			]
		})
		.onRequest(async(ctr) => {
			const type = ctr["@"].database.matchType(ctr.params.get('type', ''))
			if (!type) return ctr.status(ctr.$status.BAD_REQUEST).print({ success: false, errors: ['Invalid type'] })

			const version = ctr.params.get('version', ''),
				location = await ctr["@"].database.version(version, type)
			if (!location) return ctr.status(ctr.$status.NOT_FOUND).print({ success: false, errors: ['Version not found'] })

			const builds = await ctr["@"].cache.use(`builds::${type}::${version}`, () => ctr["@"].database.select(ctr["@"].database.fields.build)
					.from(ctr["@"].database.schema.builds)
					.where(and(
						eq(ctr["@"].database.schema.builds.type, type),
						location === 'minecraft'
							? eq(ctr["@"].database.schema.builds.versionId, version)
							: eq(ctr["@"].database.schema.builds.projectVersionId, version)
					))
					.orderBy(desc(ctr["@"].database.schema.builds.id))
					.then((builds) => builds.map(ctr["@"].database.prepare.build)),
				time(10).m()
			)

			return ctr.print({
				success: true,
				changes: builds.filter((build) => build.changes.length).map((build) => ({
					id: build.id,
					changes: build.changes
				}))
			})
		})
	)