import { globalAPIRouter } from "@/api"
import { time } from "@rjweb/utils"
import { count, desc, eq } from "drizzle-orm"

export = new globalAPIRouter.Path('/')
	.document({
		parameters: [
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
	.http('GET', '/{version}', (http) => http
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
									}, version: {
										type: 'object',
										properties: {
											id: {
												type: 'string'
											}, type: {
												type: 'string',
												enum: [
													'SNAPSHOT',
													'RELEASE'
												]
											}, supported: {
												type: 'boolean'
											}, created: {
												type: 'string'
											}, builds: {
												type: 'object',
												additionalProperties: {
													type: 'number'
												}
											}
										}, required: ['id', 'type', 'supported', 'created', 'builds']
									}
								}, required: ['success', 'version']
							}
						}
					}
				}
			}
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
				version: Object.assign(versionData, {
					builds
				})
			})
		})
	)
	.http('GET', '/{version}/builds', (http) => http
		.document({
			deprecated: true,
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
											type: 'array',
											items: {
												$ref: '#/components/schemas/build'
											}
										}
									}
								}, required: [
									'success',
									'builds'
								]
							}
						}
					}
				}
			}
		})
		.onRequest(async(ctr) => {
			const version = ctr.params.get('version', '')

			const builds = await ctr["@"].cache.use(`builds::${version}::all`, async() => {
				const data = await ctr["@"].database.select(ctr["@"].database.fields.build)
					.from(ctr["@"].database.schema.builds)
					.where(eq(ctr["@"].database.schema.builds.versionId, version))
					.orderBy(desc(ctr["@"].database.schema.builds.id))

				return Object.fromEntries(ctr["@"].database.schema.types.map((type) => [
					type,
					data.filter((build) => build.type === type).map(ctr["@"].database.prepare.build)
				]))
			}, time(6).h())

			if (!builds) return ctr.status(ctr.$status.NOT_FOUND).print({ success: false, errors: ['Version not found'] })

			return ctr.print({
				success: true,
				builds
			})
		})
	)