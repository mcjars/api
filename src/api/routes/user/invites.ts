import { userAPIRouter } from "@/api"
import { time } from "@rjweb/utils"
import { and, eq } from "drizzle-orm"

export = new userAPIRouter.Path('/')
	.document({
		parameters: [
			{
				name: 'organization',
				in: 'path',
				required: true,
				schema: {
					type: 'integer'
				}
			}
		]
	})
	.http('POST', '/{organization}/accept', (http) => http
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
			const organizationId = parseInt(ctr.params.get('organization', ''))
			if (isNaN(organizationId) || organizationId < 1) return ctr.status(ctr.$status.BAD_REQUEST).print({ success: false, errors: ['Invalid organization'] })

			const organization = await ctr["@"].cache.use(`organization::${organizationId}`, () => ctr["@"].database.select({
					id: ctr["@"].database.schema.organizations.id,
					name: ctr["@"].database.schema.organizations.name,
					icon: ctr["@"].database.schema.organizations.icon,
					types: ctr["@"].database.schema.organizations.types,
					ownerId: ctr["@"].database.schema.organizations.ownerId,
					created: ctr["@"].database.schema.organizations.created
				})
					.from(ctr["@"].database.schema.organizations)
					.innerJoin(ctr["@"].database.schema.users, eq(ctr["@"].database.schema.organizations.ownerId, ctr["@"].database.schema.users.id))
					.leftJoin(ctr["@"].database.schema.organizationSubusers, and(
						eq(ctr["@"].database.schema.organizations.id, ctr["@"].database.schema.organizationSubusers.organizationId),
						eq(ctr["@"].database.schema.organizationSubusers.pending, true)
					))
					.where(and(
						eq(ctr["@"].database.schema.organizationSubusers.userId, ctr["@"].user.id),
						eq(ctr["@"].database.schema.organizations.id, organizationId)
					))
					.limit(1)
					.then((r) => r[0]),
				time(5).m()
			)

			if (!organization) return ctr.status(ctr.$status.BAD_REQUEST).print({ success: false, errors: ['Invalid organization'] })

			await ctr["@"].database.write.update(ctr["@"].database.schema.organizationSubusers)
				.set({ pending: false })
				.where(and(
					eq(ctr["@"].database.schema.organizationSubusers.organizationId, organizationId),
					eq(ctr["@"].database.schema.organizationSubusers.userId, ctr["@"].user.id)
				))

			return ctr.print({ success: true })
		})
	)
	.http('POST', '/{organization}/decline', (http) => http
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
			const organizationId = parseInt(ctr.params.get('organization', ''))
			if (isNaN(organizationId) || organizationId < 1) return ctr.status(ctr.$status.BAD_REQUEST).print({ success: false, errors: ['Invalid organization'] })

			const organization = await ctr["@"].cache.use(`organization::${organizationId}`, () => ctr["@"].database.select({
					id: ctr["@"].database.schema.organizations.id,
					name: ctr["@"].database.schema.organizations.name,
					icon: ctr["@"].database.schema.organizations.icon,
					types: ctr["@"].database.schema.organizations.types,
					ownerId: ctr["@"].database.schema.organizations.ownerId,
					created: ctr["@"].database.schema.organizations.created
				})
					.from(ctr["@"].database.schema.organizations)
					.innerJoin(ctr["@"].database.schema.users, eq(ctr["@"].database.schema.organizations.ownerId, ctr["@"].database.schema.users.id))
					.leftJoin(ctr["@"].database.schema.organizationSubusers, and(
						eq(ctr["@"].database.schema.organizations.id, ctr["@"].database.schema.organizationSubusers.organizationId),
						eq(ctr["@"].database.schema.organizationSubusers.pending, true)
					))
					.where(and(
						eq(ctr["@"].database.schema.organizationSubusers.userId, ctr["@"].user.id),
						eq(ctr["@"].database.schema.organizations.id, organizationId)
					))
					.limit(1)
					.then((r) => r[0]),
				time(5).m()
			)

			if (!organization) return ctr.status(ctr.$status.BAD_REQUEST).print({ success: false, errors: ['Invalid organization'] })

			await ctr["@"].database.write.delete(ctr["@"].database.schema.organizationSubusers)
				.where(and(
					eq(ctr["@"].database.schema.organizationSubusers.organizationId, organizationId),
					eq(ctr["@"].database.schema.organizationSubusers.userId, ctr["@"].user.id)
				))

			return ctr.print({ success: true })
		})
	)