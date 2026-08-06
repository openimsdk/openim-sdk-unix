import test from 'node:test'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { verifyDriverInvariants } from '../src/verify-driver.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

test('native Drivers retain lifecycle and exactly-once seams', () => {
  verifyDriverInvariants(root)
})
