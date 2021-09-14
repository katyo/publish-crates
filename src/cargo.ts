import {exec} from '@actions/exec'

export async function cargoPackageFiles(path: string): Promise<string[]> {
    let out = ''
    let err = ''

    const ret = await exec('cargo', ['package', '--list'], {
        cwd: path,
        listeners: {
            stdout(buf: Buffer) {
                out += buf.toString()
            },
            stderr(buf: Buffer) {
                err += buf.toString()
            }
        }
    })

    if (0 !== ret) {
        throw new Error(
            `Error when listing cargo package files at '${path}'. (${err})`
        )
    }

    return out
        .split('\n')
        .map(file => file.trim())
        .filter(file => file.length > 0)
}
