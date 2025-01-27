import { server } from '@/api'
import { types } from '@/schema'

server.schema('types', {
	type: 'string',
	enum: Array.from(types)
})

server.schema('typeInformation', {
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
})

server.schema('build', {
  type: 'object',
  properties: {
    id: {
      type: 'integer',
    }, type: {
      $ref: '#/components/schemas/types',
    }, projectVersionId: {
      oneOf: [
        { type: 'string' },
        { type: 'null' }
      ]
    }, versionId: {
      oneOf: [
        { type: 'string' },
        { type: 'null' }
      ]
    }, buildNumber: {
      type: 'integer',
    }, name: {
      type: 'string',
      description: 'The name of the build, usually the build number with a prefixed #.'
    }, experimental: {
      type: 'boolean',
    }, created: {
      oneOf: [
        { type: 'string', format: 'date-time' },
        { type: 'null' }
      ]
    }, jarUrl: {
      description: 'The URL to download the jar file from.',
      oneOf: [
        { type: 'string' },
        { type: 'null' }
      ]
    }, jarSize: {
      oneOf: [
				{ type: 'integer' },
				{ type: 'null' }
			]
    }, jarLocation: {
      description: 'What to name the jar file when downloaded. If null, use server.jar.',
      example: 'minecraft.jar',
      oneOf: [
        { type: 'string' },
				{ type: 'null' }
			]
    }, zipUrl: {
      description: 'The URL to download the zip file from, If provided, extract into the server root.',
      oneOf: [
        { type: 'string' },
				{ type: 'null' }
      ]
    }, zipSize: {
      oneOf: [
        { type: 'integer' },
				{ type: 'null' }
			]
    }, changes: {
      type: 'array',
      items: {
        type: 'string'
      }
    }, installation: {
      type: 'array',
      items: {
        type: 'array',
        items: {
          $ref: '#/components/schemas/installationStep'
        }
      }
    }
  }, required: [
    'id',
    'type',
    'projectVersionId',
    'versionId',
    'buildNumber',
    'experimental',
    'created',
    'jarUrl',
    'jarSize',
    'jarLocation',
    'zipUrl',
    'zipSize',
    'changes',
  ]
})

server.schema('installationStep', {
	oneOf: [
		{
			type: 'object',
			properties: {
				type: {
					type: 'string',
					const: 'download'
				}, file: {
					type: 'string'
				}, url: {
					type: 'string'
				}, size: {
					'type': 'integer'
				}
			}, required: [
				'type',
				'optional',
				'file',
				'url',
				'size'
			]
		},
		{
			type: 'object',
			properties: {
				type: {
					type: 'string',
					const: 'unzip'
				}, file: {
					type: 'string'
				}, location: {
					type: 'string'
				}
			}, required: [
				'type',
				'optional',
				'file',
				'location'
			]
		},
		{
			type: 'object',
			properties: {
				type: {
					type: 'string',
					const: 'remove'
				},
				location: {
					type: 'string',
					enum: [
						'libraries',
						'mcvapi.server.jar.zip'
					]
				}
			}, required: [
				'type',
				'optional',
				'location'
			]
		}
	]
})

server.schema('version', {
	type: 'object',
	properties: {
		type: {
			type: 'string',
			enum: [
				'RELEASE',
				'SNAPSHOT'
			]
		}, supported: {
			type: 'boolean'
		}, java: {
			type: 'integer'
		}, created: {
			type: 'string',
			format: 'date-time'
		}, builds: {
			type: 'integer'
		}, latest: {
			$ref: '#/components/schemas/build'
		}
	}, required: [
		'type',
		'supported',
		'java',
		'created',
		'builds',
		'latest'
	]
})

server.schema('minifiedVersion', {
	type: 'object',
	properties: {
		type: {
			type: 'string',
			enum: [
				'RELEASE',
				'SNAPSHOT'
			]
		}, supported: {
			type: 'boolean'
		}, java: {
			type: 'integer'
		}, created: {
			type: 'string',
			format: 'date-time'
		}, builds: {
			type: 'integer'
		}
	}, required: [
		'type',
		'supported',
		'java',
		'created',
		'builds'
	]
})

server.schema('buildSearch', {
	type: 'object',
	properties: {
		type: {
			$ref: '#/components/schemas/types',
		}, versionId: {
			type: 'string'
		}, projectVersionId: {
			oneOf: [
				{ type: 'string' },
				{ type: 'null' }
			]
		}, buildNumber: {
			type: 'integer'
		}, hash: {
			type: 'object',
			properties: {
				primary: {
					type: 'boolean'
				}, sha1: {
					type: 'string'
				}, sha224: {
					type: 'string'
				}, sha256: {
					type: 'string'
				}, sha384: {
					type: 'string'
				}, sha512: {
					type: 'string'
				}, md5: {
					type: 'string'
				}
			}
		}, jarUrl: {
			oneOf: [
				{ type: 'string' },
				{ type: 'null' }
			]
		}, jarSize: {
			oneOf: [
				{ type: 'integer' },
				{ type: 'null' }
			]
		}, zipUrl: {
			oneOf: [
				{ type: 'string' },
				{ type: 'null' }
			]
		}, zipSize: {
			oneOf: [
				{ type: 'integer' },
				{ type: 'null' }
			]
		}
	}
})

server.schema('error', {
	type: 'object',
	properties: {
		success: {
			type: 'boolean',
			const: false
		}, errors: {
			type: 'array',
			items: {
				type: 'string'
			}
		}
	}, required: [
		'success',
		'errors'
	]
})

server.schema('user', {
	type: 'object',
	properties: {
		id: {
			type: 'integer'
		}, name: {
			oneOf: [
				{ type: 'string' },
				{ type: 'null' }
			]
		}, email: {
			type: 'string'
		}, login: {
			type: 'string'
		}, avatar: {
			type: 'string'
		}, admin: {
			type: 'boolean'
		}
	}, required: ['id', 'name', 'email', 'login', 'avatar', 'admin']
})

server.schema('organization', {
	type: 'object',
	properties: {
		id: {
			type: 'number'
		}, name: {
			type: 'string'
		}, icon: {
			oneOf: [
				{ type: 'string' },
				{ type: 'null' }
			]
		}, types: {
			type: 'array',
			items: {
				$ref: '#/components/schemas/types'
			}
		}, verified: {
			type: 'boolean'
		}, public: {
			type: 'boolean'
		}, created: {
			type: 'string',
			format: 'date-time'
		}, owner: {
			$ref: '#/components/schemas/user'
		}
	}, required: ['id', 'name', 'types', 'verified', 'public', 'created', 'owner']
})