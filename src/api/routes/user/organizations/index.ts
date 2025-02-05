import { userAPIRouter } from "@/api"
import { count, desc, eq, or } from "drizzle-orm"
import { z } from "zod"

function uniqueOrganizations<T extends { id: number }>(organizations: T[]): T[] {
	const ids = new Set(organizations.map((organization) => organization.id))

	const result: T[] = []
	for (const id of ids) {
		result.push(organizations.find((organization) => organization.id === id)!)
	}

	return result
}

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
				verified: ctr["@"].database.schema.organizations.verified,
				public: ctr["@"].database.schema.organizations.public,
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
					owned: uniqueOrganizations(organizations.filter((organization) => organization.owner.id === ctr["@"].user.id)).map((organization) => Object.assign(organization, {
						owner: ctr["@"].database.prepare.user(organization.owner)
					})),

					member: uniqueOrganizations(organizations.filter((organization) => organization.owner.id !== ctr["@"].user.id && !organization.pending)).map((organization) => Object.assign(organization, {
						owner: ctr["@"].database.prepare.user(organization.owner)
					})),

					invites: uniqueOrganizations(organizations.filter((organization) => organization.owner.id !== ctr["@"].user.id && organization.pending)).map((organization) => Object.assign(organization, {
						owner: ctr["@"].database.prepare.user(organization.owner)
					}))
				}
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
								name: { type: 'string', minLength: 3, maxLength: 16 }
							}, required: ['name']
						}
					}
				}
			}
		})
		.onRequest(async(ctr) => {
			const data = z.object({
				name: z.string().min(3).max(16)
			}).safeParse(await ctr.$body().json().catch(() => null))

			if (!data.success) return ctr.status(ctr.$status.BAD_REQUEST).print({ success: false, errors: data.error.errors.map((err) => `${err.path.join('.')}: ${err.message}`) })

			const organizations = await ctr["@"].database.select({
				count: count()
			}).from(ctr["@"].database.schema.organizations)
				.where(eq(ctr["@"].database.schema.organizations.ownerId, ctr["@"].user.id))
				.then((r) => r[0].count)

			if (organizations >= ctr["@"].env.MAX_ORGANIZATIONS_PER_USER) return ctr.status(ctr.$status.FORBIDDEN).print({ success: false, errors: ['You can only own up to 2 organizations currently'] })

			try {
				await ctr["@"].database.write.insert(ctr["@"].database.schema.organizations)
					.values({ name: data.data.name, ownerId: ctr["@"].user.id })

				return ctr.print({ success: true })
			} catch {
				return ctr.status(ctr.$status.CONFLICT).print({ success: false, errors: ['Organization name already taken'] })
			}
		})
	)