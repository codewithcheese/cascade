import fs from 'fs'
import path from 'path';

import { Config } from "./config"

type DB = {
    repos: {
        [key: string]: {
            downstreams: { [key: string]: { owner: string, repo: string } }
        }
    }
}

const dbPath = path.join(process.cwd(), 'db.json')

export const db: DB = load()

function load () {
    try {
        if (fs.statSync(dbPath).isFile()) {
            return JSON.parse(fs.readFileSync(dbPath).toString())
        }
    } catch (e: any) {
        if (e.code === "ENOENT") {
            return {repos: {}}
        } else {
            throw e
        }

    }
}

export function applyConfig(config: Config, owner: string, repo: string) {
    for (const upstream of config.upstreams) {
        if (!db.repos[upstream]) {
            db.repos[upstream] = { downstreams: {} }
        }
        db.repos[upstream].downstreams[`${owner}/${repo}`] = {
            owner,
            repo
        }
    }
    save()
}

function save () {
    fs.writeFileSync(dbPath, JSON.stringify(db))
}
