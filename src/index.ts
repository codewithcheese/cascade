import fs from 'fs'
import path from 'path'
import { createServer } from 'http'

import 'dotenv/config'
import yaml from 'js-yaml';
import { Webhooks, createNodeMiddleware } from '@octokit/webhooks'
import { createAppAuth } from "@octokit/auth-app";
import { Octokit } from "@octokit/rest";

import {Config} from "./config";
import {db, applyConfig} from "./db";
import * as process from "process";

const octokitOptions = {
    authStrategy: createAppAuth,
    auth: {
        type: 'app',
        appId: process.env['GITHUB_APP_ID'],
        privateKey: fs.readFileSync(path.join(process.cwd(), 'github-app-private-key.pem')),
        clientId: process.env['GITHUB_APP_CLIENT_ID'],
        clientSecret: process.env['GITHUB_APP_CLIENT_SECRET'],
    }
}

const github = new Octokit(octokitOptions);

(async () => {
    const octokit = await authOctokit()
    const userResponse = await octokit.rest.apps.getAuthenticated()
    console.log(`Authenticated as ${userResponse.data.name}`)
})()

const webhooks = new Webhooks({
    secret: process.env['GITHUB_APP_SECRET'] || '',
});

webhooks.on(['pull_request.opened', 'pull_request.synchronize'], async ({ id, name, payload }) => {
    await cascadePR(payload)
});

webhooks.on('pull_request.closed', async ({ id, name, payload }) => {
    const repoName = payload.repository.name
    console.log(`PR event "${payload.action}" from ${repoName}`)
    if (!payload.installation?.id) {
        throw Error('App misconfigured, installation id not set in webhook payload')
    }
    const installationId = payload.installation?.id
    await requestConfigFileAndApplyToDb(payload.repository.owner.login, payload.repository.name, installationId)
})

createServer(
    createNodeMiddleware(webhooks, { path: "/" })
).listen(3000);

async function authOctokit(installationId: string | number = 'app-scope') {
    let token: any;
    if (installationId === 'app-scope') {
        ({ token } = (await github.auth({
            type: 'app',
        })) as any);
    } else {
        ({ token } = (await github.auth({
            type: 'installation',
            installationId,
        })) as any);
    }
    Reflect.deleteProperty(octokitOptions, 'authStrategy');
    octokitOptions.auth = token;
    return new Octokit(octokitOptions);
}

async function requestConfigFileAndApplyToDb (owner: string, repo: string, installationId: number) {
    const octokit = await authOctokit(installationId)
    const response = await octokit.rest.repos.getContent({
        owner,
        repo,
        path: 'cascade.yml'
    });
    // @ts-ignore
    const config = yaml.load(Buffer.from(response.data.content, 'base64')) as Config
    applyConfig(config, owner, repo)
}

function slugify(name: string): string {
    return name.toLowerCase().replace(/[^a-z0-9-]/g, '-');
}

async function cascadePR (payload: any) {
    const repoName = payload.repository.name
    console.log(`PR event "${payload.action}" from ${repoName}`)
    if (!payload.installation?.id) {
        throw Error('App misconfigured, installation id not set in webhook payload')
    }
    const octokit = await authOctokit(payload.installation.id)
    // for all repos that list PR as upstreams
    const downstreams = db.repos[payload.repository.full_name].downstreams
    for (const downstream of Object.keys(downstreams)) {
        try {
            const {owner, repo} = db.repos[payload.repository.full_name].downstreams[downstream]
            const repoResponse = await octokit.rest.repos.get({
                owner,
                repo
            })
            const refResponse = await octokit.rest.git.getRef({
                owner,
                repo,
                ref: `heads/${repoResponse.data.default_branch}`
            });
            const commitMessage = `Cascade from ${repoName} PR ${payload.pull_request.id}`
            const branchName = slugify(commitMessage);
            const sha = refResponse.data.object.sha
            try {
                const newBranchRef = await octokit.rest.git.createRef({
                    owner,
                    repo,
                    ref: `refs/heads/${branchName}`,
                    sha,
                })
                const currentCommit = await octokit.git.getCommit({
                    owner,
                    repo,
                    commit_sha: newBranchRef.data.object.sha,
                });
                const newCommit = await octokit.git.createCommit({
                    owner,
                    repo,
                    message: commitMessage,
                    tree: currentCommit.data.tree.sha,
                    parents: [currentCommit.data.sha],
                });
                await octokit.git.updateRef({
                    owner,
                    repo,
                    ref: `heads/${branchName}`,
                    sha: newCommit.data.sha,
                });
            } catch (e: any) {
                if (e.status !== 422) {
                    throw e
                }
            }
            const title = `Upstream update ${repoName} for PR ${payload.pull_request.number}`
            const body = yaml.dump({
                upstream: {
                    repo: repoName,
                    branch: payload.pull_request.head.ref,
                    pull_request_id: payload.pull_request.id
                }
            }) + "\n---"
            await octokit.rest.pulls.create({
                title,
                body,
                owner,
                repo,
                head: branchName,
                base: repoResponse.data.default_branch,
            })
        } catch (e) {
            console.error(e)
        }
    }
}
