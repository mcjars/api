import { globalAPIRouter } from "@/api"
import { and, avg, count, eq, gte, lte, sql, sum, sumDistinct } from "drizzle-orm"
import { time } from "@rjweb/utils"

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
									}, stats: {
										type: 'object',
										properties: {
											builds: {
												type: 'integer'
											}, size: {
												type: 'object',
												properties: {
													total: {
														type: 'object',
														properties: {
															jar: {
																type: 'number'
															}, zip: {
																type: 'number'
															}
														}, required: ['jar', 'zip']
													}, average: {
														type: 'object',
														properties: {
															jar: {
																type: 'number'
															}, zip: {
																type: 'number'
															}
														}, required: ['jar', 'zip']
													}
												}, required: ['total', 'average']
											}
										}, required: ['builds', 'size']
									}
								}, required: ['success', 'stats']
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

			const stats = await ctr["@"].cache.use(`stats::version::${version}`, () => ctr["@"].database.select({
					builds: count(),
					total: {
						jar: sumDistinct(ctr["@"].database.schema.builds.jarSize),
						zip: sum(ctr["@"].database.schema.builds.zipSize)
					}, average: {
						jar: avg(ctr["@"].database.schema.builds.jarSize),
						zip: avg(ctr["@"].database.schema.builds.zipSize)
					}
				})
					.from(ctr["@"].database.schema.builds)
					.where(eq(ctr["@"].database.schema.builds.versionId, version))
					.then((r) => r[0]),
				time(30).m()
			)

			if (!stats?.builds) return ctr.status(ctr.$status.NOT_FOUND).print({ success: false, errors: ['Version not found'] })

			return ctr.print({
				success: true,
				stats: {
					builds: stats?.builds ?? 0,
					size: {
						total: {
							jar: Number(stats?.total.jar ?? 0),
							zip: Number(stats?.total.zip ?? 0)
						}, average: {
							jar: Number(stats?.average.jar ?? 0),
							zip: Number(stats?.average.zip ?? 0)
						}
					}
				}
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
									}, stats: {
										type: 'array',
										items: {
											type: 'object',
											properties: {
												day: {
													type: 'integer'
												}, builds: {
													type: 'integer'
												}, size: {
													type: 'object',
													properties: {
														total: {
															type: 'object',
															properties: {
																jar: {
																	type: 'number'
																}, zip: {
																	type: 'number'
																}
															}, required: ['jar', 'zip']
														}, average: {
															type: 'object',
															properties: {
																jar: {
																	type: 'number'
																}, zip: {
																	type: 'number'
																}
															}, required: ['jar', 'zip']
														}
													}, required: ['total', 'average']
												}
											}, required: ['day', 'builds', 'size']
										}
									}
								}, required: ['success', 'stats']
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

			const stats = await ctr["@"].cache.use(`stats::version::${version}::history::${start.getTime()}::${end.getTime()}`, () => ctr["@"].database.select({
					builds: count(),
					day: sql`extract(day from ${ctr["@"].database.schema.builds.created})`.as('day'),
					total: {
						jar: sumDistinct(ctr["@"].database.schema.builds.jarSize),
						zip: sum(ctr["@"].database.schema.builds.zipSize)
					}, average: {
						jar: avg(ctr["@"].database.schema.builds.jarSize),
						zip: avg(ctr["@"].database.schema.builds.zipSize)
					}
				})
					.from(ctr["@"].database.schema.builds)
					.where(and(
						eq(ctr["@"].database.schema.builds.versionId, version),
						gte(ctr["@"].database.schema.builds.created, start),
						lte(ctr["@"].database.schema.builds.created, end)
					))
					.groupBy(sql`day`),
				time(30).m()
			)

			return ctr.print({
				success: true,
				stats: Array.from({ length: end.getDate() }, (_, i) => {
					const day = new Date(year, month - 1, i + 1).toISOString().split('T')[0]
					const data = stats.find((d) => d.day === day)

					return {
						day: parseInt(day.split('-')[2]),
						builds: data?.builds ?? 0,
						size: {
							total: {
								jar: Number(data?.total.jar ?? 0),
								zip: Number(data?.total.zip ?? 0)
							}, average: {
								jar: Number(data?.average.jar ?? 0),
								zip: Number(data?.average.zip ?? 0)
							}
						}
					}
				})
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
									}, stats: {
										type: 'object',
										properties: {
											builds: {
												type: 'integer'
											}, size: {
												type: 'object',
												properties: {
													total: {
														type: 'object',
														properties: {
															jar: {
																type: 'number'
															}, zip: {
																type: 'number'
															}
														}, required: ['jar', 'zip']
													}, average: {
														type: 'object',
														properties: {
															jar: {
																type: 'number'
															}, zip: {
																type: 'number'
															}
														}, required: ['jar', 'zip']
													}
												}, required: ['total', 'average']
											}
										}, required: ['builds', 'size']
									}
								}, required: ['success', 'stats']
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

			const stats = await ctr["@"].cache.use(`stats::${type}`, () => ctr["@"].database.select({
					builds: count(),
					total: {
						jar: type === 'FABRIC' ? sum(ctr["@"].database.schema.builds.jarSize) : sumDistinct(ctr["@"].database.schema.builds.jarSize),
						zip: sum(ctr["@"].database.schema.builds.zipSize)
					}, average: {
						jar: avg(ctr["@"].database.schema.builds.jarSize),
						zip: avg(ctr["@"].database.schema.builds.zipSize)
					}
				})
					.from(ctr["@"].database.schema.builds)
					.where(eq(ctr["@"].database.schema.builds.type, type))
					.then((r) => r[0]),
				time(30).m()
			)

			return ctr.print({
				success: true,
				stats: {
					builds: stats?.builds ?? 0,
					size: {
						total: {
							jar: Number(stats?.total.jar ?? 0),
							zip: Number(stats?.total.zip ?? 0)
						}, average: {
							jar: Number(stats?.average.jar ?? 0),
							zip: Number(stats?.average.zip ?? 0)
						}
					}
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
									}, stats: {
										type: 'array',
										items: {
											type: 'object',
											properties: {
												day: {
													type: 'integer'
												}, builds: {
													type: 'integer'
												}, size: {
													type: 'object',
													properties: {
														total: {
															type: 'object',
															properties: {
																jar: {
																	type: 'number'
																}, zip: {
																	type: 'number'
																}
															}, required: ['jar', 'zip']
														}, average: {
															type: 'object',
															properties: {
																jar: {
																	type: 'number'
																}, zip: {
																	type: 'number'
																}
															}, required: ['jar', 'zip']
														}
													}, required: ['total', 'average']
												}
											}, required: ['day', 'builds', 'size']
										}
									}
								}, required: ['success', 'stats']
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
			]
		})
		.onRequest(async(ctr) => {
			const type = ctr["@"].database.matchType(ctr.params.get('type', ''))
			if (!type) return ctr.status(ctr.$status.BAD_REQUEST).print({ success: false, errors: ['Invalid type'] })

			const year = parseInt(ctr.params.get('year', '')),
				month = parseInt(ctr.params.get('month', ''))

			if (isNaN(year) || year < 2024 || year > new Date().getFullYear()) return ctr.status(ctr.$status.BAD_REQUEST).print({ success: false, errors: ['Invalid year'] })
			if (isNaN(month) || month < 1 || month > 12) return ctr.status(ctr.$status.BAD_REQUEST).print({ success: false, errors: ['Invalid month'] })

			const start = new Date(year, month - 1, 1),
				end = new Date(year, month, 0)

			const stats = await ctr["@"].cache.use(`stats::${type}::history::${start.getTime()}::${end.getTime()}`, () => ctr["@"].database.select({
					builds: count(),
					day: sql`extract(day from ${ctr["@"].database.schema.builds.created})`.as('day'),
					total: {
						jar: type === 'FABRIC' ? sum(ctr["@"].database.schema.builds.jarSize) : sumDistinct(ctr["@"].database.schema.builds.jarSize),
						zip: sum(ctr["@"].database.schema.builds.zipSize)
					}, average: {
						jar: avg(ctr["@"].database.schema.builds.jarSize),
						zip: avg(ctr["@"].database.schema.builds.zipSize)
					}
				})
					.from(ctr["@"].database.schema.builds)
					.where(and(
						eq(ctr["@"].database.schema.builds.type, type),
						gte(ctr["@"].database.schema.builds.created, start),
						lte(ctr["@"].database.schema.builds.created, end)
					))
					.groupBy(sql`day`),
				time(30).m()
			)

			return ctr.print({
				success: true,
				stats: Array.from({ length: end.getDate() }, (_, i) => {
					const day = new Date(year, month - 1, i + 1).toISOString().split('T')[0]
					const data = stats.find((d) => d.day === day)

					return {
						day: parseInt(day.split('-')[2]),
						builds: data?.builds ?? 0,
						size: {
							total: {
								jar: Number(data?.total.jar ?? 0),
								zip: Number(data?.total.zip ?? 0)
							}, average: {
								jar: Number(data?.average.jar ?? 0),
								zip: Number(data?.average.zip ?? 0)
							}
						}
					}
				})
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
									}, stats: {
										type: 'object',
										properties: {
											builds: {
												type: 'integer'
											}, size: {
												type: 'object',
												properties: {
													total: {
														type: 'object',
														properties: {
															jar: {
																type: 'number'
															}, zip: {
																type: 'number'
															}
														}, required: ['jar', 'zip']
													}, average: {
														type: 'object',
														properties: {
															jar: {
																type: 'number'
															}, zip: {
																type: 'number'
															}
														}, required: ['jar', 'zip']
													}
												}, required: ['total', 'average']
											}
										}, required: ['builds', 'size']
									}
								}, required: ['success', 'stats']
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

			const stats = await ctr["@"].cache.use(`stats::${type}::${version}`, () => ctr["@"].database.select({
					builds: count(),
					total: {
						jar: type === 'FABRIC' ? sum(ctr["@"].database.schema.builds.jarSize) : sumDistinct(ctr["@"].database.schema.builds.jarSize),
						zip: sum(ctr["@"].database.schema.builds.zipSize)
					}, average: {
						jar: avg(ctr["@"].database.schema.builds.jarSize),
						zip: avg(ctr["@"].database.schema.builds.zipSize)
					}
				})
					.from(ctr["@"].database.schema.builds)
					.where(and(
						eq(ctr["@"].database.schema.builds.type, type),
						location === 'minecraft'
							? eq(ctr["@"].database.schema.builds.versionId, version)
							: eq(ctr["@"].database.schema.builds.projectVersionId, version)
					))
					.then((r) => r[0]),
				time(30).m()
			)

			return ctr.print({
				success: true,
				stats: {
					builds: stats?.builds ?? 0,
					size: {
						total: {
							jar: Number(stats?.total.jar ?? 0),
							zip: Number(stats?.total.zip ?? 0)
						}, average: {
							jar: Number(stats?.average.jar ?? 0),
							zip: Number(stats?.average.zip ?? 0)
						}
					}
				}
			})
		})
	)
	.http('GET', '/{type}/{version}/history/{year}/{month}', (http) => http
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
									}, stats: {
										type: 'array',
										items: {
											type: 'object',
											properties: {
												day: {
													type: 'integer'
												}, builds: {
													type: 'integer'
												}, size: {
													type: 'object',
													properties: {
														total: {
															type: 'object',
															properties: {
																jar: {
																	type: 'number'
																}, zip: {
																	type: 'number'
																}
															}, required: ['jar', 'zip']
														}, average: {
															type: 'object',
															properties: {
																jar: {
																	type: 'number'
																}, zip: {
																	type: 'number'
																}
															}, required: ['jar', 'zip']
														}
													}, required: ['total', 'average']
												}
											}, required: ['day', 'builds', 'size']
										}
									}
								}, required: ['success', 'stats']
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
			]
		})
		.onRequest(async(ctr) => {
			const type = ctr["@"].database.matchType(ctr.params.get('type', ''))
			if (!type) return ctr.status(ctr.$status.BAD_REQUEST).print({ success: false, errors: ['Invalid type'] })

			const version = ctr.params.get('version', ''),
				location = await ctr["@"].database.version(version, type)
			if (!location) return ctr.status(ctr.$status.NOT_FOUND).print({ success: false, errors: ['Version not found'] })

			const year = parseInt(ctr.params.get('year', '')),
				month = parseInt(ctr.params.get('month', ''))

			if (isNaN(year) || year < 2024 || year > new Date().getFullYear()) return ctr.status(ctr.$status.BAD_REQUEST).print({ success: false, errors: ['Invalid year'] })
			if (isNaN(month) || month < 1 || month > 12) return ctr.status(ctr.$status.BAD_REQUEST).print({ success: false, errors: ['Invalid month'] })

			const start = new Date(year, month - 1, 1),
				end = new Date(year, month, 0, 23, 59, 59, 999)

			const stats = await ctr["@"].cache.use(`stats::${type}::${version}::history::${start.getTime()}::${end.getTime()}`, () => ctr["@"].database.select({
					builds: count(),
					day: sql`extract(day from ${ctr["@"].database.schema.builds.created})`.as('day'),
					total: {
						jar: type === 'FABRIC' ? sum(ctr["@"].database.schema.builds.jarSize) : sumDistinct(ctr["@"].database.schema.builds.jarSize),
						zip: sum(ctr["@"].database.schema.builds.zipSize)
					}, average: {
						jar: avg(ctr["@"].database.schema.builds.jarSize),
						zip: avg(ctr["@"].database.schema.builds.zipSize)
					}
				})
					.from(ctr["@"].database.schema.builds)
					.where(and(
						eq(ctr["@"].database.schema.builds.type, type),
						location === 'minecraft'
							? eq(ctr["@"].database.schema.builds.versionId, version)
							: eq(ctr["@"].database.schema.builds.projectVersionId, version),
						gte(ctr["@"].database.schema.builds.created, start),
						lte(ctr["@"].database.schema.builds.created, end)
					))
					.groupBy(sql`day`),
				time(30).m()
			)

			return ctr.print({
				success: true,
				stats: Array.from({ length: end.getDate() }, (_, i) => {
					const day = new Date(year, month - 1, i + 1).toISOString().split('T')[0]
					const data = stats.find((d) => d.day === day)

					return {
						day: parseInt(day.split('-')[2]),
						builds: data?.builds ?? 0,
						size: {
							total: {
								jar: Number(data?.total.jar ?? 0),
								zip: Number(data?.total.zip ?? 0)
							}, average: {
								jar: Number(data?.average.jar ?? 0),
								zip: Number(data?.average.zip ?? 0)
							}
						}
					}
				})
			})
		})
	)