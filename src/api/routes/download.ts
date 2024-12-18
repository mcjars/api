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
	.http('GET', '/arclight/{branch}/{version}/{type}', (http) => http
		.onRequest(async(ctr) => {
			const branch = ctr.params.get('branch', ''),
				version = ctr.params.get('version', ''),
				type = ctr.params.get('type', '').replace('.jar', '')

			const response = await fetch(`https://files.hypertention.cn/v1/files/arclight/branches/${branch}/versions-snapshot/${version}/${type}`).catch(() => null)
			if (!response?.ok) return ctr.status(ctr.$status.NOT_FOUND).print({ success: false, errors: ['Build not found'] })

			response.headers.forEach((value, key) => blacklistedHeaders.includes(key) || ctr.headers.set(key, value))

			return ctr.status(response.status).print(await response.arrayBuffer())
		})
	)
	.http('GET', '/leaves/{version}/{build}/{file}', (http) => http
		.onRequest(async(ctr) => {
			const version = ctr.params.get('version', ''),
				build = ctr.params.get('build', ''),
				file = ctr.params.get('file', '')

			const response = await fetch(`https://api.leavesmc.org/v2/projects/leaves/versions/${version}/builds/${build}/downloads/${file}`).catch(() => null)
			if (!response?.ok) return ctr.status(ctr.$status.NOT_FOUND).print({ success: false, errors: ['Build not found'] })

			response.headers.forEach((value, key) => blacklistedHeaders.includes(key) || ctr.headers.set(key, value))

			return ctr.status(response.status).print(await response.arrayBuffer())
		})
	)
	.http('GET', '/canvas/{build}/{file}', (http) => http
		.onRequest(async(ctr) => {
			const build = ctr.params.get('build', ''),
				file = ctr.params.get('file', '')

			const response = await fetch(`https://github.com/CraftCanvasMC/Canvas/releases/download/${build}/${file}`).catch(() => null)
			if (!response?.ok) return ctr.status(ctr.$status.NOT_FOUND).print({ success: false, errors: ['Build not found'] })

			response.headers.forEach((value, key) => blacklistedHeaders.includes(key) || ctr.headers.set(key, value))

			return ctr.status(response.status).print(await response.arrayBuffer())
		})
	)
)