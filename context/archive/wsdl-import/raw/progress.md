---
change_id: wsdl-import
produced-by: lz-tdd
updated: 2026-11-21
---

# Progress: WSDL import

## Phase 1: parse WSDL into SOAP templates, and the wire matches

- **Executor:** lz-tdd
- **Status:** done
- **Started:** 2026-11-21
- **Finished:** 2026-11-21

**Changed**
- `package.json`: `fast-xml-parser@^4.5.7`, recorded in `tech-stack.md`.
- `src/core/wsdl.ts`:
  - `parseWsdl` resolves names by namespace URI, as the spike showed. It reads ports with their SOAP version and
    address, and operations with their soapAction, input element and first-level children.
  - It refuses invalid XML with `XMLValidator`'s line and column, a document that is not WSDL 1.1, and a port with no
    SOAP address.
  - `soapTemplate` builds a `POST` with the 1.1 headers (`text/xml`, `SOAPAction`) or the 1.2 header (`soap+xml` with
    `action`) and an envelope.
- `test-support/wsdl-fixture.ts`: the BillingService fixture.
- `src/core/wsdl.test.ts`: 4 cases, the default-namespace and `wsdl:`-prefixed documents among them.
- `src/core/wsdl.int.test.ts`: the probe that the lesson "Probe what undici does" requires. A SOAP 1.1 and a SOAP 1.2
  template are sent through `sendAndRecord` to the capture server. The received headers equal the recorded list, the
  SOAP headers equal the template's, and the body is the envelope's bytes.

**Verification**

```
$ npx vitest run --project unit src/core/wsdl.test.ts        # before
 FAIL  Error: Cannot find module './wsdl'
$ npx vitest run --project unit src/core/wsdl.test.ts → 4 passed
$ npx vitest run --project integration src/core/wsdl.int.test.ts → 2 passed
```

The probe was written after the parser and passed at its first run. undici kept `SOAPAction` and the `action`
parameter exactly as given, as predicted.

## Phase 2: import and list WSDL sources

- **Executor:** lz-tdd
- **Status:** done
- **Started:** 2026-11-21
- **Finished:** 2026-11-21

**Changed**
- `src/core/template-store.ts`:
  - `storePlanned`, shared by both kinds, holds the new-or-re-import logic from slice 11.
  - `importWsdl` files templates by port, prefixed with the service when there are several. Its key is
    `port operation`, and its label is the operation name.
  - Sources gain `kind: 'wsdl'` and `grouping: 'port'`.
- The contract gains `pigeon:import-wsdl` (`ImportWsdlInputSchema`), and `TemplateSource.kind` gains `'wsdl'`. The
  handler and client are added.
- Tests: `template-store.int.test.ts`, 3 WSDL cases (import by port, re-import in place, invalid WSDL). The
  all-operations HTTP test imports a WSDL.

**Verification**

```
$ (before) × an import files one SOAP template… · × re-importing the same WSDL… · × an invalid WSDL imports nothing
$ (before the contract) × every operation in the contract answers through HTTP — TypeError
$ npx vitest run --project integration src/server/ src/core/template-store.int.test.ts → 55 passed
```

## Phase 3: the dialog's WSDL source and the SOAP tree

- **Executor:** lz-e2e
- **Status:** done
- **Started:** 2026-11-21
- **Finished:** 2026-11-21

**Changed**
- `ImportDialog`:
  - the Source segment switches between OpenAPI JSON and WSDL;
  - WSDL parses with `parseWsdl`, shows "WSDL · title · N ports · M operations", and previews by port (`wsdlGroups`);
  - it has no grouping or environment options;
  - Generate calls `importWsdl`;
  - re-import detection compares kind and title.
- `TemplatesTree` shows a SOAP badge for WSDL templates (`.method-soap`).
- `e2e/templates.spec.ts`: 1 scenario. A WSDL is previewed by port and generated. A SOAP template opens with its
  envelope, sends with `SOAPAction`, and is recorded.

**Verification**

```
$ npx playwright test e2e/templates.spec.ts      # before the UI
  ✘ a WSDL is previewed by port… (15.0s)
$ npx playwright test e2e/templates.spec.ts --repeat-each=3 → 15 passed
$ npx playwright test → 85 passed (1.3m)
$ npm run test:unit → 390 passed · npm run test:integration → 374 passed · typecheck 0 · lint clean
```

**Drift:** none.

## Code-review fixes: /code-review findings 1–10

- **Executor:** lz-tdd (findings 1–5, 7 and 8); lz-build (findings 6, 9 and 10)
- **Status:** done
- **Started:** 2026-11-21
- **Finished:** 2026-11-21

**Changed**
- `src/core/wsdl.ts` rewritten around `normalize`. Every element carries the namespaces in scope, its children are keyed
  by `{uri}local`, and QName attributes resolve with their element's scope. This covers prefixes declared on nested
  elements and one namespace under two prefixes (2 and 3).
- 1: children are qualified only under `elementFormDefault="qualified"`; otherwise `<name>` has no prefix.
- 4: children of a named complexType (`type="tns:X"`) are read.
- 5: an RPC operation is wrapped in an element named after it, in the `soap:body` namespace, with its parts as
  children.
- 7: overloads are matched by input name. Their template name and key carry it: `find (one)`.
- 8: `groupPorts` is shared by the store and the dialog's preview.
- 9: the listing carries `badge`, so the tree has no kind checks.
- 6: switching the source kind invalidates a read in flight.
- 10: a parsed WSDL styles the file box as chosen.
- Tests: `test-support/wsdl-fixture.ts` gains `GENERATED`, a generator-style WSDL. `wsdl.test.ts` gains 5 cases. The
  BillingService expectations are now unqualified (its schema has no `elementFormDefault`), and the e2e body assertion
  follows.

**Verification**

```
$ npx vitest run --project unit src/core/wsdl.test.ts      # before: module had no groupPorts, file failed to load
$ npx vitest run --project unit src/core/wsdl.test.ts → 9 passed
$ npm run test:unit → 395 passed · npm run test:integration → 374 passed
$ npx playwright test e2e/templates.spec.ts --repeat-each=3 → 15 passed · npx playwright test → 85 passed
$ typecheck 0 · lint clean
```

**Drift:** none.
