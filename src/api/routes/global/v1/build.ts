import { globalAPIRouter } from "@/api"
import { ReturnRow } from "@/globals/database"
import { time } from "@rjweb/utils"
import { sql } from "drizzle-orm"

export = new globalAPIRouter.Path('/')
	.http('GET', '/{build}', (http) => http
		.document({
			parameters: [
				{
					name: 'build',
					in: 'path',
					description: 'The build number or hash to lookup',
					required: true,
					example: 'b1f3eeac53355d9ba5cf19e36abe8b2a30278c0e60942f3d07ac9ac9e4564951',
					schema: {
						type: 'string'
					}
				}
			], responses: {
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
									}, build: {
										$ref: '#/components/schemas/build'
									}, latest: {
										$ref: '#/components/schemas/build'
									}, version: {
										$ref: '#/components/schemas/minifiedVersion'
									}
								}, required: [
									'success',
									'build',
									'latest',
									'version'
								]
							}
						}
					}
				}, 404: {
					description: 'Not Found',
					content: {
						'application/json': {
							schema: {
								$ref: '#/components/schemas/error'
							}
						}
					}
				}
			}
		})
		.onRequest(async(ctr) => {
			const buildParam = ctr.params.get('build', '')

			const { rows: [ build, latest ] } = await ctr["@"].cache.use(`build::${buildParam}`, async() => {
				const int = isNaN(parseInt(buildParam)) ? -1 : parseInt(buildParam),
					hashType = buildParam.length === 40 ? 'sha1'
						: buildParam.length === 56 ? 'sha224'
						: buildParam.length === 64 ? 'sha256'
						: buildParam.length === 96 ? 'sha384'
						: buildParam.length === 128 ? 'sha512'
						: buildParam.length === 32 ? 'md5'
						: null
		
				return ctr["@"].database.execute<ReturnRow>(sql`
					WITH spec_build AS (
						SELECT builds.*
						FROM ${hashType
								? sql`build_hashes INNER JOIN builds ON builds.id = build_hashes.build_id WHERE ${sql.identifier(hashType)} = ${buildParam}`
								: sql`builds WHERE id = ${int}`
						} LIMIT 1
					)
	
					, filtered_builds AS (
						SELECT b.*
						FROM builds b
						INNER JOIN spec_build sb
							ON sb.id = b.id 
							OR (COALESCE(sb.version_id, sb.project_version_id) = COALESCE(b.version_id, b.project_version_id) AND sb.type = b.type)
						WHERE b.type != 'ARCLIGHT' OR (
							(sb.project_version_id LIKE '%-fabric' AND b.project_version_id LIKE '%-fabric')
							OR (sb.project_version_id LIKE '%-forge' AND b.project_version_id LIKE '%-forge')
							OR (sb.project_version_id LIKE '%-neoforge' AND b.project_version_id LIKE '%-neoforge')
							OR (sb.project_version_id NOT LIKE '%-fabric' AND sb.project_version_id NOT LIKE '%-forge' AND sb.project_version_id NOT LIKE '%-neoforge')
						)
					)
	
					SELECT *, 0 AS build_count, now()::timestamp as version2_created, '' AS _version_id, 'RELEASE' AS version_type, false AS version_supported, 0 AS version_java, now() AS version_created
					FROM spec_build

					UNION ALL

					SELECT x.*, mv.*
					FROM (
						SELECT *
						FROM (
							SELECT b.*, count(1) OVER () AS build_count, min(b.created) OVER () AS version2_created
							FROM filtered_builds b
							ORDER BY b.id DESC
						) LIMIT 1
					) x
					LEFT JOIN minecraft_versions mv ON mv.id = x.version_id;
				`)
			}, time(30).m())

			if (!build || !latest) return ctr.status(ctr.$status.NOT_FOUND).print({ success: false, errors: ['Build not found'] })

			ctr["@"].data.type = 'lookup'
			ctr["@"].data.build = {
				id: build.id,
				type: build.type,
				versionId: build.version_id,
				projectVersionId: build.project_version_id,
				buildNumber: build.build_number,
				java: latest.version_java
			}

			return ctr.print({
				success: true,
				build: ctr["@"].database.prepare.rawBuild(build),
				latest: ctr["@"].database.prepare.rawBuild(latest),
				version: {
					id: latest.version_id || latest.project_version_id,
					type: latest.version_type ?? 'RELEASE',
					java: latest.version_java ?? 21,
					supported: latest.version_supported ?? true,
					created: latest.version_created ? new Date(latest.version_created) : new Date(latest.version2_created),
					builds: parseInt(latest.build_count)
				}
			})
		})
	)