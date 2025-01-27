import { organizationAPIRouter } from "@/api"
import { types } from "@/schema"
import { object } from "@rjweb/utils"
import { eq } from "drizzle-orm"
import { z } from "zod"

export = new organizationAPIRouter.Path('/')
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
									}, types: {
										type: 'object',
										additionalProperties: {
											type: 'object',
											properties: {
												icon: {
													type: 'string'
												}, builds: {
													type: 'number'
												}, versions: {
													type: 'object',
													properties: {
														minecraft: {
															type: 'number'
														}, project: {
															type: 'number'
														}
													}, required: ['minecraft', 'project']
												}, name: {
													type: 'string'
												}, color: {
													type: 'string'
												}, homepage: {
													type: 'string'
												}, deprecated: {
													type: 'boolean'
												}, experimental: {
													type: 'boolean'
												}, description: {
													type: 'string'
												}, categories: {
													type: 'array',
													items: {
														type: 'string'
													}
												}, compatibility: {
													type: 'array',
													items: {
														type: 'string'
													}
												}
											}, required: [
												'icon',
												'builds',
												'versions',
												'name',
												'color',
												'homepage',
												'deprecated',
												'experimental',
												'description',
												'categories',
												'compatibility'
											]
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
			return ctr.print({
				success: true,
				types: ctr["@"].organization.types.length
					? object.pick(await ctr["@"].database.types(), ctr["@"].organization.types)
					: await ctr["@"].database.types()
			})
		})
	)
	.http('PATCH', '/', (http) => http
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
									}
								}, required: ['success']
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
								types: {
									type: 'array',
									items: {
										$ref: '#/components/schemas/types'
									}
								}
							}, required: ['types']
						}
					}
				}
			}
		})
		.onRequest(async(ctr) => {
			const data = z.object({
				types: z.string().refine((type) => types.includes(type as 'VANILLA')).array().max(types.length)
			}).safeParse(await ctr.$body().json().catch(() => null))

			if (!data.success) return ctr.status(ctr.$status.BAD_REQUEST).print({ success: false, errors: data.error.errors.map((err) => `${err.path.join('.')}: ${err.message}`) })

			await ctr["@"].database.write.update(ctr["@"].database.schema.organizations)
				.set({ types: data.data.types as 'VANILLA'[] })
				.where(eq(ctr["@"].database.schema.organizations.id, ctr["@"].organization.id))

			return ctr.print({ success: true })
		})
	)