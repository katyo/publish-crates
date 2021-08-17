import * as fs from 'fs'
import {promisify} from 'util'

export const stat = promisify(fs.stat)
export const readFile = promisify(fs.readFile)

export async function delay(msecs: number): Promise<void> {
    return new Promise(resolve => {
        setTimeout(() => resolve(), msecs)
    })
}
