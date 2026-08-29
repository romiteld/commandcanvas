# CommandCanvas Hand Relay

CommandCanvas Hand Relay is the optional, separately deployed CUDA inference
service used by CommandCanvas after a user explicitly enables private-GPU hand
tracking. It accepts one bounded JPEG or WebP frame at a time, performs
in-memory YOLO hand-pose inference with ONNX Runtime's CUDA execution provider,
returns semantic 21-point hand landmarks, and does not persist raw frames.

This repository is intentionally separate from the MIT-licensed CommandCanvas
web application. It contains the relay service, pinned model artifacts,
deployment operations, tests, and corresponding-source record required for the
relay's AGPL-3.0-only release path. The web application retains only the relay
protocol, session, token, and browser client.

## Layout

- `services/hand-relay/`: Python service, deterministic dependency locks,
  container definitions, model manifests, and contract tests.
- `services/hand-relay/models/`: pinned 640-pixel production model.
- `public/models/`: pinned 320-pixel rollback model retained for the existing
  rollback image contract.
- `ops/hand-relay/`: reversible Caddy route install, validation, status, and
  rollback operations.
- `docs/`: privacy, topology, performance, and model-selection evidence.
- `SOURCE.md`: exact model provenance, hashes, and corresponding-source paths.

## Deterministic non-GPU verification

The test suite injects the inference backend. It verifies protocol, admission,
authenticity, replay refusal, bounded image handling, packaging, and exact model
manifests without claiming that CUDA ran:

```bash
python3 -m pip install --requirement services/hand-relay/requirements-ci.lock
PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 \
  python3 -m pytest services/hand-relay/tests -q
bash ops/hand-relay/tests/manage-caddy-route.test.sh
```

Real CUDA startup and benchmark instructions are documented in
[`services/hand-relay/README.md`](services/hand-relay/README.md). They require an
NVIDIA host and are separate from deterministic CI.

## Publication boundary

This checkpoint creates the repository locally only. It does not publish a
remote repository, deploy the service, mutate the existing route, or run a
billable provider. Before another release is distributed or promoted, replace
the source-link follow-up in `SOURCE.md` with the exact public commit containing
the deployed service and model source record.

## License

[GNU Affero General Public License v3.0 only](LICENSE), copyright 2026 Daniel
Romitelli. Third-party model and runtime notices are in
[`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).
