import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createClient } from 'genlayer-js'
import { studionet } from 'genlayer-js/chains'
import { finalized, installTransport, leader } from '../transport.js'

installTransport()

const source = readFileSync('contracts/intake.py', 'utf8')
const evidence = JSON.parse(readFileSync('evidence/studionet-dryad.json', 'utf8'))
const deployment = JSON.parse(readFileSync('public/deployment.json', 'utf8'))
const client = createClient({ chain: studionet })

const normalize = value => {
  if (Array.isArray(value)) return value.map(normalize)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value).sort().map(key => [key, normalize(value[key])]),
    )
  }
  return value
}

const errorText = receipt => {
  const result = leader(receipt)?.result
  const payload = result?.payload
  const detail = payload?.readable ?? payload ?? result?.readable ?? result
  return typeof detail === 'string' ? detail : JSON.stringify(detail)
}

assert.equal(Number(await client.getChainId()), 61999, 'RPC is not Stable Studionet')
assert.equal(evidence.chainId, 61999, 'Evidence chain ID mismatch')
assert.equal(evidence.rpc, 'https://studio.genlayer.com/api', 'Evidence RPC mismatch')
assert.equal(evidence.address, deployment.address, 'Evidence contract address mismatch')

const sourceSha256 = createHash('sha256').update(source).digest('hex')
assert.equal(evidence.sourceSha256, sourceSha256, 'Evidence source hash differs from the current contract')
assert.equal(
  await client.getContractCode(deployment.address),
  source,
  'Deployed contract source differs from the repository source',
)

const steps = Object.entries(evidence.steps)
assert(steps.length > 0, 'No recorded transaction evidence found')

for (const [name, step] of steps) {
  assert(step.hash, name + ': transaction hash missing')
  assert.equal(step.status, 'FINALIZED', name + ': saved status is not FINALIZED')
  assert.equal(step.consensus, 'MAJORITY_AGREE', name + ': saved consensus is not majority agreement')
  assert.equal(step.verified, true, name + ': saved readback is not verified')

  const receipt = await client.getTransaction({ hash: step.hash })
  assert(receipt, name + ': transaction receipt unavailable')
  assert(finalized(receipt), name + ': transaction is not FINALIZED')
  assert.equal(
    receipt.from_address?.toLowerCase(),
    step.sender?.toLowerCase(),
    name + ': transaction sender mismatch',
  )
  assert.equal(
    receipt.result_name ?? receipt.result,
    'MAJORITY_AGREE',
    name + ': on-chain consensus mismatch',
  )

  const leaderReceipt = leader(receipt)
  assert(leaderReceipt, name + ': leader receipt unavailable')
  assert.equal(
    leaderReceipt.execution_result,
    step.execution,
    name + ': on-chain execution result mismatch',
  )

  if (step.execution === 'ERROR') {
    assert(step.error, name + ': expected rejection reason missing from saved evidence')
    assert(
      errorText(receipt).includes(step.error),
      name + ': on-chain rejection reason differs from saved evidence',
    )
  } else {
    assert.equal(step.execution, 'SUCCESS', name + ': unexpected execution result')
  }
}

const recordedByHash = new Map(steps.map(([name, step]) => [step.hash, { name, step }]))
const publishedSteps = deployment.cases.flatMap(item => item.steps ?? [])
assert(publishedSteps.length > 0, 'No published transaction references found')

for (const published of publishedSteps) {
  const recorded = recordedByHash.get(published.hash)
  assert(recorded, 'Published transaction is missing from detailed evidence: ' + published.hash)
  assert.equal(
    published.execution,
    recorded.step.execution,
    recorded.name + ': published execution result mismatch',
  )
}

async function readCase(key) {
  const value = await client.readContract({
    address: deployment.address,
    functionName: 'get_case',
    args: [key],
    transactionHashVariant: 'latest-final',
  })
  assert(value, 'No on-chain case found for ' + key)
  return typeof value === 'string' ? JSON.parse(value) : value
}

const expectedCases = [
  { label: 'Received example', evidenceStep: 'receive', state: 'RECEIVED' },
  { label: 'Blocked example', evidenceStep: 'incomplete-delivery-reconcile', state: 'BLOCKED' },
]

for (const expected of expectedCases) {
  const published = deployment.cases.find(item => item.label === expected.label)
  assert(published, 'Missing published case: ' + expected.label)

  const saved = evidence.steps[expected.evidenceStep]
  assert(saved?.readback, expected.label + ': saved readback missing')

  const actual = await readCase(published.key)
  assert.equal(actual.state, expected.state, expected.label + ': unexpected on-chain state')
  assert.deepEqual(
    normalize(actual),
    normalize(saved.readback),
    expected.label + ': on-chain readback differs from saved evidence',
  )
  console.log(expected.label + ': ' + actual.state + ' (' + published.key + ')')
}

console.log('Read-only verification passed.')
console.log('Chain: Stable Studionet (61999)')
console.log('Contract: ' + deployment.address)
console.log('Source: exact match (' + sourceSha256 + ')')
console.log('Finalized receipts: ' + steps.length + ' verified; ' + publishedSteps.length + ' published')
console.log('No transaction was signed or submitted.')
