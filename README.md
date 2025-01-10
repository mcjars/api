# api - MCJars Minecraft Versions API

mcvapi (versions-worker) is an api tool for retrieving Minecraft server versions. It allows you to easily download, install, and lookup Minecraft server versions. This is the api part that runs on 4 HA Hetzner VMs with 2 Load Balancers.

## Features

- Runs in Docker for high availability
- Fast Reverse Hash Lookup (< 2ms)
- Data is cached for fast repeated retrievals
- Available in Europe and East Coast US

## Developing

To Develop on this api tool, you need to install all required dependencies

```bash
git clone https://github.com/mcjars/api.git api

cd api

# make sure to have nodejs installed already
npm i -g pnpm
pnpm i

# fill out the config
cp .env.example .env

# after filling out the config
pnpm kit migrate

# start the dev server on port 8000
pnpm dev
```

> [!NOTE]
> NOT AN OFFICIAL MINECRAFT SERVICE. NOT APPROVED BY OR ASSOCIATED WITH MOJANG OR MICROSOFT.
