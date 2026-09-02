# CommandCanvas hand fine-tune v1

This package validates a private, raw-camera hand-pose dataset and produces
deterministic receipts for an owner-only experimental training run. It does not
contain Ultralytics or model bytes, camera footage, or a production model. Its
`train-owner-experiment` command is a bounded API adapter that runs only when
the separately licensed runtime and exact pinned checkpoint are supplied at
execution time.

The default RunPod path is a network-free dry run. The `--execute` path
currently refuses before creating a Pod because secure SSH transfer with host
key pinning and an independent termination guardian are not implemented. This
is an intentional cost and data-safety gate.

The pinned upstream checkpoint is isolated by an AGPL runtime and CC-BY-NC-SA
training-data license boundary. Every generated candidate begins with
`productionEligible: false`; benchmark, license, and physical acceptance are
separate gates.

Run the synthetic contract suite from the repository root:

```sh
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover \
  -s scripts/hand-finetune/v1/tests -p 'test_*.py' -v
```

Show the CLI without touching the network:

```sh
PYTHONPATH=scripts/hand-finetune/v1 \
  python3 -m commandcanvas_hand_finetune --help
```
