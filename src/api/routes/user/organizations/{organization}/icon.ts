import { userAPIRouter, userOrganizationValidator } from "@/api"
import { DeleteObjectCommand } from "@aws-sdk/client-s3"
import { string } from "@rjweb/utils"
import { eq } from "drizzle-orm"
import sharp from "sharp"

export = new userAPIRouter.Path('/')
	.validate(userOrganizationValidator.use({}))
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
									success: { type: 'boolean', const: true },
									url: { type: 'string', format: 'uri' }
								}, required: ['success', 'url']
							}
						}
					}
				}
			}, requestBody: {
				content: {
					'image/png': {
						schema: {
							type: 'string',
							format: 'binary'
						}
					}, 'image/jpeg': {
						schema: {
							type: 'string',
							format: 'binary'
						}
					}, 'image/webp': {
						schema: {
							type: 'string',
							format: 'binary'
						}
					}, 'image/gif': {
						schema: {
							type: 'string',
							format: 'binary'
						}
					}, 'image/svg+xml': {
						schema: {
							type: 'string',
							format: 'binary'
						}
					}, 'image/tiff': {
						schema: {
							type: 'string',
							format: 'binary'
						}
					}
				}
			}
		})
		.onRequest(async(ctr) => {
			try {
				const image = await sharp(await ctr.$body().arrayBuffer()).resize(512, 512, { fit: 'cover' }).webp().toBuffer(),
					url = await ctr["@"].s3.url(`organization-icons/${ctr["@"].organization.id}-${string.generateSegments([5, 6, 4])}.webp`, image, 'image/webp')

				if (ctr["@"].organization.icon && ctr["@"].env.S3_URL && ctr["@"].organization.icon.startsWith(ctr["@"].env.S3_URL)) {
					await ctr["@"].s3.send(new DeleteObjectCommand({
						Bucket: ctr["@"].env.S3_BUCKET,
						Key: ctr["@"].organization.icon.slice(ctr["@"].env.S3_URL.length + 1)
					})).catch(() => null)
				}

				await ctr["@"].database.write.update(ctr["@"].database.schema.organizations)
					.set({ icon: url })
					.where(eq(ctr["@"].database.schema.organizations.id, ctr["@"].organization.id))
					.execute()

				ctr["@"].organization.icon = url
				await ctr["@"].cache.set(`organization::${ctr["@"].organization.id}`, JSON.stringify(ctr["@"].organization))

				return ctr.print({ success: true, url })
			} catch {
				return ctr.status(ctr.$status.BAD_REQUEST).print({ success: false, errors: ['Invalid image'] })
			}
		})
	)