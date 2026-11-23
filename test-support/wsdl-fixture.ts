// A WSDL 1.1 document with one service, a SOAP 1.1 port and a SOAP 1.2 port, two operations each (slice 12).
export const BILLING = `<?xml version="1.0" encoding="UTF-8"?>
<definitions name="BillingService" targetNamespace="http://example.com/billing"
  xmlns="http://schemas.xmlsoap.org/wsdl/" xmlns:soap="http://schemas.xmlsoap.org/wsdl/soap/"
  xmlns:soap12="http://schemas.xmlsoap.org/wsdl/soap12/"
  xmlns:tns="http://example.com/billing" xmlns:xsd="http://www.w3.org/2001/XMLSchema">
  <types><xsd:schema targetNamespace="http://example.com/billing">
    <xsd:element name="CreateInvoice"><xsd:complexType><xsd:sequence>
      <xsd:element name="customerId" type="xsd:string"/><xsd:element name="amount" type="xsd:decimal"/>
    </xsd:sequence></xsd:complexType></xsd:element>
    <xsd:element name="GetInvoice"><xsd:complexType><xsd:sequence><xsd:element name="id" type="xsd:string"/></xsd:sequence></xsd:complexType></xsd:element>
  </xsd:schema></types>
  <message name="CreateInvoiceIn"><part name="parameters" element="tns:CreateInvoice"/></message>
  <message name="GetInvoiceIn"><part name="parameters" element="tns:GetInvoice"/></message>
  <portType name="BillingPortType">
    <operation name="CreateInvoice"><input message="tns:CreateInvoiceIn"/></operation>
    <operation name="GetInvoice"><input message="tns:GetInvoiceIn"/></operation>
  </portType>
  <binding name="BillingBinding" type="tns:BillingPortType">
    <soap:binding style="document" transport="http://schemas.xmlsoap.org/soap/http"/>
    <operation name="CreateInvoice"><soap:operation soapAction="urn:CreateInvoice"/></operation>
    <operation name="GetInvoice"><soap:operation soapAction="urn:GetInvoice"/></operation>
  </binding>
  <binding name="BillingBinding12" type="tns:BillingPortType">
    <soap12:binding style="document" transport="http://schemas.xmlsoap.org/soap/http"/>
    <operation name="CreateInvoice"><soap12:operation soapAction="urn:CreateInvoice"/></operation>
    <operation name="GetInvoice"><soap12:operation soapAction="urn:GetInvoice"/></operation>
  </binding>
  <service name="BillingService">
    <port name="BillingPort" binding="tns:BillingBinding"><soap:address location="http://localhost:8080/billing"/></port>
    <port name="BillingPort12" binding="tns:BillingBinding12"><soap12:address location="http://localhost:8080/billing12"/></port>
  </service>
</definitions>`;

// Written as generators often write it (code review of wsdl-import, 1–5, 7): namespaces declared on nested elements,
// the WSDL namespace under two prefixes, unqualified schema elements, a named complexType, an RPC binding with typed
// parts, and an overloaded operation told apart by its input name.
export const GENERATED = `<?xml version="1.0"?>
<wsdl:definitions xmlns="http://schemas.xmlsoap.org/wsdl/" xmlns:wsdl="http://schemas.xmlsoap.org/wsdl/"
  name="Shop" targetNamespace="urn:shop">
  <wsdl:types>
    <schema xmlns="http://www.w3.org/2001/XMLSchema" xmlns:tns="urn:shop" targetNamespace="urn:shop">
      <element name="getItem" type="tns:getItemType"/>
      <complexType name="getItemType"><sequence><element name="sku" type="string"/></sequence></complexType>
      <element name="find"><complexType><sequence><element name="q" type="string"/></sequence></complexType></element>
      <element name="findAll"><complexType><sequence><element name="page" type="int"/></sequence></complexType></element>
    </schema>
  </wsdl:types>
  <wsdl:message name="getItemIn" xmlns:s="urn:shop"><wsdl:part name="p" element="s:getItem"/></wsdl:message>
  <wsdl:message name="findIn" xmlns:s="urn:shop"><wsdl:part name="p" element="s:find"/></wsdl:message>
  <wsdl:message name="findAllIn" xmlns:s="urn:shop"><wsdl:part name="p" element="s:findAll"/></wsdl:message>
  <wsdl:message name="pingIn"><wsdl:part name="host" type="xsd:string"/><wsdl:part name="count" type="xsd:int"/></wsdl:message>
  <wsdl:portType name="ShopType" xmlns:s="urn:shop">
    <wsdl:operation name="getItem"><wsdl:input message="s:getItemIn"/></wsdl:operation>
    <wsdl:operation name="find"><wsdl:input name="one" message="s:findIn"/></wsdl:operation>
    <wsdl:operation name="find"><wsdl:input name="all" message="s:findAllIn"/></wsdl:operation>
  </wsdl:portType>
  <wsdl:portType name="PingType" xmlns:s="urn:shop">
    <wsdl:operation name="ping"><wsdl:input message="s:pingIn"/></wsdl:operation>
  </wsdl:portType>
  <wsdl:binding name="ShopBinding" type="s:ShopType" xmlns:s="urn:shop" xmlns:soap12="http://schemas.xmlsoap.org/wsdl/soap12/">
    <soap12:binding style="document" transport="http://schemas.xmlsoap.org/soap/http"/>
    <wsdl:operation name="getItem"><soap12:operation soapAction="urn:getItem"/></wsdl:operation>
    <wsdl:operation name="find"><soap12:operation soapAction="urn:findOne"/><wsdl:input name="one"/></wsdl:operation>
    <wsdl:operation name="find"><soap12:operation soapAction="urn:findAll"/><wsdl:input name="all"/></wsdl:operation>
  </wsdl:binding>
  <wsdl:binding name="PingBinding" type="s:PingType" xmlns:s="urn:shop" xmlns:soap="http://schemas.xmlsoap.org/wsdl/soap/">
    <soap:binding style="rpc" transport="http://schemas.xmlsoap.org/soap/http"/>
    <wsdl:operation name="ping"><soap:operation soapAction="urn:ping"/>
      <wsdl:input><soap:body use="literal" namespace="urn:ping"/></wsdl:input></wsdl:operation>
  </wsdl:binding>
  <wsdl:service name="Shop" xmlns:s="urn:shop">
    <wsdl:port name="ShopPort" binding="s:ShopBinding"><soap12:address xmlns:soap12="http://schemas.xmlsoap.org/wsdl/soap12/" location="http://shop.test/soap"/></wsdl:port>
    <wsdl:port name="PingPort" binding="s:PingBinding"><soap:address xmlns:soap="http://schemas.xmlsoap.org/wsdl/soap/" location="http://shop.test/ping"/></wsdl:port>
  </wsdl:service>
</wsdl:definitions>`;
