import assert from 'node:assert/strict'
import test from 'node:test'
import { reconcileEnterpriseIDs, type EnterpriseStableIDRegistry } from '../src/enterprise-integrity.js'

test('Enterprise offAll retirement preserves every later callable ID', () => {
  const registry: EnterpriseStableIDRegistry = {
    schemaVersion: 1,
    edition: 'enterprise-delta',
    namespaces: {
      constants: [],
      types: [],
      typeExtensions: [],
      callables: [
        { id: 200001, name: 'offAll', status: 'retired', previousNames: [], replacement: 'public:callables:2002/offAll' },
        { id: 200002, name: 'enterpriseA', status: 'active', previousNames: [] },
        { id: 200084, name: 'enterpriseZ', status: 'active', previousNames: [] },
      ],
      events: [],
    },
  }
  const result = reconcileEnterpriseIDs(registry, 'callables', ['enterpriseZ', 'enterpriseA'])
  assert.deepEqual(result.ids, [200084, 200002])
  assert.equal(result.registry.namespaces.callables[0]?.status, 'retired')
})

test('Enterprise retired IDs cannot be imported or filled', () => {
  const registry: EnterpriseStableIDRegistry = {
    schemaVersion: 1,
    edition: 'enterprise-delta',
    namespaces: {
      constants: [], types: [], typeExtensions: [], events: [],
      callables: [{ id: 200001, name: 'offAll', status: 'retired', previousNames: [] }],
    },
  }
  assert.throws(() => reconcileEnterpriseIDs(registry, 'callables', ['offAll']), /Reserved Enterprise/)
  assert.deepEqual(reconcileEnterpriseIDs(registry, 'callables', ['newCallable']).ids, [200002])
})
