import { userAPIRouter } from "@/api"
import { desc, eq, or } from "drizzle-orm"

export = new userAPIRouter.Path('/')
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
									organizations: {
										type: 'object',
										properties: {
											owned: {
												type: 'array',
												items: {
													$ref: '#/components/schemas/organization'
												}
											}, member: {
												type: 'array',
												items: {
													$ref: '#/components/schemas/organization'
												}
											}, invites: {
												type: 'array',
												items: {
													$ref: '#/components/schemas/organization'
												}
											}
										}, required: ['owned', 'member', 'invites']
									}
								}, required: ['success', 'organizations']
							}
						}
					}
				}
			}
		})
		.onRequest(async(ctr) => {
			const organizations = await ctr["@"].database.selectDistinct({
				id: ctr["@"].database.schema.organizations.id,
				name: ctr["@"].database.schema.organizations.name,
				icon: ctr["@"].database.schema.organizations.icon,
				types: ctr["@"].database.schema.organizations.types,
				created: ctr["@"].database.schema.organizations.created,
				owner: ctr["@"].database.schema.users,
				pending: ctr["@"].database.schema.organizationSubusers.pending
			})
				.from(ctr["@"].database.schema.organizations)
				.innerJoin(ctr["@"].database.schema.users, eq(ctr["@"].database.schema.organizations.ownerId, ctr["@"].database.schema.users.id))
				.leftJoin(ctr["@"].database.schema.organizationSubusers, eq(ctr["@"].database.schema.organizations.id, ctr["@"].database.schema.organizationSubusers.organizationId))
				.where(or(
					eq(ctr["@"].database.schema.organizations.ownerId, ctr["@"].user.id),
					eq(ctr["@"].database.schema.organizationSubusers.userId, ctr["@"].user.id)
				))
				.orderBy(desc(ctr["@"].database.schema.organizations.id))

			return ctr.print({
				success: true,
				organizations: {
					owned: organizations.filter((organization) => organization.owner.id === ctr["@"].user.id).map((organization) => Object.assign(organization, {
						owner: ctr["@"].database.prepare.user(organization.owner)
					})),

					member: organizations.filter((organization) => organization.owner.id !== ctr["@"].user.id && !organization.pending).map((organization) => Object.assign(organization, {
						owner: ctr["@"].database.prepare.user(organization.owner)
					})),

					invites: organizations.filter((organization) => organization.owner.id !== ctr["@"].user.id && organization.pending).map((organization) => Object.assign(organization, {
						owner: ctr["@"].database.prepare.user(organization.owner)
					}))
				}
			})
		})
	)