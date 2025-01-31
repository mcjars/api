import { globalAPIRouter } from "@/api"
import { and, asc, count, countDistinct, desc, eq, gte, isNotNull, lte, notLike, sql } from "drizzle-orm"
import { object, time } from "@rjweb/utils"
import { typesWithProjectAsIdentifier } from "@/globals/database"

export = new globalAPIRouter.Path('/')
	.http('GET', '/versions', (http) => http
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
											type: 'object',
											properties: {
												total: { type: 'integer' },
												uniqueIps: { type: 'integer' }
											}, required: ['total', 'uniqueIps']
										}
									}
								}, required: ['success', 'versions']
							}
						}
					}
				}
			}
		})
		.onRequest(async(ctr) => {
			const versions = await ctr["@"].cache.use('lookups::versions', () => ctr["@"].database.select({
					version: sql<string>`x.version`.as('version'),
					total: count().as('total'),
					uniqueIps: countDistinct(ctr["@"].database.schema.requests.ip)
				})
					.from(ctr["@"].database.select({
						version: sql<string>`${ctr["@"].database.schema.requests.data}->'build'->>'versionId'`.as('version'),
						ip: ctr["@"].database.schema.requests.ip
					})
						.from(ctr["@"].database.schema.requests)
						.where(and(
							eq(ctr["@"].database.schema.requests.status, 200),
							isNotNull(ctr["@"].database.schema.requests.data),
							notLike(ctr["@"].database.schema.requests.path, `%tracking=nostats%`),
							sql`${ctr["@"].database.schema.requests.data}->>'type' = 'lookup'`
						))
						.as('x'))
					.where(isNotNull(sql`x.version`))
					.groupBy(sql`x.version`)
					.orderBy(desc(sql`total`)),
				time(3).h()
			)

			return ctr.print({
				success: true,
				versions: Object.fromEntries(versions.map((version) => [
					version.version,
					object.pick(version, ['total', 'uniqueIps'])
				]))
			})
		})
	)
	.http('GET', '/versions/history/{year}/{month}', (http) => http
		.document({
			parameters: [
				{
					name: 'year',
					in: 'path',
					description: 'The year to get information for',
					required: true,
					example: '2024',
					schema: {
						type: 'integer'
					}
				},
				{
					name: 'month',
					in: 'path',
					description: 'The month to get information for',
					required: true,
					example: '1',
					schema: {
						type: 'integer'
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
									}, versions: {
										type: 'object',
										additionalProperties: {
											type: 'array',
											items: {
												type: 'object',
												properties: {
													day: { type: 'integer' },
													total: { type: 'integer' },
													uniqueIps: { type: 'integer' }
												}, required: ['day', 'total', 'uniqueIps']
											}
										}
									}
								}, required: ['success', 'versions']
							}
						}
					}
				}
			}
		})
		.onRequest(async(ctr) => {
			const year = parseInt(ctr.params.get('year', '')),
				month = parseInt(ctr.params.get('month', ''))

			if (isNaN(year) || year < 2024 || year > new Date().getFullYear()) return ctr.status(ctr.$status.BAD_REQUEST).print({ success: false, errors: ['Invalid year'] })
			if (isNaN(month) || month < 1 || month > 12) return ctr.status(ctr.$status.BAD_REQUEST).print({ success: false, errors: ['Invalid month'] })

			const start = new Date(year, month - 1, 1),
				end = new Date(year, month, 0, 23, 59, 59, 999)

			const versions = await ctr["@"].cache.use(`lookups::versions::history::${start.getTime()}::${end.getTime()}`, () => ctr["@"].database.select({
					version: sql<string>`x.version`.as('version'),
					day: sql<string>`extract(day from x.created)`.as('day'),
					total: count().as('total'),
					uniqueIps: countDistinct(ctr["@"].database.schema.requests.ip)
				})
					.from(ctr["@"].database.select({
						version: sql<string>`${ctr["@"].database.schema.requests.data}->'build'->>'versionId'`.as('version'),
						created: ctr["@"].database.schema.requests.created,
						ip: ctr["@"].database.schema.requests.ip
					})
						.from(ctr["@"].database.schema.requests)
						.where(and(
							eq(ctr["@"].database.schema.requests.status, 200),
							isNotNull(ctr["@"].database.schema.requests.data),
							notLike(ctr["@"].database.schema.requests.path, `%tracking=nostats%`),
							sql`${ctr["@"].database.schema.requests.data}->>'type' = 'lookup'`,
							gte(ctr["@"].database.schema.requests.created, start),
							lte(ctr["@"].database.schema.requests.created, end),
						))
						.as('x'))
					.where(isNotNull(sql`x.version`))
					.groupBy(sql`day`, sql`x.version`)
					.orderBy(asc(sql`day`), desc(sql`total`)),
				time(3).h()
			)

			return ctr.print({
				success: true,
				versions: Object.fromEntries(versions.map((version) => [
					version.version,
					Array.from({ length: end.getDate() }, (_, i) => {
						const data = versions.find((stat) => stat.version === version.version && parseInt(stat.day) === i + 1)

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
	.http('GET', '/versions/{type}', (http) => http
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
									}, versions: {
										type: 'object',
										additionalProperties: {
											type: 'object',
											properties: {
												total: { type: 'integer' },
												uniqueIps: { type: 'integer' }
											}, required: ['total', 'uniqueIps']
										}
									}
								}, required: ['success', 'versions']
							}
						}
					}
				}
			}
		})
		.onRequest(async(ctr) => {
			const type = ctr["@"].database.matchType(ctr.params.get('type', ''))
			if (!type) return ctr.status(ctr.$status.BAD_REQUEST).print({ success: false, errors: ['Invalid type'] })

			const selector = typesWithProjectAsIdentifier.includes(type) ? 'projectVersionId' : 'versionId'

			const versions = await ctr["@"].cache.use(`lookups::versions::${type}`, () => ctr["@"].database.select({
					version: sql<string>`x.version`.as('version'),
					total: count().as('total'),
					uniqueIps: countDistinct(ctr["@"].database.schema.requests.ip)
				})
					.from(ctr["@"].database.select({
						version: sql<string>`${ctr["@"].database.schema.requests.data}->'build'->>${selector}`.as('version'),
						ip: ctr["@"].database.schema.requests.ip
					})
						.from(ctr["@"].database.schema.requests)
						.where(and(
							eq(ctr["@"].database.schema.requests.status, 200),
							isNotNull(ctr["@"].database.schema.requests.data),
							notLike(ctr["@"].database.schema.requests.path, `%tracking=nostats%`),
							sql`${ctr["@"].database.schema.requests.data}->>'type' = 'lookup'`,
							sql`${ctr["@"].database.schema.requests.data}->'build'->>'type' = ${type}`
						))
						.as('x'))
					.where(isNotNull(sql`x.version`))
					.groupBy(sql`x.version`)
					.orderBy(desc(sql`total`)),
				time(3).h()
			)

			return ctr.print({
				success: true,
				versions: Object.fromEntries(versions.map((version) => [
					version.version,
					object.pick(version, ['total', 'uniqueIps'])
				]))
			})
		})
	)
	.http('GET', '/versions/{type}/history/{year}/{month}', (http) => http
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
				},
				{
					name: 'year',
					in: 'path',
					description: 'The year to get information for',
					required: true,
					example: '2024',
					schema: {
						type: 'integer'
					}
				},
				{
					name: 'month',
					in: 'path',
					description: 'The month to get information for',
					required: true,
					example: '1',
					schema: {
						type: 'integer'
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
									}, versions: {
										type: 'object',
										additionalProperties: {
											type: 'array',
											items: {
												type: 'object',
												properties: {
													day: { type: 'integer' },
													total: { type: 'integer' },
													uniqueIps: { type: 'integer' }
												}, required: ['day', 'total', 'uniqueIps']
											}
										}
									}
								}, required: ['success', 'versions']
							}
						}
					}
				}
			}
		})
		.onRequest(async(ctr) => {
			const type = ctr["@"].database.matchType(ctr.params.get('type', ''))
			if (!type) return ctr.status(ctr.$status.BAD_REQUEST).print({ success: false, errors: ['Invalid type'] })

			const year = parseInt(ctr.params.get('year', '')),
				month = parseInt(ctr.params.get('month', ''))

			if (isNaN(year) || year < 2024 || year > new Date().getFullYear()) return ctr.status(ctr.$status.BAD_REQUEST).print({ success: false, errors: ['Invalid year'] })
			if (isNaN(month) || month < 1 || month > 12) return ctr.status(ctr.$status.BAD_REQUEST).print({ success: false, errors: ['Invalid month'] })

			const start = new Date(year, month - 1, 1),
				end = new Date(year, month, 0, 23, 59, 59, 999)

			const selector = typesWithProjectAsIdentifier.includes(type) ? 'projectVersionId' : 'versionId'

			const versions = await ctr["@"].cache.use(`lookups::versions::${type}::history::${start.getTime()}::${end.getTime()}`, () => ctr["@"].database.select({
					version: sql<string>`x.version`.as('version'),
					day: sql<string>`extract(day from x.created)`.as('day'),
					total: count().as('total'),
					uniqueIps: countDistinct(ctr["@"].database.schema.requests.ip)
				})
					.from(ctr["@"].database.select({
						version: sql<string>`${ctr["@"].database.schema.requests.data}->'build'->>${selector}`.as('version'),
						created: ctr["@"].database.schema.requests.created,
						ip: ctr["@"].database.schema.requests.ip
					})
						.from(ctr["@"].database.schema.requests)
						.where(and(
							eq(ctr["@"].database.schema.requests.status, 200),
							isNotNull(ctr["@"].database.schema.requests.data),
							notLike(ctr["@"].database.schema.requests.path, `%tracking=nostats%`),
							sql`${ctr["@"].database.schema.requests.data}->>'type' = 'lookup'`,
							sql`${ctr["@"].database.schema.requests.data}->'build'->>'type' = ${type}`,
							gte(ctr["@"].database.schema.requests.created, start),
							lte(ctr["@"].database.schema.requests.created, end)
						))
						.as('x')
					)
					.where(isNotNull(sql`x.version`))
					.groupBy(sql`day`, sql`x.version`)
					.orderBy(asc(sql`day`), desc(sql`total`)),
				time(3).h()
			)

			return ctr.print({
				success: true,
				versions: Object.fromEntries(versions.map((version) => [
					version.version,
					Array.from({ length: end.getDate() }, (_, i) => {
						const data = versions.find((stat) => stat.version === version.version && parseInt(stat.day) === i + 1)

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
	.http('GET', '/types', (http) => http
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
									}, types: {
										type: 'object',
										additionalProperties: {
											type: 'object',
											properties: {
												total: { type: 'integer' },
												uniqueIps: { type: 'integer' }
											}, required: ['total', 'uniqueIps']
										}
									}
								}, required: ['success', 'types']
							}
						}
					}
				}
			}
		})
		.onRequest(async(ctr) => {
			const types = await ctr["@"].database.select({
				type: sql<string>`x.type`.as('type'),
				total: count().as('total'),
				uniqueIps: countDistinct(ctr["@"].database.schema.requests.ip)
			})
				.from(ctr["@"].database.select({
					type: sql<string>`${ctr["@"].database.schema.requests.data}->'build'->>'type'`.as('type'),
					ip: ctr["@"].database.schema.requests.ip
				})
					.from(ctr["@"].database.schema.requests)
					.where(and(
						eq(ctr["@"].database.schema.requests.status, 200),
						isNotNull(ctr["@"].database.schema.requests.data),
						notLike(ctr["@"].database.schema.requests.path, `%tracking=nostats%`),
						sql`${ctr["@"].database.schema.requests.data}->>'type' = 'lookup'`
					))
					.as('x'))
				.where(isNotNull(sql`x.type`))
				.groupBy(sql`x.type`)
				.orderBy(desc(sql`total`))

			return ctr.print({
				success: true,
				types: Object.fromEntries(types.map((type) => [
					type.type,
					object.pick(type, ['total', 'uniqueIps'])
				])
				)
			})
		})
	)
	.http('GET', '/types/history/{year}/{month}', (http) => http
		.document({
			parameters: [
				{
					name: 'year',
					in: 'path',
					description: 'The year to get information for',
					required: true,
					example: '2024',
					schema: {
						type: 'integer'
					}
				},
				{
					name: 'month',
					in: 'path',
					description: 'The month to get information for',
					required: true,
					example: '1',
					schema: {
						type: 'integer'
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
									}, types: {
										type: 'object',
										additionalProperties: {
											type: 'array',
											items: {
												type: 'object',
												properties: {
													day: { type: 'integer' },
													total: { type: 'integer' },
													uniqueIps: { type: 'integer' }
												}, required: ['day', 'total', 'uniqueIps']
											}
										}
									}
								}, required: ['success', 'types']
							}
						}
					}
				}
			}
		})
		.onRequest(async(ctr) => {
			const year = parseInt(ctr.params.get('year', '')),
				month = parseInt(ctr.params.get('month', ''))

			if (isNaN(year) || year < 2024 || year > new Date().getFullYear()) return ctr.status(ctr.$status.BAD_REQUEST).print({ success: false, errors: ['Invalid year'] })
			if (isNaN(month) || month < 1 || month > 12) return ctr.status(ctr.$status.BAD_REQUEST).print({ success: false, errors: ['Invalid month'] })

			const start = new Date(year, month - 1, 1),
				end = new Date(year, month, 0, 23, 59, 59, 999)

			const types = await ctr["@"].database.select({
				type: sql<string>`x.type`.as('type'),
				day: sql<string>`extract(day from x.created)`.as('day'),
				total: count().as('total'),
				uniqueIps: countDistinct(ctr["@"].database.schema.requests.ip)
			})
				.from(ctr["@"].database.select({
					type: sql<string>`${ctr["@"].database.schema.requests.data}->'build'->>'type'`.as('type'),
					created: ctr["@"].database.schema.requests.created,
					ip: ctr["@"].database.schema.requests.ip
				})
					.from(ctr["@"].database.schema.requests)
					.where(and(
						eq(ctr["@"].database.schema.requests.status, 200),
						isNotNull(ctr["@"].database.schema.requests.data),
						notLike(ctr["@"].database.schema.requests.path, `%tracking=nostats%`),
						sql`${ctr["@"].database.schema.requests.data}->>'type' = 'lookup'`,
						gte(ctr["@"].database.schema.requests.created, start),
						lte(ctr["@"].database.schema.requests.created, end),
					))
					.as('x'))
				.where(isNotNull(sql`x.type`))
				.groupBy(sql`day`, sql`x.type`)
				.orderBy(asc(sql`day`), desc(sql`total`))

			return ctr.print({
				success: true,
				types: Object.fromEntries(types.map((type) => [
					type.type,
					Array.from({ length: end.getDate() }, (_, i) => {
						const data = types.find((stat) => stat.type === type.type && parseInt(stat.day) === i + 1)

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