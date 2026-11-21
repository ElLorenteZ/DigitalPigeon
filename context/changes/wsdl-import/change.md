---
change_id: wsdl-import
title: Import a WSDL file as SOAP templates, and send them like any call
status: closed
ticket: null
created: 2026-11-21
updated: 2026-11-21
closed: 2026-11-21
produced-by: lz-change
---

## Intent

Roadmap M2 slice 12: "Spike WSDL parsing first. A WSDL file previews and generates one template per operation, filed by
service and port; a SOAP template sends a `POST` with `SOAPAction` and an envelope, recorded like any call".

## Boundary

**This change covers:**
- Parsing WSDL 1.1 for SOAP 1.1 and 1.2 ports: their addresses, operations, soapActions and the input element with its
  first-level children.
- WSDL templates: one per operation, filed by port. Each is a `POST` to the port's address with the SOAP headers and an
  envelope body.
- The import dialog's WSDL source, with re-import and errors as for OpenAPI.

**Explicitly not in this change:**
- WSDL 2.0.
- `wsdl:import` and `xsd:import`.
- RPC style with several parts.
- Deep element expansion; the envelope has first-level children only.
- WS-Security.

## Notes

- Outcome (2026-11-21): closed as done. All 3 phases are verified, the review verdict is merge, and all 10
  code-review findings are fixed. Stacked PR on #10.
