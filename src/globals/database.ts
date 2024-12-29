import { drizzle } from "drizzle-orm/node-postgres"
import * as schema from "@/schema"
import { time } from "@rjweb/utils"
import { and, asc, count, countDistinct, eq, max, min, sql } from "drizzle-orm"
import env from "@/globals/env"
import cache from "@/globals/cache"
import yaml from "js-yaml"
import logger from "@/globals/logger"
import { Pool } from "pg"

export type ReturnRow = RawBuild & {
	build_count: string
	version_type: string | null
	version_java: string | null
	version_supported: boolean | null
	version_created: string | null
	version2_created: string
}

const compatibility = [
	'spigot', 'paper', 'folia', 'purpur',
	'fabric', 'forge', 'neoforge', 'bungeecord',
	'velocity', 'quilt', 'sponge'
] as const

const extraTypeInfos: Record<schema.ServerType, {
	name: string
	color: string
	homepage: string
	deprecated: boolean
	experimental: boolean
	description: string
	categories: ('modded' | 'plugins' | 'proxy')[]
	compatibility: typeof compatibility[number][]
}> = {
	VANILLA: {
		name: 'Vanilla',
		color: '#3B2A22',
		homepage: 'https://minecraft.net/en-us/download/server',
		deprecated: false,
		experimental: false,
		description: 'The official Minecraft server software.',
		categories: [],
		compatibility: []
	}, PAPER: {
		name: 'Paper',
		color: '#444444',
		homepage: 'https://papermc.io/software/paper',
		deprecated: false,
		experimental: false,
		description: 'A high performance fork of the Spigot Minecraft Server.',
		categories: ['plugins'],
		compatibility: ['spigot', 'paper']
	}, PUFFERFISH: {
		name: 'Pufferfish',
		color: '#FFA647',
		homepage: 'https://pufferfish.host/downloads',
		deprecated: false,
		experimental: false,
		description: 'A fork of Paper that aims to be even more performant.',
		categories: ['plugins'],
		compatibility: ['spigot', 'paper']
	}, SPIGOT: {
		name: 'Spigot',
		color: '#F7CF0D',
		homepage: 'https://www.spigotmc.org',
		deprecated: false,
		experimental: false,
		description: 'A high performance fork of the Bukkit Minecraft Server.',
		categories: ['plugins'],
		compatibility: ['spigot']
	}, FOLIA: {
		name: 'Folia',
		color: '#3CC5D2',
		homepage: 'https://papermc.io/software/folia',
		deprecated: false,
		experimental: true,
		description: 'A fork of Paper that uses regional multithreading for high player counts.',
		categories: ['plugins'],
		compatibility: ['folia']
	}, PURPUR: {
		name: 'Purpur',
		color: '#C92BFF',
		homepage: 'https://purpurmc.org',
		deprecated: false,
		experimental: false,
		description: 'A fork of Paper that aims to be more feature rich, adding patches from pufferfish too.',
		categories: ['plugins'],
		compatibility: ['spigot', 'paper', 'purpur']
	}, WATERFALL: {
		name: 'Waterfall',
		color: '#193CB2',
		homepage: 'https://papermc.io/software/waterfall',
		deprecated: true,
		experimental: false,
		description: 'A fork of BungeeCord that aims to be more performant.',
		categories: ['plugins', 'proxy'],
		compatibility: ['bungeecord']
	}, VELOCITY: {
		name: 'Velocity',
		color: '#1BBAE0',
		homepage: 'https://papermc.io/software/velocity',
		deprecated: false,
		experimental: false,
		description: 'A modern, high performance, extensible proxy server alternative for waterfall.',
		categories: ['plugins', 'proxy'],
		compatibility: ['velocity']
	}, FABRIC: {
		name: 'Fabric',
		color: '#C6BBA5',
		homepage: 'https://fabricmc.net',
		deprecated: false,
		experimental: false,
		description: 'A lightweight and modular Minecraft server software.',
		categories: ['modded'],
		compatibility: ['fabric']
	}, BUNGEECORD: {
		name: 'BungeeCord',
		color: '#D4B451',
		homepage: 'https://www.spigotmc.org/wiki/bungeecord-installation',
		deprecated: false,
		experimental: false,
		description: 'A proxy server software for Minecraft.',
		categories: ['plugins', 'proxy'],
		compatibility: ['bungeecord']
	}, QUILT: {
		name: 'Quilt',
		color: '#9722FF',
		homepage: 'https://quiltmc.org',
		deprecated: false,
		experimental: true,
		description: 'A fork of Fabric that aims to be more feature rich and have easier apis.',
		categories: ['modded'],
		compatibility: ['fabric', 'quilt']
	}, FORGE: {
		name: 'Forge',
		color: '#DFA86A',
		homepage: 'https://files.minecraftforge.net/net/minecraftforge/forge',
		deprecated: false,
		experimental: false,
		description: 'The original Minecraft modding platform.',
		categories: ['modded'],
		compatibility: ['forge']
	}, NEOFORGE: {
		name: 'NeoForge',
		color: '#D7742F',
		homepage: 'https://neoforged.net',
		deprecated: false,
		experimental: false,
		description: 'A cousin of Forge that aims to be more performant and have better modding apis.',
		categories: ['modded'],
		compatibility: ['forge', 'neoforge']
	}, MOHIST: {
		name: 'Mohist',
		color: '#2A3294',
		homepage: 'https://mohistmc.com/software/mohist',
		deprecated: true,
		experimental: false,
		description: 'A variation of forge/neoforge that allows loading spigot plugins next to mods.',
		categories: ['modded', 'plugins'],
		compatibility: ['forge', 'spigot', 'paper']
	}, ARCLIGHT: {
		name: 'Arclight',
		color: '#F4FDE5',
		homepage: 'https://github.com/IzzelAliz/Arclight',
		deprecated: false,
		experimental: false,
		description: 'A Bukkit server implementation utilizing Mixins for modding support.',
		categories: ['modded', 'plugins'],
		compatibility: ['fabric', 'spigot', 'forge', 'neoforge']
	}, SPONGE: {
		name: 'Sponge',
		color: '#F7CF0D',
		homepage: 'https://www.spongepowered.org',
		deprecated: false,
		experimental: false,
		description: 'A modding platform for Minecraft.',
		categories: ['modded'],
		compatibility: ['sponge']
	}, LEAVES: {
		name: 'Leaves',
		color: '#40794F',
		homepage: 'https://leavesmc.org/software/leaves',
		deprecated: false,
		experimental: false,
		description: 'A fork of paper that aims to restore vanilla behavior and add new features.',
		categories: ['plugins'],
		compatibility: ['spigot', 'paper']
	}, CANVAS: {
		name: 'Canvas',
		color: '#3D11AE',
		homepage: 'https://github.com/CraftCanvasMC/Canvas',
		deprecated: false,
		experimental: true,
		description: 'A fork of purpur that aims to be more performant and have better apis.',
		categories: ['plugins'],
		compatibility: ['spigot', 'paper', 'purpur']
	}
}

export const configs: Record<string, {
	type: schema.ServerType
	format: schema.Format
}> = {
	// Vanilla
	'server.properties': {
		type: 'VANILLA',
		format: 'PROPERTIES'
	},

	// Spigot
	'spigot.yml': {
		type: 'SPIGOT',
		format: 'YAML'
	}, 'bukkit.yml': {
		type: 'SPIGOT',
		format: 'YAML'
	},

	// Paper
	'paper.yml': {
		type: 'PAPER',
		format: 'YAML'
	}, 'config/paper-global.yml': {
		type: 'PAPER',
		format: 'YAML'
	}, 'config/paper-world-defaults.yml': {
		type: 'PAPER',
		format: 'YAML'
	},

	// Pufferfish
	'pufferfish.yml': {
		type: 'PUFFERFISH',
		format: 'YAML'
	},

	// Purpur
	'purpur.yml': {
		type: 'PURPUR',
		format: 'YAML'
	},

	// Leaves
	'leaves.yml': {
		type: 'LEAVES',
		format: 'YAML'
	},

	// Canvas
	'canvas.yml': {
		type: 'CANVAS',
		format: 'YAML'
	},

	// Sponge
	'config/sponge/global.conf': {
		type: 'SPONGE',
		format: 'CONF'
	}, 'config/sponge/sponge.conf': {
		type: 'SPONGE',
		format: 'CONF'
	}, 'config/sponge/tracker.conf': {
		type: 'SPONGE',
		format: 'CONF'
	},

	// Arclight
	'arclight.conf': {
		type: 'ARCLIGHT',
		format: 'CONF'
	},

	// NeoForge
	'config/neoforge-server.toml': {
		type: 'NEOFORGE',
		format: 'TOML'
	}, 'config/neoforge-common.toml': {
		type: 'NEOFORGE',
		format: 'TOML'
	},

	// Mohist
	'mohist-config/mohist.yml': {
		type: 'MOHIST',
		format: 'YAML'
	},

	// Velocity
	'velocity.toml': {
		type: 'VELOCITY',
		format: 'TOML'
	},

	// BungeeCord
	'config.yml': {
		type: 'BUNGEECORD',
		format: 'YAML'
	},

	// Waterfall
	'waterfall.yml': {
		type: 'WATERFALL',
		format: 'YAML'
	},
}

export type RawBuild = {
	id: number
	type: schema.ServerType

	version_id: string | null
	project_version_id: string | null
	build_number: number
	experimental: boolean

	jar_url: string | null
	jar_size: number | null
	jar_location: string | null
	zip_url: string | null
	zip_size: number | null
	
	installation: schema.InstallStep[][]
	changes: string[]

	created: string | null
}

const pool = new Pool({
	connectionString: env.DATABASE_URL
})

const writePool = env.DATABASE_URL_PRIMARY ? new Pool({
	connectionString: env.DATABASE_URL_PRIMARY
}) : pool

const db = drizzle(pool, { schema }),
	writeDb = drizzle(writePool, { schema }),
	startTime = performance.now()

Promise.all([
	db.$client.connect(),
	env.DATABASE_URL_PRIMARY ? writeDb.$client.connect() : Promise.resolve()
]).then(() => {
	logger()
		.text('Database', (c) => c.cyan)
		.text('Connection established!')
		.text(`(${(performance.now() - startTime).toFixed(1)}ms)`, (c) => c.gray)
		.info()
})

const versionsAll = db.select()
	.from(
		db.select({
			java: schema.minecraftVersions.java,
			created: schema.minecraftVersions.created,
			supported: schema.minecraftVersions.supported,
			versionType: schema.minecraftVersions.type,
			builds: count(schema.builds.id).as('builds'),
			latest: max(schema.builds.id).as('latest')
		})
			.from(schema.minecraftVersions)
			.innerJoin(schema.builds, and(
				eq(schema.builds.versionId, schema.minecraftVersions.id),
				eq(schema.builds.type, sql.placeholder('type'))
			))
			.groupBy(
				schema.minecraftVersions.id,
				schema.minecraftVersions.created,
				schema.minecraftVersions.supported,
				schema.minecraftVersions.java,
				schema.minecraftVersions.type
			)
			.orderBy(asc(schema.minecraftVersions.created))
			.as('x')
	)
	.innerJoin(schema.builds, eq(schema.builds.id, sql`x.latest`))
	.prepare('versions_all')

const versionsVelocity = db.select()
	.from(
		db.select({
			builds: count(schema.builds.id).as('builds'),
			latest: max(schema.builds.id).as('latest'),
			createdOldest: min(schema.builds.created).as('createdOldest'),
			projectVersionId: schema.projectVersions.id
		})
			.from(schema.projectVersions)
			.innerJoin(schema.builds, and(
				eq(schema.builds.projectVersionId, schema.projectVersions.id),
				eq(schema.builds.type, 'VELOCITY')
			))
			.groupBy(schema.projectVersions.id)
			.as('x')
	)
	.innerJoin(schema.builds, eq(schema.builds.id, sql`x.latest`))
	.orderBy(asc(sql`x."createdOldest"`))
	.prepare('versions_velocity')

type DbWithoutWrite = Omit<typeof db, 'insert' | 'update' | 'delete'>

export default Object.assign(db as DbWithoutWrite, {
	write: writeDb,
	schema,

	prepare: {
		build<Data extends Record<string, any> | null | undefined>(raw: Data): Data extends null ? null : Data extends undefined ? null : Data {
			if (!raw) return null as any

			return {
				id: raw.id,
				type: raw.type,

				versionId: raw.versionId,
				projectVersionId: raw.projectVersionId,
				buildNumber: raw.buildNumber,
				name: raw.buildNumber === 1 ? raw.projectVersionId ?? `#${raw.buildNumber}` : `#${raw.buildNumber}`,
				experimental: raw.experimental,

				jarUrl: raw.jarUrl,
				jarSize: raw.jarSize,
				jarLocation: raw.jarLocation,
				zipUrl: raw.zipUrl,
				zipSize: raw.zipSize,

				installation: raw.installation,
				changes: raw.changes,

				created: raw.created,
			} as any
		},

		rawBuild<Data extends RawBuild>(build: Data): Data extends null ? null : Data extends undefined ? null : Data {
			if (!build) return null as any

			return {
				id: build.id,
				type: build.type,

				versionId: build.version_id,
				projectVersionId: build.project_version_id,
				buildNumber: build.build_number,
				name: build.build_number === 1 ? build.project_version_id ?? `#${build.build_number}` : `#${build.build_number}`,
				experimental: build.experimental,

				jarUrl: build.jar_url,
				jarSize: build.jar_size,
				jarLocation: build.jar_location,
				zipUrl: build.zip_url,
				zipSize: build.zip_size,

				installation: build.installation,
				changes: build.changes,

				created: build.created ? new Date(build.created) : null
			} as any
		},

		user<Data extends Record<string, any> | null | undefined>(raw: Data): Data extends null ? null : Data extends undefined ? null : Data {
			if (!raw) return null as any

			return {
				id: raw.id,
				name: raw.name,
				avatar: `https://avatars.githubusercontent.com/u/${raw.githubId}`,
				email: raw.email,
				login: raw.login
			} as any
		}
	},

	fields: {
		build: {
			id: schema.builds.id,
			type: schema.builds.type,

			versionId: schema.builds.versionId,
			projectVersionId: schema.builds.projectVersionId,
			buildNumber: schema.builds.buildNumber,
			experimental: schema.builds.experimental,

			jarUrl: schema.builds.jarUrl,
			jarSize: schema.builds.jarSize,
			jarLocation: schema.builds.jarLocation,
			zipUrl: schema.builds.zipUrl,
			zipSize: schema.builds.zipSize,

			installation: schema.builds.installation,
			changes: schema.builds.changes,

			created: schema.builds.created
		} as const
	},

	formatConfig(file: string, rawValue: string) {
		let value = ''

		for (const line of rawValue.split('\n')) {
			if (line.startsWith('#')) continue
			value += line + '\n'
		}

		if (file.endsWith('.properties')) {
			value = value.split('\n')
				.sort((a, b) => a.split('=')[0].localeCompare(b.split('=')[0]))
				.join('\n')
		} else if (file.endsWith('.yml') || file.endsWith('.yaml')) {
			value = yaml.dump(yaml.load(value), { sortKeys: true })
		}

		if (file === 'velocity.toml') {
			value = value.replace(/forwarding-secret = "(.*)"/, 'forwarding-secret="xxx"')
		}

		if (file === 'config.yml') {
			value = value
				.replace(/stats_uuid: (.*)/, 'stats_uuid: xxx')
				.replace(/stats: (.*)/, 'stats: xxx')
		}

		if (file === 'leaves.yml') {
			value = value.replace(/server-id: (.*)/, 'server-id: xxx')
		}

		value = value.trim()
			.replace(/seed-(.*)=(.*)/g, 'seed-$1=xxx')
			.replace(/seed-(.*): (.*)/g, 'seed-$1: xxx')

		return value
	},

	async versions(type: schema.ServerType) {
		switch (type) {
			case "VELOCITY": {
				const versions = await cache.use('builds::VELOCITY', async() => {
					const versions = await versionsVelocity.execute()

					return Object.fromEntries(versions.map((version, i) => [
						version.x.projectVersionId,
						{
							type: 'RELEASE',
							supported: i === versions.length - 1,
							java: 21,
							created: version.x.createdOldest,
							builds: Number(version.x.builds),
							latest: this.prepare.build(version.builds)
						}
					]))
				}, time(30).m())

				return versions
			}

			default: {
				const versions = await cache.use(`builds::${type}`, async() => {
					const versions = await versionsAll.execute({ type })

					return Object.fromEntries(versions.map((version) => [
						version.builds.versionId!,
						{
							type: version.x.versionType,
							supported: version.x.supported,
							java: version.x.java,
							created: version.x.created,
							builds: Number(version.x.builds),
							latest: this.prepare.build(version.builds)
						}
					]))
				}, time(30).m())

				return versions
			}
		}
	},

	async version(version: string, type: schema.ServerType): Promise<'minecraft' | 'project' | null> {
		const [ minecraft, project ] = await cache.use(`versionLocation::${version}::${type}`, () => Promise.all([
			db.select({
				_: sql`1`
			})
				.from(schema.minecraftVersions)
				.where(eq(schema.minecraftVersions.id, version))
				.limit(1)
				.then((r) => r[0]),
			db.select({
				_: sql`1`
			})
				.from(schema.projectVersions)
				.where(and(
					eq(schema.projectVersions.type, type),
					eq(schema.projectVersions.id, version)
				))
				.limit(1)
				.then((r) => r[0])
		]), time(30).m())

		return minecraft ? 'minecraft' : project ? 'project' : null
	},

	types() {
		return cache.use('types::all', async() => {
			const data = await db.select({
				type: schema.builds.type,
				builds: count(),
				versionsMinecraft: countDistinct(schema.builds.versionId),
				versionsProject: countDistinct(schema.builds.projectVersionId)
			})
				.from(schema.builds)
				.groupBy(schema.builds.type)
	
			return Object.fromEntries(schema.types.map((type) => [
				type,
				{
					...extraTypeInfos[type],
					icon: `${env.S3_URL}/icons/${type.toLowerCase()}.png`,
					builds: data.find((d) => d.type === type)?.builds ?? 0,
					versions: {
						minecraft: data.find((d) => d.type === type)?.versionsMinecraft ?? 0,
						project: data.find((d) => d.type === type)?.versionsProject ?? 0
					}
				}
			]))
		}, time(30).m())
	}
})