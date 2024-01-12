import * as fs from 'fs'
import {promisify} from 'util'
import {parse, satisfies} from 'semver'

export const stat = promisify(fs.stat)
export const readFile = promisify(fs.readFile)

export async function delay(msecs: number): Promise<void> {
    return new Promise(resolve => {
        setTimeout(() => resolve(), msecs)
    })
}

export function semver(available: string, required: string): boolean {
    return satisfies(available, required.replace(/,/g, ' '))
}

export function isver(version: string): boolean {
    return typeof parse(version) === 'object'
}
