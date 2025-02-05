import { globalAPIRouter } from "@/api"
import { object } from "@rjweb/utils"

export = new globalAPIRouter.Path('/')
	.http('GET', '/', (http) => http
		.document({
			deprecated: true,
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
											$ref: '#/components/schemas/typeInformation'
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
				types: object.pick(await ctr["@"].database.types(), ctr["@"].database.establishedTypes)
			})
		})
	)