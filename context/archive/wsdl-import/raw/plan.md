---
change_id: wsdl-import
title: Import a WSDL file as SOAP templates, and send them like any call
produced-by: lz-plan
revision: 1
created: 2026-11-21
updated: 2026-11-21
inputs: change.md, spike-wsdl-parsing.md (holds), archive/openapi-import, archive/reimport-and-errors, lessons.md ("Probe what undici does")
---

# Plan: WSDL import

## Approach

- **Parser: `src/core/wsdl.ts`, using `fast-xml-parser@4`** (spike: holds, with namespace-URI lookup, not
  `removeNSPrefix`).
  - `parseWsdl(text)` returns `{ title, titled, ports[] }`. Each port has `{ service, port, soap: '1.1' | '1.2',
    address, operations[] }`, and each operation has `{ name, soapAction, element: { namespace, name }, children[] }`.
  - Children are the first-level `xsd:element` names of the input element's complex type.
  - Invalid XML is reported with `XMLValidator`'s line and column. A document that is not WSDL 1.1 is refused, and so
    is a port with no SOAP address.
- **Template.** Method `POST`; URL the port's address; body an XML envelope (SOAP 1.1 or 1.2 namespace) with the input
  element and an empty element per child.
  - SOAP 1.1: `Content-Type: text/xml; charset=utf-8` and `SOAPAction: "<action>"`.
  - SOAP 1.2: `Content-Type: application/soap+xml; charset=utf-8; action="<action>"`.
  - Directory: the port's name, prefixed by the service when the file has several services. Key: `port operation`.
- **Store.** `importWsdl({ text, filename, mode })` shares the re-import code with OpenAPI. Sources are `kind: 'wsdl'`.
  The listing's `path` is the operation name, and the tree shows a SOAP badge for WSDL sources.
- **Contract.** `pigeon:import-wsdl`; `TemplateSource.kind` gains `'wsdl'`.
- **UI.** The dialog's WSDL source is enabled: it accepts `.wsdl`/`.xml`, parses with `parseWsdl`, previews by port, and
  has no grouping or environment options, because SOAP addresses are absolute.
- **Lesson "Probe what undici does".** `SOAPAction` and the `action` parameter are new header shapes. An integration
  test sends both SOAP versions through `sendAndRecord` to the capture server. It checks the received headers equal
  the recorded list and the body bytes equal the envelope (T1.3).

## Alternatives rejected

| Alternative | Why it lost |
|---|---|
| `removeNSPrefix: true` | The spike showed it collapses `soap:operation` into `wsdl:operation` and loses the SOAP version. |
| `DOMParser` in the browser only | Not available in unit tests or on the server, and the server re-parses on import. |
| A SOAP client library (`soap`) | It generates calls, not templates, and brings much more than parsing. |

## Phases

### Phase 1: parse WSDL into SOAP templates, and the wire matches (lz-tdd)
- **Files:** `src/core/wsdl.ts`, its unit test, `src/core/wsdl.int.test.ts` (send to the capture server),
  `package.json`, `tech-stack.md`.

### Phase 2: import and list WSDL sources (lz-tdd)
- **Files:** `src/core/template-store.ts` and its int test; the contract, `ipc.ts`, `api.ts`, the all-operations test.

### Phase 3: the dialog's WSDL source and the SOAP tree (lz-e2e)
- **Files:** `src/renderer/app.tsx`, `e2e/templates.spec.ts`.
- **Scenario:** a WSDL is previewed by port and generated. A SOAP template opens with its envelope and `SOAPAction`,
  and sends to the capture server, where it is recorded.
