// Slice 12 (wsdl-import): WSDL 1.1 into one SOAP template per operation, filed by port (spike-wsdl-parsing.md).
import { describe, expect, it } from 'vitest';
import { SpecError } from './openapi';
import { BILLING, GENERATED } from '../../test-support/wsdl-fixture';
import { groupPorts, parseWsdl, soapTemplate } from './wsdl';

const prefixed = BILLING.replace(
  'xmlns="http://schemas.xmlsoap.org/wsdl/"',
  'xmlns:wsdl="http://schemas.xmlsoap.org/wsdl/"',
).replace(
  /<(\/?)(definitions|types|message|part|portType|operation|input|binding|service|port)([ >/])/g,
  '<$1wsdl:$2$3',
);

describe('parseWsdl', () => {
  it('reads every port with its SOAP version, address, and operations with soapAction and input element', () => {
    for (const text of [BILLING, prefixed]) {
      const parsed = parseWsdl(text);
      expect(parsed.title).toBe('BillingService');
      expect(parsed.titled).toBe(true);
      expect(
        parsed.ports.map((p) => [p.service, p.port, p.soap, p.address]),
      ).toEqual([
        [
          'BillingService',
          'BillingPort',
          '1.1',
          'http://localhost:8080/billing',
        ],
        [
          'BillingService',
          'BillingPort12',
          '1.2',
          'http://localhost:8080/billing12',
        ],
      ]);
      expect(parsed.ports[0]?.operations).toEqual([
        {
          name: 'CreateInvoice',
          inputName: undefined,
          qualified: false,
          soapAction: 'urn:CreateInvoice',
          element: {
            namespace: 'http://example.com/billing',
            name: 'CreateInvoice',
          },
          children: ['customerId', 'amount'],
        },
        {
          name: 'GetInvoice',
          inputName: undefined,
          qualified: false,
          soapAction: 'urn:GetInvoice',
          element: {
            namespace: 'http://example.com/billing',
            name: 'GetInvoice',
          },
          children: ['id'],
        },
      ]);
    }
  });

  it('refuses invalid XML with its line and column, and what is not WSDL 1.1', () => {
    expect(() => parseWsdl('<definitions>\n  <oops>\n</definitions>')).toThrow(
      SpecError,
    );
    expect(() => parseWsdl('<definitions>\n  <oops>\n</definitions>')).toThrow(
      /line \d+, column \d+/,
    );
    expect(() => parseWsdl('<root/>')).toThrow(/not a WSDL 1.1 document/);
  });
});

describe('soapTemplate', () => {
  const parsed = parseWsdl(BILLING);

  it('makes a SOAP 1.1 POST with SOAPAction and an envelope', () => {
    const port = parsed.ports[0]!;
    const t = soapTemplate(port, port.operations[0]!);
    expect(t.method).toBe('POST');
    expect(t.url).toBe('http://localhost:8080/billing');
    expect(t.headerRows).toEqual([
      ['Content-Type', 'text/xml; charset=utf-8'],
      ['SOAPAction', '"urn:CreateInvoice"'],
    ]);
    expect(t.body).toEqual({
      type: 'xml',
      text: [
        '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:tns="http://example.com/billing">',
        '  <soap:Header/>',
        '  <soap:Body>',
        '    <tns:CreateInvoice>',
        '      <customerId></customerId>',
        '      <amount></amount>',
        '    </tns:CreateInvoice>',
        '  </soap:Body>',
        '</soap:Envelope>',
      ].join('\n'),
    });
  });

  it('makes a SOAP 1.2 POST with the action in the Content-Type', () => {
    const port = parsed.ports[1]!;
    const t = soapTemplate(port, port.operations[1]!);
    expect(t.headerRows).toEqual([
      [
        'Content-Type',
        'application/soap+xml; charset=utf-8; action="urn:GetInvoice"',
      ],
    ]);
    expect(t.body).toMatchObject({ type: 'xml' });
    expect(t.body?.type === 'xml' && t.body.text).toContain(
      'xmlns:soap="http://www.w3.org/2003/05/soap-envelope"',
    );
  });
});

// Code review of wsdl-import, 1–5, 7 and 8.
describe('parseWsdl: WSDL as generators write it', () => {
  const parsed = parseWsdl(GENERATED);
  const shop = parsed.ports.find((p) => p.port === 'ShopPort');
  const ping = parsed.ports.find((p) => p.port === 'PingPort');

  it('resolves prefixes declared on nested elements, and the WSDL namespace under two prefixes', () => {
    expect(parsed.title).toBe('Shop');
    expect(shop?.soap).toBe('1.2');
    expect(shop?.address).toBe('http://shop.test/soap');
    expect(ping?.soap).toBe('1.1');
  });

  it('reads children of a named complexType, unqualified by default', () => {
    const getItem = shop?.operations.find((o) => o.name === 'getItem');
    expect(getItem?.element).toEqual({
      namespace: 'urn:shop',
      name: 'getItem',
    });
    expect(getItem?.children).toEqual(['sku']);
    expect(getItem?.qualified).toBe(false);
    const body = soapTemplate(shop!, getItem!).body;
    expect(body?.type === 'xml' && body.text).toContain('<sku></sku>');
  });

  it('tells overloaded operations apart by input name', () => {
    const finds = shop?.operations.filter((o) => o.name === 'find');
    expect(finds?.map((o) => [o.inputName, o.soapAction, o.children])).toEqual([
      ['one', 'urn:findOne', ['q']],
      ['all', 'urn:findAll', ['page']],
    ]);
  });

  it('wraps an RPC operation in an element named after it, with its parts', () => {
    const op = ping?.operations[0];
    expect(op?.element).toEqual({ namespace: 'urn:ping', name: 'ping' });
    expect(op?.children).toEqual(['host', 'count']);
    const body = soapTemplate(ping!, op!).body;
    expect(body?.type === 'xml' && body.text).toContain('<tns:ping>');
    expect(body?.type === 'xml' && body.text).toContain('<host></host>');
  });

  it('groups ports into directories, one rule for preview and store', () => {
    expect([...groupPorts(parsed).keys()]).toEqual(['ShopPort', 'PingPort']);
  });
});
