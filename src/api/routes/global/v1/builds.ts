import { globalAPIRouter } from "@/api"
import { time } from "@rjweb/utils"
import { and, desc, eq, sql } from "drizzle-orm"

export = new globalAPIRouter.Path('/')
	.document({
		parameters: [
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
									}, versions: {
										type: 'object',
										additionalProperties: {
											$ref: '#/components/schemas/version'
										}
									}
								}, required: [
									'success',
									'versions'
								]
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
			}
		})
		.onRequest(async(ctr) => {
			const type = ctr["@"].database.matchType(ctr.params.get('type', ''))
			if (!type) return ctr.status(ctr.$status.BAD_REQUEST).print({ success: false, errors: ['Invalid type'] })

			return ctr.print({
				success: true,
				versions: await ctr["@"].database.versions(type)
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
								}, required: [
									'success',
									'builds'
								]
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
				}, 404: {
					description: 'Not Found',
					content: {
						'application/json': {
							schema: {
								$ref: '#/components/schemas/error'
							}
						}
					}
				}
			}, parameters: [
				{
					name: 'version',
					in: 'path',
					description: 'The version to get builds for',
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
				builds
			})
		})
	)
	.http('GET', '/{type}/{version}/{build}', (http) => http
		.document({
			parameters: [
				{
					name: 'version',
					in: 'path',
					description: 'The version to get builds for',
					required: true,
					example: '1.17.1',
					schema: {
						type: 'string'
					}
				},
				{
					name: 'build',
					in: 'path',
					description: 'The build number or hash to lookup',
					required: true,
					example: 'latest',
					schema: {
						oneOf: [
							{ type: 'string', const: 'latest' },
							{ type: 'integer' }
						]
					}
				}
			], responses: {
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
									}, build: {
										$ref: '#/components/schemas/build'
									}
								}, required: [
									'success',
									'build'
								]
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
				}, 404: {
					description: 'Not Found',
					content: {
						'application/json': {
							schema: {
								$ref: '#/components/schemas/error'
							}
						}
					}
				}
			}
		})
		.onRequest(async(ctr) => {
			const type = ctr["@"].database.matchType(ctr.params.get('type', ''))
			if (!type) return ctr.status(ctr.$status.BAD_REQUEST).print({ success: false, errors: ['Invalid type'] })

			const version = ctr.params.get('version', ''),
				location = await ctr["@"].database.version(version, type),
				build = parseInt(ctr.params.get('build', ''))
			if (!location) return ctr.status(ctr.$status.NOT_FOUND).print({ success: false, errors: ['Version not found'] })

			const serverBuild = await ctr["@"].cache.use(`build::${type}::${version}::buildNumber.${build}`, () => ctr["@"].database.select()
					.from(ctr["@"].database.schema.builds)
					.where(and(
						eq(ctr["@"].database.schema.builds.type, type),
						location === 'minecraft'
							? eq(ctr["@"].database.schema.builds.versionId, version)
							: eq(ctr["@"].database.schema.builds.projectVersionId, version),
						isNaN(build)
							? sql`1 = 1`
							: eq(ctr["@"].database.schema.builds.buildNumber, build)
					))
					.orderBy(desc(ctr["@"].database.schema.builds.id))
					.limit(1)
					.then(([build]) => ctr["@"].database.prepare.build(build)),
				time(3).h()
			)

			if (!serverBuild) return ctr.status(ctr.$status.NOT_FOUND).print({ success: false, errors: ['Build not found'] })

			return ctr.print({
				success: true,
				build: serverBuild
			})
		})
	)