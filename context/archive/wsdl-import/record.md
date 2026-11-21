---
change_id: wsdl-import
title: Import a WSDL file as SOAP templates, and send them like any call
produced-by: lz-archive
archived: 2026-11-21
change-opened: 2026-11-21
ticket: null
verdict: merge
outcome: shipped
milestone: M2, slice 12 (roadmap.md)
branch: wsdl-import, PR #11 (stacked on #10; archived on the branch before merge)
raw: raw/
---

## 1. What was built

- WSDL 1.1 import.
  - The dialog's WSDL source parses the file and previews its ports.
  - Generate files one SOAP template per operation by port, re-imported in place like OpenAPI.
  - A template is a `POST` to the port's address, with `SOAPAction` (SOAP 1.1) or `action` in the Content-Type
    (SOAP 1.2), and an envelope with the input element and its first-level children.
- SOAP sends are recorded like any call. A wire probe checks that both versions reach the server exactly as recorded.
- New dependency: `fast-xml-parser@4`.

**Differs from the plan:** code review turned the parser into a scoped namespace resolver. It added unqualified
children by default, named complex types, RPC wrappers, overload names, and one port-grouping rule.

## 2. Why this approach

WSDL names mean namespace URIs, so every lookup resolves a prefix with the declarations in scope at that element. The
same parser runs in the dialog, for the preview, and on the server, for the import. The template path reuses
everything slice 10 built.

## 3. What was rejected

- **`removeNSPrefix`.** The spike showed it merges `soap:operation` into `wsdl:operation` and loses the SOAP version.
- **Resolving with the root's declarations only.** The spike's approach. It failed on WSDL as generators write it.
- **A SOAP client library (`soap`).** It makes calls, not templates.
- **`DOMParser`.** It is not in Node or the unit tests.

## 4. Surprises

- The spike's tidy fixture hid five real-world shapes that code review found: nested namespace declarations, two
  prefixes for one namespace, unqualified schemas (the XSD default), named complex types, and RPC style. Its "Not
  tried" list named two of them.

## 5. What still stands

- The envelope has first-level children only. Nested types, `xsd:import`, WSDL 2.0 and WS-Security are not read.
- If a SOAP body is wrong for a server, check `elementFormDefault` and the RPC/document style in `src/core/wsdl.ts`
  first.
