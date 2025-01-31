import { userAPIRouter, userOrganizationValidator } from "@/api"
import { time } from "@rjweb/utils"
import { and, count, eq, ilike } from "drizzle-orm"
import { z } from "zod"

export = new userAPIRouter.Path('/')
	.validate(userOrganizationValidator.use({}))
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
									success: { type: 'boolean', const: true },
									users: {
										type: 'array',
										items: {
											type: 'object',
											properties: {
												user: {
													$ref: '#/components/schemas/user'
												}, pending: {
													type: 'boolean'
												}, created: {
													type: 'string',
													format: 'date-time'
												}
											}, required: ['user', 'pending', 'created']
										}
									}
								}, required: ['success', 'users']
							}
						}
					}
				}
			}
		})
		.onRequest(async(ctr) => {
			const users = await ctr["@"].database.select({
				user: ctr["@"].database.schema.users,
				pending: ctr["@"].database.schema.organizationSubusers.pending,
				created: ctr["@"].database.schema.organizationSubusers.created
			})
				.from(ctr["@"].database.schema.organizationSubusers)
				.where(eq(ctr["@"].database.schema.organizationSubusers.organizationId, ctr["@"].organization.id))
				.innerJoin(ctr["@"].database.schema.users, eq(ctr["@"].database.schema.organizationSubusers.userId, ctr["@"].database.schema.users.id))

			return ctr.print({
				success: true,
				users: users.map((user) => Object.assign(user, { user: ctr["@"].database.prepare.user(user.user, user.pending) }))
			})
		})
	)
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
									success: { type: 'boolean', const: true }
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
								login: { type: 'string' }
							}, required: ['login']
						}
					}
				}
			}
		})
		.onRequest(async(ctr) => {
			if (ctr["@"].organization.ownerId !== ctr["@"].user.id) return ctr.status(ctr.$status.FORBIDDEN).print({ success: false, errors: ['You do not have permission to add subusers'] })

			const data = z.object({
				login: z.string().max(255)
			}).safeParse(await ctr.$body().json().catch(() => null))

			if (!data.success) return ctr.status(ctr.$status.BAD_REQUEST).print({ success: false, errors: data.error.errors.map((err) => `${err.path.join('.')}: ${err.message}`) })

			const subusers = await ctr["@"].database.select({
				count: count()
			})
				.from(ctr["@"].database.schema.organizationSubusers)
				.where(eq(ctr["@"].database.schema.organizationSubusers.organizationId, ctr["@"].organization.id))
				.then((r) => r[0]?.count)

			if (subusers >= 15) return ctr.status(ctr.$status.BAD_REQUEST).print({ success: false, errors: ['You have reached the maximum number of subusers'] })

			const userId = await ctr["@"].cache.use(`user::${data.data.login}`, () => ctr["@"].database.select({
					id: ctr["@"].database.schema.users.id
				})
					.from(ctr["@"].database.schema.users)
					.where(ilike(ctr["@"].database.schema.users.login, data.data.login.replace(/%|_/g, (r) => `\\${r}`)))
					.then((r) => r[0]?.id),
				time(1).h()
			)

			if (!userId) return ctr.status(ctr.$status.BAD_REQUEST).print({ success: false, errors: ['User not found'] })
			if (userId === ctr["@"].user.id) return ctr.status(ctr.$status.BAD_REQUEST).print({ success: false, errors: ['Cannot add yourself as a subuser'] })
			if (userId === ctr["@"].organization.ownerId) return ctr.status(ctr.$status.BAD_REQUEST).print({ success: false, errors: ['Cannot add the owner as a subuser'] })

			try {
				await ctr["@"].database.write.insert(ctr["@"].database.schema.organizationSubusers)
					.values({
						organizationId: ctr["@"].organization.id,
						userId
					})

				return ctr.print({ success: true })
			} catch {
				return ctr.status(ctr.$status.BAD_REQUEST).print({ success: false, errors: ['User is already a subuser'] })
			}
		})
	)
	.http('DELETE', '/{subuser}', (http) => http
		.document({
			responses: {
				200: {
					description: 'Success',
					content: {
						'application/json': {
							schema: {
								type: 'object',
								properties: {
									success: { type: 'boolean', const: true }
								}, required: ['success']
							}
						}
					}
				}
			}, parameters: [
				{
					name: 'subuser',
					in: 'path',
					required: true,
					schema: {
						type: 'string'
					}
				}
			]
		})
		.onRequest(async(ctr) => {
			const userId = await ctr["@"].cache.use(`user::${ctr.params.get('subuser', '')}`, () => ctr["@"].database.select({
					id: ctr["@"].database.schema.users.id
				})
					.from(ctr["@"].database.schema.users)
					.where(ilike(ctr["@"].database.schema.users.login, ctr.params.get('subuser', '').replace(/%|_/g, (r) => `\\${r}`)))
					.then((r) => r[0]?.id),
				time(1).h()
			)

			if (ctr["@"].organization.ownerId !== ctr["@"].user.id && userId !== ctr["@"].user.id) return ctr.status(ctr.$status.FORBIDDEN).print({ success: false, errors: ['You do not have permission to remove subusers'] })

			try {
				const count = await ctr["@"].database.write.delete(ctr["@"].database.schema.organizationSubusers)
					.where(and(
						eq(ctr["@"].database.schema.organizationSubusers.organizationId, ctr["@"].organization.id),
						eq(ctr["@"].database.schema.organizationSubusers.userId, userId)
					))
					.returning({
						id: ctr["@"].database.schema.organizationSubusers.userId
					})

				if (!count.length) return ctr.status(ctr.$status.BAD_REQUEST).print({ success: false, errors: ['User not found'] })

				return ctr.print({ success: true })
			} catch {
				return ctr.status(ctr.$status.BAD_REQUEST).print({ success: false, errors: ['User is not a subuser'] })
			}
		})
	)