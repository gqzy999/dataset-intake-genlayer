# Dataset Intake

Dataset Intake reconciles a research delivery manifest against an exact public Zenodo record. A sender locks the record ID, file declarations and receiving wallet. Independent GenLayer validators fetch publisher metadata and compare the complete canonical evidence. The contract computes missing, additional and changed files and either blocks the handoff or enables the designated recipient to acknowledge it.

## Use the desk

1. Open a published example or connect an injected wallet. Stable Studionet temporary test wallets also work. They exist only in memory.
2. Lodge a fixed numeric Zenodo record ID with 1–32 declared files. Each row has a `name`, byte `size` and the exact lowercase Zenodo `checksum` field.
3. Request independent verification. Inspect the file-by-file comparison, submission identity and official source.
4. The assigned recipient can sign off a cleared manifest. A blocked delivery requires a fresh reference and corrected input.
5. Download the finalized receipt JSON from a RECEIVED case. It includes the contract, case reference, declared and authoritative metadata, and recorded parties.

## Contract and scope

`LODGED → CLEARED → RECEIVED`, or `LODGED → BLOCKED`. Only a new sender/slug can create a delivery. Any account can request verification, while only the assigned recipient can acknowledge. Transport, schema or consensus failures leave a lodged delivery retryable. The validator independently repeats the fixed-source request and compares the entire normalized return, including DOI and every file's name, size and digest.

The checksum is the publisher's stated MD5 metadata. The contract does not fetch or compare file bytes, establish authenticity of local copies, or confirm physical transfer. This is a receipt for the declared manifest and its agreed publisher metadata. Public metadata only. The supported scope is public Zenodo-minted version DOIs with a complete bounded file list.

## Develop and verify

```sh
npm ci
npm test
npm run build
python3 -m pip install genvm-linter==0.11.0
genvm-lint check contracts/intake.py
```

The Vite build is suitable for GitHub Pages. Network settings are Stable Studionet 61999 with genlayer-js 1.1.8. The acceptance script can use two authorized test signers via `STUDIO_OWNER_KEY` and `STUDIO_DELEGATE_KEY`, or create fresh in-memory signers with `STUDIO_SIGNERS=ephemeral npm run live`. Use a fresh `STUDIO_EVIDENCE_PATH` for a new run, and reconcile any uncertain broadcast before resending.

[GenVM validation](evidence/genvm-lint.txt) · [Official example manifest](https://zenodo.org/api/records/1196821)

## Deployment attempts

Both [recorded submissions](evidence/deployment-attempt.json) were reverted at the EVM submission layer, with no consensus transaction logs. The preview has no verified contract configured. Unit tests exercise the state machine using a local host. The acceptance runner requires a successful deployment before it can verify either business case.
