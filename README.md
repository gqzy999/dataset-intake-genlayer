# Dataset Intake

[Open Dataset Intake](https://gqzy999.github.io/dataset-intake-genlayer/)

A sender locks a research delivery manifest, an exact public archive release, and the receiving wallet. GenLayer validators independently retrieve and normalize the publisher's file metadata. Missing, extra, or changed files block sign-off. Only the named recipient can acknowledge a matching delivery.

## Use the desk

1. Open a published example or connect a wallet on Stable Studionet (chain ID 61999). Temporary test wallets are available in the browser.
2. Choose an archive and enter a public record ID. For Dryad, enter the numeric version ID from the version API URL and use the example manifest button to populate a real record.
3. Lodge the delivery with a distinct receiving wallet and 1–32 declared files, each with a name, byte size, and lowercase `md5:` checksum.
4. Request independent verification. Inspect the finalized comparison and switch to the named recipient to acknowledge a cleared delivery.
5. Download the finalized receipt JSON from a RECEIVED case. It contains the contract, reference, declared and official metadata, and recorded parties.

## Contract behavior

`LODGED → CLEARED → RECEIVED`, or `LODGED → BLOCKED`. A blocked delivery requires a new reference. Anyone can request verification, and each validator compares the entire canonical publisher response, including the DOI and full file manifest. An unavailable archive leaves the case retryable.

Dryad uses the official version files endpoint. It requires the complete file listing, checks that every listed file belongs to the requested version and one dataset, and uses the archive’s MD5 digest. Zenodo uses an exact positive record ID and its version DOI. Stable Studionet nodes received HTTP 403 for the Zenodo example. The live examples use [Dryad version 26724](https://datadryad.org/api/v2/versions/26724/files).

The receipt attests to matching publisher metadata and recipient acknowledgement. It does not verify downloaded file bytes or physical transfer.

## Develop and verify

```sh
npm ci
npm test
npm run build
python3 -m pip install genvm-linter==0.11.0
genvm-lint check contracts/intake.py
```

[GenVM validation](evidence/genvm-lint-dryad.txt) covers the deployed source. The app uses genlayer-js 2.0.0. Stable Studionet quotes a protocol deposit in test GEN with an EVM gas price of zero. Temporary browser wallet keys remain in memory, and the Studio faucet can fund those accounts. Injected wallets need their own test GEN balance.

The live acceptance script uses authorized test signers provided through `STUDIO_OWNER_KEY` and `STUDIO_DELEGATE_KEY`, or fresh in-memory signers with `STUDIO_SIGNERS=ephemeral npm run live`. Set `STUDIO_CONTRACT_ADDRESS` to verify an existing, source-matched deployment. Use a fresh `STUDIO_EVIDENCE_PATH` for a fresh run. Reconcile uncertain broadcasts before retrying.

## Live evidence

[Verified contract](https://explorer-studio.genlayer.com/address/0xF2035f00d53Aa986F8fc9896C2E5483B526fA8CA) · [Deployment transaction](https://explorer-studio.genlayer.com/transactions/0xc8df3851995a324afdcfb69a5cc961ce499190846c5d5f64911b6a2f6664602f) · [Receipts and state readback](evidence/studionet-dryad.json)

The received example reached `RECEIVED` after the designated recipient signed. The blocked example reports the missing file. The contract rejected an unauthorized signature on the cleared delivery and an acknowledgement on the blocked delivery.

## Deployment history

[Earlier deployments](evidence/deployment-attempt.json) reverted at the submission layer with `FeesDistributionMissing`. After fee-aware deployment, the [Zenodo reconciliation](https://explorer-studio.genlayer.com/transactions/0x91ab66e18d07f5dbce1b42083991e3c2358b97bb4d771e21db6350ca6f162233) rolled back with `ZENODO_UNAVAILABLE`. The [archive probe](https://explorer-studio.genlayer.com/transactions/0x6657a456aced220c56b679cf2b1221f77ac0049f6b2de059f76df9903cbfcd43) observed successful HTTP responses from both Dryad and Figshare endpoints.

Figshare reconciliation in the experimental deployment left the cases lodged. The [finalized reconciliation](https://explorer-studio.genlayer.com/transactions/0x2bb6327cca67f7e3ea7e9f9e43078cab24799f88917bd2e5bc3d40cad8991f52) returned `ARCHIVE_UNAVAILABLE`.
