# Kyivstar vendor artifacts — SUPERSEDED

**Status: superseded — Kyivstar-direct is no longer the SMS route.**

As of the **v2.26 SMS-provider pivot (2026-06-22)**, the SMS provider is **TurboSMS** (UA-native aggregator, self-service) with **AlphaSMS** as the documented fallback. Kyivstar-direct was dropped as the default (see research doc **ADR-005** and `docs/handoffs/2026-06-22-sms-provider-pivot-kyivstar-to-turbosms.md`).

- `kyivstar-api-postman-collection.json` is **retained as a research artifact**, not used by the build. The build-facing SMS reference now lives in **`docs/vendor/turbosms/API-REFERENCE.md`**.
- **"Kyivstar" still appears (correctly) elsewhere as a mobile *operator*** — patients subscribe to Kyivstar/Vodafone UA/lifecell, and the cross-operator deliverability seed test sends *to* Kyivstar subscribers. That operator/network sense is unchanged; only the *provider/route* sense changed.
- This file and the JSON are **kept, not deleted** (project RULE 1: no file deletion without explicit owner permission). Deleting the JSON is a separate decision for the owner.
