import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3"
import env from "@/globals/env"

const client = new S3Client({
	endpoint: `http${env.S3_SSL ? 's' : ''}://${env.S3_HOST}:${env.S3_PORT}/`,
	region: env.S3_REGION,
	forcePathStyle: true,
	credentials: {
		accessKeyId: env.S3_ACCESS_KEY ?? '',
		secretAccessKey: env.S3_SECRET_KEY ?? ''
	}
})

export default Object.assign(client, {
	async url(file: string, data: string | Buffer, content = 'application/octet-stream'): Promise<string> {
		const command = new PutObjectCommand({
			Bucket: env.S3_BUCKET,
			Key: file,
			Body: data,
			ContentType: content
		})

		await client.send(command)

		return `${env.S3_URL}/${file}`
	}
})