// WSDL 1.1 into SOAP request templates (slice 12, wsdl-import). Every name is resolved by namespace URI with the
// declarations in scope at that element, never by stripping prefixes: `removeNSPrefix` merges soap:operation into
// wsdl:operation and loses the SOAP version (spike-wsdl-parsing.md, surprise 1), and generators declare prefixes on
// nested elements or bind one namespace to two prefixes (code review of wsdl-import, 2 and 3).
// Not read: WSDL 2.0, imports, nested element types beyond the first level.
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { SpecError } from './openapi';
import type { WireInput } from './wire';

const WSDL = 'http://schemas.xmlsoap.org/wsdl/';
const SOAP11 = 'http://schemas.xmlsoap.org/wsdl/soap/';
const SOAP12 = 'http://schemas.xmlsoap.org/wsdl/soap12/';
const XSD = 'http://www.w3.org/2001/XMLSchema';
const ENVELOPE = {
  '1.1': 'http://schemas.xmlsoap.org/soap/envelope/',
  '1.2': 'http://www.w3.org/2003/05/soap-envelope',
} as const;

export interface WsdlOperation {
  name: string;
  /** The input's name, which tells overloaded operations apart (code review, 7). */
  inputName: string | undefined;
  soapAction: string;
  element: { namespace: string; name: string } | null;
  /** First-level child element names of the input element. */
  children: string[];
  /** Whether the children are in the element's namespace (`elementFormDefault="qualified"`; code review, 1). */
  qualified: boolean;
}

export interface WsdlPort {
  service: string;
  port: string;
  soap: '1.1' | '1.2';
  address: string;
  operations: WsdlOperation[];
}

export interface ParsedWsdl {
  title: string;
  titled: boolean;
  ports: WsdlPort[];
}

/** An element with its attributes, its children by `{uri}local`, and the namespaces in scope. */
interface El {
  attrs: Record<string, string>;
  children: Map<string, El[]>;
  ns: Map<string, string>;
}

const key = (uri: string, local: string) => `{${uri}}${local}`;
const localOf = (qname: string) => qname.split(':').pop() ?? qname;

function normalize(raw: unknown, inherited: Map<string, string>): El {
  const ns = new Map(inherited);
  const attrs: Record<string, string> = {};
  const node =
    typeof raw === 'object' && raw !== null && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  for (const [name, value] of Object.entries(node)) {
    if (!name.startsWith('@')) continue;
    if (name === '@xmlns') ns.set('', String(value));
    else if (name.startsWith('@xmlns:')) ns.set(name.slice(7), String(value));
    else attrs[localOf(name.slice(1))] = String(value);
  }
  const children = new Map<string, El[]>();
  for (const [name, value] of Object.entries(node)) {
    if (name.startsWith('@') || name === '#text') continue;
    for (const item of Array.isArray(value) ? value : [value]) {
      const child = normalize(item, ns);
      const prefix = name.includes(':') ? name.split(':')[0] : '';
      const uri = child.ns.get(prefix as string) ?? '';
      const k = key(uri, localOf(name));
      children.set(k, [...(children.get(k) ?? []), child]);
    }
  }
  return { attrs, children, ns };
}

const kids = (el: El | undefined, uri: string, local: string) =>
  el?.children.get(key(uri, local)) ?? [];

/** A QName attribute value resolved with the namespaces in scope at its element. */
function qname(el: El, value: string | undefined) {
  if (!value) return null;
  const parts = value.split(':');
  const prefix = parts.length > 1 ? (parts[0] as string) : '';
  return { namespace: el.ns.get(prefix) ?? '', name: localOf(value) };
}

export function parseWsdl(text: string): ParsedWsdl {
  const valid = XMLValidator.validate(text);
  if (valid !== true) {
    throw new SpecError(
      `The file is not valid XML at line ${valid.err.line}, column ${valid.err.col}: ${valid.err.msg}`,
    );
  }
  const doc = normalize(
    new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@',
      parseTagValue: false,
    }).parse(text),
    new Map(),
  );
  const root = kids(doc, WSDL, 'definitions')[0];
  if (!root) {
    throw new SpecError(
      'The file is not a WSDL 1.1 document: it needs a definitions element in the WSDL namespace',
    );
  }

  const byName = (els: El[]) =>
    new Map(els.map((e) => [e.attrs.name ?? '', e]));
  const messages = byName(kids(root, WSDL, 'message'));
  const portTypes = byName(kids(root, WSDL, 'portType'));
  const bindings = byName(kids(root, WSDL, 'binding'));
  // Schema elements and named complex types, with whether their children are qualified.
  const elements = new Map<string, { el: El; qualified: boolean }>();
  const types = new Map<string, El>();
  for (const typesEl of kids(root, WSDL, 'types')) {
    for (const schema of kids(typesEl, XSD, 'schema')) {
      const qualified = schema.attrs.elementFormDefault === 'qualified';
      const tns = schema.attrs.targetNamespace ?? '';
      for (const el of kids(schema, XSD, 'element')) {
        elements.set(key(tns, el.attrs.name ?? ''), { el, qualified });
      }
      for (const type of kids(schema, XSD, 'complexType')) {
        types.set(key(tns, type.attrs.name ?? ''), type);
      }
    }
  }
  const sequenceNames = (type: El | undefined) =>
    kids(type, XSD, 'sequence')
      .flatMap((sequence) => kids(sequence, XSD, 'element'))
      .map((child) => child.attrs.name ?? '')
      .filter((name) => name !== '');
  // Inline anonymous type, or a named one by `type=` (code review, 4).
  const childrenOf = (el: El) => {
    const inline = kids(el, XSD, 'complexType')[0];
    if (inline) return sequenceNames(inline);
    const named = qname(el, el.attrs.type);
    return named
      ? sequenceNames(types.get(key(named.namespace, named.name)))
      : [];
  };

  const ports: WsdlPort[] = [];
  for (const service of kids(root, WSDL, 'service')) {
    for (const port of kids(service, WSDL, 'port')) {
      const bindingName = qname(port, port.attrs.binding)?.name ?? '';
      const binding = bindings.get(bindingName);
      if (!binding) continue;
      const soap: '1.1' | '1.2' | null =
        kids(binding, SOAP12, 'binding').length > 0
          ? '1.2'
          : kids(binding, SOAP11, 'binding').length > 0
            ? '1.1'
            : null;
      if (!soap) continue; // HTTP GET/POST bindings are not SOAP templates.
      const soapNs = soap === '1.2' ? SOAP12 : SOAP11;
      const style =
        kids(binding, soapNs, 'binding')[0]?.attrs.style ?? 'document';
      const address = kids(port, soapNs, 'address')[0]?.attrs.location ?? '';
      if (address === '') {
        throw new SpecError(
          `port "${port.attrs.name ?? ''}" of service "${service.attrs.name ?? ''}" has no SOAP address`,
        );
      }
      const portType = portTypes.get(
        qname(binding, binding.attrs.type)?.name ?? '',
      );
      const operations = kids(binding, WSDL, 'operation').map(
        (op): WsdlOperation => {
          const name = op.attrs.name ?? '';
          const inputName = kids(op, WSDL, 'input')[0]?.attrs.name;
          const soapOp = kids(op, soapNs, 'operation')[0];
          const abstract = kids(portType, WSDL, 'operation').find(
            (o) =>
              o.attrs.name === name &&
              (inputName === undefined ||
                kids(o, WSDL, 'input')[0]?.attrs.name === inputName),
          );
          const input = abstract ? kids(abstract, WSDL, 'input')[0] : undefined;
          const message = input
            ? messages.get(qname(input, input.attrs.message)?.name ?? '')
            : undefined;
          const parts = kids(message, WSDL, 'part');
          const base = {
            name,
            inputName,
            soapAction: soapOp?.attrs.soapAction ?? '',
          };
          // RPC: the body is an element named after the operation, its parts as children (code review, 5).
          if ((soapOp?.attrs.style ?? style) === 'rpc') {
            const body = kids(kids(op, WSDL, 'input')[0], soapNs, 'body')[0];
            return {
              ...base,
              element: {
                namespace:
                  body?.attrs.namespace ?? root.attrs.targetNamespace ?? '',
                name,
              },
              children: parts.map((p) => p.attrs.name ?? '').filter(Boolean),
              qualified: false,
            };
          }
          const element = parts[0]
            ? qname(parts[0], parts[0].attrs.element)
            : null;
          const declared = element
            ? elements.get(key(element.namespace, element.name))
            : undefined;
          return {
            ...base,
            element,
            children: declared ? childrenOf(declared.el) : [],
            qualified: declared?.qualified ?? false,
          };
        },
      );
      ports.push({
        service: service.attrs.name ?? '',
        port: port.attrs.name ?? '',
        soap,
        address,
        operations,
      });
    }
  }
  const title =
    root.attrs.name ?? kids(root, WSDL, 'service')[0]?.attrs.name ?? '';
  return { title: title || 'Untitled service', titled: title !== '', ports };
}

/** Directories for the ports: the service is named only when there are several (one rule for preview and store). */
export function groupPorts(wsdl: ParsedWsdl): Map<string, WsdlPort> {
  const services = new Set(wsdl.ports.map((p) => p.service));
  return new Map(
    wsdl.ports.map((port) => [
      services.size > 1 ? `${port.service}.${port.port}` : port.port,
      port,
    ]),
  );
}

/** The request a SOAP template sends: a POST to the port's address with an envelope (slice 12). */
export function soapTemplate(port: WsdlPort, op: WsdlOperation): WireInput {
  const headerRows: [string, string][] =
    port.soap === '1.1'
      ? [
          ['Content-Type', 'text/xml; charset=utf-8'],
          ['SOAPAction', `"${op.soapAction}"`],
        ]
      : [
          [
            'Content-Type',
            `application/soap+xml; charset=utf-8${op.soapAction ? `; action="${op.soapAction}"` : ''}`,
          ],
        ];
  const child = (name: string) =>
    op.qualified ? `<tns:${name}></tns:${name}>` : `<${name}></${name}>`;
  const body = op.element
    ? [
        `    <tns:${op.element.name}>`,
        ...op.children.map((c) => `      ${child(c)}`),
        `    </tns:${op.element.name}>`,
      ]
    : [];
  const tns =
    op.element && op.element.namespace
      ? ` xmlns:tns="${op.element.namespace}"`
      : '';
  return {
    method: 'POST',
    url: port.address,
    queryRows: [],
    headerRows,
    body: {
      type: 'xml',
      text: [
        `<soap:Envelope xmlns:soap="${ENVELOPE[port.soap]}"${tns}>`,
        '  <soap:Header/>',
        '  <soap:Body>',
        ...body,
        '  </soap:Body>',
        '</soap:Envelope>',
      ].join('\n'),
    },
  };
}
