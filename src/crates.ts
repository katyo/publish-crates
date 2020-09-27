import {HttpClient, HttpCodes} from '@actions/http-client'
import {delay} from './utils'

interface CrateInfo {
    crate: {
        id: string
        name: string
        created_at: string
        updated_at: string
    }
    versions: VersionInfo[]
}

interface VersionInfo {
    crate: string
    num: string
    created_at: string
    updated_at: string
}

async function getCrateInfo(crate: string): Promise<CrateInfo | undefined> {
    const client = new HttpClient('publish-crates')
    const url = `https://crates.io/api/v1/crates/${crate}`
    const res = await client.get(url)
    if (res.message.statusCode === HttpCodes.NotFound) {
        return
    }
    if (res.message.statusCode !== HttpCodes.OK) {
        const raw = await res.readBody()
        throw new Error(
            `Error when requesting crate '${crate}' info from crates.io (status: ${res.message.statusCode}, contents: '${raw}')`
        )
    }
    const raw = await res.readBody()
    try {
        return JSON.parse(raw)
    } catch (error) {
        throw new Error(`Error when parsing response JSON: ${error.message}`)
    }
}

export interface Version {
    version: string
    created: Date
}

export async function getCrateVersions(
    crate: string
): Promise<Version[] | undefined> {
    const data = await getCrateInfo(crate)
    if (!data) {
        return
    }
    return data.versions.map(
        ({num, created_at}) =>
            ({
                version: num,
                created: new Date(created_at)
            } as Version)
    )
}

export async function awaitCrateVersion(
    crate: string,
    version: string,
    timeout = 60000
): Promise<void> {
    const started = Date.now()
    for (;;) {
        await delay(5000)
        const versions = await getCrateVersions(crate)
        if (
            versions &&
            versions.some(version_info => version_info.version === version)
        ) {
            return
        } else if (Date.now() - started > timeout) {
            throw new Error(
                `Timeout '${timeout}ms' reached when awaiting crate '${crate}' version '${version}'`
            )
        }
    }
}
