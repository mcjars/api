import { globalAPIRouter } from "@/api"
import { object } from "@rjweb/utils"

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
									}, types: {
										type: 'object',
										properties: {
											recommended: {
												type: 'object',
												additionalProperties: {
													$ref: '#/components/schemas/typeInformation'
												}
											}, established: {
												type: 'object',
												additionalProperties: {
													$ref: '#/components/schemas/typeInformation'
												}
											}, experimental: {
												type: 'object',
												additionalProperties: {
													$ref: '#/components/schemas/typeInformation'
												}
											}, miscellaneous: {
												type: 'object',
												additionalProperties: {
													$ref: '#/components/schemas/typeInformation'
												}
											}, limbos: {
												type: 'object',
												additionalProperties: {
													$ref: '#/components/schemas/typeInformation'
												}
											}
										}, required: ['recommended', 'established', 'experimental', 'miscellaneous', 'limbos']
									}
								}, required: ['success', 'types']
							}
						}
					}
				}
			}
		})
		.onRequest(async(ctr) => {
			const types = await ctr["@"].database.types()

			return ctr.print({
				success: true,
				types: {
					recommended: object.pick(types, ['VANILLA', 'PAPER', 'FABRIC', 'FORGE', 'NEOFORGE', 'VELOCITY']),
					established: object.pick(types, ['PURPUR', 'PUFFERFISH', 'SPONGE', 'SPIGOT', 'BUNGEECORD', 'WATERFALL']),
					experimental: object.pick(types, ['FOLIA', 'QUILT', 'CANVAS']),
					miscellaneous: object.pick(types, ['ARCLIGHT', 'MOHIST', 'LEAVES', 'ASPAPER', 'LEGACY_FABRIC']),
					limbos: object.pick(types, ['LOOHP_LIMBO', 'NANOLIMBO'])
				}
			})
		})
	)