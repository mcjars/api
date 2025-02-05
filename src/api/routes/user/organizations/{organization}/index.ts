import { userAPIRouter, userOrganizationValidator } from "@/api"
import { types } from "@/schema"
import { DeleteObjectCommand } from "@aws-sdk/client-s3"
import { time } from "@rjweb/utils"
import { count, eq, ilike } from "drizzle-orm"
import { z } from "zod"

export = new userAPIRouter.Path('/')
	.validate(userOrganizationValidator.use({}))
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
								name: { type: 'string', minLength: 3, maxLength: 16 },
								types: {
									type: 'array',
									items: {
										$ref: '#/components/schemas/types'
									}
								}, owner: { type: 'string' },
								public: { type: 'boolean' }
							}
						}
					}
				}
			}
		})
		.onRequest(async(ctr) => {
			const data = z.object({
				name: z.string().min(3).max(16).optional(),
				types: z.string().refine((type) => types.includes(type as 'VANILLA')).array().max(types.length).optional(),
				owner: z.string().optional(),
				public: z.boolean().optional()
			}).safeParse(await ctr.$body().json().catch(() => null))

			if (!data.success) return ctr.status(ctr.$status.BAD_REQUEST).print({ success: false, errors: data.error.errors.map((err) => `${err.path.join('.')}: ${err.message}`) })

			let ownerId = ctr["@"].organization.ownerId

			if (data.data.owner) {
				if (ctr["@"].organization.ownerId !== ctr["@"].user.id) return ctr.status(ctr.$status.FORBIDDEN).print({ success: false, errors: ['You do not have permission to change the owner'] })

				const userId = await ctr["@"].cache.use(`user::${data.data.owner}`, () => ctr["@"].database.select({
						id: ctr["@"].database.schema.users.id
					})
						.from(ctr["@"].database.schema.users)
						.where(ilike(ctr["@"].database.schema.users.login, data.data.owner!.replace(/%|_/g, (r) => `\\${r}`)))
						.then((r) => r[0]?.id),
					time(1).h()
				)

				if (!userId) return ctr.status(ctr.$status.BAD_REQUEST).print({ success: false, errors: ['User not found'] })

				const organizations = await ctr["@"].database.select({
					count: count()
				}).from(ctr["@"].database.schema.organizations)
					.where(eq(ctr["@"].database.schema.organizations.ownerId, userId))
					.then((r) => r[0].count)

				if (organizations >= ctr["@"].env.MAX_ORGANIZATIONS_PER_USER) return ctr.status(ctr.$status.FORBIDDEN).print({ success: false, errors: ['User can only own up to 2 organizations currently'] })

				ownerId = userId
			}

			try {
				await ctr["@"].database.write.update(ctr["@"].database.schema.organizations)
					.set({ name: data.data.name, types: data.data.types as 'VANILLA'[], public: data.data.public, ownerId })
					.where(eq(ctr["@"].database.schema.organizations.id, ctr["@"].organization.id))

				await ctr["@"].cache.del(`organization::${ctr["@"].organization.id}`)

				return ctr.print({ success: true })
			} catch {
				return ctr.status(ctr.$status.CONFLICT).print({ success: false, errors: ['Organization name already taken'] })
			}
		})
	)
	.http('DELETE', '/', (http) => http
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
			}
		})
		.onRequest(async(ctr) => {
			if (ctr["@"].organization.ownerId !== ctr["@"].user.id) return ctr.status(ctr.$status.FORBIDDEN).print({ success: false, errors: ['You do not have permission to delete this organization'] })
			if (ctr["@"].organization.verified) return ctr.status(ctr.$status.FORBIDDEN).print({ success: false, errors: ['You cannot delete a verified organization, contact support'] })

			if (ctr["@"].organization.icon && ctr["@"].env.S3_URL && ctr["@"].organization.icon.startsWith(ctr["@"].env.S3_URL)) {
				await ctr["@"].s3.send(new DeleteObjectCommand({
					Bucket: ctr["@"].env.S3_BUCKET,
					Key: ctr["@"].organization.icon.slice(ctr["@"].env.S3_URL.length + 1)
				})).catch(() => null)
			}

			await ctr["@"].database.write.delete(ctr["@"].database.schema.organizations)
				.where(eq(ctr["@"].database.schema.organizations.id, ctr["@"].organization.id))

			await ctr["@"].cache.del(`organization::${ctr["@"].organization.id}`)

			return ctr.print({ success: true })
		})
	)