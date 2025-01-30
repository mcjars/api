import { globalAPIRouter } from "@/api"
import database, { configs } from "@/globals/database"

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
									}, configs: {
										type: 'object',
										additionalProperties: {
											type: 'object',
											properties: {
												type: {
													$ref: '#/components/schemas/types'
												}, format: {
													type: 'string',
													enum: database.schema.formats
												}
											}, required: ['type', 'format']
										}
									}
								}, required: ['success', 'configs']
							}
						}
					}
				}
			}
		})
		.onRequest((ctr) => {
			return ctr.print({
				success: true,
				configs
			})
		})
	)