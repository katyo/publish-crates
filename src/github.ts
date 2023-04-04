import {getOctokit, context as github_context} from '@actions/github'

export type Context = typeof github_context
export type GitHub = ReturnType<typeof getOctokit>

export interface GitHubHandle {
    github: GitHub
    context: Context
}

export function githubHandle(
    token: string = process.env.GITHUB_TOKEN || '',
    context: Context = github_context
): GitHubHandle {
    let github: GitHub
    return {
        get github() {
            if (!github) {
                github = getOctokit(token, {})
            }
            return github
        },
        context
    }
}

export async function lastCommitDate(
    {
        github,
        context: {
            repo: {owner, repo},
            sha
        }
    }: GitHubHandle,
    path: string
): Promise<Date> {
    let result: {
        repository: {
            object: {
                history: {
                    edges: {
                        node: {
                            committedDate: string
                        }
                    }[]
                }
            }
        }
    }

    try {
        result = await github.graphql(
            `
query lastCommitDate($owner: String!, $repo: String!, $sha: String!, $path: String!) {
    repository(owner: $owner, name: $repo) {
        object(oid: $sha) {
            ... on Commit {
                history(first: 1, path: $path) {
                    edges {
                        node {
                            committedDate
                        }
                    }
                }
            }
        }
    }
}
`,
            {
                owner,
                repo,
                sha,
                path
            }
        )
    } catch (error) {
        throw new Error(
            `Unable to retrieve history from GitHub due to: ${error}`
        )
    }

    const {edges} = result.repository.object.history

    if (edges.length !== 1) {
        throw new Error(`Unable to retrieve history for path '${path}'`)
    }

    return new Date(edges[0].node.committedDate)
}
