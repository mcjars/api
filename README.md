> [!WARNING]
> moved to https://github.com/mcjars/www/tree/main/backend

# api - MCJars Minecraft Versions API

"mcvapi" is an api tool for retrieving Minecraft server versions. It allows you to easily download, install, and lookup Minecraft server versions. This is the api part that runs on 6 HA Hetzner VMs with 3 Load Balancers.

## Features

- Runs in Docker for high availability
- Fast Reverse Hash Lookup (< 50ms)
- Data is cached for fast repeated retrievals
- Servers in Germany, Hillsboro (Oregon, US), and Ashburn (Virginia, US)
- Blazingly 🔥 fast 🚀, written in 100% safe Rust. 🦀

## Developing

To Develop on this api tool, you need to install all required dependencies

```bash
git clone https://github.com/mcjars/api.git api

cd api

# make sure to have nodejs and rustup (cargo) installed already
cargo build

# fill out the config
cp .env.example .env

# after filling out the config
cd database
npm i -g pnpm
pnpm i

pnpm kit migrate
cd ..

# start the dev server on port 8000
cargo run
```

> [!NOTE]
> NOT AN OFFICIAL MINECRAFT SERVICE. NOT APPROVED BY OR ASSOCIATED WITH MOJANG OR MICROSOFT.
