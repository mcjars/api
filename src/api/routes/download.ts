import { server } from "@/api"
import { time } from "@rjweb/utils"

const blacklistedHeaders = [
	'content-encoding',
	'transfer-encoding',
	'connection'
]

server.path('/download', (path) => path
	.httpRatelimit((limit) => limit
		.hits(5)
		.window(time(10).s())
	)
	.http('GET', '/fabric/{version}/{projectVersion}/{installerVersion}', (http) => http
		.onRequest(async(ctr) => {
			const version = ctr.params.get('version', ''),
				projectVersion = ctr.params.get('projectVersion', ''),
				installerVersion = ctr.params.get('installerVersion', '').replace('.jar', '')

			const response = await fetch(`https://meta.fabricmc.net/v2/versions/loader/${version}/${projectVersion}/${installerVersion}/server/jar`).catch(() => null)
			if (!response?.ok) return ctr.status(ctr.$status.NOT_FOUND).print({ success: false, errors: ['Build not found'] })

			response.headers.forEach((value, key) => blacklistedHeaders.includes(key) || ctr.headers.set(key, value))

			return ctr.status(response.status).print(await response.arrayBuffer())
		})
	)
	.http('GET', '/legacy-fabric/{version}/{projectVersion}/{installerVersion}', (http) => http
		.onRequest(async(ctr) => {
			const version = ctr.params.get('version', ''),
				projectVersion = ctr.params.get('projectVersion', ''),
				installerVersion = ctr.params.get('installerVersion', '').replace('.jar', '')

			const response = await fetch(`https://meta.legacyfabric.net/v2/versions/loader/${version}/${projectVersion}/${installerVersion}/server/jar`).catch(() => null)
			if (!response?.ok) return ctr.status(ctr.$status.NOT_FOUND).print({ success: false, errors: ['Build not found'] })

			response.headers.forEach((value, key) => blacklistedHeaders.includes(key) || ctr.headers.set(key, value))

			return ctr.status(response.status).print(await response.arrayBuffer())
		})
	)
)