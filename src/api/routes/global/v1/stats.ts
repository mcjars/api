import { globalAPIRouter } from "@/api"
import { time } from "@rjweb/utils"
import { count, sql, sum, sumDistinct } from "drizzle-orm"

export = new globalAPIRouter.Path('/')
	.http('GET', '/', (http) => http
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
												type: 'number'
											}, hashes: {
												type: 'number'
											}, requests: {
												type: 'number'
											}, size: {
												type: 'object',
												properties: {
													database: {
														type: 'number'
													}
												}, required: ['database']
											}, total: {
												type: 'object',
												properties: {
													jarSize: {
														type: 'number'
													}, zipSize: {
														type: 'number'
													}
												}, required: ['jarSize', 'zipSize']
											}
										}, required: [
											'builds',
											'hashes',
											'requests',
											'size',
											'total'
										]
									}
								}, required: ['success', 'stats']
							}
						}
					}
				}
			}
		})
		.onRequest(async(ctr) => {
			const [ hashes, requests, builds ] = await ctr["@"].cache.use('stats::all', () => Promise.all([
				ctr["@"].database.select({
					hashes: count()
				})
					.from(ctr["@"].database.schema.buildHashes)
					.then((r) => r[0]),
				ctr["@"].database.select({
					requests: count(),
					size: sql<string>`pg_database_size(current_database())`
				})
					.from(ctr["@"].database.schema.requests)
					.then((r) => r[0]),
				ctr["@"].database.select({
					builds: count(),
					totalJarSize: sumDistinct(ctr["@"].database.schema.builds.jarSize),
					totalZipSize: sum(ctr["@"].database.schema.builds.zipSize)
				})
					.from(ctr["@"].database.schema.builds)
					.then((r) => r[0])
			]), time(10).m())

			return ctr.print({
				success: true,
				stats: {
					builds: builds?.builds ?? 0,
					hashes: hashes?.hashes ?? 0,
					requests: requests?.requests ?? 0,
					size: {
						database: Number(requests?.size ?? 0)
					}, total: {
						jarSize: Number(builds?.totalJarSize ?? 0),
						zipSize: Number(builds?.totalZipSize ?? 0)
					}
				}
			})
		})
	)