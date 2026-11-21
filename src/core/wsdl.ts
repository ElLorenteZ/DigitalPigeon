// WSDL 1.1 into SOAP request templates (slice 12, wsdl-import). Names are resolved by namespace URI from the root's
// xmlns declarations: `removeNSPrefix` would merge soap:operation into wsdl:operation and lose the SOAP version
// (spike-wsdl-parsing.md, surprise 1). Not read: WSDL 2.0, imports, RPC with several parts, nested element types.
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
  soapAction: string;
  element: { namespace: string; name: string } | null;
  /** First-level child element names of the input element. */
  children: string[];
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

type Node = Record<string, unknown>;
const isNode = (v: unknown): v is Node =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown) => (typeof v === 'string' ? v : '');
const local = (qname: string) => qname.split(':').pop() ?? qname;

export function parseWsdl(text: string): ParsedWsdl {
  const valid = XMLValidator.validate(text);
  if (valid !== true) {
    throw new SpecError(
      `The file is not valid XML at line ${valid.err.line}, column ${valid.err.col}: ${valid.err.msg}`,
    );
  }
  const doc = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@',
    parseTagValue: false,
  }).parse(text) as Node;

  const rootKey = Object.keys(doc).find((k) => local(k) === 'definitions');
  const root = rootKey ? doc[rootKey] : undefined;
  // Namespaces declared on the root, by prefix ('' is the default).
  const ns = new Map<string, string>();
  if (isNode(root)) {
    for (const [key, value] of Object.entries(root)) {
      if (key === '@xmlns') ns.set('', str(value));
      else if (key.startsWith('@xmlns:')) ns.set(key.slice(7), str(value));
    }
  }
  const prefixOf = (uri: string) =>
    [...ns].find(([, value]) => value === uri)?.[0];
  if (!isNode(root) || rootKey !== qualified(prefixOf(WSDL), 'definitions')) {
    throw new SpecError(
      'The file is not a WSDL 1.1 document: it needs a definitions element in the WSDL namespace',
    );
  }
  const kids = (node: unknown, uri: string, name: string): Node[] => {
    const prefix = prefixOf(uri);
    if (prefix === undefined || !isNode(node)) return [];
    const value = node[qualified(prefix, name)];
    return (
      Array.isArray(value) ? value : value === undefined ? [] : [value]
    ).filter(isNode);
  };
  const namespaceOf = (qname: string) => {
    const parts = qname.split(':');
    return ns.get(parts.length > 1 ? (parts[0] as string) : '') ?? '';
  };

  const byName = (nodes: Node[]) =>
    new Map(nodes.map((n) => [str(n['@name']), n]));
  const messages = byName(kids(root, WSDL, 'message'));
  const portTypes = byName(kids(root, WSDL, 'portType'));
  const bindings = byName(kids(root, WSDL, 'binding'));
  const elements = new Map<string, Node>();
  for (const types of kids(root, WSDL, 'types')) {
    for (const schema of kids(types, XSD, 'schema')) {
      for (const element of kids(schema, XSD, 'element')) {
        elements.set(str(element['@name']), element);
      }
    }
  }
  const childrenOf = (elementName: string) =>
    kids(elements.get(elementName), XSD, 'complexType')
      .flatMap((type) => kids(type, XSD, 'sequence'))
      .flatMap((sequence) => kids(sequence, XSD, 'element'))
      .map((child) => str(child['@name']))
      .filter((name) => name !== '');

  const ports: WsdlPort[] = [];
  for (const service of kids(root, WSDL, 'service')) {
    for (const port of kids(service, WSDL, 'port')) {
      const binding = bindings.get(local(str(port['@binding'])));
      if (!binding) continue;
      const soap = kids(binding, SOAP12, 'binding').length > 0 ? '1.2' : '1.1';
      const soapNs = soap === '1.2' ? SOAP12 : SOAP11;
      if (soap === '1.1' && kids(binding, SOAP11, 'binding').length === 0) {
        continue; // Not a SOAP binding (HTTP GET/POST bindings are not templates).
      }
      const address = str(kids(port, soapNs, 'address')[0]?.['@location']);
      if (address === '') {
        throw new SpecError(
          `port "${str(port['@name'])}" of service "${str(service['@name'])}" has no SOAP address`,
        );
      }
      const portType = portTypes.get(local(str(binding['@type'])));
      const operations = kids(binding, WSDL, 'operation').map((op) => {
        const name = str(op['@name']);
        const abstract = kids(portType, WSDL, 'operation').find(
          (o) => str(o['@name']) === name,
        );
        const message = messages.get(
          local(str(kids(abstract, WSDL, 'input')[0]?.['@message'])),
        );
        const elementName = str(kids(message, WSDL, 'part')[0]?.['@element']);
        return {
          name,
          soapAction: str(kids(op, soapNs, 'operation')[0]?.['@soapAction']),
          element: elementName
            ? { namespace: namespaceOf(elementName), name: local(elementName) }
            : null,
          children: elementName ? childrenOf(local(elementName)) : [],
        };
      });
      ports.push({
        service: str(service['@name']),
        port: str(port['@name']),
        soap,
        address,
        operations,
      });
    }
  }
  const title =
    str(root['@name']) || str(kids(root, WSDL, 'service')[0]?.['@name']);
  return { title: title || 'Untitled service', titled: title !== '', ports };
}

const qualified = (prefix: string | undefined, name: string) =>
  prefix ? `${prefix}:${name}` : name;

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
  const body = op.element
    ? [
        `    <tns:${op.element.name}>`,
        ...op.children.map((c) => `      <tns:${c}></tns:${c}>`),
        `    </tns:${op.element.name}>`,
      ]
    : [];
  const tns = op.element ? ` xmlns:tns="${op.element.namespace}"` : '';
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
