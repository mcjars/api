import { globalAPIRouter } from "@/api"
import { and, count, countDistinct, desc, eq, gte, inArray, like, lte, notLike, sql } from "drizzle-orm"
import { types, ServerType } from "@/schema"
import { object, time } from "@rjweb/utils"

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
									}, requests: {
										type: 'object',
										additionalProperties: {
											type: 'object',
											properties: {
												total: {
													type: 'number'
												}, uniqueIps: {
													type: 'number'
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

			const requests = await ctr["@"].cache.use(`requests::version::${version}`, () => ctr["@"].database.select({
					total: count().as('total'),
					uniqueIps: countDistinct(ctr["@"].database.schema.requests.ip),
					type: sql<string>`x.type`.as('type')
				})
					.from(
						ctr["@"].database.select({
							ip: ctr["@"].database.schema.requests.ip,
							type: sql<string>`UPPER(
								SPLIT_PART(
									SPLIT_PART(
										SUBSTR(${ctr["@"].database.schema.requests.path}, ${'/api/v_/builds/'.length} + 1),
										'?',
										1
									),
									'/',
									1
								)
							)`.as('type')
						})
							.from(ctr["@"].database.schema.requests)
							.where(and(
								eq(ctr["@"].database.schema.requests.status, 200),
								notLike(ctr["@"].database.schema.requests.path, `%tracking=nostats%`),
								like(ctr["@"].database.schema.requests.path, `/api/v_/builds/%`),
								like(ctr["@"].database.schema.requests.path, `%/${version}%`)
							))
							.as('x')
					)
					.where(inArray(sql`x.type`, [...ctr["@"].database.schema.types]))
					.groupBy(sql`x.type`)
					.orderBy(desc(sql`total`)),
				time(3).h()
			)

			if (!requests?.length) return ctr.status(ctr.$status.NOT_FOUND).print({ success: false, errors: ['Version not found'] })

			return ctr.print({
				success: true,
				requests: Object.fromEntries(ctr["@"].database.schema.types.map((type) => [
					type,
					object.pick(requests.find((stat) => stat.type === type) ?? { total: 0, uniqueIps: 0 }, ['total', 'uniqueIps'])
				]))
			})
		})
	)
	.http('GET', '/version/{version}/history/{year}/{month}', (http) => http
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
									}, requests: {
										type: 'object',
										additionalProperties: {
											type: 'array',
											items: {
												type: 'object',
												properties: {
													day: {
														type: 'number'
													}, total: {
														type: 'number'
													}, uniqueIps: {
														type: 'number'
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
					name: 'version',
					in: 'path',
					description: 'The version to get information for',
					required: true,
					example: '1.17.1',
					schema: {
						type: 'string'
					}
				},
				{
					name: 'year',
					in: 'path',
					description: 'The year to get information for',
					required: true,
					example: 2024,
					schema: {
						type: 'number'
					}
				},
				{
					name: 'month',
					in: 'path',
					description: 'The month to get information for',
					required: true,
					example: 1,
					schema: {
						type: 'number'
					}
				}
			]
		})
		.onRequest(async(ctr) => {
			const version = ctr.params.get('version', ''),
				year = parseInt(ctr.params.get('year', '')),
				month = parseInt(ctr.params.get('month', ''))

			if (isNaN(year) || year < 2024 || year > new Date().getFullYear()) return ctr.status(ctr.$status.BAD_REQUEST).print({ success: false, errors: ['Invalid year'] })
			if (isNaN(month) || month < 1 || month > 12) return ctr.status(ctr.$status.BAD_REQUEST).print({ success: false, errors: ['Invalid month'] })

			const start = new Date(year, month - 1, 1),
				end = new Date(year, month, 0, 23, 59, 59, 999)

			const requests = await ctr["@"].cache.use(`requests::version::${version}::history::${start.getTime()}::${end.getTime()}`, () => ctr["@"].database.select({
					total: count().as('total'),
					uniqueIps: countDistinct(ctr["@"].database.schema.requests.ip),
					type: sql<string>`x.type`.as('type'),
					day: sql<string>`x.day`.as('day'),
				})
					.from(
						ctr["@"].database.select({
							day: sql<string>`extract(day from ${ctr["@"].database.schema.requests.created})`.as('day'),
							ip: ctr["@"].database.schema.requests.ip,
							type: sql<string>`UPPER(
								SPLIT_PART(
									SPLIT_PART(
										SUBSTR(${ctr["@"].database.schema.requests.path}, ${'/api/v_/builds/'.length} + 1),
										'?',
										1
									),
									'/',
									1
								)
							)`.as('type')
						})
							.from(ctr["@"].database.schema.requests)
							.where(and(
								eq(ctr["@"].database.schema.requests.status, 200),
								notLike(ctr["@"].database.schema.requests.path, `%tracking=nostats%`),
								like(ctr["@"].database.schema.requests.path, `/api/v_/builds/%`),
								like(ctr["@"].database.schema.requests.path, `%/${version}%`),
								gte(ctr["@"].database.schema.requests.created, start),
								lte(ctr["@"].database.schema.requests.created, end)
							))
							.as('x')
					)
					.where(inArray(sql`x.type`, [...ctr["@"].database.schema.types]))
					.groupBy(sql`x.type, x.day`)
					.orderBy(sql`x.day`),
				time(3).h()
			)

			return ctr.print({
				success: true,
				requests: Object.fromEntries(ctr["@"].database.schema.types.map((type) => [
					type,
					Array.from({ length: end.getDate() }, (_, i) => {
						const data = requests.find((stat) => stat.type === type && parseInt(stat.day) === i + 1)

						return {
							day: i + 1,
							total: data?.total ?? 0,
							uniqueIps: data?.uniqueIps ?? 0
						}
					})
				]))
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
									}, requests: {
										type: 'object',
										properties: {
											root: {
												type: 'object',
												properties: {
													total: {
														type: 'number'
													}, uniqueIps: {
														type: 'number'
													}
												}
											}, versions: {
												type: 'object',
												additionalProperties: {
													type: 'object',
													properties: {
														total: {
															type: 'number'
														}, uniqueIps: {
															type: 'number'
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
			const type = ctr.params.get('type', '').toUpperCase() as ServerType
			if (!types.includes(type)) return ctr.status(ctr.$status.BAD_REQUEST).print({ success: false, errors: ['Invalid type'] })

			const [ requests, mcVersions, projectVersions ] = await Promise.all([
				ctr["@"].cache.use(`requests::${type}`, () => ctr["@"].database.select({
						total: count().as('total'),
						uniqueIps: countDistinct(ctr["@"].database.schema.requests.ip),
						version: sql<string>`CASE
							WHEN LENGTH(${ctr["@"].database.schema.requests.path}) > ${`/api/v_/builds/${type}/`.length}
							THEN UPPER(
								SPLIT_PART(
									SPLIT_PART(
										SUBSTR(${ctr["@"].database.schema.requests.path}, ${`/api/v_/builds/${type}/`.length} + 1),
										'?',
										1
									),
									'/',
									1
								)
							)
							ELSE '/'
						END`.as('version')
					})
						.from(ctr["@"].database.schema.requests)
						.where(and(
							eq(ctr["@"].database.schema.requests.status, 200),
							notLike(ctr["@"].database.schema.requests.path, `%tracking=nostats%`),
							like(ctr["@"].database.schema.requests.path, `/api/v_/builds/${type}%`)
						))
						.groupBy(sql`version`)
						.orderBy(desc(sql`total`)),
					time(30).m()
				),
				ctr["@"].cache.use('versions::all::minecraft', () => ctr["@"].database.select({
						id: ctr["@"].database.schema.minecraftVersions.id
					})
						.from(ctr["@"].database.schema.minecraftVersions),
					time(3).h()
				),
				type !== 'VELOCITY' ? null : ctr["@"].cache.use(`versions::all::project::${type}`, () => ctr["@"].database.select({
						id: ctr["@"].database.schema.projectVersions.id
					})
						.from(ctr["@"].database.schema.projectVersions)
						.where(eq(ctr["@"].database.schema.projectVersions.type, type)),
					time(3).h()
				)
			])

			const mappedRequests = requests.map((stat) => ({
				version: type !== 'VELOCITY' ? mcVersions.find((v) => stat.version === v.id.toUpperCase())?.id : projectVersions?.find((v) => stat.version === v.id.toUpperCase())?.id,
				total: stat.total,
				uniqueIps: stat.uniqueIps
			}))

			return ctr.print({
				success: true,
				requests: {
					root: object.pick(requests.find((stat) => stat.version === '/') ?? { total: 0, uniqueIps: 0 }, ['total', 'uniqueIps']),
					versions: Object.fromEntries(mappedRequests.filter((stat) => stat.version).map((stat) => [
						stat.version,
						object.pick(stat, ['total', 'uniqueIps'])
					]))
				}
			})
		})
	)
	.http('GET', '/{type}/history/{year}/{month}', (http) => http
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
									}, requests: {
										type: 'array',
										items: {
											type: 'object',
											properties: {
												day: {
													type: 'number'
												}, root: {
													type: 'object',
													properties: {
														total: {
															type: 'number'
														}, uniqueIps: {
															type: 'number'
														}
													}
												}, versions: {
													type: 'object',
													additionalProperties: {
														type: 'object',
														properties: {
															total: {
																type: 'number'
															}, uniqueIps: {
																type: 'number'
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
					name: 'year',
					in: 'path',
					description: 'The year to get information for',
					required: true,
					example: 2024,
					schema: {
						type: 'number'
					}
				},
				{
					name: 'month',
					in: 'path',
					description: 'The month to get information for',
					required: true,
					example: 1,
					schema: {
						type: 'number'
					}
				}
			]
		})
		.onRequest(async(ctr) => {
			const type = ctr.params.get('type', '').toUpperCase() as ServerType
			if (!types.includes(type)) return ctr.status(ctr.$status.BAD_REQUEST).print({ success: false, errors: ['Invalid type'] })

			const year = parseInt(ctr.params.get('year', '')),
				month = parseInt(ctr.params.get('month', ''))

			if (isNaN(year) || year < 2024 || year > new Date().getFullYear()) return ctr.status(ctr.$status.BAD_REQUEST).print({ success: false, errors: ['Invalid year'] })
			if (isNaN(month) || month < 1 || month > 12) return ctr.status(ctr.$status.BAD_REQUEST).print({ success: false, errors: ['Invalid month'] })

			const start = new Date(year, month - 1, 1),
				end = new Date(year, month, 0, 23, 59, 59, 999)

			const [ requests, mcVersions, projectVersions ] = await Promise.all([
				ctr["@"].cache.use(`requests::${type}::history::${start.getTime()}::${end.getTime()}`, () => ctr["@"].database.select({
						total: count().as('total'),
						uniqueIps: countDistinct(ctr["@"].database.schema.requests.ip),
						day: sql<string>`extract(day from ${ctr["@"].database.schema.requests.created})`.as('day'),
						version: sql<string>`CASE
							WHEN LENGTH(${ctr["@"].database.schema.requests.path}) > ${`/api/v_/builds/${type}/`.length}
							THEN UPPER(
								SPLIT_PART(
									SPLIT_PART(
										SUBSTR(${ctr["@"].database.schema.requests.path}, ${`/api/v_/builds/${type}/`.length} + 1),
										'?',
										1
									),
									'/',
									1
								)
							)
							ELSE '/'
						END`.as('version')
					})
						.from(ctr["@"].database.schema.requests)
						.where(and(
							eq(ctr["@"].database.schema.requests.status, 200),
							notLike(ctr["@"].database.schema.requests.path, `%tracking=nostats%`),
							like(ctr["@"].database.schema.requests.path, `/api/v_/builds/${type}%`),
							gte(ctr["@"].database.schema.requests.created, start),
							lte(ctr["@"].database.schema.requests.created, end)
						))
						.groupBy(sql`version, day`)
						.orderBy(sql`day`),
					time(30).m()
				),
				ctr["@"].cache.use('versions::all::minecraft', () => ctr["@"].database.select({
						id: ctr["@"].database.schema.minecraftVersions.id
					})
						.from(ctr["@"].database.schema.minecraftVersions),
					time(3).h()
				),
				type !== 'VELOCITY' ? null : ctr["@"].cache.use(`versions::all::project::${type}`, () => ctr["@"].database.select({
						id: ctr["@"].database.schema.projectVersions.id
					})
						.from(ctr["@"].database.schema.projectVersions)
						.where(eq(ctr["@"].database.schema.projectVersions.type, type)),
					time(3).h()
				)
			])

			const mappedRequests = requests.map((stat) => ({
				day: parseInt(stat.day),
				version: type !== 'VELOCITY' ? mcVersions.find((v) => stat.version === v.id.toUpperCase())?.id : projectVersions?.find((v) => stat.version === v.id.toUpperCase())?.id,
				total: stat.total,
				uniqueIps: stat.uniqueIps
			}))

			return ctr.print({
				success: true,
				requests: Array.from({ length: end.getDate() }, (_, i) => {
					const data = mappedRequests.filter((stat) => stat.day === i + 1)

					return {
						day: i + 1,
						root: object.pick(requests.find((stat) => stat.version === '/' && parseInt(stat.day) === i + 1) ?? { total: 0, uniqueIps: 0 }, ['total', 'uniqueIps']),
						versions: Object.fromEntries(data.filter((stat) => stat.version).map((stat) => [
							stat.version,
							object.pick(stat, ['total', 'uniqueIps'])
						]))
					}
				})
			})
		})
	)