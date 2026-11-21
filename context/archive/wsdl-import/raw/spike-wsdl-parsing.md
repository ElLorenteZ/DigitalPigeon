---
produced-by: lz-spike
assumption: fast-xml-parser can read a WSDL 1.1 document's services, ports, SOAP 1.1 and 1.2 addresses, binding soapActions and each operation's input element, whatever prefix the WSDL namespace uses
verdict: holds
timebox: 30 min / about 15 min
versions: fast-xml-parser@4.5.7, Node v22.22.2
updated: 2026-11-21
---

# Spike: WSDL parsing

## Assumption
fast-xml-parser reads a WSDL 1.1 document well enough to make one template per operation: service, port, address,
SOAP version, soapAction, and the input element. This holds whether the WSDL namespace is the default namespace or has
a prefix (`wsdl:`).

## Prediction (written before running)
It holds with `removeNSPrefix: true`. Confidence: medium. SOAP 1.2 bindings may need separate handling.

## What happened
A one-file script parsed a sample WSDL with one service, two ports and two bindings (SOAP 1.1 and 1.2), each binding
with two operations. It printed every port's address, SOAP version, and each operation's soapAction and input element.

## Verdict: holds, but not as predicted

## Surprises
1. **`removeNSPrefix` breaks WSDL.** `soap:operation` inside `wsdl:operation` both become `operation`, so the
   soapAction disappeared (undefined). Stripping prefixes also loses the namespace that tells SOAP 1.1 from 1.2.
2. **Namespaces must be resolved by URI.** Keep the prefixes, read the root's `xmlns:*` declarations, and look up
   children by namespace URI plus local name. With that, the default-namespace and the `wsdl:`-prefixed documents
   give the same result.

## Not tried
- WSDL 2.0.
- Imports (`wsdl:import`, `xsd:import`), and namespaces declared on inner elements rather than the root.
- RPC style with multiple parts.
- Element type expansion into a full request body. The spike read the element's name only.

## What this means for the plan
- Add `fast-xml-parser@4` as a dependency, recorded in `tech-stack.md`.
- Parse in `src/core/wsdl.ts`, resolving names by namespace URI.
- Build a template's body as a SOAP envelope with the input element and its first-level children as empty elements.
  Send it as `POST` to the port's address, with `SOAPAction` (1.1) or `action` in the Content-Type (1.2).

## Code
Deleted. It lived in the session scratchpad as `spike-wsdl/`. The working lookup:

```js
const ns = {}; for (const [k, v] of Object.entries(root)) if (k.startsWith('@xmlns')) ns[k === '@xmlns' ? '' : k.slice(7)] = v;
const q = (uri, name) => { const x = Object.entries(ns).find(([, v]) => v === uri)?.[0]; return x === undefined ? null : x ? `${x}:${name}` : name; };
const kids = (node, uri, name) => [node?.[q(uri, name)]].flat().filter((v) => v !== undefined);
```
